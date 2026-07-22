# Phase 9: Authority & Permission Fold Correctness - Pattern Map

**Mapped:** 2026-07-19
**Files analyzed:** 6 (3 primary fold/client files modified for AUTH-03..08/D-14, 3 `foldMembers` call sites for `verifyVac` threading)
**Analogs found:** 6 / 6 (every fix has an in-repo correct sibling — no "no analog" section needed this phase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog (same file, sibling code) | Match Quality |
|---|---|---|---|---|
| `packages/concord/src/helpers/control.ts` (Grant fold, `:174-198`) — AUTH-03/04/07 | service (pure fold/reducer) | transform (event-sourced read fold) | Banlist fold, same file `:288-303` (coordinate-gate + rank pattern) | exact — same file, same fold shape |
| `packages/concord/src/helpers/control.ts` (Role fold, `:150-170`) — AUTH-06 | service (pure fold/reducer) | transform | Existing `role.position <= 0` guard immediately above, same file `:161-163` | exact — extend adjacent guard |
| `packages/concord/src/helpers/control.ts` (Banlist fold, `:288-303`) — D-14 | service (pure fold/reducer) | transform | AUTH-07's Grant target-rank gate (same fix shape, same file) | exact — same fix pattern, different entity |
| `packages/concord/src/helpers/guestbook.ts` (`foldMembers` Kick branch, `:77-84`) — AUTH-08 | service (pure fold/reducer) | transform | `vacVerifier` predicate injection already used for channel-rekey (`client/channel-sync.ts:32`) / private-channel (`client/private-channel.ts:62`) | role-match — cross-file predicate-injection precedent |
| `packages/concord/src/helpers/guestbook.ts` (banlist apply, `:114`) — D-14 owner exemption | service (pure fold/reducer) | transform | Same file's `resolveStanding`-injected pattern already used for the Kick/Join branches above it | exact — same file, same injected-callback convention |
| `packages/concord/src/client/community.ts` `kick()` (`:1011-1015`) — AUTH-05 | controller (client write-path method) | request-response (pre-publish guard) | `rotateChannel`'s exclude-loop outrank throw, same file `:1036-1041` | exact — identical throw shape, single-target instead of loop |
| `packages/concord/src/client/admin.ts` `ban()` (`:257-263`) — AUTH-05 | controller (client write-path method) | request-response (pre-publish guard) | `refound()`'s local outrank throw (same class family, `admin.ts`/`community.ts` `canDo`/`standingOf` delegation) | exact — same class's own `canDo`/`standingOf` |
| `packages/concord/src/models/community.ts:54`, `models/members.ts:22`, `client/sync.ts:176` — `foldMembers` call-site wiring | provider/store (fold call site) | transform | `vacVerifier(state, PERM.*)` construction already used at `community.ts:707` (channel-rekey) / `community.ts:785` (refound) | exact — same construction, new `requiredPerm` arg |

## Pattern Assignments

### `packages/concord/src/helpers/control.ts` — Grant fold (AUTH-03, AUTH-04, AUTH-07)

**Analog:** the banlist coordinate-gate fold in the same file, `control.ts:292-303` (existing, correct); AUTH-07's rank-gate mirrors the Role fold's own outrank check pattern.

**Current imports** (`control.ts:22`) — must gain `grantLocator`:
```typescript
import { banlistLocator, editionHash, inviteLinksLocator } from "./crypto.js";
// AUTH-03: add grantLocator to this import list
```

**`cidBytes` hoist gotcha** — currently defined once, late (`control.ts:285`), AFTER the Grant fold loop (`:174-198`) that AUTH-03 needs it in:
```typescript
// control.ts:285 (current, too late for AUTH-03)
const cidBytes = hexToBytes(material.community_id);
```
Hoist this single `const` above the Grant fold loop; do not leave a second re-declaration — delete/reuse the one at `:285`.

**Coordinate-gate analog to mirror** (`control.ts:292-303`, existing/correct, template for AUTH-03):
```typescript
// Source: packages/concord/src/helpers/control.ts:292-303 (existing, correct)
const banlist = new Set<string>();
for (const cand of groupByEntity(byVsk(VSK.BANLIST)).get(banlistLocator(cidBytes)) ?? []) {
  const s = standing(cand.author);
  if (!s.isOwner && !hasPerm(s.permissions, PERM.BAN)) continue;
  try {
    for (const pk of JSON.parse(cand.content) as string[]) banlist.add(pk);
    heads.set(cand.eid, cand.source);
    break;
  } catch { /* skip */ }
}
```

**AUTH-03/04/07 combined fix sketch for the Grant loop** (mirrors the above shape; keeps the eid the banlist loop already keeps, which the Grant loop today discards):
```typescript
for (const [eid, cands] of grantCandidates) {
  for (const cand of cands) {
    const s = standing(cand.author);
    let grant: Grant;
    try { grant = JSON.parse(cand.content) as Grant; } catch { continue; }
    if (!grant.member) continue;
    if (eid !== grantLocator(cidBytes, grant.member)) continue; // AUTH-03
    if (!Array.isArray(grant.role_ids) || !grant.role_ids.every((rid) => typeof rid === "string")) continue; // AUTH-04 — unconditional, before `authorized`
    const targetStanding = standing(grant.member);
    const authorized =
      s.isOwner ||
      (hasPerm(s.permissions, PERM.MANAGE_ROLES) &&
        grant.role_ids.every((rid) => {
          const r = roles.get(rid);
          return r ? r.position > s.position : false;
        }) &&
        (grant.member === cand.author || s.position < targetStanding.position)); // AUTH-07/D-01/D-02
    // ... existing fold-apply on `authorized` unchanged ...
  }
}
```

**Pitfall (do not conflate):** the AUTH-04 shape guard must be its own unconditional `if (!...) continue;`, NOT folded into the `authorized &&` chain — an owner-signed malformed grant must also be skipped, and `s.isOwner` short-circuiting the chain would otherwise let it through unguarded.

---

### `packages/concord/src/helpers/control.ts` — Role fold, `Role.position` guard (AUTH-06)

**Analog:** the existing adjacent guard in the same fold, `control.ts:161-163`.

**Current code to extend:**
```typescript
// Source: packages/concord/src/helpers/control.ts:154-163 (current, AUTH-06 target)
try {
  role = JSON.parse(cand.content) as Role;
} catch {
  continue;
}
if (!role.role_id) role.role_id = eid;
if (!s.isOwner && role.position <= s.position) continue;
if (role.position <= 0) continue; // position 0 is the owner alone
```

**Fix — insert BEFORE the two existing checks** (`NaN`/`1.5`/`undefined` slip past `<=` today):
```typescript
if (!Number.isInteger(role.position) || role.position <= 0 || role.position >= 0xffffffff) continue;
```

---

### `packages/concord/src/helpers/control.ts` — Banlist fold, rank + owner exemption (D-14)

**Analog:** AUTH-07's Grant target-rank gate above (same fix shape — "signer must strictly outrank the target's CURRENT standing" — applied to a different entity in the same file).

**Fix — per-pk rank check replacing the flat set-add** (`control.ts:292-303`):
```typescript
for (const cand of groupByEntity(byVsk(VSK.BANLIST)).get(banlistLocator(cidBytes)) ?? []) {
  const s = standing(cand.author);
  if (!s.isOwner && !hasPerm(s.permissions, PERM.BAN)) continue;
  try {
    for (const pk of JSON.parse(cand.content) as string[]) {
      // D-14: strictly outrank pk's CURRENT standing; owner is unbannable for free
      if (s.isOwner || s.position < standing(pk).position) banlist.add(pk);
    }
    heads.set(cand.eid, cand.source);
    break;
  } catch { /* skip */ }
}
```

**Pitfall:** compare `s.position < standing(pk).position` — NOT `s.position < s.position` (always false, would empty the banlist entirely). `standing(pk)` must resolve the BANNED target, a lookup the current loop never performs.

---

### `packages/concord/src/helpers/guestbook.ts` — `foldMembers` Kick branch, `vac` gate (AUTH-08)

**Analog:** the `verifyVac?: (rotator, vac) => boolean` injected-predicate pattern already used on `client/channel-sync.ts:32` and `client/private-channel.ts:62` for channel-rekey/refound gating.

**Sibling injection precedent** (`client/channel-sync.ts:28-32`):
```typescript
// Source: packages/concord/src/client/channel-sync.ts:28-32
canRemoveSelf?: (rotator: string) => boolean;
verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean;
```

**Current `foldMembers` signature** (`guestbook.ts:49-56`, unchanged args + new trailing optional param):
```typescript
export function foldMembers(
  guestbook: DecodedEvent[],
  observed: Map<string, number>,
  banlist: Set<string>,
  resolveStanding: (member: string) => Standing,
  nowMs: number = Date.now(),
  refounder?: string,
  verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean, // AUTH-08, new
): Set<string> {
```

**Current Kick branch to extend** (`guestbook.ts:77-84`, keep unchanged, ADD the gate — do not replace):
```typescript
} else if (r.kind === KICK_KIND) {
  const target = r.tags.find((t) => t[0] === "p")?.[1];
  if (!target) continue;
  const actor = resolveStanding(d.author);
  const victim = resolveStanding(target);
  if (!hasPerm(actor.permissions, PERM.KICK) || actor.position >= victim.position) continue; // D-05: keep unchanged
  if (verifyVac) { // AUTH-08/D-04: additive gate
    const vacTag = r.tags.find((t) => t[0] === "vac");
    const vac: [string, string, string] | undefined =
      vacTag && vacTag[1] && vacTag[2] && vacTag[3] ? [vacTag[1], vacTag[2], vacTag[3]] : undefined;
    if (!verifyVac(d.author, vac)) continue;
  }
  consider(target, false, d);
}
```

**The predicate to reuse, unchanged** (`helpers/permissions.ts:98-111`):
```typescript
export function vacVerifier(
  state: CommunityState,
  requiredPerm: bigint,
): (rotator: string, vac: [string, string, string] | undefined) => boolean {
  const owner = state.material.owner;
  const communityId = hexToBytes(state.material.community_id);
  const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
  return (rotator, vac) => {
    if (rotator === owner) return true;
    if (!vac) return false;
    if (vac[0] !== grantLocator(communityId, rotator)) return false;
    return hasPerm(resolveStanding(rotator, owner, rolesMap, state.grants).permissions, requiredPerm);
  };
}
```

**Call-site wiring (all 3, verified in-scope this session):**
| Call site | Existing in-scope state value | Wire as |
|---|---|---|
| `models/community.ts:54` | `control` (destructured from `combineLatest([control$, ...])`) | `verifyVac: vacVerifier(control, PERM.KICK)` |
| `models/members.ts:22` | `control: CommunityState` parameter | `verifyVac: vacVerifier(control, PERM.KICK)` |
| `client/sync.ts:176` | `state0` (defined at `sync.ts:152`, before the `:176` call) | `verifyVac: vacVerifier(state0, PERM.KICK)` |

**Pitfall:** `foldMembers` has 3 production call sites plus test call sites (`roundtrip.test.ts:71`, `helpers/__tests__/guestbook.test.ts`) — grep `foldMembers(` after the change to confirm all 3 production sites pass `verifyVac`; the optional-param shape makes a missed site a silent no-op, not a compile error.

---

### `packages/concord/src/helpers/guestbook.ts` — banlist apply, owner exemption (D-14)

**Analog:** the same file's Kick/Join branches already inject `resolveStanding` as a callback; the owner-exemption check reuses that same injected function, no new import.

**Fix** (`guestbook.ts:114`):
```typescript
for (const banned of banlist) {
  if (resolveStanding(banned).isOwner) continue; // D-14: never drop the owner
  members.delete(banned);
}
```
Note: `resolveStanding` here is the function *parameter* already threaded through `foldMembers`, not the raw `helpers/permissions.ts` export — no import change needed.

---

### `packages/concord/src/client/community.ts` `kick()` (AUTH-05, D-09)

**Analog:** `rotateChannel`'s exclude-loop outrank throw, same file, `community.ts:1036-1041`.

**Analog code** (existing, correct):
```typescript
// Source: packages/concord/src/client/community.ts:1036-1041
for (const target of opts.exclude ?? []) {
  if (!this.canDo(PERM.MANAGE_CHANNELS, this.standingOf(target).position))
    throw new Error(`cannot exclude ${target} from the channel — you do not outrank them`);
}
```

**Fix sketch — `kick()`** (`community.ts:1011-1015`, single target, not a loop):
```typescript
async kick(member: string): Promise<void> {
  if (!this.canDo(PERM.KICK, this.standingOf(member).position))
    throw new Error(`cannot kick ${member} — you do not outrank them or lack KICK`);
  await this.admin.grantRoles(member, []);
  const vac = await this.admin.vacFor(this.pubkey);
  await this.publishToPlane({ plane: "guestbook" }, await KickFactory.create(member, vac), {});
}
```
`this.canDo`/`this.standingOf` already exist (`community.ts:1334`/`:1321`), delegating to `this.admin.canDo` — no new helper needed.

---

### `packages/concord/src/client/admin.ts` `ban()` (AUTH-05, D-09)

**Analog:** same class family's own `canDo`/`standingOf` (`admin.ts:352-368`), same throw shape as `community.ts`'s `rotateChannel`.

**Fix sketch:**
```typescript
async ban(member: string): Promise<void> {
  if (!this.canDo(PERM.BAN, this.standingOf(member).position))
    throw new Error(`cannot ban ${member} — you do not outrank them or lack BAN`);
  const current = new Set(this.opts.state().banlist);
  current.add(member);
  await this.publishEdition(VSK.BANLIST, banlistLocator(this.communityIdBytes), JSON.stringify([...current]));
  await this.grantRoles(member, []);
}
```

---

## Shared Patterns

### Rank comparison (never hand-roll)
**Source:** `packages/concord/src/helpers/permissions.ts` — `resolveStanding`, `canActOn`, `canDo`, `hasPerm`, `standingOf`
**Apply to:** AUTH-05, AUTH-07, D-14 — owner = position 0, roleless = `0xffffffff` sentinel already correctly encoded; do not reimplement.

### Grant-citation verification (never hand-roll)
**Source:** `packages/concord/src/helpers/permissions.ts:98-111` — `vacVerifier(state, requiredPerm)`
**Apply to:** AUTH-08's Kick gate — call with `PERM.KICK`; no bespoke vac-array parser inside `guestbook.ts`.

### Coordinate derivation (never hand-roll)
**Source:** `packages/concord/src/helpers/crypto.ts:184` (`grantLocator`), `:189` (`banlistLocator`) — both frozen, byte-exact, unchanged this phase.
**Apply to:** AUTH-03's Grant coordinate-gate; reuse the imported function, do not recompute inline elsewhere.

### Skip-candidate on malformed shape, never throw
**Source:** `control.ts:161-163`'s existing `role.position <= 0` guard pattern, extended.
**Apply to:** AUTH-04, AUTH-06 — `continue` to the next candidate in the group; a fold consumed by every member's client must be total, never partial via exception (this is the AUTH-04/M06 defect class itself).

### Local throw-and-abort before publish
**Source:** `community.ts:1036-1041` (`rotateChannel`'s exclude-loop check).
**Apply to:** AUTH-05's `kick()`/`ban()` — client-side pre-publish guard using each class's own `canDo`/`standingOf`; distinct from fold-internal skip-candidate (a throw here is safe — it only aborts the single caller's own action before any publish, not a shared read-path fold).

## No Analog Found

None — every fix in this phase (AUTH-03..08, D-14) has a correct in-repo sibling already implementing the same shape ("bring the omitted path up to the correct sibling path"), confirmed by RESEARCH.md's file-by-file read this session.

## Metadata

**Analog search scope:** `packages/concord/src/helpers/{control,guestbook,permissions,crypto}.ts`, `packages/concord/src/client/{community,admin,channel-sync,private-channel,sync}.ts`, `packages/concord/src/models/{community,members}.ts` — all read/grepped directly this session (RESEARCH.md) plus one confirming grep this pass (`control.ts` imports/`cidBytes`/`banlistLocator` line numbers, all matched).
**Files scanned:** 10 (all analogs already known from CONTEXT.md/RESEARCH.md; no additional Glob/Grep discovery pass was needed — this phase's scope was fully pre-mapped by research).
**Pattern extraction date:** 2026-07-19
