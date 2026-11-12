/**
 * Security audit proof-of-concept tests for the v7.1.0 messaging stack.
 * These tests demonstrate attack behavior against GiftWrapReceiver and the
 * wrapped (NIP-17) client. They are NOT part of the package's normal suite.
 *
 * Areas covered:
 *  1. NIP-59 sender spoofing / rumor-store poisoning / seal-id forgery
 *  2. Cross-envelope rumor reuse (id collision) author-binding
 *  3. Error isolation: one hostile envelope must not kill the inbox stream
 *  4. Forged processing checkpoints (repair path and trust boundary)
 *  5. NIP-17 outgoing envelope recipient binding + timestamp randomization
 */
import { GiftWrapFactory } from "applesauce-common/factories";
import { getGiftWrapRumor, getGiftWrapSeal, getRumorSeals } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { RumorStore } from "applesauce-core/event-store";
import { finalizeEvent, getEventHash, kinds, unixNow, type NostrEvent, type Rumor } from "applesauce-core/helpers";
import { nip44 } from "applesauce-core/helpers/encryption";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { firstValueFrom, Subject, type Subscription } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WrappedMessagesClient } from "../../messages/wrapped/client.js";
import { GiftWrapReceiver } from "../receiver.js";
import type { GiftWrapProcessingRecord, GiftWrapProcessingStore, GiftWrapReceiverOptions } from "../types.js";

const victim = new PrivateKeySigner(new Uint8Array(32).fill(22));
const victimPubkey = await victim.getPublicKey();
const sender = new PrivateKeySigner(new Uint8Array(32).fill(21));
const senderPubkey = await sender.getPublicKey();
const attacker = new PrivateKeySigner(new Uint8Array(32).fill(99));
const attackerPubkey = await attacker.getPublicKey();
const bystander = new PrivateKeySigner(new Uint8Array(32).fill(55));
const bystanderPubkey = await bystander.getPublicKey();

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  disposables.splice(0).forEach((value) => value.dispose());
  vi.restoreAllMocks();
});

function own<T extends { dispose(): void }>(value: T): T {
  disposables.push(value);
  return value;
}

async function envelope(signer = sender, recipientPubkey = victimPubkey, kind = 1, content = "hello") {
  const template = {
    kind,
    pubkey: await signer.getPublicKey(),
    created_at: unixNow(),
    tags: [],
    content,
  };
  const rumor = { ...template, id: getEventHash(template) };
  const gift = await GiftWrapFactory.create(signer, recipientPubkey, rumor);
  return { rumor, event: JSON.parse(JSON.stringify(gift)) as NostrEvent };
}

/** Hand-builds a gift wrap with full control over the seal JSON (no factory checks). */
async function craftedWrap(rumor: Rumor, sealSignerKey: Uint8Array) {
  const sealDraft = {
    kind: kinds.Seal,
    pubkey: getPublicKey(sealSignerKey),
    created_at: unixNow() - 30,
    tags: [],
    content: nip44.v2.encrypt(JSON.stringify(rumor), nip44.getConversationKey(sealSignerKey, victimPubkey)),
  };
  const seal = finalizeEvent(sealDraft, sealSignerKey);

  const ephemeralKey = generateSecretKey();
  const wrapDraft = {
    kind: kinds.GiftWrap,
    pubkey: getPublicKey(ephemeralKey),
    created_at: unixNow() - 10,
    tags: [["p", victimPubkey]],
    content: nip44.v2.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephemeralKey, victimPubkey)),
  };
  return finalizeEvent(wrapDraft, ephemeralKey);
}

function setup(overrides: Partial<GiftWrapReceiverOptions> = {}) {
  const arrivals = new Subject<NostrEvent>();
  const pool = {
    subscription: vi.fn(
      () =>
        new Observable<NostrEvent>((subscriber) => {
          const subscription = arrivals.subscribe(subscriber);
          return () => subscription.unsubscribe();
        }),
    ),
  };
  const eventStore = new EventStore();
  const receiver = own(
    new GiftWrapReceiver({
      pubkey: victimPubkey,
      eventStore,
      pool: pool as unknown as RelayPool,
      signer: victim,
      relays: ["wss://inbox.test"],
      ...overrides,
    }),
  );
  return { receiver, eventStore, pool, arrivals };
}

function processingStorage(records: Map<string, GiftWrapProcessingRecord>): GiftWrapProcessingStore {
  return {
    list: () => structuredClone([...records.values()]),
    set: (record) => {
      records.set(record.eventId, structuredClone(record));
    },
  };
}

describe("NIP-59 unwrap verification (audit PoC)", () => {
  it("rejects a seal whose author does not match the claimed rumor author (sender spoofing)", async () => {
    // Attacker signs the seal, but the rumor claims a different author (bystander).
    const spoofed: Rumor = {
      kind: 1,
      pubkey: bystanderPubkey,
      created_at: unixNow(),
      tags: [],
      content: "I am bystander (spoofed)",
      id: "",
    };
    spoofed.id = getEventHash(spoofed);
    const wrap = await craftedWrap(spoofed, attacker.key);

    const { receiver } = setup();
    await expect(receiver.unlock(wrap)).rejects.toThrow();
    expect(await firstValueFrom(receiver.rumors$)).toHaveLength(0);
  });

  it("rejects a rumor whose id does not match its contents (id collision / tampering)", async () => {
    const tampered: Rumor = {
      kind: 1,
      pubkey: attackerPubkey,
      created_at: unixNow(),
      tags: [],
      content: "attacker message",
      id: "f".repeat(64), // id does not hash the contents
    };
    const wrap = await craftedWrap(tampered, attacker.key);

    const { receiver } = setup();
    await expect(receiver.unlock(wrap)).rejects.toThrow();
    expect(await firstValueFrom(receiver.rumors$)).toHaveLength(0);
  });

  it("rejects a seal whose id is not its event hash (forged lookup key)", async () => {
    // Build a seal signed by the attacker, then corrupt its id before wrapping it.
    const rumor: Rumor = {
      kind: 1,
      pubkey: attackerPubkey,
      created_at: unixNow(),
      tags: [],
      content: "attacker message",
      id: "",
    };
    rumor.id = getEventHash(rumor);
    const sealDraft = {
      kind: kinds.Seal,
      pubkey: attackerPubkey,
      created_at: unixNow() - 30,
      tags: [],
      content: nip44.v2.encrypt(JSON.stringify(rumor), nip44.getConversationKey(attacker.key, victimPubkey)),
    };
    const forgedSeal = finalizeEvent(sealDraft, attacker.key);
    (forgedSeal as { id: string }).id = "a".repeat(64); // claim an id the signature never covered

    const ephemeralKey = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: kinds.GiftWrap,
        pubkey: getPublicKey(ephemeralKey),
        created_at: unixNow() - 10,
        tags: [["p", victimPubkey]],
        content: nip44.v2.encrypt(JSON.stringify(forgedSeal), nip44.getConversationKey(ephemeralKey, victimPubkey)),
      },
      ephemeralKey,
    );

    const { receiver } = setup();
    await expect(receiver.unlock(wrap)).rejects.toThrow();
    expect(await firstValueFrom(receiver.rumors$)).toHaveLength(0);
  });

  it("does not reuse another sender's rumor instance through an id collision", async () => {
    // Sender A sends a real message to the victim.
    const { rumor, event } = await envelope();
    const { receiver, eventStore } = setup();
    eventStore.add(event);
    const first = await receiver.unlock(event);
    expect(first.id).toBe(rumor.id);

    // Attacker learns the rumor JSON (assume it leaked) and wraps the identical
    // rumor under their own seal. The rumor id therefore collides with the
    // existing instance in the internal gift-wrap event set.
    const leak: Rumor = JSON.parse(
      // The seal plaintext of the original envelope is exactly the rumor JSON.
      nip44.v2.decrypt(
        JSON.parse(await victim.nip44.decrypt(event.pubkey, event.content)).content,
        nip44.getConversationKey(victim.key, getGiftWrapSeal(event)!.pubkey),
      ),
    );
    expect(leak.id).toBe(rumor.id);
    const attackerWrap = await craftedWrap(leak, attacker.key);

    await expect(receiver.unlock(attackerWrap)).rejects.toThrow();
    // The rumor store must still hold exactly one rumor, attributed to the real sender.
    const stored = await firstValueFrom(receiver.rumors$);
    expect(stored).toHaveLength(1);
    expect(stored[0].pubkey).toBe(senderPubkey);
    // And the attacker's seal must not have been attached to the rumor's parent set.
    expect(getRumorSeals(stored[0]).map((seal) => seal.pubkey)).not.toContain(attackerPubkey);
  });
});

describe("inbox error isolation (audit PoC)", () => {
  it("keeps processing good envelopes around a hostile one and never errors the stream", async () => {
    const goodA = await envelope(sender, victimPubkey, 1, "good A");
    const goodC = await envelope(sender, victimPubkey, 1, "good C");

    // Hostile envelope: validly signed wrap whose seal plaintext is not JSON.
    const ephemeralKey = generateSecretKey();
    const hostile = finalizeEvent(
      {
        kind: kinds.GiftWrap,
        pubkey: getPublicKey(ephemeralKey),
        created_at: unixNow(),
        tags: [["p", victimPubkey]],
        content: nip44.v2.encrypt("}not json{", nip44.getConversationKey(ephemeralKey, victimPubkey)),
      },
      ephemeralKey,
    );

    const { receiver, eventStore } = setup({ autoUnlock: true });
    const results: string[] = [];
    let streamError: unknown = "none";
    const subscription = receiver.receive$.subscribe({
      next: (result) => results.push(result.status === "success" ? `ok:${result.rumor.id}` : `fail:${result.failure.code}`),
      error: (error) => (streamError = error),
    });

    eventStore.add(goodA.event);
    eventStore.add(hostile);
    eventStore.add(goodC.event);

    await vi.waitFor(
      () => {
        expect(results.filter((result) => result.startsWith("ok:"))).toHaveLength(2);
        expect(results).toContainEqual(expect.stringMatching(/^fail:/));
      },
      { timeout: 15000 },
    );

    expect(streamError).toBe("none");
    subscription.unsubscribe();

    // The receiver is still fully operational after the hostile envelope.
    const unlocked = await receiver.unlock(goodA.event);
    expect(unlocked.id).toBe(goodA.rumor.id);
  });
});

describe("forged processing checkpoints (audit PoC)", () => {
  it("repairs a forged completed checkpoint whose rumor is missing from the store", async () => {
    const { rumor, event } = await envelope();
    const records = new Map<string, GiftWrapProcessingRecord>();
    records.set(event.id, {
      version: 1,
      eventId: event.id,
      status: "completed",
      stage: "checkpoint",
      attempts: 1,
      rumorId: "b".repeat(64), // forged: no such rumor in the store
    });

    const { receiver, eventStore } = setup({ processingStore: processingStorage(records) });
    eventStore.add(event);
    // The receiver must not trust the forged completion: it re-processes and returns the real rumor.
    const unlocked = await receiver.unlock(event);
    expect(unlocked.id).toBe(rumor.id);
  });

  it("skips an envelope permanently on a forged failed checkpoint (trust boundary)", async () => {
    const { rumor, event } = await envelope();
    const records = new Map<string, GiftWrapProcessingRecord>();
    records.set(event.id, {
      version: 1,
      eventId: event.id,
      status: "failed",
      stage: "seal",
      attempts: 1,
      failure: {
        eventId: event.id,
        stage: "seal",
        code: "invalid-seal",
        attempts: 1,
        retry: "never",
        message: "forged",
      },
    });

    const { receiver, eventStore } = setup({ processingStore: processingStorage(records) });
    eventStore.add(event);
    // Bulk processing trusts the forged failure and never decrypts the envelope...
    await receiver.unlock(undefined);
    expect(await firstValueFrom(receiver.rumors$)).toHaveLength(0);
    // ...but an explicit per-envelope unlock still re-processes it.
    const unlocked = await receiver.unlock(event);
    expect(unlocked.id).toBe(rumor.id);
  });

  it("trusts a forged completed checkpoint only as far as the shared rumor store", async () => {
    // Demonstrates the documented trust boundary: an attacker with write access to BOTH
    // the checkpoint store and the rumor store can re-attribute an envelope without
    // decryption. The library cannot defend this; the stores are application-owned.
    const attackerMessage = await envelope(attacker, victimPubkey, 1, "attacker content");
    const privateMessage = await envelope(sender, victimPubkey, 1, "private content");

    const { receiver, eventStore } = setup();
    eventStore.add(attackerMessage.event);
    await receiver.unlock(attackerMessage.event); // attacker rumor now sits in the rumor store

    const records = new Map<string, GiftWrapProcessingRecord>();
    records.set(privateMessage.event.id, {
      version: 1,
      eventId: privateMessage.event.id,
      status: "completed",
      stage: "checkpoint",
      attempts: 1,
      rumorId: attackerMessage.rumor.id,
    });
    // Attach the forged store through a new receiver sharing the SAME rumor store.
    const forgedReceiver = own(
      new GiftWrapReceiver({
        pubkey: victimPubkey,
        eventStore,
        pool: { subscription: () => new Subject() } as unknown as RelayPool,
        signer: victim,
        relays: ["wss://inbox.test"],
        rumorStore: receiver.rumorStore,
        processingStore: processingStorage(records),
      }),
    );
    eventStore.add(privateMessage.event);
    const result = await forgedReceiver.unlock(privateMessage.event);
    // Confirmed: the forged checkpoint substitutes the attacker's rumor for the private one.
    expect(result.id).toBe(attackerMessage.rumor.id);
    expect(result.content).toBe("attacker content");
  });
});

describe("NIP-17 outgoing envelope binding (audit PoC)", () => {
  it("wraps each message once per recipient to that recipient only, with randomized timestamps", async () => {
    const bobKey = new Uint8Array(32).fill(2);
    const carolKey = new Uint8Array(32).fill(3);
    const bob = new PrivateKeySigner(bobKey);
    const carol = new PrivateKeySigner(carolKey);
    const bobPubkey = await bob.getPublicKey();
    const carolPubkey = await carol.getPublicKey();

    const eventStore = new EventStore();
    for (const key of [victim.key, bobKey, carolKey])
      eventStore.add(
        finalizeEvent(
          {
            kind: kinds.DirectMessageRelaysList,
            created_at: unixNow(),
            tags: [["relay", "wss://dm.test/"]],
            content: "",
          },
          key,
        ),
      );
    const publish = vi.fn(async (_relays: string[], _event: NostrEvent) => [{ from: "wss://dm.test/", ok: true }]);
    const pool = {
      req: () => new Subject(),
      subscription: () => new Subject<NostrEvent>(),
      relay: () => ({ getSupported: async () => [], getLimitations: async () => ({}) }),
      publish,
    };
    const client = own(
      new WrappedMessagesClient({
        pubkey: victimPubkey,
        signer: victim,
        eventStore,
        pool: pool as unknown as RelayPool,
        timeout: 5,
      }),
    );

    const conversation = client.conversation([bobPubkey, carolPubkey]);
    const message = await conversation.send({ content: "group hello" });

    expect(publish).toHaveBeenCalledTimes(3); // bob + carol + self copy
    const published = publish.mock.calls.map((call) => call[1] as NostrEvent);
    const recipients = new Set(published.map((event) => event.tags.find((tag) => tag[0] === "p")![1]));
    expect(recipients).toEqual(new Set([bobPubkey, carolPubkey, victimPubkey]));

    const now = unixNow();
    for (const wrap of published) {
      const recipientPubkey = wrap.tags.find((tag) => tag[0] === "p")![1];
      const recipientSigner =
        recipientPubkey === bobPubkey ? bob : recipientPubkey === carolPubkey ? carol : victim;

      // NIP-59 timestamp randomization: within the last hour, not exactly now.
      expect(wrap.created_at).toBeLessThanOrEqual(now);
      expect(wrap.created_at).toBeGreaterThanOrEqual(now - 3600);

      // The wrap's outer key is ephemeral, not the sender's.
      expect(wrap.pubkey).not.toBe(victimPubkey);

      // Only the intended recipient (or the sender) can open the outer layer.
      const sealJson = await recipientSigner.nip44.decrypt(wrap.pubkey, wrap.content);
      const seal = JSON.parse(sealJson) as NostrEvent;
      expect(seal.pubkey).toBe(victimPubkey);

      // Every other party's key must fail to open the outer layer.
      for (const other of [bob, carol, victim]) {
        if ((await other.getPublicKey()) === recipientPubkey) continue;
        await expect(other.nip44.decrypt(wrap.pubkey, wrap.content)).rejects.toThrow();
      }

      // The inner rumor is identical for every recipient; the seal layer is
      // encrypted to the recipient, so they open it with their own key.
      const rumorJson = await recipientSigner.nip44.decrypt(seal.pubkey, seal.content);
      const inner = JSON.parse(rumorJson) as Rumor;
      expect(inner.id).toBe(message.id);
      expect(inner.content).toBe("group hello");
    }

    // No plaintext ever leaves the client: all published contents are NIP-44 ciphertext.
    for (const wrap of published) expect(wrap.content.startsWith("{")).toBe(false);
  });
});
