import { describe, expect, it } from "vitest";

import { fromHex, toHex } from "../../bytes.js";
import { PERM, VSK } from "../../types.js";
import type { DecodedEvent, Role, RumorTemplate } from "../../types.js";
import {
  communityId,
  editionHash,
  epochKeyCommitment,
  groupKey,
} from "../crypto.js";
import {
  canActOn,
  hasPerm,
  parsePermissions,
  permNames,
  resolveStanding,
} from "../permissions.js";
import { createCommunity, deriveKeys, verifyOwner } from "../community.js";
import { buildEdition, computeEditionHash } from "../editions.js";
import { foldControl } from "../control.js";
import { foldMembers } from "../guestbook.js";
import {
  EMPTY_COMMUNITY_LIST,
  addToList,
  isCommunityLive,
  mergeCommunityLists,
  removeFromList,
  withinByteCap,
} from "../community-list.js";
import {
  checkContinuity,
  decodeWrappedKey,
  encodeWrappedKey,
  groupRotations,
  parseRekey,
  rekeyScopeId,
} from "../rekey.js";

const SECRET = new Uint8Array(32).fill(7);
const CID = new Uint8Array(32).fill(9);

// A synthetic decoded plane event for fold tests — no envelope required.
function decoded(rumor: RumorTemplate, author: string, ms = 1_000, id = Math.random().toString(16).slice(2)): DecodedEvent {
  return {
    rumor: { id, kind: rumor.kind, pubkey: author, content: rumor.content, tags: rumor.tags, created_at: Math.floor(ms / 1000) },
    author,
    wrapId: id,
    sealKind: 20014,
    ms,
  };
}

describe("crypto derivations", () => {
  it("groupKey is deterministic and epoch-sensitive", () => {
    const a = groupKey("concord/control", SECRET, CID, 0);
    const b = groupKey("concord/control", SECRET, CID, 0);
    const c = groupKey("concord/control", SECRET, CID, 1);
    expect(a.pk).toBe(b.pk);
    expect(a.convKey).toEqual(b.convKey);
    expect(a.pk).not.toBe(c.pk);
    expect(a.pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("editionHash chains on prev + content", () => {
    const eid = new Uint8Array(32).fill(1);
    const v1 = editionHash(eid, 1, undefined, new TextEncoder().encode("{}"));
    const v2 = editionHash(eid, 2, fromHex(v1), new TextEncoder().encode("{}"));
    expect(v1).not.toBe(v2);
    expect(editionHash(eid, 1, undefined, new TextEncoder().encode("{}"))).toBe(v1);
  });

  it("epochKeyCommitment is deterministic", () => {
    expect(toHex(epochKeyCommitment(3, SECRET))).toBe(toHex(epochKeyCommitment(3, SECRET)));
    expect(toHex(epochKeyCommitment(3, SECRET))).not.toBe(toHex(epochKeyCommitment(4, SECRET)));
  });

  it("communityId commits to owner + salt", () => {
    const salt = new Uint8Array(32).fill(2);
    const owner = "ab".repeat(32);
    expect(toHex(communityId(owner, salt))).toBe(toHex(communityId(owner, salt)));
  });
});

describe("permissions", () => {
  it("parses and tests bits", () => {
    const perms = PERM.MANAGE_ROLES | PERM.BAN;
    expect(parsePermissions(perms.toString())).toBe(perms);
    expect(parsePermissions("garbage")).toBe(0n);
    expect(hasPerm(perms, PERM.BAN)).toBe(true);
    expect(hasPerm(perms, PERM.KICK)).toBe(false);
    expect(permNames(perms).sort()).toEqual(["BAN", "MANAGE_ROLES"]);
  });

  it("resolves standing and outranking", () => {
    const owner = "owner";
    const roles = new Map<string, Role>([
      ["mod", { role_id: "mod", name: "mod", position: 5, permissions: PERM.KICK.toString(), scope: { kind: "server" }, color: 0 }],
    ]);
    const grants = new Map<string, string[]>([["alice", ["mod"]]]);
    const ownerStanding = resolveStanding(owner, owner, roles, grants);
    const alice = resolveStanding("alice", owner, roles, grants);
    const bob = resolveStanding("bob", owner, roles, grants);
    expect(ownerStanding.isOwner).toBe(true);
    expect(alice.position).toBe(5);
    expect(canActOn(alice, bob, PERM.KICK)).toBe(true); // alice(5) outranks roleless bob
    expect(canActOn(bob, alice, PERM.KICK)).toBe(false); // bob has no perm
    expect(canActOn(ownerStanding, alice, PERM.BAN)).toBe(true); // owner always
  });
});

describe("control fold", () => {
  it("folds owner genesis metadata + channel, drops unauthorized editions", () => {
    const genesis = createCommunity({ ownerPubkey: "ab".repeat(32), name: "Test", description: "d", relays: ["wss://r"] });
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));
    // An outsider trying to publish a metadata edition must be ignored.
    const rogue = buildEdition({ vsk: VSK.METADATA, eid: genesis.material.community_id, version: 2, content: JSON.stringify({ name: "Hijacked", relays: [] }) });
    events.push(decoded(rogue, "ff".repeat(32), 2_000));
    const state = foldControl(events, genesis.material);
    expect(state.metadata?.name).toBe("Test");
    expect(state.channels.map((c) => c.name)).toContain("general");
  });
});

describe("guestbook fold", () => {
  it("coalesces joins/leaves, honors banlist", () => {
    const join = (pk: string, ms: number) => decoded({ kind: 3306, content: "join", tags: [["ms", String(ms % 1000)]] }, pk, ms);
    const leave = (pk: string, ms: number) => decoded({ kind: 3306, content: "leave", tags: [["ms", String(ms % 1000)]] }, pk, ms);
    const owner = "owner";
    const roles = new Map<string, Role>();
    const grants = new Map<string, string[]>();
    const standing = (m: string) => resolveStanding(m, owner, roles, grants);
    const members = foldMembers(
      [join("alice", 1_000), join("bob", 1_000), leave("bob", 2_000)],
      new Map(),
      new Set(["carol"]),
      standing,
      10_000,
    );
    expect(members.has("alice")).toBe(true);
    expect(members.has("bob")).toBe(false); // left
    expect(members.has("carol")).toBe(false); // banned
  });
});

describe("community-list CRDT", () => {
  const mkEntry = (id: string, epoch: number, at: number) => ({
    community_id: id,
    seed: { community_id: id, owner: "o", owner_salt: "s", community_root: "r", root_epoch: epoch, channels: [], relays: [], name: id },
    current: { community_id: id, owner: "o", owner_salt: "s", community_root: "r", root_epoch: epoch, channels: [], relays: [], name: id },
    added_at: at,
  });

  it("merge is commutative and idempotent", () => {
    const a = addToList(EMPTY_COMMUNITY_LIST, mkEntry("x", 1, 100));
    const b = addToList(EMPTY_COMMUNITY_LIST, mkEntry("y", 1, 200));
    const ab = mergeCommunityLists(a, b);
    const ba = mergeCommunityLists(b, a);
    expect(ab).toEqual(ba);
    expect(mergeCommunityLists(ab, ab)).toEqual(ab);
  });

  it("liveness: leave kills, later re-join resurrects", () => {
    let list = addToList(EMPTY_COMMUNITY_LIST, mkEntry("x", 1, 100));
    expect(isCommunityLive(list, "x")).toBe(true);
    list = removeFromList(list, "x", 200);
    expect(isCommunityLive(list, "x")).toBe(false);
    list = addToList(list, mkEntry("x", 2, 300));
    expect(isCommunityLive(list, "x")).toBe(true);
    expect(withinByteCap(list)).toBe(true);
  });
});

describe("rekey codec", () => {
  it("wrapped-key round-trips and rejects scope/epoch splices", () => {
    const scopeId = new Uint8Array(32).fill(4);
    const key = new Uint8Array(32).fill(5);
    const enc = encodeWrappedKey(scopeId, 7n, key);
    expect(enc.length).toBe(72);
    expect(toHex(decodeWrappedKey(enc, scopeId, 7n))).toBe(toHex(key));
    expect(() => decodeWrappedKey(enc, new Uint8Array(32).fill(6), 7n)).toThrow(/scope/);
    expect(() => decodeWrappedKey(enc, scopeId, 8n)).toThrow(/epoch/);
  });

  it("checkContinuity distinguishes ok / gap / fork", () => {
    const held = new Uint8Array(32).fill(1);
    const commit = toHex(epochKeyCommitment(2n, held));
    expect(checkContinuity({ prevEpoch: 2n, prevCommit: commit }, 2n, held)).toEqual({ ok: true });
    expect(checkContinuity({ prevEpoch: 2n, prevCommit: "00".repeat(32) }, 2n, held)).toEqual({ ok: false, reason: "fork" });
    expect(checkContinuity({ prevEpoch: 5n, prevCommit: commit }, 2n, held)).toEqual({ ok: false, reason: "gap" });
  });

  it("groupRotations marks a single-chunk rotation complete", () => {
    const rumor: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "aa", wrapped: "bb" }]),
      tags: [
        ["scope", toHex(rekeyScopeId({ kind: "root" }))],
        ["newepoch", "3"],
        ["prevepoch", "2"],
        ["prevcommit", "cc".repeat(32)],
        ["chunk", "1", "1"],
        ["ms", "0"],
      ],
    };
    const parsed = parseRekey(decoded(rumor, "rotator"));
    expect(parsed).not.toBeNull();
    const sets = groupRotations([parsed!]);
    expect(sets).toHaveLength(1);
    expect(sets[0].complete).toBe(true);
  });
});

describe("community keys", () => {
  it("createCommunity yields a verifiable owner proof and derivable keys", () => {
    const genesis = createCommunity({ ownerPubkey: "ab".repeat(32), name: "N", relays: ["wss://r"] });
    expect(verifyOwner(genesis.material)).toBe(true);
    const keys = deriveKeys(genesis.material, []);
    expect(keys.control.pk).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.guestbook.pk).not.toBe(keys.control.pk);
  });
});

// computeEditionHash is the builder-side mirror of the fold-side editionHash.
describe("edition builder", () => {
  it("computeEditionHash matches editionHash", () => {
    const eid = "11".repeat(32);
    const content = JSON.stringify({ name: "x" });
    expect(computeEditionHash({ vsk: VSK.METADATA, eid, version: 1, content })).toBe(
      editionHash(fromHex(eid), 1, undefined, new TextEncoder().encode(content)),
    );
  });
});
