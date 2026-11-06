import { EventStore } from "applesauce-core";
import { LegacyMessageFactory } from "applesauce-common/factories";
import {
  getEncryptedContent,
  isEncryptedContentUnlocked,
  kinds,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner, type ISigner } from "applesauce-signers";
import { EMPTY, firstValueFrom, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient } from "../legacy/client.js";
import { LegacyInboxReceiver } from "../legacy/inbox-receiver.js";
import type { LegacyInboxReceiverOptions, LegacyReadResult } from "../legacy/types.js";

const ownerSigner = new PrivateKeySigner(new Uint8Array(32).fill(1));
const peerSigner = new PrivateKeySigner(new Uint8Array(32).fill(2));
const otherSigner = new PrivateKeySigner(new Uint8Array(32).fill(3));
const owner = await ownerSigner.getPublicKey();
const peer = await peerSigner.getPublicKey();
const disposables: { dispose(): void }[] = [];

afterEach(() => {
  for (const disposable of disposables.splice(0)) disposable.dispose();
  vi.restoreAllMocks();
});

function own<T extends { dispose(): void }>(value: T): T {
  disposables.push(value);
  return value;
}

/** Creates a signer whose NIP-04 decryption can be observed or replaced */
function mockSigner(decrypt = (pubkey: string, ciphertext: string) => ownerSigner.nip04.decrypt(pubkey, ciphertext)) {
  const spy = vi.fn(decrypt);
  const signer: ISigner = {
    getPublicKey: () => ownerSigner.getPublicKey(),
    signEvent: (draft) => ownerSigner.signEvent(draft),
    nip04: { encrypt: (pubkey, plaintext) => ownerSigner.nip04.encrypt(pubkey, plaintext), decrypt: spy },
  };

  return { signer, decrypt: spy };
}

function setup(overrides: Partial<LegacyInboxReceiverOptions> = {}) {
  const eventStore = new EventStore();
  const subscriptions = new Subject<NostrEvent>();
  const pool = {
    subscription: vi.fn((_relays: string[], _filter: Filter) => subscriptions),
    relay: vi.fn(() => ({ getSupported: async () => [], getLimitations: async () => ({}), request: () => EMPTY })),
    publish: vi.fn(async () => [{ from: "wss://dm.test/", ok: true }]),
  };
  const { signer, decrypt } = mockSigner();
  const options: LegacyInboxReceiverOptions = {
    pubkey: owner,
    signer,
    eventStore,
    pool: pool as unknown as RelayPool,
    fallbackRelays: ["wss://dm.test/"],
    timeout: 1,
    ...overrides,
  };

  return { eventStore, pool, options, decrypt };
}

async function message(content: string, from = peerSigner, to = owner) {
  const event = await LegacyMessageFactory.create(to, content).sign(from);
  return JSON.parse(JSON.stringify(event)) as NostrEvent;
}

async function collect(results: AsyncGenerator<LegacyReadResult>) {
  const collected: LegacyReadResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("LegacyInboxReceiver", () => {
  it("reads each loaded message once and ends when none remain", async () => {
    const { eventStore, options, decrypt } = setup();
    const receiver = own(new LegacyInboxReceiver(options));
    const events = [await message("one"), await message("two")];
    for (const event of events) eventStore.add(event);

    const results = await collect(receiver.readInbox());

    expect(results.map((result) => result.status)).toEqual(["success", "success"]);
    expect(events.map(getEncryptedContent).sort()).toEqual(["one", "two"]);
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(await receiver.readNext()).toBeUndefined();
  });

  it("does not read failed messages again until they are retried", async () => {
    const rejection = new Error("rejected");
    const { signer, decrypt } = mockSigner(async () => {
      throw rejection;
    });
    const { eventStore, options } = setup({ signer });
    const receiver = own(new LegacyInboxReceiver(options));
    const event = await message("retry");
    eventStore.add(event);

    expect(await collect(receiver.readInbox())).toMatchObject([{ status: "failed", failure: { cause: rejection } }]);
    expect(await receiver.readNext()).toBeUndefined();

    decrypt.mockImplementation((pubkey, ciphertext) => ownerSigner.nip04.decrypt(pubkey, ciphertext));
    expect(await collect(receiver.retryFailed())).toMatchObject([{ status: "success", event }]);
    expect(getEncryptedContent(event)).toBe("retry");
  });

  it("decrypts stored arrivals only while automatic unlocking is enabled", async () => {
    const { eventStore, options, decrypt } = setup();
    const receiver = own(new LegacyInboxReceiver(options));
    const results: LegacyReadResult[] = [];
    receiver.receive$.subscribe((result) => results.push(result));

    eventStore.add(await message("locked"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(decrypt).not.toHaveBeenCalled();

    receiver.setAutoUnlock(true);
    const unlocked = await message("unlocked");
    eventStore.add(unlocked);

    await vi.waitFor(() => expect(results).toContainEqual({ status: "success", event: unlocked }));
  });

  it("watches the owner's inbox and outbox mailboxes and reports their failures", async () => {
    const { options, pool } = setup();
    const receiver = own(new LegacyInboxReceiver(options));
    const errors: unknown[] = [];
    receiver.errors$.subscribe((error) => errors.push(error));

    await receiver.start();

    const filters = pool.subscription.mock.calls.map(([, filter]) => filter);
    expect(filters).toMatchObject([
      { kinds: [kinds.EncryptedDirectMessage], "#p": [owner] },
      { kinds: [kinds.EncryptedDirectMessage], authors: [owner] },
    ]);

    const failure = new Error("offline");
    pool.subscription.mock.results[0].value.error(failure);
    expect(errors).toContainEqual({
      operation: "read",
      error: failure,
      mailbox: "incoming",
      relays: ["wss://dm.test/"],
    });

    receiver.stop();
    expect(await firstValueFrom(receiver.lifecycle$)).toBe("idle");
  });
  it("shares live mailbox subscriptions between start() and watchers", async () => {
    const { options, pool } = setup();
    const receiver = own(new LegacyInboxReceiver(options));

    await receiver.start();
    const first = receiver.watch$.subscribe();
    const second = receiver.watch$.subscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pool.subscription).toHaveBeenCalledTimes(2);
    first.unsubscribe();
    second.unsubscribe();
    expect(pool.subscription.mock.results.every(({ value }) => value.observed)).toBe(true);

    receiver.stop();
    expect(pool.subscription.mock.results.every(({ value }) => !value.observed)).toBe(true);
  });
});

describe("LegacyConversationReceiver", () => {
  it("reads both directions from the owner's and the correspondent's relays", async () => {
    const { eventStore, options, pool } = setup();
    const peerRelays = await peerSigner.signEvent({
      kind: kinds.RelayList,
      created_at: 1,
      content: "",
      tags: [["r", "wss://peer.test/"]],
    });
    eventStore.add(peerRelays);
    const client = own(new LegacyMessagesClient(options));

    client.conversation(peer).receiver.start();

    const calls = pool.subscription.mock.calls.map(([relays, filter]) => ({ relays, filter }));
    expect(calls).toMatchObject([
      { relays: ["wss://peer.test/"], filter: { "#p": [owner], authors: [peer] } },
      { relays: ["wss://peer.test/"], filter: { authors: [owner], "#p": [peer] } },
    ]);
  });

  it("shares decryption with the inbox so an event loaded by both modes is decrypted once", async () => {
    const { eventStore, options, decrypt } = setup({ autoUnlock: true });
    const client = own(new LegacyMessagesClient(options));
    const conversation = client.conversation(peer);

    await client.start();
    await conversation.start();
    const event = await message("once");
    eventStore.add(event);

    await vi.waitFor(() => expect(isEncryptedContentUnlocked(event)).toBe(true));
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("rejects messages from another conversation", async () => {
    const { options } = setup();
    const client = own(new LegacyMessagesClient(options));
    const foreign = await message("foreign", otherSigner);

    await expect(client.conversation(peer).receiver.unlock(foreign)).rejects.toThrow("does not belong");
  });
});

describe("LegacyMessagesClient receiver ownership", () => {
  it("rejects an injected receiver for another account or with receiverOptions", async () => {
    const { options } = setup();
    const foreign = own(new LegacyInboxReceiver({ ...options, pubkey: peer }));
    const receiver = own(new LegacyInboxReceiver(options));

    expect(() => new LegacyMessagesClient({ ...options, receiver: foreign })).toThrow("must match");
    expect(() => new LegacyMessagesClient({ ...options, receiver, receiverOptions: {} })).toThrow("exclusive");
  });

  it("attaches to an injected receiver without starting or stopping it", async () => {
    const { options } = setup();
    const receiver = own(new LegacyInboxReceiver(options));
    const client = own(new LegacyMessagesClient({ ...options, receiver }));

    await client.start();
    expect(await firstValueFrom(receiver.lifecycle$)).toBe("idle");

    await receiver.start();
    client.dispose();
    expect(await firstValueFrom(receiver.lifecycle$)).toBe("running");
    expect(() => client.conversation(peer)).toThrow("disposed");
  });
});
