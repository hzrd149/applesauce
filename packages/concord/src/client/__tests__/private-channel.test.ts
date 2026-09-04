// ConcordPrivateChannel over a dependency-injected pool that SERVES pre-built
// wraps (no sockets). Exercises the sub-engine's epoch-atomic walk: sync a
// private channel's epoch-1 history, follow a forward channel Rekey, and sync the
// adopted epoch's messages — proving a private channel rotates on its own
// lifecycle, independent of the community root.

import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Observable, Subject, Subscription, firstValueFrom, from } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { normalizeURL } from "applesauce-core/helpers";
import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore, RumorStore } from "applesauce-core";
import { ChatMessageFactory } from "applesauce-common/factories";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { PublishResponse, Relay, RelayPool } from "applesauce-relay";

import { createCommunity } from "../../helpers/community.js";
import { buildChannelRekey, deriveChannelKeys } from "../../helpers/keys.js";
import { EPHEMERAL_GIFT_WRAP_KIND, GIFT_WRAP_KIND } from "../../helpers/gift-wrap.js";
import { giftWrap } from "../../operations/gift-wrap.js";
import { bindToChannel, includeMediaEncryption } from "../../operations/channel.js";
import { parseImeta } from "../../helpers/imeta.js";
import type { ChannelKey } from "../../types.js";
import { ConcordPrivateChannel } from "../private-channel.js";
import {
  VOICE_PRESENCE_JOINED_EXAMPLE,
  missingFixtureTags,
  substituteFixtureTags,
} from "../../__tests__/cord-wire-fixtures.js";

const settle = () => new Promise((r) => setTimeout(r, 200));

/** A captured filter — the shape `servingPool`'s `subscription`/`request` receive. */
type CapturedFilter = { kinds?: number[]; authors?: string[]; since?: number; until?: number };

// A RelayPool stand-in that serves `events` matching each REQ's authors/kinds and
// completes (EOSE). No NIP-77, no live subscription. When `subCapture` is passed,
// every filter object handed to the live `subscription` call is recorded into it —
// the spy seam for the live-direction filter-spy test (D-02/D-03 regression guard).
function servingPool(events: NostrEvent[], subCapture?: CapturedFilter[]): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: (filters: unknown) => {
      const fs = (Array.isArray(filters) ? filters : [filters]) as CapturedFilter[];
      const match = events.filter((e) =>
        fs.some(
          (f) =>
            (!f.kinds || f.kinds.includes(e.kind)) &&
            (!f.authors || f.authors.includes(e.pubkey)) &&
            (f.since === undefined || e.created_at >= f.since) &&
            (f.until === undefined || e.created_at <= f.until),
        ),
      );
      return from(match);
    },
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: (_relays: string[], filters: unknown) => {
      const fs = (Array.isArray(filters) ? filters : [filters]) as CapturedFilter[];
      subCapture?.push(...fs);
      return NEVER;
    },
    request: (_relays: string[], filters: unknown) => relay.request(filters),
    publish: async () => [],
  } as unknown as RelayPool;
}

describe("ConcordPrivateChannel (DI, served wraps)", () => {
  it("decrypts each historical attachment with its own imeta key after rekeying", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material = g.material;
    const channel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "secret",
    };
    const encrypt = async (url: string, plaintext: string) => {
      const key = generateSecretKey();
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, new TextEncoder().encode(plaintext));
      return { url, plaintext, ciphertext, key: bytesToHex(key), nonce: bytesToHex(nonce) };
    };
    const makeRumor = async (attachment: Awaited<ReturnType<typeof encrypt>>, epoch: number) => {
      let draft = await ChatMessageFactory.create(attachment.url).attachments([
        { url: attachment.url, type: "application/octet-stream" },
      ]);
      draft = await includeMediaEncryption([
        { url: attachment.url, algorithm: "aes-gcm", key: attachment.key, nonce: attachment.nonce },
      ])(draft);
      return bindToChannel(channel.id, epoch)(draft);
    };

    const before = await encrypt("https://media.test/epoch-1", "private epoch one");
    const k1 = deriveChannelKeys(material, channel);
    const wraps: NostrEvent[] = [await giftWrap(k1.current.sk, k1.current.convKey, me)(await makeRumor(before, 1))];
    const plan = await buildChannelRekey(material, channel, owner, { recipients: [ownerPub, myPub], self: ownerPub });
    wraps.push(...plan.rekeyWraps);
    const after = await encrypt("https://media.test/epoch-2", "private epoch two");
    const k2 = deriveChannelKeys(material, plan.next);
    wraps.push(await giftWrap(k2.current.sk, k2.current.convKey, me)(await makeRumor(after, 2)));

    const store = new RumorStore();
    let persisted: ChannelKey | undefined;
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool: servingPool(wraps),
      eventStore: new EventStore(),
      store,
      relays: ["wss://fake"],
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: (ck) => (persisted = ck),
    });
    await sub.start();
    await settle();

    expect(sub.epoch$.value).toBe(2);
    expect(persisted?.held?.[0]).toMatchObject({ epoch: 1, key: channel.key });
    const messages = store.getTimeline([{ kinds: [kinds.ChatMessage] }]);
    const parsed = new Map(messages.flatMap((message) => [...parseImeta(message.tags)]));
    const decrypt = async (fixture: typeof before) => {
      const encryption = parsed.get(fixture.url)!.encryption!;
      const key = await crypto.subtle.importKey("raw", hexToBytes(encryption.key), "AES-GCM", false, ["decrypt"]);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: hexToBytes(encryption.nonce) },
        key,
        fixture.ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    };
    expect(await decrypt(before)).toBe(before.plaintext);
    expect(await decrypt(after)).toBe(after.plaintext);
    expect([before.key, before.nonce]).not.toEqual([after.key, after.nonce]);
    const channelSecrets = [
      channel.key,
      plan.next.key,
      bytesToHex(k1.current.sk),
      bytesToHex(k1.current.convKey),
      bytesToHex(k2.current.sk),
      bytesToHex(k2.current.convKey),
    ];
    expect(channelSecrets).not.toContain(before.key);
    expect(channelSecrets).not.toContain(after.key);
    const wrong = parsed.get(after.url)!.encryption!;
    const wrongKey = await crypto.subtle.importKey("raw", hexToBytes(wrong.key), "AES-GCM", false, ["decrypt"]);
    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(wrong.nonce) }, wrongKey, before.ciphertext),
    ).rejects.toThrow();

    sub.dispose();
  });

  it("syncs epoch-1 history, follows a channel Rekey, and syncs the adopted epoch", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material = g.material;

    const channel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "secret",
    };

    const wraps: NostrEvent[] = [];
    // Two epoch-1 messages wrapped to the channel plane.
    const k1 = deriveChannelKeys(material, channel);
    for (const text of ["one", "two"]) {
      const rumor = await bindToChannel(channel.id, 1)(await ChatMessageFactory.create(text));
      wraps.push(await giftWrap(k1.current.sk, k1.current.convKey, me)(rumor));
    }
    // Owner rotates the channel, keeping us → rekey blobs at the channel-rekey address.
    const plan = await buildChannelRekey(material, channel, owner, { recipients: [ownerPub, myPub], self: ownerPub });
    wraps.push(...plan.rekeyWraps);
    // One epoch-2 message under the new key.
    const k2 = deriveChannelKeys(material, plan.next);
    const rumor2 = await bindToChannel(channel.id, 2)(await ChatMessageFactory.create("three"));
    wraps.push(await giftWrap(k2.current.sk, k2.current.convKey, me)(rumor2));

    const pool = servingPool(wraps);
    const store = new RumorStore();
    let persisted: ChannelKey | undefined;
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: ["wss://fake"],
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: (ck) => (persisted = ck),
    });

    expect(sub.phase$.value).toBe("idle"); // not started yet
    await sub.start();
    await settle();

    // All three messages decoded — epoch-1 history + the adopted epoch-2 message.
    const msgs = store.getTimeline([{ kinds: [kinds.ChatMessage] }]).map((m) => m.content);
    expect(msgs.sort()).toEqual(["one", "three", "two"]);
    // The channel rolled forward to its own epoch 2 and persisted the new key.
    expect(sub.epoch$.value).toBe(2);
    expect(persisted?.epoch).toBe(2);
    expect(persisted?.held?.[0]).toMatchObject({ epoch: 1, key: channel.key });

    // Descriptive status: caught up to the tip, epoch rolled, no error.
    expect(sub.phase$.value).toBe("live");
    const snap = await firstValueFrom(sub.status$);
    expect(snap).toMatchObject({ phase: "live", epoch: 2, connected: false, error: null });

    sub.dispose();
  });

  it("delivers a kind-23313 voice-presence rumor into the injected store alongside a chat control (WIRE-02, non-vacuous)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material = g.material;

    // Epoch 0 so the fixture's literal "epoch" tag value ("0") matches
    // verbatim, mirroring 11-05/06's community-side convention of using a
    // root epoch that is already 0 rather than substituting a non-placeholder.
    const channel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 0,
      name: "secret",
    };
    const k1 = deriveChannelKeys(material, channel);

    // Control: a chat message, proving the funnel works at all in this fixture.
    const chatRumor = await bindToChannel(channel.id, 0)(await ChatMessageFactory.create("control message"));

    // The rumor under test: kind 23313, non-binding tags only (channel/epoch/ms
    // are stamped by bindToChannel itself).
    const presenceTags = VOICE_PRESENCE_JOINED_EXAMPLE.tags
      .filter((t) => !["channel", "epoch", "ms"].includes(t[0]!))
      .map((t) => [...t]);
    const presenceRumor = await bindToChannel(
      channel.id,
      0,
    )({
      kind: VOICE_PRESENCE_JOINED_EXAMPLE.kind,
      content: VOICE_PRESENCE_JOINED_EXAMPLE.content,
      tags: presenceTags,
      created_at: 0,
    });

    const wraps: NostrEvent[] = [
      await giftWrap(k1.current.sk, k1.current.convKey, me)(chatRumor),
      await giftWrap(k1.current.sk, k1.current.convKey, me)(presenceRumor),
    ];

    const pool = servingPool(wraps);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: ["wss://fake"],
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    // The chat control landed — distinguishes a fixture-wiring mistake from a
    // genuine drop of the presence rumor.
    const chatMsgs = store.getTimeline([{ kinds: [kinds.ChatMessage] }]).map((m) => m.content);
    expect(chatMsgs).toEqual(["control message"]);

    const presence = store.getTimeline([{ kinds: [23313] }]);
    expect(presence).toHaveLength(1);
    expect(presence[0]!.content).toBe(VOICE_PRESENCE_JOINED_EXAMPLE.content);

    // Transit-integrity control against the fixture, mirroring the community
    // engine's WIRE-02 test: the SFU-identity placeholder binds to itself
    // since our own template carried the fixture's tags through unmodified.
    const expected = substituteFixtureTags(VOICE_PRESENCE_JOINED_EXAMPLE.tags, {
      "<channel_id>": channel.id,
      "<SFU identity>": "<SFU identity>",
    }).filter((tag) => tag[0] !== "ms");
    expect(missingFixtureTags(presence[0]!.tags, expected)).toEqual([]);

    sub.dispose();
  });
});

describe("ConcordPrivateChannel — live subscription requests both retained + ephemeral kinds (D-02 regression guard)", () => {
  it("live filter kinds contains BOTH GIFT_WRAP_KIND and EPHEMERAL_GIFT_WRAP_KIND", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material = g.material;

    const channel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "secret",
    };

    const subCapture: CapturedFilter[] = [];
    const pool = servingPool([], subCapture);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: ["wss://fake"],
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    expect(subCapture.length).toBeGreaterThan(0);
    // Expected values are the spec's two kind constants directly (TEST-01), not a
    // re-read of production's own inline literal — a pass genuinely proves both
    // kinds are still requested live, not merely that the spy echoes production.
    expect(subCapture[0].kinds).toEqual(expect.arrayContaining([GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND]));

    sub.dispose();
  });
});

// Plan 12.3-07: mirrors community.test.ts's extras describe block (Task 1) so a
// reader recognises all three engines' extras coverage at a glance — reactivity,
// churn-guard, and the no-extras byte-identical baseline (D-08/D-09/D-14).
describe("ConcordPrivateChannel extras (transport-only relay merge) — reactivity, churn, no-extras baseline (D-08/D-09/D-14)", () => {
  /** Records every `subscription()` call's relay-TARGET argument, so these
   *  tests can assert on what was actually dialled live. Local to this
   *  describe block only — `servingPool` above is untouched. `pool.relay()`
   *  is no longer a driver-registration seam (D-01) — it's only ever reached
   *  by the sync loader's own backfill requests, so it isn't tracked here. */
  function extrasPrivateChannelPool(): {
    pool: RelayPool;
    subscriptionTargets: string[][];
  } {
    const subscriptionTargets: string[][] = [];
    const relay = {
      url: "wss://fake",
      challenge: null,
      challenge$: new BehaviorSubject<string | null>(null),
      isAuthenticated: () => false,
      authenticate: async () => ({ ok: true }),
      getSupported: async () => null,
      sync: () => EMPTY,
      request: () => EMPTY,
    };
    const pool = {
      status$: new Subject(),
      relay: () => relay,
      subscription: (relays: string[]) => {
        subscriptionTargets.push([...relays]);
        return NEVER;
      },
      request: () => EMPTY,
      publish: async () => [],
    } as unknown as RelayPool;
    return { pool, subscriptionTargets };
  }

  // Distinct, non-overlapping hostnames so no assertion can pass by coincidence.
  const CHANNEL_RELAYS = ["wss://pc-extras-channel-a.test", "wss://pc-extras-channel-b.test"];
  const EXTRA_ONE = "wss://pc-extras-extra-one.test";
  const EXTRA_TWO = "wss://pc-extras-extra-two.test";

  function makeChannelKey() {
    return {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "secret",
    };
  }

  it("a second extras emission changes the live subscription's relay target, while the channel's own relays stay present (D-08/D-09)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool, subscriptionTargets } = extrasPrivateChannelPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    const before = subscriptionTargets.at(-1)!;
    expect(subscriptionTargets.length).toBeGreaterThan(0);
    expect(before.some((u) => u.includes("extras-extra-one"))).toBe(true);
    expect(before.some((u) => u.includes("extras-channel-a"))).toBe(true);
    expect(before.some((u) => u.includes("extras-channel-b"))).toBe(true);

    // Push a SECOND, DIFFERENT extras value (D-11) — a first-value-only
    // resolver would leave the target frozen on EXTRA_ONE forever.
    extras$.next([EXTRA_TWO]);
    await settle();

    const after = subscriptionTargets.at(-1)!;
    expect(after).not.toBe(before);
    expect(after.some((u) => u.includes("extras-extra-two"))).toBe(true);
    expect(after.some((u) => u.includes("extras-extra-one"))).toBe(false);
    expect(after.some((u) => u.includes("extras-channel-a"))).toBe(true);
    expect(after.some((u) => u.includes("extras-channel-b"))).toBe(true);

    sub.dispose();
  });

  it("an equal-content extras re-emission does not open a new live subscription (D-09 churn guard)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool, subscriptionTargets } = extrasPrivateChannelPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE, EXTRA_TWO]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    const callCountBefore = subscriptionTargets.length;
    expect(callCountBefore).toBeGreaterThan(0);

    // Same members, different array instance AND order — must not tear down
    // and reopen the live socket.
    extras$.next([EXTRA_TWO, EXTRA_ONE]);
    await settle();

    expect(subscriptionTargets.length).toBe(callCountBefore);

    sub.dispose();
  });

  it("with no extraRelays configured, the live subscription target equals the channel's own relay set (byte-identical, D-14)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool, subscriptionTargets } = extrasPrivateChannelPool();
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: CHANNEL_RELAYS,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    expect(subscriptionTargets.length).toBeGreaterThan(0);
    // `ExtraRelays.merge`'s empty-extras identity fast path (12.3-08, D-14)
    // means transport() returns `opts.relays` completely unchanged when no
    // extras are configured — no normalization at all — so the no-extras
    // target is byte-identical to the configured relay constant.
    expect(subscriptionTargets.at(-1)).toEqual(CHANNEL_RELAYS);

    sub.dispose();
  });
});

// Gap closure (WR-04), re-derived for D-01/D-02: mirrors community.test.ts's
// identical describe block — there is no per-relay auth driver any more, so
// this suite now proves the channel's live subscription retargets on an
// extras change and doesn't churn on a no-op re-emission.
describe("ConcordPrivateChannel live-subscription transport narrowing — retarget on extras change, no churn on no-op (WR-04)", () => {
  const AUTH_CHANNEL_RELAY = "wss://pc-auth-channel.test";
  const AUTH_CHANNEL_RELAYS = [AUTH_CHANNEL_RELAY];
  const AUTH_EXTRA = "wss://pc-auth-extra.test";
  // The live subscription's target list is the merged transport set — already
  // normalized by `mergeRelaySets` (a trailing slash) — so the recorded
  // subscription's relay list carries the NORMALIZED form, never the raw
  // literal. Normalize once for every assertion below.
  const AUTH_CHANNEL_RELAY_KEY = normalizeURL(AUTH_CHANNEL_RELAY);
  const AUTH_EXTRA_KEY = normalizeURL(AUTH_EXTRA);

  function makeChannelKey() {
    return {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "secret",
    };
  }

  /** Distinct relay objects per URL (unlike `extrasPrivateChannelPool()` above,
   *  which shares one relay object for every URL), so a per-relay `authenticate`
   *  call can be attributed to the URL it was actually made against.
   *  `pool.subscription` records every call's `{ relays, filters, options }`
   *  and returns a duck-typed Observable whose `.subscribe()` captures the
   *  real `Subscription` object `openLive()` receives — so a test can assert
   *  `.closed` on exactly what the engine holds, without reaching into any
   *  private field. */
  function authDriverPool(): {
    pool: RelayPool;
    subscriptions: { relays: string[]; filters: unknown; options: Record<string, unknown> }[];
    liveSubs: Subscription[];
  } {
    const relays = new Map<string, ReturnType<typeof makeRelay>>();
    function makeRelay(url: string) {
      return {
        url,
        challenge: null,
        challenge$: new BehaviorSubject<string | null>(null),
        isAuthenticated: () => false,
        authenticate: vi.fn(async (signer: { getPublicKey: () => Promise<string> }) => {
          const pk = await signer.getPublicKey();
          return { ok: true, pubkey: pk, url } as unknown as PublishResponse;
        }),
        getSupported: async () => null,
        request: () => EMPTY,
        sync: () => EMPTY,
      };
    }
    const subscriptions: { relays: string[]; filters: unknown; options: Record<string, unknown> }[] = [];
    const liveSubs: Subscription[] = [];
    const pool = {
      status$: new Subject(),
      relay: (url: string) => {
        if (!relays.has(url)) relays.set(url, makeRelay(url));
        return relays.get(url)!;
      },
      subscription: (relayUrls: string[], filters: unknown, options: Record<string, unknown>) => {
        subscriptions.push({ relays: relayUrls, filters, options });
        return {
          subscribe: (observerOrNext: unknown) => {
            const sub = NEVER.subscribe(observerOrNext as never);
            liveSubs.push(sub);
            return sub;
          },
        } as unknown as Observable<NostrEvent>;
      },
      request: () => EMPTY,
      publish: async () => [],
    } as unknown as RelayPool;
    return { pool, subscriptions, liveSubs };
  }

  it("removing a relay from the extras set stops targeting it, and re-adding it targets it again", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: AUTH_CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool, subscriptions } = authDriverPool();
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: AUTH_CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    // ExtraRelays.merge's identity fast path (D-14) returns `opts.relays`
    // UNCHANGED (no normalization) once the extras set is empty, so
    // membership is checked through `normalizeURL` rather than the raw
    // recorded strings.
    const latestUrls = () => subscriptions[subscriptions.length - 1].relays.map(normalizeURL);
    expect(latestUrls()).toContain(AUTH_EXTRA_KEY);
    expect(latestUrls()).toContain(AUTH_CHANNEL_RELAY_KEY);

    // Narrow the extras set — the extra relay leaves the transport.
    extras$.next([]);
    await settle();

    expect(latestUrls()).not.toContain(AUTH_EXTRA_KEY);
    expect(latestUrls()).toContain(AUTH_CHANNEL_RELAY_KEY);

    // Re-add: the extra relay is targeted again.
    extras$.next([AUTH_EXTRA]);
    await settle();

    expect(latestUrls()).toContain(AUTH_EXTRA_KEY);
    expect(latestUrls()).toContain(AUTH_CHANNEL_RELAY_KEY);

    // Direct replacement for the old teardown assertion: with no per-relay
    // driver mechanism left (D-01), and this DI'd pool never manufacturing an
    // `auth-required:` refusal, nothing ever asked the extra relay to
    // authenticate across the whole test — a relay only ever learns the
    // pubkeys an operation that actually reaches it names (T-15-08/CAUTH-02).
    expect(pool.relay(AUTH_EXTRA_KEY).authenticate).not.toHaveBeenCalled();

    sub.dispose();
  });

  it("a re-emission with identical membership does not re-open the live subscription (no churn, D-09)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: AUTH_CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool, subscriptions } = authDriverPool();
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: AUTH_CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    const countBefore = subscriptions.length;

    // A no-op re-emission — same membership, new array instance.
    extras$.next([AUTH_EXTRA]);
    await settle();

    // openLive()'s `sig` guard (Task 1) suppresses the re-open entirely.
    expect(subscriptions.length).toBe(countBefore);

    sub.dispose();
  });

  it("dispose() closes the live subscription", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: AUTH_CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool, liveSubs } = authDriverPool();
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: AUTH_CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    const liveSub = liveSubs[liveSubs.length - 1];
    expect(liveSub.closed).toBe(false);

    sub.dispose();

    expect(liveSub.closed).toBe(true);
    // No auth machinery outlives it (D-01): there is no driver map, reference
    // count, or `challenge$` subscription left for `dispose()` to have missed.
  });
});

// ── Gap closure (WR-01, 12.3-13): a construction that throws must leave
// nothing attached to the app-supplied extras source — mirrors
// community.test.ts's identical `ConcordCommunity` guard test.
/** A counting Observable stand-in for `extraRelays`: increments a counter on
 *  subscribe, delegates to an inner BehaviorSubject, and decrements on
 *  teardown — so a test can assert an exact hand-derived active-subscriber
 *  count rather than a boolean. */
function countingExtrasSource(initial: string[] = []): {
  source: Observable<string[]>;
  count: () => number;
} {
  const inner = new BehaviorSubject<string[]>(initial);
  let active = 0;
  const source = new Observable<string[]>((subscriber) => {
    active++;
    const sub = inner.subscribe(subscriber);
    return () => {
      active--;
      sub.unsubscribe();
    };
  });
  return { source, count: () => active };
}

describe("ConcordPrivateChannel constructor — self-cleaning extras on throw (WR-01, 12.3-13)", () => {
  it("a construction that throws during channel-key derivation leaves zero subscribers on the extras source; a successful construction leaves exactly one", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "Test", relays: ["wss://fake"] });
    const pool = servingPool([]);

    // Malformed channel key: `id` is not 64-char hex — `hexToBytes(channel.id)`
    // inside `deriveChannelKeys` throws synchronously, immediately after
    // `this.extras` is constructed but before any other field exists. Channel
    // key material restored from another device's Community List is never
    // validated (only invite bundles are), so this is genuinely reachable.
    const throwingChannel: ChannelKey = { id: "not-hex", key: bytesToHex(generateSecretKey()), epoch: 1, name: "x" };
    const { source: throwingExtras, count: throwingCount } = countingExtrasSource([]);

    expect(
      () =>
        new ConcordPrivateChannel({
          channelKey: throwingChannel,
          material: () => genesis.material,
          signer: me,
          pubkey: myPub,
          pool,
          eventStore: new EventStore(),
          store: new RumorStore(),
          relays: ["wss://fake"],
          extraRelays: throwingExtras,
          isAuthorized: (r) => r === ownerPub,
        }),
    ).toThrow();
    // Non-vacuity: pre-fix, `this.extras = new ExtraRelays(options.extraRelays)`
    // subscribes to `throwingExtras` BEFORE the throwing `deriveChannelKeys`
    // call — nothing ever called `.dispose()` on the discarded half-built
    // instance, so the subscriber count would have stayed at 1 forever.
    expect(throwingCount()).toBe(0);

    // Non-vacuity guard against the test passing vacuously because the source
    // is never subscribed at all: a SUCCESSFUL construction against the same
    // kind of source must leave exactly one active subscriber.
    const okChannel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "ok",
    };
    const { source: okExtras, count: okCount } = countingExtrasSource([]);
    const channel = new ConcordPrivateChannel({
      channelKey: okChannel,
      material: () => genesis.material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store: new RumorStore(),
      relays: ["wss://fake"],
      extraRelays: okExtras,
      isAuthorized: (r) => r === ownerPub,
    });
    expect(okCount()).toBe(1);
    channel.dispose();
  });

  it("a successfully constructed channel still releases its subscriber on dispose()", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "Test", relays: ["wss://fake"] });
    const pool = servingPool([]);
    const okChannel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "ok",
    };
    const { source: extras, count } = countingExtrasSource([]);

    const channel = new ConcordPrivateChannel({
      channelKey: okChannel,
      material: () => genesis.material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store: new RumorStore(),
      relays: ["wss://fake"],
      extraRelays: extras,
      isAuthorized: (r) => r === ownerPub,
    });
    expect(count()).toBe(1);

    channel.dispose();
    // Guards against a regression where the new constructor failure path
    // double-disposes, or the success path stops disposing on dispose().
    expect(count()).toBe(0);
  });
});

// Phase 17 RESID-01 supersedes Phase 15 WR-02's clear-on-recovery reading:
// transient per-relay AUTH remains operation/diagnostic state and never enters
// the private channel's fatal lifecycle UI surface.
describe("ConcordPrivateChannel fatal-only UI error boundary (RESID-01)", () => {
  const AUTH_URL = "wss://pc-error-oracle.test";

  /** Records every `subscription()` call's `{ relays, filters, options }` — the
   *  seam this test needs to capture the live subscription's own recorded
   *  `onAuthRequired` handler, mirroring `community.test.ts`'s `authOraclePool`. */
  function authOraclePool(): {
    pool: RelayPool;
    subscriptionCalls: { relays: string[]; filters: unknown; options: Record<string, unknown> }[];
    authenticate: ReturnType<typeof vi.fn>;
  } {
    const authenticate = vi.fn(async (signer: { getPublicKey: () => Promise<string> }) => {
      const pk = await signer.getPublicKey();
      return { ok: true, pubkey: pk, url: AUTH_URL } as unknown as PublishResponse;
    });
    const relay = {
      url: AUTH_URL,
      challenge: null,
      challenge$: new BehaviorSubject<string | null>(null),
      isAuthenticated: () => false,
      authenticate,
      getSupported: async () => null,
      sync: () => EMPTY,
      request: () => EMPTY,
    };
    const subscriptionCalls: { relays: string[]; filters: unknown; options: Record<string, unknown> }[] = [];
    const pool = {
      status$: new Subject(),
      relay: () => relay,
      subscription: (relays: string[], filters: unknown, options: Record<string, unknown> = {}) => {
        subscriptionCalls.push({ relays, filters, options });
        return NEVER;
      },
      request: () => EMPTY,
      publish: async () => [],
    } as unknown as RelayPool;
    return { pool, subscriptionCalls, authenticate };
  }

  /** Synthesizes a `RelayAuthContext`-shaped value the same way a relay's own
   *  `auth-required:` refusal would — the ONLY input this test feeds a captured
   *  handler. */
  function authRequiredCtx(pool: RelayPool, missingPubkeys: string[] | null, id: string) {
    return {
      relay: pool.relay(AUTH_URL) as unknown as Relay,
      url: AUTH_URL,
      challenge: null,
      request: { verb: "REQ" as const, id, filters: [] },
      requirement: missingPubkeys ?? true,
      missingPubkeys,
      reason: "auth-required",
    };
  }

  it("keeps rejected, thrown, and unanswered AUTH out of fatal UI error state", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: [AUTH_URL] });
    const material = g.material;
    const channel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "secret",
    };

    const { pool, subscriptionCalls, authenticate } = authOraclePool();
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      eventStore: new EventStore(),
      store,
      relays: [AUTH_URL],
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    // The walk finished cleanly — no stale error left over.
    expect(sub.error$.value).toBeNull();
    expect(sub.phase$.value).toBe("live");

    const latest = subscriptionCalls[subscriptionCalls.length - 1]!;
    const onAuthRequired = latest.options.onAuthRequired as (ctx: unknown) => Promise<void>;
    const authors = (latest.filters as { authors?: string[] }[])[0]!.authors!;

    authenticate.mockResolvedValueOnce({ ok: false, message: "denied", from: AUTH_URL });
    await onAuthRequired(authRequiredCtx(pool, authors, "rejected"));
    expect(sub.error$.value).toBeNull();

    authenticate.mockRejectedValueOnce(new Error("relay auth transport failed"));
    await onAuthRequired(authRequiredCtx(pool, authors, "thrown"));
    expect(sub.error$.value).toBeNull();

    const unknownPubkey = "0".repeat(64);
    await onAuthRequired(authRequiredCtx(pool, [unknownPubkey], "live-1"));
    expect(sub.error$.value).toBeNull();
    expect(sub.phase$.value).toBe("live");

    const status = await firstValueFrom(sub.status$);
    expect(status.error).toBeNull();

    sub.dispose();
  });

  it("still reports a genuine private-channel sync failure through fatal UI state", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: [AUTH_URL] });
    const sub = new ConcordPrivateChannel({
      channelKey: { id: bytesToHex(generateSecretKey()), key: bytesToHex(generateSecretKey()), epoch: 1, name: "secret" },
      material: () => g.material,
      signer: me,
      pubkey: myPub,
      pool: servingPool([]),
      eventStore: new EventStore(),
      store: new RumorStore(),
      relays: [AUTH_URL],
      isAuthorized: (r) => r === ownerPub,
    });
    (sub as unknown as { syncContext: () => never }).syncContext = () => {
      throw new Error("fatal channel sync failure");
    };

    await sub.start();

    expect(sub.error$.value).toBe("fatal channel sync failure");
    expect(sub.phase$.value).toBe("error");
    expect((await firstValueFrom(sub.status$)).error).toBe("fatal channel sync failure");
    sub.dispose();
  });
});
