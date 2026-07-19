# Phase 9: Authority & Permission Fold Correctness - Research

**Researched:** 2026-07-19
**Domain:** CORD-04 Control Plane authority folds (Grant/Role/Banlist) and CORD-02 Guestbook membership fold (Kick), `applesauce-concord` (`packages/concord/src/`)
**Confidence:** HIGH

## Summary

This phase is pure correctness work over three files: `helpers/control.ts` (`foldControl` — Role/Grant/Banlist folds), `helpers/guestbook.ts` (`foldMembers` — Kick), and the client write paths `client/community.ts`/`client/admin.ts` (`kick()`/`ban()`). No new capability, no new crypto — every fix reuses primitives that already exist and are already correctly used elsewhere in the codebase (`canActOn`/`canDo`/`standingOf`/`vacVerifier`/`grantLocator`/`banlistLocator`). The two spec rulings this phase resolves (AUTH-07 "strict", AUTH-08 "required + validated") are directly confirmed by CORD-04's raw upstream text, fetched and quoted verbatim below — this research treats them as settled, not reopened.

All CONTEXT.md D-01..D-14 decisions were checked against the current tree this session. Every cited file:line location was found present and semantically matching, with a small number of drift notes below (line numbers shifted by ~1-5 lines from CONTEXT.md's citations in a couple of spots — the code shape is unchanged, only line numbers moved slightly). One structural gotcha the planner must know about: `foldControl`'s `cidBytes` (`hexToBytes(material.community_id)`) is currently computed at `control.ts:285`, **after** the Grant fold loop (`:174-198`) — AUTH-03's coordinate check needs it earlier, so the Grant-fold task must hoist that line (or compute `hexToBytes(material.community_id)` redundantly inline) before it can call `grantLocator(cidBytes, grant.member)`.

**Primary recommendation:** Implement all six fixes (AUTH-03..08) plus D-14 as targeted, independent patches inside the three files above, each landing with its own spec-derived test in the same commit (per TEST-01/D-12 and the milestone's established per-fix-atomic-with-its-test discipline from Phases 5-8). Thread the Kick `vac` gate into `foldMembers` as a new optional trailing parameter (`verifyVac?: (rotator, vac) => boolean`), mirroring the existing `channel-sync.ts:32`/`private-channel.ts:62` pattern, and wire it at all three `foldMembers` call sites (`models/community.ts:54`, `models/members.ts:22`, `client/sync.ts:176`) using the already-in-scope `CommunityState`-shaped value at each site (`control`, `control`, `state0` respectively) — no reordering needed except at the sync.ts site, where `state0` is already defined before the `foldMembers` call.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Grant coordinate validation (AUTH-03) | Database/Storage (fold, pure function) | — | `foldControl` is a pure reducer over fetched plane events; no I/O, no client state |
| Malformed Grant guard (AUTH-04) | Database/Storage (fold) | — | Same fold; must not throw regardless of attacker-crafted input |
| Local authority reject for kick/ban (AUTH-05) | API/Backend (client write path) | — | `kick()`/`ban()` are client-side "backend" methods that gate a publish; this is client-local authorization, analogous to backend request validation |
| Role.position validation (AUTH-06) | Database/Storage (fold) | — | Same fold, defense-in-depth guard |
| Grant target-rank gate (AUTH-07) | Database/Storage (fold) | — | Same fold; authority resolution is fold-internal |
| Kick `vac` gate (AUTH-08) | Database/Storage (fold) | API/Backend (write path already attaches `vac`) | Read-path enforcement lives in `foldMembers`; write-path (`kick()`) already correct, no change needed there beyond AUTH-05 |
| Banlist rank + owner exemption (D-14) | Database/Storage (fold) | — | Same fold (`control.ts`) + membership fold (`guestbook.ts`) |
| TEST-01 spec-derived tests | (cross-cutting, all tiers) | — | Applies to every derivation/fold this phase touches |

No Browser/Client-tier or CDN-tier work in this phase — everything is pure fold logic plus one client-side pre-publish guard.

## Standard Stack

No new dependencies. Every fix reuses existing in-repo primitives:

| Module | Function | Purpose | Status |
|--------|----------|---------|--------|
| `helpers/permissions.ts` | `resolveStanding`, `canActOn`, `canDo` (via `admin.ts`/`community.ts` wrappers), `hasPerm` | Rank/bit resolution | Existing, unchanged |
| `helpers/permissions.ts:98-111` | `vacVerifier(state, requiredPerm)` | Grant-citation verification predicate | Existing (Phase 8 D-08/D-12), reused for `PERM.KICK` |
| `helpers/crypto.ts:184` | `grantLocator(communityId, memberXonlyHex)` | Grant coordinate derivation | Existing, currently used on write only |
| `helpers/crypto.ts:189` | `banlistLocator(communityId)` | Banlist coordinate derivation | Existing, already used on read (`control.ts:293`) |

No package installs, no `npm view`/`pip`/`cargo` version checks needed — this section is a no-op for this phase.

## Package Legitimacy Audit

**Not applicable.** This phase installs no new packages, ecosystem or otherwise — it modifies existing TypeScript source in `packages/concord/src/`. No `package-legitimacy check` run was needed.

## Architecture Patterns

### System Architecture Diagram

```
                     kind-3308 plane events (Control)         kind-3306/3309/3312 (Guestbook)
                              │                                          │
                              ▼                                          ▼
                     ┌──────────────────┐                        ┌──────────────────┐
                     │   foldControl()  │                        │   foldMembers()   │
                     │  (control.ts)    │──state.roles/grants───▶│  (guestbook.ts)   │
                     │                  │  state.banlist ───────▶│                   │
                     │ Role fold        │                        │ Join/Leave fold   │
                     │ Grant fold  ◀────┼── AUTH-03/04/06/07     │ Kick fold ◀───────┼── AUTH-08 (vac gate)
                     │ Banlist fold ◀───┼── D-14 (rank+owner)    │ banlist.delete ◀──┼── D-14 (owner exempt)
                     └──────────────────┘                        └──────────────────┘
                              │                                          │
                              └───────────────┬──────────────────────────┘
                                               ▼
                                     CommunityState (roles, grants,
                                     banlist, members, ...)
                                               │
                                               ▼
                                    resolveStanding/canDo/canActOn
                                    (rank comparisons for every
                                     subsequent authority decision)
                                               │
                          ┌────────────────────┼─────────────────────┐
                          ▼                    ▼                     ▼
                  community.kick()      community.ban()       (read-path already
                  (AUTH-05: local        → admin.ban()          enforces via the
                   canDo check           (AUTH-05: local        folds above; AUTH-05
                   before publish)        canDo check)          only fixes the UI-lie)
```

### Recommended Project Structure

No new files or folders — every change lands inside existing files:
```
packages/concord/src/
├── helpers/
│   ├── control.ts        # AUTH-03, AUTH-04, AUTH-06, AUTH-07, D-14 (banlist half)
│   ├── guestbook.ts       # AUTH-08 (Kick vac gate), D-14 (owner-exemption half)
│   ├── permissions.ts     # no change — vacVerifier/canActOn/canDo already correct, just called with PERM.KICK now
│   └── crypto.ts          # no change — grantLocator/banlistLocator already exist
├── client/
│   ├── community.ts       # AUTH-05 (kick() local reject), foldMembers call site (sync.ts, models) threading
│   ├── admin.ts           # AUTH-05 (ban() local reject)
│   └── sync.ts            # foldMembers call site — thread verifyVac using already-in-scope state0
└── models/
    ├── community.ts       # foldMembers call site — thread verifyVac using already-in-scope `control`
    └── members.ts          # foldMembers call site — thread verifyVac using already-in-scope `control` param
```

### Pattern 1: Skip-candidate on malformed shape, never throw (AUTH-04, AUTH-06)

**What:** Validate a JSON.parse'd candidate's shape defensively before using it; `continue` to the next candidate in the group rather than letting a `TypeError` escape the fold.
**When to use:** Any time an entity's content is `JSON.parse`d and then used without a runtime type guard — the existing `try/catch` around `JSON.parse` itself does NOT protect against a well-formed-JSON-but-wrong-shape payload (e.g. `{"member":"ab..","role_ids":"not-an-array"}` parses fine; `.every` on it throws).
**Example (existing role-position pattern to extend, `control.ts:161-163`):**
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
// AUTH-06 fix: insert BEFORE the two checks above (NaN/1.5/undefined slip past `<=`):
if (!Number.isInteger(role.position) || role.position <= 0 || role.position >= 0xffffffff) continue;
```
**Example (AUTH-04 shape guard, new, `control.ts:183` after `grant.member` check):**
```typescript
if (!grant.member) continue;
// AUTH-04 fix: reject non-array / non-string-entry role_ids BEFORE the .every() rank check below.
if (!Array.isArray(grant.role_ids) || !grant.role_ids.every((rid) => typeof rid === "string")) continue;
```

### Pattern 2: Fold only at the derived coordinate (AUTH-03, mirrors banlist)

**What:** Accept a candidate only if the eid it arrived under structurally equals the entity's derived coordinate — never trust an eid-independent field from content to imply authenticity of position.
**When to use:** Any entity whose coordinate is a pure function of stable identifiers (community_id, member, etc.) — Grant and Banlist both qualify (CORD-04 §1's coordinate table).
**Example (existing banlist precedent, `control.ts:292-303`, to mirror for Grant):**
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
```typescript
// AUTH-03 fix sketch — grantCandidates loop keeps the eid (currently discarded
// by `for (const [, cands] of grantCandidates)`), gates on it:
const cidBytes = hexToBytes(material.community_id); // HOISTED — currently defined at :285, after this loop
for (const [eid, cands] of grantCandidates) {
  for (const cand of cands) {
    const s = standing(cand.author);
    let grant: Grant;
    try { grant = JSON.parse(cand.content) as Grant; } catch { continue; }
    if (!grant.member) continue;
    if (eid !== grantLocator(cidBytes, grant.member)) continue; // AUTH-03
    if (!Array.isArray(grant.role_ids) || !grant.role_ids.every((rid) => typeof rid === "string")) continue; // AUTH-04
    // ... existing role-outrank + new AUTH-07 target-rank check (Pattern 3) ...
  }
}
```
Note: `grantLocator` must be added to the `import { ... } from "./crypto.js"` list at `control.ts:22` (currently imports only `banlistLocator, editionHash, inviteLinksLocator`).

### Pattern 3: Target-rank gate on every non-self authority action (AUTH-07, D-14)

**What:** In addition to any entity-specific outrank rule (e.g. Grant's "outrank every role handed out"), the general CORD-04 §3/§5 rule requires the actor to *strictly outrank the target member* for any non-self action. Apply this as an additional AND'd condition, never a replacement for the entity-specific rule.
**When to use:** Grant (target = `grant.member`), Banlist (target = each banned pk).
**Example (Grant target-rank gate, D-01/D-02):**
```typescript
// AUTH-07 fix — add to the existing `authorized` computation at control.ts:184-190
const targetStanding = standing(grant.member);
const authorized =
  s.isOwner ||
  (hasPerm(s.permissions, PERM.MANAGE_ROLES) &&
    grant.role_ids.every((rid) => {
      const r = roles.get(rid);
      return r ? r.position > s.position : false;
    }) &&
    // D-01/D-02: signer must also strictly outrank the TARGET's current standing,
    // for every non-self Grant (closes the vacuous `[].every()` revoke hole).
    (grant.member === cand.author || s.position < targetStanding.position));
```
**Example (Banlist per-entry rank gate + implicit owner exemption, D-14):**
```typescript
// D-14 fix — control.ts:292-303, per-pk check instead of a flat set-add
for (const cand of groupByEntity(byVsk(VSK.BANLIST)).get(banlistLocator(cidBytes)) ?? []) {
  const s = standing(cand.author);
  if (!s.isOwner && !hasPerm(s.permissions, PERM.BAN)) continue;
  try {
    for (const pk of JSON.parse(cand.content) as string[]) {
      // D-14: signer must strictly outrank pk's CURRENT standing — this also
      // makes the owner unbannable for free (nobody's position < 0).
      if (s.isOwner || s.position < standing(pk).position) banlist.add(pk);
    }
    heads.set(cand.eid, cand.source);
    break;
  } catch { /* skip */ }
}
```
```typescript
// D-14 defense-in-depth — guestbook.ts:114, owner-exempt even if a forged/buggy
// banlist upstream somehow carried the owner's pk this far.
for (const banned of banlist) {
  if (resolveStanding(banned).isOwner) continue; // never drop the owner
  members.delete(banned);
}
```
Note `resolveStanding` in `guestbook.ts` is the injected `(member: string) => Standing` parameter, not the raw helper — no import change needed, just call it.

### Pattern 4: Inject a `verifyVac` predicate into a fold, mirroring the sibling rekey path (AUTH-08, D-04/D-05)

**What:** `foldMembers`'s Kick branch needs the same vac-gate shape `readRekeyScoped`/`readRekey` already apply, injected as an optional trailing parameter so the fold itself never touches live client state (stays pure over folded `CommunityState`).
**Current `foldMembers` signature** (`helpers/guestbook.ts:49-56`):
```typescript
export function foldMembers(
  guestbook: DecodedEvent[],
  observed: Map<string, number>,
  banlist: Set<string>,
  resolveStanding: (member: string) => Standing,
  nowMs: number = Date.now(),
  refounder?: string,
): Set<string> {
```
**The sibling precedent this mirrors** (`client/channel-sync.ts:28-32`, identical shape on `private-channel.ts:56,62`):
```typescript
// Source: packages/concord/src/client/channel-sync.ts:28-32
canRemoveSelf?: (rotator: string) => boolean;
verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean;
```
**Fix sketch — new trailing param + Kick-branch gate:**
```typescript
export function foldMembers(
  guestbook: DecodedEvent[],
  observed: Map<string, number>,
  banlist: Set<string>,
  resolveStanding: (member: string) => Standing,
  nowMs: number = Date.now(),
  refounder?: string,
  verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean, // AUTH-08
): Set<string> {
  // ... unchanged ...
  } else if (r.kind === KICK_KIND) {
    const target = r.tags.find((t) => t[0] === "p")?.[1];
    if (!target) continue;
    const actor = resolveStanding(d.author);
    const victim = resolveStanding(target);
    if (!hasPerm(actor.permissions, PERM.KICK) || actor.position >= victim.position) continue;
    // AUTH-08/D-04/D-05: keep the existing rank-vs-victim check above; ADD the vac
    // gate rather than replacing it. Mirrors parseRekey's vac-tag parsing
    // (helpers/rekey.ts:181-183).
    if (verifyVac) {
      const vacTag = r.tags.find((t) => t[0] === "vac");
      const vac: [string, string, string] | undefined =
        vacTag && vacTag[1] && vacTag[2] && vacTag[3] ? [vacTag[1], vacTag[2], vacTag[3]] : undefined;
      if (!verifyVac(d.author, vac)) continue;
    }
    consider(target, false, d);
  }
```
**Call-site wiring — all 3 sites already have a `CommunityState`-shaped value in scope**:
- `models/community.ts:54` — pass `verifyVac: vacVerifier(control, PERM.KICK)` (the `control` destructured from `combineLatest([control$, ...])`, which already has `.material`/`.roles`/`.grants`; `vacVerifier` never reads `.members`).
- `models/members.ts:22` — same: the function already takes `control: CommunityState` as a parameter; pass `vacVerifier(control, PERM.KICK)`.
- `client/sync.ts:176` — `state0 = foldControl(control, epochMaterial)` is defined at `sync.ts:152`, *before* the `foldMembers` call at `:176` — no reordering needed, pass `vacVerifier(state0, PERM.KICK)`.

**Existing `vacVerifier`** (`helpers/permissions.ts:98-111`, unchanged, just called with a new `requiredPerm`):
```typescript
// Source: packages/concord/src/helpers/permissions.ts:98-111
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

### Pattern 5: Local throw-and-abort before publish (AUTH-05)

**What:** Mirror `rotateChannel`/`refound`'s existing outrank-throw shape for `kick()`/`ban()`.
**Existing precedent** (`client/community.ts:1036-1041`, `rotateChannel`):
```typescript
// Source: packages/concord/src/client/community.ts:1036-1041
for (const target of opts.exclude ?? []) {
  if (!this.canDo(PERM.MANAGE_CHANNELS, this.standingOf(target).position))
    throw new Error(`cannot exclude ${target} from the channel — you do not outrank them`);
}
```
**Fix sketch — `kick()` (`community.ts:1011-1015`, single target, not a loop):**
```typescript
async kick(member: string): Promise<void> {
  // AUTH-05/D-09: local fail-closed guard before any publish, mirroring rotateChannel/refound.
  if (!this.canDo(PERM.KICK, this.standingOf(member).position))
    throw new Error(`cannot kick ${member} — you do not outrank them or lack KICK`);
  await this.admin.grantRoles(member, []);
  const vac = await this.admin.vacFor(this.pubkey);
  await this.publishToPlane({ plane: "guestbook" }, await KickFactory.create(member, vac), {});
}
```
**Fix sketch — `admin.ts`'s `ban()` (`admin.ts:257-263`)**, using the class's own `canDo`/`standingOf` (`admin.ts:352-368`):
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
Note: `kick()` lives on `ConcordCommunity` (`community.ts`), `ban()` on `ConcordCommunityAdmin` (`admin.ts`) — the throw lands in each class using that class's own `canDo`/`standingOf` (both already exist, `community.ts:1334`/`:1321` and `admin.ts:359`/`:352`, delegating to each other — `community.ts`'s `canDo` calls `this.admin.canDo`).

### Anti-Patterns to Avoid

- **Replacing an existing check instead of AND-ing a new one.** AUTH-07's target-rank gate and D-14's banlist rank gate are *additional* constraints. Do not remove the existing role-outrank check (Grant) or the existing bit-check (Banlist) — both must hold simultaneously.
- **Throwing instead of skipping inside a fold.** `foldControl`/`foldMembers` are read-path pure functions consumed by every member's client — a throw there fails everyone's state, which is exactly M06's defect. AUTH-05's *client-side* throw (in `kick()`/`ban()`, not in a fold) is correct because it runs only for the caller attempting the action, before any publish.
- **Re-fetching the cited Grant's version/hash from a live store inside `vacVerifier` or the Kick gate.** Phase 8's D-12 deliberately rejected this ("pure over folded state") and this phase's D-04 explicitly carries that decision forward — do not add a store lookup to make the Kick vac-check "more spec-literal." See Assumptions Log A1 for the one place this diverges from the literal spec text.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rank comparison (actor vs target) | A new position-comparison helper | `canActOn`/`canDo`/`resolveStanding` (`permissions.ts`) | Owner/roleless sentinel semantics (position 0 / `0xffffffff`) are already correctly encoded; a second implementation risks a subtly different off-by-one |
| Grant-citation verification | A bespoke `vac`-array parser + rank check inside `guestbook.ts` | `vacVerifier(state, PERM.KICK)` (`permissions.ts:98-111`) | Already implements the exact CORD-04 §5 semantics (owner-exempt, eid-match, current-roster-grants-perm); reusing it keeps root/channel/Kick vac checks provably identical |
| Grant/Banlist coordinate derivation | Ad-hoc HKDF calls in `control.ts` | `grantLocator`/`banlistLocator` (`crypto.ts:184,189`) | Frozen, byte-exact derivations (CORD-02 Appendix A.6) — a local reimplementation is a re-addressing bug waiting to happen |

**Key insight:** Every "don't hand-roll" item in this phase is already implemented correctly somewhere in the same codebase (write path, channel path, or root path) — the fix is always "call the existing function from the omitted call site," never "write new logic."

## Runtime State Inventory

Not applicable — this is a correctness fix to fold *logic*, not a rename/refactor/migration. No stored data keys, service configs, OS registrations, secrets, or build artifacts carry the string names being changed (there are none; `AUTH-03`..`AUTH-08`/`D-14` add validation, they don't rename anything). Confirmed by reading `control.ts`, `guestbook.ts`, `admin.ts`, `community.ts` in full for this phase — no identifier renames anywhere in the fix set.

## Common Pitfalls

### Pitfall 1: `cidBytes` is computed after the Grant fold loop needs it
**What goes wrong:** AUTH-03's coordinate check (`eid === grantLocator(cidBytes, grant.member)`) needs `cidBytes = hexToBytes(material.community_id)`, but the existing code only computes that at `control.ts:285`, well after the Grant loop (`:174-198`) that needs it.
**Why it happens:** `cidBytes` was only ever needed by the later Channel/Banlist/Invite sections when this code was written; the Grant fold never needed the community id before.
**How to avoid:** Hoist the `const cidBytes = hexToBytes(material.community_id);` line to above the roles/grants pass loop (or immediately above the Grant loop specifically), and delete/rename the later duplicate — don't leave two definitions.
**Warning signs:** A `cidBytes is not defined` compile error, or (worse) a second re-declaration shadowing the first silently.

### Pitfall 2: `grantLocator` is not currently imported into `control.ts`
**What goes wrong:** AUTH-03 needs `grantLocator`, but `control.ts:22` only imports `banlistLocator, editionHash, inviteLinksLocator` from `./crypto.js`.
**Why it happens:** The read-path Grant coordinate check has literally never existed (that's M05/AUTH-03 itself).
**How to avoid:** Add `grantLocator` to the import list.
**Warning signs:** `ReferenceError: grantLocator is not defined` at runtime if TypeScript's strict mode is somehow bypassed, or a compile error otherwise.

### Pitfall 3: The `.every()` on `role_ids` serves two different purposes — don't conflate the shape guard with the rank check
**What goes wrong:** The existing `grant.role_ids.every((rid) => { const r = roles.get(rid); return r ? r.position > s.position : false; })` is a **rank** check assuming `role_ids` is already a valid `string[]`. AUTH-04's fix is a separate **shape** guard that must run *first* and independently, or a non-array `role_ids` still reaches the rank-check `.every()` and throws before AUTH-04's guard even matters if ordered wrong.
**Why it happens:** Easy to think "add one `.every()` check" and merge the two concerns into one expression, accidentally short-circuiting the shape validation only when authorization is also being evaluated (e.g. skipping the shape check for an owner-signed grant since `s.isOwner` short-circuits the `&&` chain before the rank `.every()` runs — but the shape guard must run regardless of who signed it, since a malformed `role_ids` from the OWNER would also throw).
**How to avoid:** Place the `Array.isArray(...) && role_ids.every(rid => typeof rid === "string")` shape guard as its own `if (!... ) continue;` statement, unconditional on `s.isOwner`, *before* the `authorized` computation — not folded into the `authorized` boolean expression.
**Warning signs:** A test with an owner-signed malformed grant (`role_ids: "oops"`) still throws even after the "fix" — the shape guard was accidentally gated behind the non-owner branch.

### Pitfall 4: Threading `verifyVac` through `foldMembers` requires touching 3 call sites, not 1
**What goes wrong:** Fixing only `helpers/guestbook.ts` (adding the parameter) but forgetting to pass `vacVerifier(..., PERM.KICK)` at all three call sites leaves the parameter permanently `undefined`, silently disabling the gate everywhere (the `if (verifyVac)` guard makes this a silent no-op, not a compile error, since the parameter is optional).
**Why it happens:** `foldMembers` has 3 call sites (`models/community.ts:54`, `models/members.ts:22`, `client/sync.ts:176`) plus test call sites (`roundtrip.test.ts:71`, `helpers/__tests__/guestbook.test.ts`) — easy to fix the helper and one obvious call site and miss the others.
**How to avoid:** `grep -rn "foldMembers(" packages/concord/src/` before considering the task done; verify all 3 production call sites pass `verifyVac`.
**Warning signs:** A new spec-derived AUTH-08 test passes (it calls `foldMembers` directly with `verifyVac` supplied) while a `community.test.ts`/integration-level regression test for the same scenario still shows the un-vac'd Kick succeeding — that gap is exactly a missed call site.

### Pitfall 5: D-14's banlist rank check must read `standing(pk)` (the banned target), not `standing(cand.author)` twice
**What goes wrong:** Confusing which side of the comparison is the actor vs. the target — accidentally checking `s.position < s.position` (always false, banlist becomes permanently empty) or omitting the target lookup entirely.
**Why it happens:** The existing code only ever computes `standing(cand.author)` (`s`) in this loop; the banned pk itself was never resolved to a `Standing` before D-14.
**How to avoid:** Explicitly call `standing(pk)` per banned entry inside the `for (const pk of JSON.parse(...))` loop, and compare `s.position < standing(pk).position` (or `s.isOwner`).
**Warning signs:** A test banning a lower-ranked target fails to add them to `banlist`, or a test banning the owner unexpectedly succeeds.

## Code Examples

### Verified patterns from official sources

See Architecture Patterns 1-5 above for verbatim current-code + fix-sketch pairs for every AUTH-03..08 + D-14 fix. All code excerpts above were read from the live tree this session (2026-07-19) at the cited file:line locations.

### grantLocator / banlistLocator — the coordinate primitives (unchanged, `crypto.ts:184,189`)
```typescript
// Source: packages/concord/src/helpers/crypto.ts:184-191
/** A member's Grant coordinate. secret = community_id, id = member_xonly. */
export function grantLocator(communityId: Uint8Array, memberXonlyHex: string): string {
  return bytesToHex(concordHkdf(communityId, "concord/grant", hexToBytes(memberXonlyHex)));
}

/** The Banlist coordinate. secret = community_id, id = 0..0. */
export function banlistLocator(communityId: Uint8Array): string {
  return bytesToHex(concordHkdf(communityId, "concord/banlist", ZERO_32));
}
```

### The existing test fixture helper for fold tests (`helpers/__tests__/test-utils.ts`)
```typescript
// Source: packages/concord/src/helpers/__tests__/test-utils.ts
export function decoded(
  rumor: RumorTemplate,
  author: string,
  ms = 1_000,
  id = Math.random().toString(16).slice(2),
): DecodedEvent { /* ... */ }
```
Use this to build synthetic `DecodedEvent`s for `foldControl`/`foldMembers` tests — no envelope/encryption needed for fold-level unit tests, matching the existing `control.test.ts`/`guestbook.test.ts` convention.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Root Refounding honored from any BAN holder, no rank check | `readRekey`/`refound()` outrank loop + fail-closed `canRemoveSelf` | Phase 6 (AUTH-01/02) | Established the "fail-closed rank gate" pattern this phase's AUTH-07/D-14 gates copy |
| Rotations carried no `vac` citation | `vacFor`/`vacVerifier` on root + channel rekey | Phase 8 (ROTATE-08, D-08/D-12) | Established the exact predicate shape (`vacVerifier`) this phase's AUTH-08 reuses verbatim, just called with `PERM.KICK` |
| N/A — Grant/Banlist/Role folds have not changed since initial implementation | This phase | 2026-07-19 (planned) | First correctness pass on these three folds |

**Deprecated/outdated:** None — no prior API surface is being removed in this phase (contrast Phase 7's `ChannelMetadata.key`/`.epoch` breaking removal). All six fixes are additive validation; no public type signature changes except `foldMembers` gaining one new *optional* trailing parameter (non-breaking).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | AUTH-08's Kick `vac` gate intentionally does NOT implement CORD-04 §5's literal "a reader will not honor it until it has synced that Grant to at least the cited version" (block-until-synced, version+hash pinning) — it resolves only the eid-coordinate match plus the *current* roster's permission grant, per Phase 8's D-12 "pure over folded state" ruling, carried forward by this phase's D-04. | AUTH-08 / Pattern 4 / Anti-Patterns | If a future audit or spec-conformance re-check treats §5's "block-until-synced" as a hard MUST rather than an implementation choice, this phase's Kick gate (and the root/channel rekey gates it mirrors) would need a follow-up phase adding version/hash pinning — a deliberate, already-ruled scope boundary, not an oversight, but worth flagging since it's a literal-vs-practical divergence from the fetched spec text |
| A2 | The CORD-04 raw spec text was fetched successfully this session (`raw.githubusercontent.com/concord-protocol/concord/main/04.md` and `02.md`, via direct `curl`, not the summarizing WebFetch tool) and quoted verbatim in this document — treated as `[CITED]`, the highest tier available for spec claims (no Context7 entry exists for this niche protocol). | Summary / Standard Stack / rulings | If the `main` branch has moved since 2026-07-19, section numbers or wording could drift; re-verify before a downstream phase relies on an exact quote |

**If empty:** N/A — see table above. A1 is a carried-forward, already-adjudicated milestone decision (not new to this phase); A2 is a sourcing-method note, not a factual gap.

## Open Questions (RESOLVED)

1. **Exact wording of the upstream clarification note for D-03 (AUTH-07's §2/§3 ambiguity)**
   - What we know: CORD-04 §2 states the Grant-specific rule ("outrank every Role it hands out"); §3's general rule ("strictly outrank its target") is restated as a numbered MUST in §5's "Authorizing an Action" procedure ("Confirms the actor holds the action's required bit and strictly outranks its target, traced to the owner") — which reads as binding on every authority action, Grant included, since a Grant is itself "an authority action" per §1's framing ("Every authority action is an edition on the Control Plane").
   - What's unclear: Whether the upstream Concord spec maintainers consider §2's silence on the target-member case a gap (worth a PR/issue) or already-resolved by §5's general restatement. This phase's D-03 says the mechanism (GH issue vs. in-repo note) is Claude's discretion during execution — that discretion is unaffected by this research.
   - Recommendation: File the note as originally planned (D-03); this research found §5 to be even *more* directly supportive of the "strict" ruling than CONTEXT.md's citation implied (§5 restates the general rule as a numbered authorization step, not just an aside), which strengthens rather than weakens the case for the clarification.

2. **Whether `models/community.ts`'s `control` value (pre-members `CommunityState`) is safe to pass into `vacVerifier` before `.members` is populated**
   - What we know: `vacVerifier` only reads `state.material`, `state.roles`, `state.grants` — never `state.members` (confirmed by reading `permissions.ts:98-111` in full).
   - What's unclear: Nothing substantive — this was checked and confirmed safe. Listed here only so the planner doesn't re-derive it as a blocking question; treat as resolved.
   - Recommendation: Pass `control` (or `state0` in `sync.ts`) directly; no restructuring needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test | ✓ | v24.17.0 | — |
| pnpm | workspace scripts | ✓ | 11.10.0 | — |
| vitest | `pnpm --filter applesauce-concord test` | ✓ (root `vitest.config.ts` present, workspace-wide) | via root config | — |
| TypeScript | `tsc` build | ✓ (per PROJECT.md: 5.8–5.9) | — | — |

No missing dependencies. This phase needs no new environment setup beyond what every prior phase (5-8) already used successfully.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-root `vitest.config.ts`, no per-package override in `packages/concord/`) |
| Config file | `/home/user/Projects/applesauce/vitest.config.ts` (root) |
| Quick run command | `pnpm --filter applesauce-concord test -- helpers/__tests__/control.test.ts helpers/__tests__/guestbook.test.ts` |
| Full suite command | `pnpm --filter applesauce-concord test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| AUTH-03 | A Grant at a mismatched eid (forged coordinate) is dropped | unit | `pnpm --filter applesauce-concord test -- control.test.ts` | ✅ extend `control.test.ts` (mirrors existing "folds the banlist only at its derived coordinate" test at `:60-87`) |
| AUTH-04 | A Grant with non-array/non-string `role_ids` is skipped, not thrown | unit | `pnpm --filter applesauce-concord test -- control.test.ts` | ✅ new test in `control.test.ts` |
| AUTH-05 | `kick()`/`ban()` throw locally when caller lacks bit/rank | unit/integration | `pnpm --filter applesauce-concord test -- community.test.ts` | ✅ extend `client/__tests__/community.test.ts` (existing `kick`/`canDo` tests at `:669,676,1295`) |
| AUTH-06 | `Role.position` NaN/float/sentinel rejected | unit | `pnpm --filter applesauce-concord test -- control.test.ts` | ✅ new test in `control.test.ts` |
| AUTH-07 | Junior `MANAGE_ROLES` holder cannot revoke/demote a senior member's Grant (non-self target) | unit | `pnpm --filter applesauce-concord test -- control.test.ts` | ✅ new test in `control.test.ts` |
| AUTH-08 | Kick `vac` gate: missing/wrong-coordinate vac dropped; demoted actor's Kick dropped by current roster | unit | `pnpm --filter applesauce-concord test -- guestbook.test.ts` | ✅ extend `helpers/__tests__/guestbook.test.ts` |
| D-14 | Banlist honors a pk only when signer strictly outranks it; owner never bannable | unit | `pnpm --filter applesauce-concord test -- control.test.ts guestbook.test.ts` | ✅ extend both files (control.ts fold half + guestbook.ts owner-exemption half) |
| TEST-01 (standing) | Every derivation/fold touched has an independently-hand-derived spec-value assertion, not implementation-echo | unit (cross-cutting) | same commands above | ✅ — see Sampling Rate below |

### Sampling Rate

- **Per task commit:** `pnpm --filter applesauce-concord test -- <touched-test-file>.test.ts` (fast, targeted)
- **Per wave merge:** `pnpm --filter applesauce-concord test` (full concord suite)
- **Phase gate:** Full concord suite green + `pnpm run build` (all packages) before `/gsd-verify-work`, matching Phase 6-8's gate pattern

### Wave 0 Gaps

None — `control.test.ts`, `guestbook.test.ts`, and `client/__tests__/community.test.ts` already exist with the right shape (imports, `decoded()` fixture helper, `createCommunity`/`EditionFactory` scaffolding) to extend directly. No new test file or shared fixture is needed.

### TEST-01 spec-derivation detail — the independently-derived value for each fix

Per D-12: every assertion below must be computed BY HAND from the CORD-04/02 formula (or from the existing crypto primitives called directly, never from `foldControl`/`foldMembers` under test), plus a non-vacuity check (the test fails without the fix).

| Fix | Independently-derived spec value the test computes | Non-vacuity check |
|-----|------------------------------------------------------|---------------------|
| AUTH-03 | `grantLocator(hexToBytes(community_id), member)` computed directly from `crypto.ts`'s exported function (same primitive the fix calls — this is acceptable per D-12 because `grantLocator` IS the frozen spec formula (CORD-02 A.6), not `foldControl`'s output; the test constructs a forged eid ≠ this value and asserts it's dropped) | Revert the coordinate check (comment it out) and confirm the forged-eid grant DOES fold — proves the test is sensitive to the fix |
| AUTH-04 | N/A (this is a shape/crash guard, not a value derivation) — the spec-relevant assertion is "the fold does not throw and the malformed candidate contributes nothing," derived from CORD-04 §2's `role_ids: string[]` shape | Revert the shape guard and confirm `foldControl` throws (uncaught `TypeError`) on the same malformed input — proves the guard, not incidental code, prevents the crash |
| AUTH-05 | N/A (behavioral: a throw, not a numeric derivation) — spec-relevant assertion is "the local check topologically matches the read-path `canActOn`/`hasPerm(KICK/BAN)` + `position <` computation," i.e. hand-construct a `Standing` for actor and target and assert `actor.position < target.position && hasPerm(actor.permissions, PERM.KICK)` by hand before calling `kick()` | Remove the local guard and confirm `kick()`/`ban()` resolve without throwing for an under-ranked caller (matching the described current L04 symptom) |
| AUTH-06 | Hand-pick `NaN`, `1.5`, `undefined`, `0xffffffff` as `position` values; the spec-derived expectation is CORD-04 §3's `"position": <u32>` (a positive integer, `0` reserved for the owner, `< 0xffffffff` the roleless sentinel from `permissions.ts:34`) — assert each is rejected (role.position not in the folded `state.roles`) | Revert the `Number.isInteger` guard and confirm a `NaN`-position role folds and confers its permission bits — reproduces L05's described symptom |
| AUTH-07 | Hand-construct two `Standing`s (junior `position=5` with `MANAGE_ROLES`, senior `position=1`) per CORD-04 §3's `position` ordering rule (lower = higher authority); the spec-derived expected outcome is REJECT (junior cannot strip/demote senior) per §3's "the actor must hold the required bit and strictly outrank its target" restated in §5 step 3 | Revert the target-rank gate and confirm the junior's revoke Grant DOES fold (the pre-existing vacuous-`[].every()` hole) |
| AUTH-08 | Hand-compute the expected `vac[0]` as `grantLocator(hexToBytes(community_id), actor)` (same primitive, acceptable per the AUTH-03 rationale above — it's the frozen coordinate formula, not fold output); construct a demoted actor (Grant superseded in the SAME test's control state) and assert their Kick with a stale-but-structurally-valid vac is dropped because `hasPerm(currentStanding.permissions, PERM.KICK)` is now false | Revert `verifyVac` wiring (pass `undefined`) and confirm the demoted actor's Kick DOES succeed — reproduces S02's described symptom |
| D-14 | Hand-construct actor/target `Standing`s per CORD-04 §3 ordering; spec-derived expectation: banlist entry honored only if `signer.position < target.position`; owner (`position === 0`) is never in the resulting `banlist`/`members`-deletion regardless of signer rank, per CORD-04 §2 "occupies position 0, and is supreme and unremovable" | Revert the per-entry rank check (or the guestbook.ts owner-exemption) independently and confirm each reproduces the described hole (junior bans senior; owner gets banned) |

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | Authentication is Nostr-key-based (seal signature), out of this phase's scope — unchanged |
| V3 Session Management | no | No session concept in this protocol layer |
| V4 Access Control | yes | This entire phase IS V4: rank-based authorization (`canActOn`/`hasPerm`) gating every Grant/Kick/Ban/Role action — the fixes ARE the access-control hardening |
| V5 Input Validation | yes | AUTH-04 (malformed `role_ids`), AUTH-06 (malformed `position`) — reject-on-malformed-shape at the fold boundary, the exact ASVS "fail closed on invalid input" pattern |
| V6 Cryptography | no | No new cryptographic primitive — `grantLocator`/`banlistLocator`/`vacVerifier` are pre-existing, unmodified derivations reused as-is |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Privilege escalation via vacuous authorization check (`[].every()` on empty array trivially true) | Elevation of Privilege | AUTH-07's additional target-rank gate — never rely on an array method's vacuous-truth on empty input as an implicit "no constraint" signal when a constraint should still apply |
| Denial of service via malformed input crashing a shared fold (`foldControl` throwing kills every member's state) | Denial of Service | AUTH-04/AUTH-06's skip-candidate (never throw) pattern — a fold over untrusted, attacker-reachable wire content must be total (never partial via exception) |
| Authorization bypass via unvalidated coordinate (grant folded regardless of claimed eid) | Spoofing / Tampering | AUTH-03's coordinate-equality check — an entity whose address is a pure function of stable identifiers must be validated against that function, not trusted from content |
| Stale-authority replay (a demoted actor's action honored because the verifier doesn't re-check current rank) | Elevation of Privilege | AUTH-08's `vacVerifier` — resolves rank against the CURRENT folded roster, not the cited moment, so a demotion takes effect immediately for any dependent vac-gated action |
| Missing authorization on the write/UX path masking a would-be-successful action as if it happened | Tampering (of user-visible state, not actual authority) | AUTH-05's local throw — read path already enforces (no real vulnerability), but the UI must not lie about a no-op succeeding |

## Sources

### Primary (HIGH confidence)
- Upstream Concord spec, `raw.githubusercontent.com/concord-protocol/concord/main/04.md` — fetched via direct `curl` (not summarized), full text read for §1, §2, §3, §5, §6, Appendix A/B. Quoted verbatim above.
- Upstream Concord spec, `raw.githubusercontent.com/concord-protocol/concord/main/02.md` — fetched via direct `curl`, full text read for §5 (Guestbook/Kick wire shape), §6 (round-trip discipline), §8.
- `packages/concord/src/helpers/control.ts` — read in full this session (339 lines), all cited line numbers verified.
- `packages/concord/src/helpers/permissions.ts` — read in full this session (112 lines).
- `packages/concord/src/helpers/guestbook.ts` — read in full this session (117 lines).
- `packages/concord/src/helpers/crypto.ts` — read in full this session (246 lines).
- `packages/concord/src/client/admin.ts` — read in full this session (383 lines).
- `packages/concord/src/client/community.ts` — read at lines 690-829, 1000-1055, 1220-1290, plus grep of all `kick`/`ban`/`vacFor`/`canDo`/`standingOf` occurrences.
- `packages/concord/src/client/sync.ts` — read at lines 160-204, plus `state0` definition grep confirming ordering safety.
- `packages/concord/src/client/channel-sync.ts`, `client/private-channel.ts` — grepped for `verifyVac`/`canRemoveSelf` precedent shape, confirming CONTEXT.md's citations (`:32`/`:62`) exactly.
- `packages/concord/src/helpers/keys.ts` — grepped for `readRekeyScoped`/`ScopedHeld`/`readRekey` signatures confirming the `verifyVac` threading pattern's origin.
- `packages/concord/src/helpers/rekey.ts` — read lines 135-190 for the `vac` tag parsing convention (`parseRekey`) mirrored in this phase's Kick-branch vac parsing.
- `packages/concord/src/models/community.ts`, `models/members.ts` — read in full, confirming both `foldMembers` call sites already have a `CommunityState`-shaped `control` in scope.
- `packages/concord/src/helpers/__tests__/control.test.ts`, `guestbook.test.ts`, `test-utils.ts` — read in full, confirming existing fixture/assertion conventions to extend.
- `.planning/phases/09-authority-permission-fold-correctness/09-CONTEXT.md` — the locked D-01..D-14 decisions this research grounds.
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/concord-audit.md`, `.planning/PROJECT.md`, `.planning/phases/06-refounding-rotation-authority-correctness/06-CONTEXT.md` — read in full per the task's file list.

### Secondary (MEDIUM confidence)
- None — every claim in this document traces to a primary source read this session.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; every primitive reused was read in full this session.
- Architecture: HIGH — every fold/call-site was read directly, including the 3 `foldMembers` call sites and the `cidBytes` hoisting gotcha.
- Pitfalls: HIGH — derived from direct code reading, not speculation (e.g. the `cidBytes` ordering issue and the `grantLocator` missing import were discovered by reading, not inferred).
- Spec rulings (AUTH-07/AUTH-08): HIGH — raw upstream spec text fetched and quoted verbatim via `curl`, not paraphrased or summarized by an intermediate model.

**Research date:** 2026-07-19
**Valid until:** 30 days (stable, no fast-moving dependency; re-verify line numbers if Phase 9 planning is deferred past that window, since prior phases have shown line-number drift of a few lines per phase as the codebase evolves)
