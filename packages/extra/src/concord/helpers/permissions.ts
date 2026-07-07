// CORD-04 permission / roster resolution.

import { PERM } from "../types.js";
import type { PermName, Role } from "../types.js";

export function parsePermissions(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function hasPerm(perms: bigint, perm: bigint): boolean {
  return (perms & perm) === perm;
}

export function permNames(perms: bigint): PermName[] {
  return (Object.keys(PERM) as PermName[]).filter((k) => hasPerm(perms, PERM[k]));
}

/** A member's resolved standing in the roster. */
export interface Standing {
  /** union of all role permission bits */
  permissions: bigint;
  /** lowest (highest-authority) position among held roles; owner is 0 */
  position: number;
  isOwner: boolean;
  roleIds: string[];
}

const ROLELESS_POSITION = 0xffffffff;

/**
 * Resolve a member's standing from the folded roster.
 * The owner (proven by community_id, CORD-02) is position 0 and holds every bit.
 */
export function resolveStanding(
  member: string,
  owner: string,
  roles: Map<string, Role>,
  grants: Map<string, string[]>,
): Standing {
  if (member === owner) {
    let all = 0n;
    for (const p of Object.values(PERM)) all |= p;
    return { permissions: all, position: 0, isOwner: true, roleIds: [] };
  }
  const roleIds = grants.get(member) ?? [];
  let permissions = 0n;
  let position = ROLELESS_POSITION;
  for (const id of roleIds) {
    const role = roles.get(id);
    if (!role) continue;
    permissions |= parsePermissions(role.permissions);
    if (role.position < position) position = role.position;
  }
  return { permissions, position, isOwner: false, roleIds };
}

/** Actor may act on target: holds the bit AND strictly outranks the target. */
export function canActOn(actor: Standing, target: Standing, required: bigint): boolean {
  if (actor.isOwner) return true;
  if (!hasPerm(actor.permissions, required)) return false;
  return actor.position < target.position;
}
