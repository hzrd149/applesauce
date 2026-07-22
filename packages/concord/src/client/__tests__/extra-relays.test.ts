// The phase's standing regression guard (D-05): a canary extras endpoint drives
// the FULL public-API lifecycle (create → invite → join → metadata edit →
// refound) and is asserted a) never present in any published event's content
// or any returned artifact, and b) POSITIVELY present as a publish/request/
// subscription TRANSPORT TARGET. That second half is deliberate — extras
// appearing as transport destinations is the feature this phase built, so a
// future contributor "fixing" a failure by asserting extras are absent from a
// relay-target argument would be encoding the inverse of the phase's goal. Any
// assertion that finds the canary missing from a transport-target argument
// should read as a REGRESSION in the feature, never as something to relax.
//
// Reuses the fake-pool dependency-injection harness convention from
// community.test.ts/client.test.ts (inert sync, ok:true publish acking) but
// additionally records every publish/request/subscription call's relay-TARGET
// argument, and serves `request()` from its own growing publish log — so a
// second client instance can genuinely fetch the invite bundle the first
// published, mirroring what a real shared relay would do.
//
// This file gains a second describe block (task 2) with per-write targeted
// equality assertions at each enumerated protocol write.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, delay, from } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { RelayPool } from "applesauce-relay";

import { ConcordClient } from "../client.js";
import { memoryStorage } from "../storage.js";
import { COMMUNITY_LIST_KIND } from "../../helpers/community-list.js";
import { parseInviteLink } from "../../helpers/invite-bundle.js";

// The invite-link fragment is a custom byte-packed, base64url-encoded format
// (encodeFragment/decodeFragment) — a raw substring check against `invite.url`
// cannot see a leak packed inside it (base64 scrambles byte boundaries), so
// every invite-link artifact assertion below decodes the link with the
// package's own public parser (parseInviteLink) FIRST and inspects the
// resulting bootstrapRelays array, never the raw URL string.

const settle = () => new Promise((r) => setTimeout(r, 200));

// A hostname that can never resolve to anything real — the phase's canary.
// Substring-matched (never the exact normalized form) against serialized
// event JSON, returned artifacts, and recorded transport-target arguments, so
// normalization (trailing-slash etc.) never hides a real leak or a real hit.
const CANARY_HOST = "canary.invalid";
const CANARY_RELAY = `wss://${CANARY_HOST}`;

// The community's protocol relay set for this suite — distinct from both the
// canary and the default STOCK_RELAYS, so a targeted equality assertion below
// can never pass by coincidence.
const PROTOCOL_RELAYS = ["wss://protocol-one.test", "wss://protocol-two.test"];

interface RecordedTarget {
  relays: string[];
  filters: unknown;
}
interface RecordedPublish {
  relays: string[];
  event: NostrEvent;
}

function matchesFilter(e: NostrEvent, f: { kinds?: number[]; authors?: string[]; [tag: string]: unknown }): boolean {
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  for (const key of Object.keys(f)) {
    if (!key.startsWith("#")) continue;
    const tagName = key.slice(1);
    const values = f[key] as string[];
    if (!e.tags.some((t) => t[0] === tagName && values.includes(t[1]))) return false;
  }
  return true;
}

/**
 * A fake pool mirroring community.test.ts/client.test.ts's DI harness (inert
 * relay-level request/sync, `ok:true`-for-every-target publish acking — the
 * "everyone is listening" shape refound()'s majority gate needs) that
 * additionally records every publish/request/subscription call's relay-TARGET
 * argument alongside its event/filter argument, and serves `request()`
 * queries from its own growing publish log so a second client instance can
 * genuinely fetch what the first one published.
 */
function fakePool(): {
  pool: RelayPool;
  publishes: RecordedPublish[];
  requests: RecordedTarget[];
  subscriptions: RecordedTarget[];
} {
  const publishes: RecordedPublish[] = [];
  const requests: RecordedTarget[] = [];
  const subscriptions: RecordedTarget[] = [];

  function serve(filters: unknown) {
    const fs = (Array.isArray(filters) ? filters : [filters]) as Array<{
      kinds?: number[];
      authors?: string[];
      [tag: string]: unknown;
    }>;
    const events = publishes.map((p) => p.event);
    const match = events.filter((e) => fs.some((f) => matchesFilter(e, f)));
    return from(match).pipe(delay(0));
  }

  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true, from: "wss://fake" }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };

  const pool = {
    status$: new Subject(),
    relay: () => relay,
    subscription: (relays: string[], filters: unknown) => {
      subscriptions.push({ relays, filters });
      return NEVER;
    },
    request: (relays: string[], filters: unknown) => {
      requests.push({ relays, filters });
      return serve(filters);
    },
    publish: async (relays: string[], event: NostrEvent) => {
      publishes.push({ relays, event });
      return relays.map((from) => ({ ok: true, from }));
    },
  } as unknown as RelayPool;

  return { pool, publishes, requests, subscriptions };
}

/** Drives create-community → create-invite-link → join-by-link (from a second
 *  client instance) through the public API only, both clients configured with
 *  the same canary extras endpoint over one shared fake pool. */
async function mintInviteAndJoin() {
  const { pool, publishes, requests, subscriptions } = fakePool();

  const signer1 = new PrivateKeySigner(generateSecretKey());
  const pubkey1 = await signer1.getPublicKey();
  const client1 = new ConcordClient({
    signer: signer1,
    pool,
    eventStore: new EventStore(),
    storage: memoryStorage(),
    relays: PROTOCOL_RELAYS,
    extraRelays: [CANARY_RELAY],
    autoUnlock: true,
  });
  await client1.start();
  const community1 = await client1.createNewCommunity("Canary", "extras must never leak", PROTOCOL_RELAYS);
  await settle();

  const invite = await client1.invites.create(community1.communityId, { base: "https://app.example" });
  await settle();

  const signer2 = new PrivateKeySigner(generateSecretKey());
  const client2 = new ConcordClient({
    signer: signer2,
    pool,
    eventStore: new EventStore(),
    storage: memoryStorage(),
    relays: PROTOCOL_RELAYS,
    extraRelays: [CANARY_RELAY],
    autoUnlock: true,
  });
  await client2.start();
  const community2 = await client2.joinByLink(invite.url);
  await settle();

  return {
    pool,
    publishes,
    requests,
    subscriptions,
    signer1,
    pubkey1,
    client1,
    community1,
    invite,
    client2,
    community2,
  };
}

describe("ConcordClient extra-relays lifecycle canary (D-05)", () => {
  it("drives create -> invite -> join -> metadata edit -> refound with a canary extras endpoint: canary is a transport target, never content or an artifact", async () => {
    const { publishes, requests, subscriptions, signer1, pubkey1, community1, invite, community2, client1, client2 } =
      await mintInviteAndJoin();

    await community1.editMetadata({ name: "Renamed" });
    await settle();

    await community1.refound({ keep: [pubkey1] });
    await settle();

    // Non-vacuity (TEST-01/T-12.3-28): every collection below must be
    // non-empty BEFORE any absence assertion, so an empty-collection false
    // pass is impossible.
    expect(publishes.length).toBeGreaterThan(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(subscriptions.length).toBeGreaterThan(0);

    // Positive (D-12/T-12.3-30): the canary DOES appear as a publish, request,
    // AND subscription transport target during the run. Extras appearing as
    // transport destinations is the feature — this is what proves the suite
    // catches a regression that drops extras entirely, not merely proves the
    // option is inert. Never invert these into absence assertions.
    expect(publishes.some((p) => p.relays.some((r) => r.includes(CANARY_HOST)))).toBe(true);
    expect(requests.some((r) => r.relays.some((u) => u.includes(CANARY_HOST)))).toBe(true);
    expect(subscriptions.some((s) => s.relays.some((u) => u.includes(CANARY_HOST)))).toBe(true);

    // Content: the canary must never appear inside a published event's
    // serialized form (tags, content, or any field a later phase adds).
    for (const { event } of publishes) {
      expect(JSON.stringify(event)).not.toContain(CANARY_HOST);
    }

    // Artifacts: the invite link URL, the joined community's material relays,
    // and the published community-list plaintext. The link's fragment is a
    // custom byte-packed/base64url encoding — decode it with the package's own
    // public parser before inspecting, never substring-match the raw URL (the
    // encoding can scramble a leaked substring into something unmatchable).
    const parsedInvite = parseInviteLink(invite.url);
    expect(parsedInvite.bootstrapRelays.length).toBeGreaterThan(0);
    expect(parsedInvite.bootstrapRelays.some((r) => r.includes(CANARY_HOST))).toBe(false);
    expect(community2.material.relays.length).toBeGreaterThan(0);
    expect(community2.material.relays.some((r) => r.includes(CANARY_HOST))).toBe(false);

    const listEvent = publishes
      .map((p) => p.event)
      .filter((e) => e.kind === COMMUNITY_LIST_KIND && e.pubkey === pubkey1)
      .at(-1);
    expect(listEvent).toBeDefined();
    const listPlaintext = await signer1.nip44!.decrypt(pubkey1, listEvent!.content);
    expect(listPlaintext).not.toContain(CANARY_HOST);

    client1.stop();
    client2.stop();
  });
});
