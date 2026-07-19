// D-04 down-only re-read spine (ROTATE-06): `syncEpoch`'s "known" branch folds a
// historical epoch's already-fetched rekey plane instead of discarding it, and
// `syncEpochs` cascades a strictly-lower late-arriving winner into the walk's
// continuation. Exercised directly against `syncEpoch`/`syncEpochs` over a
// dependency-injected pool that SERVES pre-built wraps (no sockets, no
// ConcordCommunity) — mirrors private-channel.test.ts's `servingPool` pattern.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, from } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { RelayPool } from "applesauce-relay";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { EditionFactory } from "../../factories/control.js";
import { buildRefounding, deriveConcordKeys, rollForward, wrapForTarget } from "../../helpers/keys.js";
import { grantLocator } from "../../helpers/crypto.js";
import { PERM, VSK } from "../../types.js";
import { syncEpochs, type SyncContext } from "../sync.js";

// A RelayPool stand-in that serves `events` matching each REQ's authors/kinds and
// completes (EOSE). No NIP-77, no live subscription — identical shape to
// private-channel.test.ts's `servingPool`.
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

describe("syncEpochs — D-04 down-only re-read spine (ROTATE-06)", () => {
  it("re-reads a known epoch's rekey plane; a late-arriving strictly-lower sibling cascades into N+2", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const member = new PrivateKeySigner(generateSecretKey());
    const memberPub = await member.getPublicKey();
    const self = new PrivateKeySigner(generateSecretKey());
    const selfPub = await self.getPublicKey();

    const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material0 = genesis.material;
    const keys0 = deriveConcordKeys(material0, []);

    const events: NostrEvent[] = [];

    // Grant `member` PERM.BAN (mirrors community.test.ts's AUTH-02 pattern) so a
    // SECOND, independent rotator is authorized to compete with the owner for
    // epoch 1 — CORD-06 §3 racing convergence needs two DISTINCT rotator
    // pubkeys, since `groupRotations` keys sets by (rotator, scope, newEpoch,
    // prevCommit): same-rotator chunks would merge into one set, not race.
    const roleId = "03".repeat(32);
    const role = {
      role_id: roleId,
      name: "Banhammer",
      position: 5,
      permissions: PERM.BAN.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    const roleEd = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });
    events.push((await wrapForTarget(keys0, { plane: "control" }, owner, roleEd, { plaintext: true })).wrap);

    const grantEid = grantLocator(hexToBytes(material0.community_id), memberPub);
    const grantEd = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid: grantEid,
      version: 1,
      content: JSON.stringify({ member: memberPub, role_ids: [roleId] }),
    });
    events.push((await wrapForTarget(keys0, { plane: "control" }, owner, grantEd, { plaintext: true })).wrap);

    // HAND-DERIVED ordering (CORD-06 §3's lowest-key-wins rule) — fixed byte
    // patterns, not random keys, so "LOW < HIGH" holds by construction and this
    // test's expectations never depend on lowerKeyWins/isStrictlyLowerKey
    // (the functions under test) to determine which root SHOULD win:
    //   lowKey  = 0x01 repeated 32x → hex "0101…01"
    //   highKey = 0xff repeated 32x → hex "ffff…ff"
    // "0101…" < "ffff…" lexicographically, so lowKey MUST be the winner.
    const lowKey = new Uint8Array(32).fill(0x01);
    const highKey = new Uint8Array(32).fill(0xff);
    expect(bytesToHex(lowKey) < bytesToHex(highKey)).toBe(true); // sanity-check the hand derivation itself

    const recipients = [ownerPub, memberPub, selfPub];

    // Owner's rotation lands first (HIGH root) — a normal, uncontested adoption.
    const ownerPlan = await buildRefounding(keys0, owner, {
      recipients,
      self: ownerPub,
      heads: [],
      channels: [],
      newRoot: highKey,
    });
    events.push(...ownerPlan.rekeyWraps);

    const pool = servingPool(events);
    const ctx: SyncContext = {
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      signer: self,
      self: selfPub,
      relays: ["wss://fake"],
      route: () => {},
      ensureAuth: () => {},
    };

    // First full sync: only the owner's (HIGH) rotation is on the relay.
    const first = await syncEpochs(ctx, material0);
    expect(first.removed).toBe(false);
    expect(first.tipKeys?.material.root_epoch).toBe(1);
    expect(first.tipKeys?.material.community_root).toBe(bytesToHex(highKey));

    // The member's (LOW) rotation for the SAME epoch 0→1 slot arrives LATE —
    // appended to the relay only now, simulating a straggling relay/late publish.
    const memberPlan = await buildRefounding(keys0, member, {
      recipients,
      self: memberPub,
      heads: [],
      channels: [],
      newRoot: lowKey,
    });
    events.push(...memberPlan.rekeyWraps);

    // A legitimate epoch1(LOW)→epoch2 rotation, minted by the owner directly off
    // the CORRECTED LOW root — proves the cascade rebuilds N+2 from the corrected
    // N+1, not the abandoned HIGH branch. Addressed under the LOW root, so it is
    // invisible to the walk until the LOW root is actually (re-)adopted.
    const keys1Low = rollForward(keys0, lowKey, 1, memberPub, []);
    const epoch2Key = generateSecretKey();
    const followupPlan = await buildRefounding(keys1Low, owner, {
      recipients: [ownerPub, memberPub, selfPub],
      self: ownerPub,
      heads: [],
      channels: [],
      newRoot: epoch2Key,
    });
    events.push(...followupPlan.rekeyWraps);

    // Second (later) full sync starts from the PERSISTED material a caller would
    // have saved after the first walk — tip epoch 1 (HIGH), epoch 0 held.
    const persisted = first.tipKeys!.material;
    const second = await syncEpochs(ctx, persisted);

    // Epoch 0 is re-read ("known"), NOT re-decided as "adopt" — but it now
    // surfaces the strictly-lower sibling for `syncEpochs` to act on.
    const epoch0Result = second.epochs.find((e) => e.epoch === 0)!;
    expect(epoch0Result.transition).toBe("known");
    expect(epoch0Result.reReadAdopted?.key).toEqual(lowKey);

    // The cascade replaced chain[1]: the corrected epoch-1 root is LOW, not HIGH.
    const epoch1Result = second.epochs.find((e) => e.epoch === 1)!;
    expect(epoch1Result.keys.material.community_root).toBe(bytesToHex(lowKey));

    // N+2 rebuilt from the CORRECTED N+1 — the tip is epoch 2, minted off LOW.
    expect(second.tipKeys?.material.root_epoch).toBe(2);
    expect(second.tipKeys?.material.community_root).toBe(bytesToHex(epoch2Key));
    // held_roots threads through the corrected branch (LOW at epoch 1), proving
    // the abandoned HIGH branch is fully discarded, not merely skipped over.
    expect(second.tipKeys?.material.held_roots).toEqual([
      { epoch: 1, key: bytesToHex(lowKey) },
      { epoch: 0, key: material0.community_root },
    ]);
  });

  it("re-reading the SAME (non-strictly-lower) winner again leaves a settled epoch untouched (down-only)", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const self = new PrivateKeySigner(generateSecretKey());
    const selfPub = await self.getPublicKey();

    const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material0 = genesis.material;
    const keys0 = deriveConcordKeys(material0, []);

    const highKey = new Uint8Array(32).fill(0xff);
    const recipients = [ownerPub, selfPub];
    const ownerPlan = await buildRefounding(keys0, owner, {
      recipients,
      self: ownerPub,
      heads: [],
      channels: [],
      newRoot: highKey,
    });

    const events: NostrEvent[] = [...ownerPlan.rekeyWraps];
    const pool = servingPool(events);
    const ctx: SyncContext = {
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      signer: self,
      self: selfPub,
      relays: ["wss://fake"],
      route: () => {},
      ensureAuth: () => {},
    };

    const first = await syncEpochs(ctx, material0);
    expect(first.tipKeys?.material.community_root).toBe(bytesToHex(highKey));

    // No new events arrive — a second full walk re-reads epoch 0 and rediscovers
    // the SAME (already-latched) root. It is surfaced as a re-read "adopt" (the
    // fold itself has no memory of what was already settled — see `syncEpoch`'s
    // doc comment), but `syncEpochs`'s down-only comparison must recognize it is
    // NOT strictly lower and leave the chain exactly as it was.
    const second = await syncEpochs(ctx, first.tipKeys!.material);
    const epoch0Result = second.epochs.find((e) => e.epoch === 0)!;
    expect(epoch0Result.reReadAdopted?.key).toEqual(highKey);
    expect(second.tipKeys?.material.root_epoch).toBe(1);
    expect(second.tipKeys?.material.community_root).toBe(bytesToHex(highKey));
  });
});
