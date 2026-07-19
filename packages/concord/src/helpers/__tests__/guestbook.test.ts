import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";

import { PERM } from "../../types.js";
import type { CommunityState, JoinMaterial, Role } from "../../types.js";
import { grantLocator } from "../crypto.js";
import { foldMembers } from "../guestbook.js";
import { resolveStanding, vacVerifier } from "../permissions.js";
import { decoded } from "./test-utils.js";

describe("guestbook fold", () => {
  it("coalesces joins/leaves, honors banlist", () => {
    const join = (pk: string, ms: number) =>
      decoded({ kind: 3306, content: "join", tags: [["ms", String(ms % 1000)]] }, pk, ms);
    const leave = (pk: string, ms: number) =>
      decoded({ kind: 3306, content: "leave", tags: [["ms", String(ms % 1000)]] }, pk, ms);
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

  const owner = "owner";
  const standing = (m: string) => resolveStanding(m, owner, new Map<string, Role>(), new Map<string, string[]>());

  it("honors a snapshot only from the epoch's refounder", () => {
    const snap = (author: string, members: string[], ms: number) =>
      decoded(
        {
          kind: 3312,
          content: JSON.stringify(members),
          tags: [
            ["snap", "s1", "1", "1"],
            ["ms", String(ms % 1000)],
          ],
        },
        author,
        ms,
      );

    // From an arbitrary member: ignored.
    const forged = foldMembers(
      [snap("mallory", ["victim"], 1_000)],
      new Map(),
      new Set(),
      standing,
      10_000,
      "refounder",
    );
    expect(forged.has("victim")).toBe(false);

    // From the refounder: seeds present members.
    const honored = foldMembers(
      [snap("refounder", ["dave"], 1_000)],
      new Map(),
      new Set(),
      standing,
      10_000,
      "refounder",
    );
    expect(honored.has("dave")).toBe(true);
  });

  it("drops a snapshot's seed once its subject self-signs a newer leave", () => {
    const snap = decoded(
      {
        kind: 3312,
        content: JSON.stringify(["dave"]),
        tags: [
          ["snap", "s1", "1", "1"],
          ["ms", "0"],
        ],
      },
      "refounder",
      1_000,
    );
    const leave = decoded({ kind: 3306, content: "leave", tags: [["ms", "5"]] }, "dave", 2_000);
    const members = foldMembers([snap, leave], new Map(), new Set(), standing, 10_000, "refounder");
    expect(members.has("dave")).toBe(false);
  });

  it("drops an entry whose ms tag is out of range (malformed)", () => {
    const badJoin = decoded({ kind: 3306, content: "join", tags: [["ms", "5000"]] }, "eve", 1_000);
    const members = foldMembers([badJoin], new Map(), new Set(), standing, 10_000);
    // Observation still counts eve forward if she's seen elsewhere, so assert the
    // malformed guestbook entry alone didn't admit her.
    expect(members.has("eve")).toBe(false);
  });

  // Characterization test (Pitfall 3, 06-RESEARCH.md): a bare `observed` entry
  // with no coalesced Guestbook state (no Join/Leave/Kick/Snapshot at all) is
  // admitted by the `!c` forward-observation branch (guestbook.ts:109-111) — this
  // is the spec's OWN "auto-included even if their Join never arrived" behavior
  // (CORD-02 §5), not a bug. `foldMembers` itself stays untouched by the ROTATE-04
  // fix; epoch scoping is applied one layer up, to the `observed` map's INPUT
  // (client/sync.ts's `planeStoreKey` + community.ts's `rewireState`), so a
  // removed member's prior-epoch observed authorship never reaches this branch
  // for the new epoch in the first place.
  it("admits a bare observed entry with no coalesced guestbook state (the `!c` branch) — foldMembers is unmodified by ROTATE-04's fix", () => {
    const observed = new Map([["frank", 5_000]]);
    const members = foldMembers([], observed, new Set(), standing, 10_000);
    expect(members.has("frank")).toBe(true);
  });
});

// AUTH-08 (CORD-04 §5): a non-owner Kick must additionally cite the Grant it
// acts under — vacVerifier(state, PERM.KICK), reused unchanged from
// helpers/permissions.ts. Expected vac[0] eids are hand-derived directly from
// grantLocator (D-12 frozen coordinate formula), never read back from
// foldMembers/vacVerifier under test.
describe("AUTH-08 Kick vac gate", () => {
  const owner = "aa".repeat(32);
  const communityIdHex = "cc".repeat(32);
  const cidBytes = hexToBytes(communityIdHex);
  const actor = "bb".repeat(32);
  const victim = "dd".repeat(32);

  const kickRole: Role = {
    role_id: "role1",
    name: "mod",
    position: 1,
    permissions: PERM.KICK.toString(),
    scope: { kind: "server" },
    color: 0,
  };

  // OLD roster: the actor still holds KICK — fed as foldMembers' OWN
  // `resolveStanding` param, so the retained rank-vs-victim check passes and
  // the new vac gate (built against a possibly-different CURRENT roster below)
  // is isolated, mirroring 08-05's isAuthorized/vac independence.
  const oldRoles = new Map<string, Role>([[kickRole.role_id, kickRole]]);
  const oldGrants = new Map<string, string[]>([[actor, [kickRole.role_id]]]);
  const oldStanding = (m: string) => resolveStanding(m, owner, oldRoles, oldGrants);

  const material: JoinMaterial = {
    community_id: communityIdHex,
    owner,
    owner_salt: "s".repeat(64),
    community_root: "r".repeat(64),
    root_epoch: 0,
    channels: [],
    relays: [],
    name: "N",
  };

  // Expected vac[0], hand-derived ONLY from grantLocator — never read back
  // from foldMembers/vacVerifier.
  const expectedEid = grantLocator(cidBytes, actor);

  /** CURRENT folded roster passed to vacVerifier. `demoted=true` supersedes the
   *  actor's Grant (no role), simulating a Grant revoked after the Kick was cited. */
  function currentState(demoted: boolean): CommunityState {
    return {
      material,
      channels: [],
      roles: [kickRole],
      grants: demoted ? new Map<string, string[]>() : oldGrants,
      banlist: new Set(),
      inviteLinks: new Set(),
      members: new Set(),
      dissolved: false,
    };
  }

  const join = (pk: string, ms: number) =>
    decoded({ kind: 3306, content: "join", tags: [["ms", String(ms % 1000)]] }, pk, ms);
  const kick = (vac: [string, string, string] | undefined, ms: number, from = actor) =>
    decoded({ kind: 3309, content: "", tags: [["p", victim], ...(vac ? [["vac", ...vac]] : [])] }, from, ms);

  it("drops a non-owner Kick with no vac tag", () => {
    const verifyVac = vacVerifier(currentState(false), PERM.KICK);
    const members = foldMembers(
      [join(victim, 500), kick(undefined, 1_000)],
      new Map(),
      new Set(),
      oldStanding,
      10_000,
      undefined,
      verifyVac,
    );
    expect(members.has(victim)).toBe(true); // Kick dropped — victim stays a member
  });

  it("drops a non-owner Kick whose vac[0] does not equal grantLocator(cid, actor)", () => {
    const verifyVac = vacVerifier(currentState(false), PERM.KICK);
    const members = foldMembers(
      [join(victim, 500), kick(["00".repeat(32), "1", "22".repeat(32)], 1_000)],
      new Map(),
      new Set(),
      oldStanding,
      10_000,
      undefined,
      verifyVac,
    );
    expect(members.has(victim)).toBe(true);
  });

  it("drops a demoted actor's Kick even with a structurally valid stale vac", () => {
    // CURRENT roster (fed to vacVerifier) has the actor's Grant superseded —
    // no role, no PERM.KICK — even though the citation structurally resolves
    // and the fold's own resolveStanding (oldStanding) still says the actor
    // outranks the victim (isolating the vac gate from the rank check).
    const verifyVac = vacVerifier(currentState(true), PERM.KICK);
    const members = foldMembers(
      [join(victim, 500), kick([expectedEid, "1", "22".repeat(32)], 1_000)],
      new Map(),
      new Set(),
      oldStanding,
      10_000,
      undefined,
      verifyVac,
    );
    expect(members.has(victim)).toBe(true); // dropped despite a structurally valid vac
  });

  it("non-vacuity: with verifyVac omitted, the same demoted-actor Kick succeeds (reproduces the pre-AUTH-08 gap)", () => {
    const members = foldMembers(
      [join(victim, 500), kick([expectedEid, "1", "22".repeat(32)], 1_000)],
      new Map(),
      new Set(),
      oldStanding,
      10_000,
      // verifyVac intentionally omitted.
    );
    expect(members.has(victim)).toBe(false);
  });

  it("honors an owner Kick with vac omitted", () => {
    const verifyVac = vacVerifier(currentState(false), PERM.KICK);
    const members = foldMembers(
      [join(victim, 500), kick(undefined, 1_000, owner)],
      new Map(),
      new Set(),
      oldStanding,
      10_000,
      undefined,
      verifyVac,
    );
    expect(members.has(victim)).toBe(false); // owner Kick honored
  });
});
