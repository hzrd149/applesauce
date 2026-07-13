import { describe, expect, it } from "vitest";

import { PERM } from "../../types.js";
import type { CommunityState, JoinMaterial, Role } from "../../types.js";
import { canActOn, hasPerm, parsePermissions, permNames, refoundAuthority, resolveStanding } from "../permissions.js";

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

  it("a deleted role confers no permissions or rank", () => {
    const owner = "owner";
    const roles = new Map<string, Role>([
      ["mod", { role_id: "mod", name: "mod", position: 5, permissions: PERM.KICK.toString(), scope: { kind: "server" }, color: 0, deleted: true }],
    ]);
    const grants = new Map<string, string[]>([["alice", ["mod"]]]);
    const alice = resolveStanding("alice", owner, roles, grants);
    const bob = resolveStanding("bob", owner, roles, grants);
    expect(alice.permissions).toBe(0n); // deleted role grants nothing
    expect(alice.roleIds).toEqual(["mod"]); // grant is untouched
    expect(canActOn(alice, bob, PERM.KICK)).toBe(false); // no authority left
  });

  it("refoundAuthority: owner or a BAN-holder may rotate the root", () => {
    const roles = new Map<string, Role>([
      ["ban", { role_id: "ban", name: "admin", position: 1, permissions: PERM.BAN.toString(), scope: { kind: "server" }, color: 0 }],
      ["mod", { role_id: "mod", name: "mod", position: 5, permissions: PERM.KICK.toString(), scope: { kind: "server" }, color: 0 }],
    ]);
    const state = {
      material: { owner: "owner" } as JoinMaterial,
      channels: [],
      roles: [...roles.values()],
      grants: new Map<string, string[]>([
        ["alice", ["ban"]],
        ["bob", ["mod"]],
      ]),
      banlist: new Set<string>(),
      inviteLinks: new Set<string>(),
      members: new Set<string>(),
      dissolved: false,
    } satisfies CommunityState;

    const canRotate = refoundAuthority(state);
    expect(canRotate("owner")).toBe(true); // owner
    expect(canRotate("alice")).toBe(true); // holds BAN
    expect(canRotate("bob")).toBe(false); // only KICK
    expect(canRotate("carol")).toBe(false); // roleless
  });
});
