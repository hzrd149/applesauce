---
phase: 09-authority-permission-fold-correctness
reviewed: 2026-07-19T20:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
resolutions:
  CR-01: resolved in f69b9ed2 (isHexKey guard on grant.member + spec-derived non-vacuity test; suite 252/252)
  WR-01: open (advisory — owner-in-banlist-Set defense-in-depth)
  WR-02: open (advisory — verifyVac optional/fail-open; all current call sites wire it)
  IN-01: open (advisory — dead role.position<=0 check)
---

# Phase 9: Code Review Report

**Reviewed:** 2026-07-19T20:00:00Z
**Depth:** deep
**Files Reviewed:** 10
**Status:** issues_found

## Summary


Most of the phase's stated fixes (AUTH-03 coordinate binding, AUTH-04 malformed-`role_ids` guard, AUTH-06 `Role.position` guard, AUTH-07 target-rank gate, AUTH-08 Kick vac gate, AUTH-05 client pre-publish throws) are correctly implemented, correctly ordered relative to each other, and match their documented intent — verified line-by-line and, for the headline finding below, by an actual reproduction run against the current tree.

However, the AUTH-03 coordinate gate itself introduces a **new, previously-absent crash path**: it calls `grantLocator(cidBytes, grant.member)` on a JSON-content-sourced value that is only checked for truthiness, not for hex-string validity, before being handed to `hexToBytes`. Any signed event landing in the Grant-vsk candidate stream with a truthy-but-non-hex `member` field throws an uncaught `RangeError` out of `foldControl`, which every caller invokes with no try/catch (including inside an RxJS `map()` with no `catchError`). This is exactly the "fold must be total, never throw" defect class AUTH-04 was written to close, reopened one guard earlier — the fix undermines its own stated purpose (see CR-01, reproduced empirically below).

Two further correctness/consistency gaps were found in the D-14 banlist owner-exemption and in `foldMembers`' opt-in vac-gate API shape (WR-01, WR-02), plus one dead-code artifact left by the AUTH-06 guard (IN-01).

## Critical Issues

### CR-01: Malformed `Grant.member` crashes `foldControl` via an unguarded `hexToBytes` call — reintroduces the exact "fold must be total" defect AUTH-04 was written to close


**Issue:** The AUTH-03 coordinate gate added in this phase reads:

```ts
if (!grant.member) continue;
// AUTH-03: ...
if (eid !== grantLocator(cidBytes, grant.member)) continue;
```

`grant.member` comes from `JSON.parse(cand.content)` cast (`as Grant`) with zero runtime shape validation beyond the truthiness check on the line above. `grantLocator(communityId, memberXonlyHex)` (`helpers/crypto.ts:184-186`) immediately calls `hexToBytes(memberXonlyHex)`, which **throws** (not returns null/undefined) whenever the input is not a string, has odd length, or contains non-hex characters (`@noble/hashes/utils.js`: `throw new Error('hex string expected...')` / `'padded hex string expected...'` / `'Invalid byte sequence'`).

Any event — from **any signer, holding no permission at all** — published into the Grant-vsk candidate stream at any coordinate with content such as `{"member":"not-valid-hex","role_ids":[]}` reaches this line before `authorized` is ever computed (authorization is checked further down the same loop, not before this coordinate gate). The call throws, and the exception propagates straight out of `foldControl` uncaught.

`foldControl` has no internal try/catch around this call (only the `JSON.parse` above it is guarded), and none of its callers wrap it either:
- `client/sync.ts:152` calls it directly inside `syncEpoch`, unguarded — the whole epoch sync `Promise` rejects.
- `client/community.ts:1217` calls it directly, unguarded.

This is a denial-of-service: a single malformed Grant edition, requiring no privilege whatsoever to publish, breaks every client's read-path fold for that community. It is the same failure class the phase's own AUTH-04 guard exists to prevent for `role_ids` — but the new AUTH-03 coordinate check runs *before* AUTH-04's shape guard and has no equivalent validation of its own. The file already imports and uses `isHexKey` (`helpers/control.ts:20`) to validate `eid`/`prevHash` elsewhere in this same function (`:50`, `:55`) — the tool to fix this was already in scope and simply wasn't applied to `grant.member`.

**Reproduced:** confirmed empirically against the current tree — a scratch test constructing a Grant edition with `content: JSON.stringify({ member: "not-valid-hex", role_ids: [] })`, signed by an arbitrary non-privileged author, thrown at `foldControl`:

```
threw: true RangeError: hex string expected, got unpadded hex of length 13
    at hexToBytes (.../@noble/hashes/utils.js:373:15)
```
(No existing test in `control.test.ts` covers a malformed `grant.member` — the AUTH-04 tests only exercise malformed `role_ids`, so this gap has no regression coverage.)

**Fix:** Validate `grant.member` is a well-formed hex key before it ever reaches `grantLocator`, mirroring the `isHexKey` pattern already used in this file:

```ts
if (!grant.member || typeof grant.member !== "string" || !isHexKey(grant.member)) continue;
// AUTH-03: a Grant lives at exactly ONE derived coordinate...
if (eid !== grantLocator(cidBytes, grant.member)) continue;
```


## Warnings

### WR-01: Owner can end up in the banlist `Set` itself, contradicting the "owner is never bannable" invariant the D-14 fix documents


**Issue:** The D-14 per-entry gate is:

```ts
for (const pk of JSON.parse(cand.content) as string[]) {
  if (s.isOwner || s.position < standing(pk).position) banlist.add(pk);
}
```

`s` is the standing of the banlist **edition's signer** (`cand.author`), not of the target `pk`. When the signer *is* the owner (`s.isOwner === true`), the `s.isOwner ||` clause short-circuits the whole per-pk rank check — so if the owner's own banlist content includes their own pubkey (self-inflicted, but also reachable via the client-side `ban()` guard: `admin.ts`'s `canDo(PERM.BAN, ...)` uses `canActOn`, which returns `true` unconditionally for `actor.isOwner` *before* checking whether `target === actor`, so `community.ban(ownPubkey)` when called by the owner passes the local pre-publish guard too), that pubkey is added to `banlist` unconditionally, with no check that the *target* isn't also the owner.


**Fix:** Make the target-side owner exemption explicit and independent of who signed the edition:

```ts
for (const pk of JSON.parse(cand.content) as string[]) {
  if (standing(pk).isOwner) continue; // owner can never appear in the banlist itself
  if (s.isOwner || s.position < standing(pk).position) banlist.add(pk);
}
```

### WR-02: `foldMembers`' `verifyVac` vac-gate parameter is optional and fail-open by default


**Issue:** `verifyVac` was added as an *optional* 7th positional parameter (`verifyVac?: (rotator, vac) => boolean`). When omitted, the Kick branch's AUTH-08 gate is simply skipped (`if (verifyVac) { ... }`), silently reverting to pre-AUTH-08 behavior — a demoted actor's stale-but-structurally-valid Kick would fold. All three current production call sites (`models/community.ts:62`, `models/members.ts:30`, `client/sync.ts:183`) do wire `vacVerifier(..., PERM.KICK)` (confirmed by grep — no live gap today), but the function's own signature does nothing to prevent a future call site (a new model, a test fixture accidentally reused in production code, a downstream package) from omitting it and silently losing the fold's most recently added authority gate, with no compiler or runtime signal that anything is wrong. Given this phase's explicit charter ("fail-closed behavior is security-critical" for exactly this class of gate), an opt-in security control is a weaker default than the rank-vs-victim check it's additive to (which is unconditional).

**Fix:** Consider making `verifyVac` a required parameter (forcing every call site to make an explicit choice, including an explicit `() => true` for call sites that intentionally don't need it, e.g. an owner-only context) rather than an optional one that silently no-ops. At minimum, this is worth flagging in `PATTERNS.md`/`RESEARCH.md` as a known trade-off so a future editor doesn't add a call site without noticing the parameter exists.

## Info

### IN-01: Dead code — the pre-existing `role.position <= 0` check is now unreachable


**Issue:** The AUTH-06 guard added on `:168` already rejects any `role.position <= 0`:

```ts
if (!Number.isInteger(role.position) || role.position <= 0 || role.position >= 0xffffffff) continue;
// No edition may claim a position at or above its own signer.
if (!s.isOwner && role.position <= s.position) continue;
if (role.position <= 0) continue; // position 0 is the owner alone
```

By the time execution reaches `:171`, `role.position <= 0` has already been excluded by `:168`, so this line can never fire. It's harmless (correct by construction) but is now dead code left over from the pre-existing guard set, and its comment ("position 0 is the owner alone") duplicates the rationale already covered by the new guard's comment.

**Fix:** Remove the now-unreachable line, or fold its comment into the AUTH-06 guard's comment block:

```ts
if (!Number.isInteger(role.position) || role.position <= 0 || role.position >= 0xffffffff) continue; // position 0 is the owner alone; sentinel reserved for roleless
if (!s.isOwner && role.position <= s.position) continue;
```

---

_Reviewed: 2026-07-19T20:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
