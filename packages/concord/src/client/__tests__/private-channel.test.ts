// ConcordPrivateChannel over a dependency-injected pool that SERVES pre-built
// wraps (no sockets). Exercises the sub-engine's epoch-atomic walk: sync a
// private channel's epoch-1 history, follow a forward channel Rekey, and sync the
// adopted epoch's messages — proving a private channel rotates on its own
// lifecycle, independent of the community root.

import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, Subscription, firstValueFrom, from } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { normalizeURL } from "applesauce-core/helpers";
import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore, RumorStore } from "applesauce-core";
import { ChatMessageFactory } from "applesauce-common/factories";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { RelayPool } from "applesauce-relay";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { buildChannelRekey, deriveChannelKeys } from "../../helpers/keys.js";
import { EPHEMERAL_GIFT_WRAP_KIND, GIFT_WRAP_KIND } from "../../helpers/gift-wrap.js";
import { giftWrap } from "../../operations/gift-wrap.js";
import { bindToChannel } from "../../operations/channel.js";
import type { ChannelKey } from "../../types.js";
import { ConcordPrivateChannel } from "../private-channel.js";

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
      relayAuth: new ConcordRelayAuth(pool),
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
      relayAuth: new ConcordRelayAuth(pool),
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
  /** Records every `subscription`/`relay()` call's relay-TARGET argument, so
   *  these tests can assert on what was actually dialled. Local to this
   *  describe block only — `servingPool` above is untouched. */
  function extrasPrivateChannelPool(): {
    pool: RelayPool;
    subscriptionTargets: string[][];
    relayCalls: string[];
  } {
    const subscriptionTargets: string[][] = [];
    const relayCalls: string[] = [];
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
      relay: (url: string) => {
        relayCalls.push(url);
        return relay;
      },
      subscription: (relays: string[]) => {
        subscriptionTargets.push([...relays]);
        return NEVER;
      },
      request: () => EMPTY,
      publish: async () => [],
    } as unknown as RelayPool;
    return { pool, subscriptionTargets, relayCalls };
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

  it("a second extras emission changes the live subscription's relay target and auth registrations, while the channel's own relays stay present (D-08/D-09)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool, subscriptionTargets, relayCalls } = extrasPrivateChannelPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
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
    expect(relayCalls.some((u) => u.includes("extras-extra-one"))).toBe(true);

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
    expect(relayCalls.some((u) => u.includes("extras-extra-two"))).toBe(true);

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
      relayAuth: new ConcordRelayAuth(pool),
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
      relayAuth: new ConcordRelayAuth(pool),
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

// Gap closure (WR-04): mirrors community.test.ts's identical describe block —
// the auth-driver registry must PRUNE on every ensureAuth call, not just
// monotonically append.
describe("ConcordPrivateChannel auth-driver lifecycle (transport narrowing) — prune-and-refresh, no churn on no-op (WR-04)", () => {
  const AUTH_CHANNEL_RELAY = "wss://pc-auth-channel.test";
  const AUTH_CHANNEL_RELAYS = [AUTH_CHANNEL_RELAY];
  const AUTH_EXTRA = "wss://pc-auth-extra.test";
  // `ensureAuth` receives the merged transport set — already normalized by
  // `mergeRelaySets` (a trailing slash) — so `pool.relay(url)` (and thus the
  // recorded driver key below) sees the NORMALIZED form, never the raw
  // literal. Normalize once for every map lookup below.
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

  // Distinct relay objects per URL (unlike `extrasPrivateChannelPool()` above,
  // which shares one relay object for every URL) — so `ConcordRelayAuth`'s
  // internal per-relay driver map (keyed by `relay.url`) genuinely tracks each
  // URL independently, and spying on `authenticateStreamKeys` lets these tests
  // assert teardown/re-creation via the returned Subscription's `closed` flag.
  function authDriverPool(): { pool: RelayPool } {
    const relays = new Map<string, ReturnType<typeof makeRelay>>();
    function makeRelay(url: string) {
      return {
        url,
        challenge: null,
        challenge$: new BehaviorSubject<string | null>(null),
        isAuthenticated: () => false,
        authenticate: async () => ({ ok: true }),
        getSupported: async () => null,
        request: () => EMPTY,
        sync: () => EMPTY,
      };
    }
    const pool = {
      status$: new Subject(),
      relay: (url: string) => {
        if (!relays.has(url)) relays.set(url, makeRelay(url));
        return relays.get(url)!;
      },
      subscription: () => NEVER,
      request: () => EMPTY,
      publish: async () => [],
    } as unknown as RelayPool;
    return { pool };
  }

  /** Spies on `relayAuth.authenticateStreamKeys`, recording every returned
   *  Subscription keyed by the (normalized) relay URL it was registered for. */
  function spyOnDrivers(relayAuth: ConcordRelayAuth): Map<string, Subscription[]> {
    const driverSubs = new Map<string, Subscription[]>();
    const original = relayAuth.authenticateStreamKeys.bind(relayAuth);
    vi.spyOn(relayAuth, "authenticateStreamKeys").mockImplementation((relay) => {
      const sub = original(relay);
      const arr = driverSubs.get(relay.url) ?? [];
      arr.push(sub);
      driverSubs.set(relay.url, arr);
      return sub;
    });
    return driverSubs;
  }

  it("removing a relay from the extras set unsubscribes its auth driver, and re-adding it registers a FRESH driver (WR-04)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: AUTH_CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool } = authDriverPool();
    const relayAuth = new ConcordRelayAuth(pool);
    const driverSubs = spyOnDrivers(relayAuth);
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      relayAuth,
      eventStore: new EventStore(),
      store,
      relays: AUTH_CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    expect(driverSubs.get(AUTH_EXTRA_KEY)?.length).toBe(1);
    expect(driverSubs.get(AUTH_EXTRA_KEY)![0].closed).toBe(false);

    // Narrow the extras set — the extra relay leaves the transport.
    extras$.next([]);
    await settle();

    expect(driverSubs.get(AUTH_EXTRA_KEY)![0].closed).toBe(true); // torn down (WR-04)

    // Re-add: a FRESH driver must register.
    extras$.next([AUTH_EXTRA]);
    await settle();

    expect(driverSubs.get(AUTH_EXTRA_KEY)?.length).toBe(2);
    expect(driverSubs.get(AUTH_EXTRA_KEY)![1].closed).toBe(false);
    expect(driverSubs.get(AUTH_EXTRA_KEY)![0].closed).toBe(true); // the removed one stays torn down

    sub.dispose();
  });

  it("a re-emission with identical membership does not unsubscribe or re-create any existing driver (no churn, D-09)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: AUTH_CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool } = authDriverPool();
    const relayAuth = new ConcordRelayAuth(pool);
    const driverSubs = spyOnDrivers(relayAuth);
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      relayAuth,
      eventStore: new EventStore(),
      store,
      relays: AUTH_CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    expect(driverSubs.get(AUTH_EXTRA_KEY)?.length).toBe(1);
    expect(driverSubs.get(AUTH_CHANNEL_RELAY_KEY)?.length).toBe(1);

    // A no-op re-emission — same membership, new array instance.
    extras$.next([AUTH_EXTRA]);
    await settle();

    expect(driverSubs.get(AUTH_EXTRA_KEY)?.length).toBe(1); // no re-create
    expect(driverSubs.get(AUTH_EXTRA_KEY)![0].closed).toBe(false); // no unsubscribe
    expect(driverSubs.get(AUTH_CHANNEL_RELAY_KEY)?.length).toBe(1);

    sub.dispose();
  });

  it("dispose() unsubscribes every registered auth driver", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: AUTH_CHANNEL_RELAYS });
    const material = g.material;
    const channel = makeChannelKey();

    const { pool } = authDriverPool();
    const relayAuth = new ConcordRelayAuth(pool);
    const driverSubs = spyOnDrivers(relayAuth);
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const store = new RumorStore();
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      relayAuth,
      eventStore: new EventStore(),
      store,
      relays: AUTH_CHANNEL_RELAYS,
      extraRelays: extras$,
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: () => {},
    });

    await sub.start();
    await settle();

    sub.dispose();

    for (const subs of driverSubs.values()) for (const s of subs) expect(s.closed).toBe(true);
  });
});
