import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";

import { PERM, VSK } from "../../types.js";
import { EditionFactory } from "../../factories/control.js";
import { computeEditionHash } from "../editions.js";
import { channelKeyFor, createCommunity } from "../community.js";
import { foldControl } from "../control.js";
import { banlistLocator, grantLocator, inviteLinksLocator } from "../crypto.js";
import { decoded } from "./test-utils.js";

const OWNER = "ab".repeat(32);
const newCommunity = () => createCommunity({ ownerPubkey: OWNER, name: "Test", description: "d", relays: ["wss://r"] });

describe("control fold", () => {
  it("folds owner genesis metadata + channel, drops unauthorized editions", async () => {
    const genesis = await newCommunity();
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));
    // An outsider trying to publish a metadata edition must be ignored.
    const rogue = await EditionFactory.create({
      vsk: VSK.METADATA,
      eid: genesis.material.community_id,
      version: 2,
      content: JSON.stringify({ name: "Hijacked", relays: [] }),
    });
    events.push(decoded(rogue, "ff".repeat(32), 2_000));
    const state = foldControl(events, genesis.material);
    expect(state.metadata?.name).toBe("Test");
    expect(state.channels.map((c) => c.name)).toContain("general");
  });

  it("folds the owner's invite registry (vsk 8) at its creator-bound coordinate", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const ownerEid = inviteLinksLocator(hexToBytes(cid), OWNER);
    const reg = await EditionFactory.create({
      vsk: VSK.INVITE_REGISTRY,
      eid: ownerEid,
      version: 1,
      content: JSON.stringify(["11".repeat(32)]),
    });
    events.push(decoded(reg, genesis.material.owner, 2_000));

    // A registry published at someone else's coordinate is a forgery — ignored.
    const forged = await EditionFactory.create({
      vsk: VSK.INVITE_REGISTRY,
      eid: "cc".repeat(32),
      version: 1,
      content: JSON.stringify(["22".repeat(32)]),
    });
    events.push(decoded(forged, genesis.material.owner, 3_000));

    const state = foldControl(events, genesis.material);
    expect(state.inviteLinks.has("11".repeat(32))).toBe(true);
    expect(state.inviteLinks.has("22".repeat(32))).toBe(false);
  });

  it("folds the banlist only at its derived coordinate", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    // A banlist at any other eid is forged. Delivered FIRST, so a fold that took
    // whichever eid group arrived first would shadow the real list with this one —
    // and would disagree with a client that received them the other way round.
    const forged = await EditionFactory.create({
      vsk: VSK.BANLIST,
      eid: "cc".repeat(32),
      version: 1,
      content: JSON.stringify(["22".repeat(32)]),
    });
    events.push(decoded(forged, genesis.material.owner, 2_000));

    const real = await EditionFactory.create({
      vsk: VSK.BANLIST,
      eid: banlistLocator(hexToBytes(cid)),
      version: 1,
      content: JSON.stringify(["11".repeat(32)]),
    });
    events.push(decoded(real, genesis.material.owner, 3_000));

    const state = foldControl(events, genesis.material);
    expect(state.banlist.has("11".repeat(32))).toBe(true);
    expect(state.banlist.has("22".repeat(32))).toBe(false);
  });

  // AUTH-03: a Grant lives at exactly ONE derived coordinate (grantLocator),
  // mirroring the banlist coordinate gate above. Folding whichever eid group
  // happened to arrive first would let a forged-coordinate Grant for the same
  // member shadow the real one AND make the fold delivery-order dependent.
  it("folds a Grant only at its derived coordinate, delivery-order independent (AUTH-03)", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const cidBytes = hexToBytes(cid);
    const baseEvents = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const member = "cd".repeat(32);
    const roleId = "01".repeat(32);
    const role = { role_id: roleId, name: "mod", position: 5, permissions: "0", scope: { kind: "server" }, color: 0 };
    const roleEd = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });

    const genuineEid = grantLocator(cidBytes, member);
    const genuine = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid: genuineEid,
      version: 1,
      content: JSON.stringify({ member, role_ids: [roleId] }),
    });

    // A forged-coordinate Grant for the SAME member, owner-signed (authority
    // alone must not be enough — the coordinate must also match), attempting
    // to revoke via a bogus eid that != grantLocator(cid, member).
    const forged = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid: "cc".repeat(32),
      version: 1,
      content: JSON.stringify({ member, role_ids: [] }),
    });

    const genuineDecoded = decoded(genuine, genesis.material.owner, 2_100);
    const forgedDecoded = decoded(forged, genesis.material.owner, 2_200);
    const roleDecoded = decoded(roleEd, genesis.material.owner, 2_000);

    const state = foldControl([...baseEvents, roleDecoded, genuineDecoded, forgedDecoded], genesis.material);
    expect(state.grants.get(member)).toEqual([roleId]);

    // Delivery-order independence: folding the exact same two Grants in the
    // opposite order converges on the identical result.
    const reversedState = foldControl([...baseEvents, roleDecoded, forgedDecoded, genuineDecoded], genesis.material);
    expect(reversedState.grants.get(member)).toEqual([roleId]);
  });

  // AUTH-04: a malformed role_ids must degrade the single candidate to a
  // skip, never throw out of foldControl — a fold consumed by every member's
  // client must be total. The guard is unconditional (not folded into the
  // `authorized` chain), so it must also catch an owner-signed malformed Grant.
  it("skips a Grant whose role_ids is not an array, without throwing, even when owner-signed (AUTH-04)", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const member = "cd".repeat(32);
    const eid = grantLocator(hexToBytes(cid), member);
    const malformed = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid,
      version: 1,
      content: JSON.stringify({ member, role_ids: "not-an-array" }),
    });
    events.push(decoded(malformed, genesis.material.owner, 2_000));

    expect(() => foldControl(events, genesis.material)).not.toThrow();
    const state = foldControl(events, genesis.material);
    expect(state.grants.has(member)).toBe(false);
  });

  it("skips a Grant whose role_ids contains a non-string entry, without throwing (AUTH-04)", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const member = "cd".repeat(32);
    const eid = grantLocator(hexToBytes(cid), member);
    const malformed = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid,
      version: 1,
      content: JSON.stringify({ member, role_ids: ["01".repeat(32), 123] }),
    });
    events.push(decoded(malformed, genesis.material.owner, 2_000));

    expect(() => foldControl(events, genesis.material)).not.toThrow();
    const state = foldControl(events, genesis.material);
    expect(state.grants.has(member)).toBe(false);
  });

  // D-08: an empty role_ids is a valid revoke, NOT malformed — it must pass
  // the shape guard through to authorization (where owner authority admits it).
  it("treats an empty role_ids as a valid revoke, not malformed (AUTH-04/D-08)", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const cidBytes = hexToBytes(cid);
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const member = "cd".repeat(32);
    const roleId = "01".repeat(32);
    const role = { role_id: roleId, name: "mod", position: 5, permissions: "0", scope: { kind: "server" }, color: 0 };
    const roleEd = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });
    events.push(decoded(roleEd, genesis.material.owner, 2_000));

    const eid = grantLocator(cidBytes, member);
    const v1Content = JSON.stringify({ member, role_ids: [roleId] });
    const grant = await EditionFactory.create({ vsk: VSK.GRANT, eid, version: 1, content: v1Content });
    events.push(decoded(grant, genesis.material.owner, 2_100));

    const granted = foldControl(events, genesis.material);
    expect(granted.grants.get(member)).toEqual([roleId]);

    const prevHash = computeEditionHash({ vsk: VSK.GRANT, eid, version: 1, content: v1Content });
    const revoke = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid,
      version: 2,
      prevHash,
      content: JSON.stringify({ member, role_ids: [] }),
    });
    events.push(decoded(revoke, genesis.material.owner, 3_000));

    const revoked = foldControl(events, genesis.material);
    expect(revoked.grants.get(member)).toEqual([]);
  });

  // AUTH-07: a non-self Grant folds only when the signer strictly outranks
  // the target's CURRENT standing (CORD-04 §3 — lower position = higher
  // authority; equal cannot act on equal). Without this clause the existing
  // roles-outrank `.every()` is vacuously true for an empty role_ids, so any
  // MANAGE_ROLES holder could strip/demote ANY other member, including a
  // senior. Positions are hand-tabulated from CORD-04 §3, not read from
  // foldControl: senior=1 (higher authority), junior=5 (lower authority).
  it("rejects a junior member's revoke of a senior member's Grant (AUTH-07)", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const cidBytes = hexToBytes(cid);
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const seniorRoleId = "01".repeat(32);
    const seniorRole = { role_id: seniorRoleId, name: "senior", position: 1, permissions: "0", scope: { kind: "server" }, color: 0 };
    events.push(decoded(await EditionFactory.create({ vsk: VSK.ROLE, eid: seniorRoleId, version: 1, content: JSON.stringify(seniorRole) }), genesis.material.owner, 2_000));

    const juniorRoleId = "02".repeat(32);
    const juniorRole = {
      role_id: juniorRoleId,
      name: "junior",
      position: 5,
      permissions: PERM.MANAGE_ROLES.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    events.push(decoded(await EditionFactory.create({ vsk: VSK.ROLE, eid: juniorRoleId, version: 1, content: JSON.stringify(juniorRole) }), genesis.material.owner, 2_010));

    const seniorMember = "aa".repeat(32);
    const juniorMember = "bb".repeat(32);

    const seniorEid = grantLocator(cidBytes, seniorMember);
    const seniorGrantContent = JSON.stringify({ member: seniorMember, role_ids: [seniorRoleId] });
    events.push(decoded(await EditionFactory.create({ vsk: VSK.GRANT, eid: seniorEid, version: 1, content: seniorGrantContent }), genesis.material.owner, 2_100));

    const juniorEid = grantLocator(cidBytes, juniorMember);
    events.push(
      decoded(
        await EditionFactory.create({
          vsk: VSK.GRANT,
          eid: juniorEid,
          version: 1,
          content: JSON.stringify({ member: juniorMember, role_ids: [juniorRoleId] }),
        }),
        genesis.material.owner,
        2_110,
      ),
    );

    // Junior (position 5) publishes a chained revoke against the SENIOR's
    // (position 1) Grant. 5 is NOT < 1, so this must never fold.
    const seniorPrevHash = computeEditionHash({ vsk: VSK.GRANT, eid: seniorEid, version: 1, content: seniorGrantContent });
    events.push(
      decoded(
        await EditionFactory.create({
          vsk: VSK.GRANT,
          eid: seniorEid,
          version: 2,
          prevHash: seniorPrevHash,
          content: JSON.stringify({ member: seniorMember, role_ids: [] }),
        }),
        juniorMember,
        3_000,
      ),
    );

    const state = foldControl(events, genesis.material);
    expect(state.grants.get(seniorMember)).toEqual([seniorRoleId]);
  });

  // Self-targeting is exempt from the target-rank check: without the
  // exemption, `s.position < targetStanding.position` is always false for a
  // self-target (equal to itself), so no member could ever revoke/demote
  // their own Grant. The revoke settles on the self-authored empty grant
  // after the fixpoint's owner-fallback/self-revoke passes converge — see
  // the companion non-vacuity check (SUMMARY) which shows the same input
  // stuck at the ORIGINAL (never-revoked) grant once the exemption is removed.
  it("still allows a self-targeting Grant despite failing the (non-exempt) target-rank check (AUTH-07)", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const cidBytes = hexToBytes(cid);
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const juniorRoleId = "02".repeat(32);
    const juniorRole = {
      role_id: juniorRoleId,
      name: "junior",
      position: 5,
      permissions: PERM.MANAGE_ROLES.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    events.push(decoded(await EditionFactory.create({ vsk: VSK.ROLE, eid: juniorRoleId, version: 1, content: JSON.stringify(juniorRole) }), genesis.material.owner, 2_000));

    const juniorMember = "bb".repeat(32);
    const juniorEid = grantLocator(cidBytes, juniorMember);
    const v1Content = JSON.stringify({ member: juniorMember, role_ids: [juniorRoleId] });
    events.push(decoded(await EditionFactory.create({ vsk: VSK.GRANT, eid: juniorEid, version: 1, content: v1Content }), genesis.material.owner, 2_100));

    const prevHash = computeEditionHash({ vsk: VSK.GRANT, eid: juniorEid, version: 1, content: v1Content });
    // Self-targeting: junior revokes their OWN Grant. grant.member===cand.author,
    // exempt from the rank clause (which would otherwise fail: 5 is not < 5).
    events.push(
      decoded(
        await EditionFactory.create({
          vsk: VSK.GRANT,
          eid: juniorEid,
          version: 2,
          prevHash,
          content: JSON.stringify({ member: juniorMember, role_ids: [] }),
        }),
        juniorMember,
        3_000,
      ),
    );

    const state = foldControl(events, genesis.material);
    expect(state.grants.get(juniorMember)).toEqual([]);
  });

  // A roleless target (standing 0xffffffff, CORD-04 §3 sentinel) still
  // admits an initial grant from anyone who outranks the sentinel — this is
  // how a brand-new member ever gets their first role. AUTH-07 must not
  // regress initial grants/promotions of never-granted members.
  it("still allows granting a role to a roleless (never-granted) target (AUTH-07)", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const cidBytes = hexToBytes(cid);
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const juniorRoleId = "02".repeat(32);
    const juniorRole = {
      role_id: juniorRoleId,
      name: "junior",
      position: 5,
      permissions: PERM.MANAGE_ROLES.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    events.push(decoded(await EditionFactory.create({ vsk: VSK.ROLE, eid: juniorRoleId, version: 1, content: JSON.stringify(juniorRole) }), genesis.material.owner, 2_000));

    const lowRoleId = "03".repeat(32);
    const lowRole = { role_id: lowRoleId, name: "low", position: 10, permissions: "0", scope: { kind: "server" }, color: 0 };
    events.push(decoded(await EditionFactory.create({ vsk: VSK.ROLE, eid: lowRoleId, version: 1, content: JSON.stringify(lowRole) }), genesis.material.owner, 2_010));

    const juniorMember = "bb".repeat(32);
    const juniorEid = grantLocator(cidBytes, juniorMember);
    events.push(
      decoded(
        await EditionFactory.create({
          vsk: VSK.GRANT,
          eid: juniorEid,
          version: 1,
          content: JSON.stringify({ member: juniorMember, role_ids: [juniorRoleId] }),
        }),
        genesis.material.owner,
        2_100,
      ),
    );

    // Junior (position 5, MANAGE_ROLES) grants lowRoleId (position 10) to a
    // brand-new member who has never been granted anything (standing
    // sentinel 0xffffffff). 5 < 0xffffffff, so this must fold.
    const newMember = "cc".repeat(32);
    const newEid = grantLocator(cidBytes, newMember);
    events.push(
      decoded(
        await EditionFactory.create({
          vsk: VSK.GRANT,
          eid: newEid,
          version: 1,
          content: JSON.stringify({ member: newMember, role_ids: [lowRoleId] }),
        }),
        juniorMember,
        3_000,
      ),
    );

    const state = foldControl(events, genesis.material);
    expect(state.grants.get(newMember)).toEqual([lowRoleId]);
  });

  it("folds only the 100 lowest role_ids", async () => {
    const genesis = await newCommunity();
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    // 101 owner-signed roles with sortable ids "00…0000".."00…0064".
    for (let i = 0; i < 101; i++) {
      const roleId = i.toString(16).padStart(64, "0");
      const role = {
        role_id: roleId,
        name: `r${i}`,
        position: 5,
        permissions: "0",
        scope: { kind: "server" },
        color: 0,
      };
      const ed = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });
      events.push(decoded(ed, genesis.material.owner, 2_000 + i));
    }

    const state = foldControl(events, genesis.material);
    expect(state.roles.length).toBe(100);
    // The dropped one is the highest id (index 100 = 0x64).
    expect(state.roles.some((r) => r.role_id === (100).toString(16).padStart(64, "0"))).toBe(false);
  });

  it("keeps a deleted role visible in state but strips its authority", async () => {
    const genesis = await newCommunity();
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const roleId = "01".repeat(32);
    const role = { role_id: roleId, name: "mod", position: 5, permissions: "0", scope: { kind: "server" }, color: 0 };
    const v1Content = JSON.stringify(role);
    const created = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: v1Content });
    events.push(decoded(created, genesis.material.owner, 2_000));

    const grant = { member: "cd".repeat(32), role_ids: [roleId] };
    const granted = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid: grantLocator(hexToBytes(genesis.material.community_id), grant.member),
      version: 1,
      content: JSON.stringify(grant),
    });
    events.push(decoded(granted, genesis.material.owner, 2_100));

    const live = foldControl(events, genesis.material);
    expect(live.roles.find((r) => r.role_id === roleId)?.deleted).toBeFalsy();
    expect(live.grants.get(grant.member)).toEqual([roleId]);

    // A later edition (chained via prev) deletes the role.
    const prevHash = computeEditionHash({ vsk: VSK.ROLE, eid: roleId, version: 1, content: v1Content });
    const deleted = await EditionFactory.create({
      vsk: VSK.ROLE,
      eid: roleId,
      version: 2,
      prevHash,
      content: JSON.stringify({ ...role, deleted: true }),
    });
    events.push(decoded(deleted, genesis.material.owner, 3_000));

    const state = foldControl(events, genesis.material);
    const folded = state.roles.find((r) => r.role_id === roleId);
    expect(folded?.deleted).toBe(true); // still visible, flagged
    expect(state.grants.get(grant.member)).toEqual([roleId]); // grant untouched
  });

  // D-01/D-04 (H06): foldControl must never derive key material from edition
  // JSON — key/epoch fields are picked explicitly, everything else falls out of
  // the fold entirely (never blind-cast). A malformed field must be skipped, not
  // crash the fold.
  it("foldControl picks edition fields explicitly and never derives key material from edition JSON (CHAN-04)", async () => {
    const genesis = await newCommunity();
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    // An authorized edition smuggling `key`/`epoch` in its JSON — must never be read.
    const channelId = "55".repeat(32);
    const ed = await EditionFactory.create({
      vsk: VSK.CHANNEL,
      eid: channelId,
      version: 1,
      content: JSON.stringify({ name: "secret", private: true, key: "aa".repeat(32), epoch: 99 }),
    });
    events.push(decoded(ed, genesis.material.owner, 2_000));

    // A malformed edition (non-boolean `private`) for a different channel must
    // not crash the fold — it is skipped, never coerced.
    const malformedId = "66".repeat(32);
    const malformed = await EditionFactory.create({
      vsk: VSK.CHANNEL,
      eid: malformedId,
      version: 1,
      content: JSON.stringify({ name: "broken", private: "yes" }),
    });
    events.push(decoded(malformed, genesis.material.owner, 2_100));

    const state = foldControl(events, genesis.material); // must not throw

    const folded = state.channels.find((c) => c.channel_id === channelId);
    expect(folded).toBeDefined();
    expect(folded!.name).toBe("secret");
    expect(folded!.private).toBe(true);
    expect(Object.hasOwn(folded!, "key")).toBe(false);
    expect(Object.hasOwn(folded!, "epoch")).toBe(false);

    // The malformed candidate is dropped entirely, not folded with a coerced type.
    expect(state.channels.some((c) => c.channel_id === malformedId)).toBe(false);

    // The edition's smuggled key never becomes derivable: a client holding no
    // material.channels entry for this id derives NOTHING for it (CHAN-01/H06).
    expect(genesis.material.channels.find((c) => c.id === channelId)).toBeUndefined();
    expect(channelKeyFor(genesis.material, folded!)).toBeNull();
  });

  // D-07/D-08/D-09 (CHAN-07, CORD-03 §2 "deletion is terminal, the id is never
  // reused"): once ANY authorized edition for an id is deleted:true, the channel
  // is permanently dropped and `heads` is pinned to that deleting edition — so a
  // subsequent compaction cannot resurrect it. This test simulates the full
  // round trip: create -> delete -> resurrection-attempt -> same-session fold
  // (still dropped) -> compaction (heads only) -> a FRESH fold over only the
  // compacted heads, as a new invite joiner would see (still dropped). A test
  // that only checks `state.channels` after ONE fold would pass even with the
  // heads-pinning bug present (07-RESEARCH.md Pitfall 1) — this test explicitly
  // does not stop there.
  it("a deleted channel stays deleted across a compaction + fresh-joiner fold (CHAN-07)", async () => {
    const genesis = await newCommunity();
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const channelId = "77".repeat(32);
    const v1Content = JSON.stringify({ name: "temp", private: false });
    const v1 = await EditionFactory.create({ vsk: VSK.CHANNEL, eid: channelId, version: 1, content: v1Content });
    events.push(decoded(v1, genesis.material.owner, 2_000));

    const v1Hash = computeEditionHash({ vsk: VSK.CHANNEL, eid: channelId, version: 1, content: v1Content });
    const v2Content = JSON.stringify({ name: "temp", private: false, deleted: true });
    const v2 = await EditionFactory.create({
      vsk: VSK.CHANNEL,
      eid: channelId,
      version: 2,
      prevHash: v1Hash,
      content: v2Content,
    });
    events.push(decoded(v2, genesis.material.owner, 3_000));

    // A higher-version "resurrection" edition citing v2 as its prev.
    const v2Hash = computeEditionHash({ vsk: VSK.CHANNEL, eid: channelId, version: 2, prevHash: v1Hash, content: v2Content });
    const v3Content = JSON.stringify({ name: "temp", private: false, deleted: false });
    const v3 = await EditionFactory.create({
      vsk: VSK.CHANNEL,
      eid: channelId,
      version: 3,
      prevHash: v2Hash,
      content: v3Content,
    });
    events.push(decoded(v3, genesis.material.owner, 4_000));

    // Same-session fold over the full history (v1, v2-deleted, v3-resurrection):
    // the sticky-delete scan sees v2 directly and drops the channel.
    const full = foldControl(events, genesis.material);
    expect(full.channels.some((c) => c.channel_id === channelId)).toBe(false);

    // The winning head for this entity must be pinned to the DELETING (v2)
    // edition, not the ordinary version-chain head (which would be v3).
    const headEdition = full.heads?.get(channelId);
    expect(headEdition).toBeDefined();

    // Simulate compaction: a fresh invite joiner never fetches prior-epoch
    // history (held_roots omission is spec-correct) — they see ONLY what's
    // compacted into the current heads. Fold a BRAND NEW foldControl call using
    // only the winning heads as the sole input.
    const compactedEvents = [...(full.heads?.values() ?? [])];
    const freshJoinerFold = foldControl(compactedEvents, genesis.material);

    // If heads had followed the ordinary chain (v3, the resurrection), this
    // fresh fold would see only `{ deleted: false }` and wrongly resurrect the
    // channel. Because heads is pinned to v2, the sticky-delete scan still finds
    // the deletion even with no other history present.
    expect(freshJoinerFold.channels.some((c) => c.channel_id === channelId)).toBe(false);
  });
});
