// D-04 backward re-read pass (ROTATE-06, channel scope): `syncChannelEpochs`
// walks `channel.held` oldest-first, re-invoking `syncRekeyAndAdvance` against
// each held epoch's rekey plane; a late-arriving strictly-lower sibling for a
// PAST channel epoch discards the forward continuation and re-walks forward
// from the corrected key. Exercised directly against `syncChannelEpochs` over a
// dependency-injected pool that SERVES pre-built wraps (no sockets, no
// ConcordPrivateChannel) — mirrors client/__tests__/sync.test.ts's pattern.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, from } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore, logger } from "applesauce-core";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { RelayPool } from "applesauce-relay";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { buildChannelRekey } from "../../helpers/keys.js";
import type { ChannelKey } from "../../types.js";
import { syncChannelEpochs, type ChannelSyncContext } from "../channel-sync.js";

// Same servingPool shape as client/__tests__/sync.test.ts and
// client/__tests__/private-channel.test.ts.
function servingPool(events: NostrEvent[]): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: (filters: unknown) => {
      const fs = (Array.isArray(filters) ? filters : [filters]) as Array<{
        kinds?: number[];
        authors?: string[];
        since?: number;
        until?: number;
      }>;
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
    subscription: () => NEVER,
    request: (_relays: string[], filters: unknown) => relay.request(filters),
    publish: async () => [],
  } as unknown as RelayPool;
}

describe("syncChannelEpochs — D-04 backward re-read spine (ROTATE-06, channel scope)", () => {
  it("heals a held epoch to a late-arriving strictly-lower sibling and rebuilds N+2 from it", async () => {
    const rotatorA = new PrivateKeySigner(generateSecretKey());
    const rotatorAPub = await rotatorA.getPublicKey();
    const rotatorB = new PrivateKeySigner(generateSecretKey());
    const rotatorBPub = await rotatorB.getPublicKey();
    const self = new PrivateKeySigner(generateSecretKey());
    const selfPub = await self.getPublicKey();

    const genesis = await createCommunity({ ownerPubkey: rotatorAPub, name: "T", relays: ["wss://fake"] });
    const material = genesis.material;

    const channelId = bytesToHex(generateSecretKey());
    const epoch1Key = bytesToHex(generateSecretKey());
    const channelAtEpoch1: ChannelKey = { id: channelId, key: epoch1Key, epoch: 1, name: "secret" };

    // HAND-DERIVED ordering (CORD-06 §3's lowest-key-wins rule) — fixed byte
    // patterns, not random keys, so "LOW < HIGH" holds by construction:
    const lowKey = new Uint8Array(32).fill(0x01);
    const highKey = new Uint8Array(32).fill(0xff);
    expect(bytesToHex(lowKey) < bytesToHex(highKey)).toBe(true); // sanity-check the hand derivation itself

    const recipients = [rotatorAPub, rotatorBPub, selfPub];

    // rotatorA's rotation (HIGH) is what the walk originally adopted for epoch
    // 1→2 — the channel is already sitting at epoch 2 (HIGH), epoch 1 held.
    const highPlan = await buildChannelRekey(material, channelAtEpoch1, rotatorA, {
      recipients,
      self: rotatorAPub,
      newKey: highKey,
    });
    const events: NostrEvent[] = [...highPlan.rekeyWraps];

    // rotatorB's competing rotation (LOW) for the SAME epoch 1→2 slot arrives
    // LATE — appended to the relay only now.
    const lowPlan = await buildChannelRekey(material, channelAtEpoch1, rotatorB, {
      recipients,
      self: rotatorBPub,
      newKey: lowKey,
    });
    events.push(...lowPlan.rekeyWraps);

    // A legitimate epoch2(LOW)→epoch3 rotation, minted directly off the
    // CORRECTED LOW key — proves the cascade rebuilds N+2 from the corrected
    // N+1, not the abandoned HIGH branch. Addressed under the LOW channel key's
    // OWN epoch-2 rekey listen address (channel-rekey addresses key on the
    // COMMUNITY root, not the channel key itself, so this event is visible
    // regardless of which channel-key branch wins — the walk just can't reach
    // it until it actually advances to epoch 2).
    const channelAtEpoch2Low: ChannelKey = { id: channelId, key: bytesToHex(lowKey), epoch: 2, name: "secret" };
    const epoch3Key = generateSecretKey();
    const followupPlan = await buildChannelRekey(material, channelAtEpoch2Low, rotatorA, {
      recipients,
      self: rotatorAPub,
      newKey: epoch3Key,
    });
    events.push(...followupPlan.rekeyWraps);

    const pool = servingPool(events);
    const ctx: ChannelSyncContext = {
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      signer: self,
      self: selfPub,
      relays: ["wss://fake"],
      route: () => {},
      ensureAuth: () => {},
      material,
      isAuthorized: (r) => r === rotatorAPub || r === rotatorBPub,
      logger: logger.extend("test"),
      decodeLogger: logger.extend("test").extend("decode"),
    };

    // The channel walk STARTS already at epoch 2 (HIGH), epoch 1 held — as if a
    // prior full sync had already adopted the HIGH branch, exactly like
    // client/__tests__/sync.test.ts's root-scope cascade oracle.
    const channelAtEpoch2High: ChannelKey = {
      id: channelId,
      key: bytesToHex(highKey),
      epoch: 2,
      name: "secret",
      held: [{ epoch: 1, key: epoch1Key }],
    };

    const result = await syncChannelEpochs(ctx, channelAtEpoch2High);
    expect(result.removed).toBe(false);

    // N+2 rebuilt from the CORRECTED N+1 — the tip is epoch 3, minted off LOW.
    expect(result.tipKey?.epoch).toBe(3);
    expect(result.tipKey?.key).toBe(bytesToHex(epoch3Key));
    // held threads through the corrected branch (LOW at epoch 2, the original
    // epoch 1 key underneath it), proving the abandoned HIGH branch at epoch 2
    // is fully discarded, not merely skipped over.
    expect(result.tipKey?.held).toEqual([
      { epoch: 2, key: bytesToHex(lowKey) },
      { epoch: 1, key: epoch1Key },
    ]);
  });

  it("re-reading a held epoch with no strictly-lower sibling leaves the chain untouched", async () => {
    const rotatorA = new PrivateKeySigner(generateSecretKey());
    const rotatorAPub = await rotatorA.getPublicKey();
    const self = new PrivateKeySigner(generateSecretKey());
    const selfPub = await self.getPublicKey();

    const genesis = await createCommunity({ ownerPubkey: rotatorAPub, name: "T", relays: ["wss://fake"] });
    const material = genesis.material;

    const channelId = bytesToHex(generateSecretKey());
    const epoch1Key = bytesToHex(generateSecretKey());
    const channelAtEpoch1: ChannelKey = { id: channelId, key: epoch1Key, epoch: 1, name: "secret" };

    const highKey = new Uint8Array(32).fill(0xff);
    const recipients = [rotatorAPub, selfPub];
    const highPlan = await buildChannelRekey(material, channelAtEpoch1, rotatorA, {
      recipients,
      self: rotatorAPub,
      newKey: highKey,
    });

    const pool = servingPool([...highPlan.rekeyWraps]);
    const ctx: ChannelSyncContext = {
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      signer: self,
      self: selfPub,
      relays: ["wss://fake"],
      route: () => {},
      ensureAuth: () => {},
      material,
      isAuthorized: (r) => r === rotatorAPub,
      logger: logger.extend("test"),
      decodeLogger: logger.extend("test").extend("decode"),
    };

    const channelAtEpoch2: ChannelKey = {
      id: channelId,
      key: bytesToHex(highKey),
      epoch: 2,
      name: "secret",
      held: [{ epoch: 1, key: epoch1Key }],
    };

    // Only the already-adopted (HIGH) rotation is on the relay — re-reading it
    // rediscovers the SAME key, which is not strictly lower, so the tip and the
    // held history are unchanged.
    const result = await syncChannelEpochs(ctx, channelAtEpoch2);
    expect(result.removed).toBe(false);
    expect(result.tipKey?.epoch).toBe(2);
    expect(result.tipKey?.key).toBe(bytesToHex(highKey));
    expect(result.tipKey?.held).toEqual([{ epoch: 1, key: epoch1Key }]);
  });
});
