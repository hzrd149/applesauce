---
phase: 06-refounding-rotation-authority-correctness
verified: 2026-07-16T21:00:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 6: Refounding Rotation & Authority Correctness Verification Report

**Phase Goal:** A Refounding is no longer a cryptographic no-op in-session — it rotates every plane address, actually drops excluded members from the memberlist, and is honored only from a rotator who strictly outranks every target it removes.
**Verified:** 2026-07-16T21:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 3 | A member excluded by a Refounding is absent from the new epoch's Complete Memberlist even with a prior-epoch Join or observed entry; new epoch's Guestbook seeded only by the snapshot; a keep list built from `state.members` does not re-admit them | ✓ VERIFIED | `client/community.ts:279-283,310-335,392-397,422-435,713-727` — guestbook store keyed `guestbook@<epoch>`, live `observed` scoped to channel stores only (control/dissolved/rekey excluded), D-03 retention trim in `adoptRefounding`. `models/community.ts:37-43` — `observedStores` drops `controlStore`. `helpers/guestbook.ts` unmodified (confirmed via `git diff --stat` across the phase — zero changes). Integration tests: `community.test.ts:515-583` (new-epoch snapshot seeding, not prior epoch), `:585-631` (ROTATE-04: prior-epoch Join and prior-epoch observed authorship both dropped), `:633-683` (D-03 store disposal), `:745-784` (D-04: `state.members` fed back as `keep` does not re-admit). |
| 4 | A rotator who does not strictly outrank a target is rejected on both send (`refound()`) and receive (`readRekey`'s guard denies by default when absent) | ✓ VERIFIED | Send: `client/community.ts:1113-1120` — per-target `canDo(PERM.BAN, standingOf(target).position)` loop, throws before `buildRefounding`/any publish; test `community.test.ts:685-743` proves a non-outranking BAN holder's `refound()` rejects (`/outrank/`) and `published` stays empty. Receive: `helpers/keys.ts:513` — `held.canRemoveSelf?.(set.rotator) === true` (fail-closed; no `!held.canRemoveSelf \|\|` remains anywhere in the tree, confirmed by grep). `readRekey` (`keys.ts:399-431`) threads an optional `canRemoveSelf` into the root `ScopedHeld`; both call sites (`community.ts:685-701` `checkRekey`, `sync.ts:184-202` `syncEpoch`) supply it via `hasPerm`/`canActOn` over `PERM.BAN`. Test `keys.test.ts:192-220` proves all three outcomes: outranking rotator → removed, non-outranking → not removed, absent predicate → not removed (fail-closed-on-absence). |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `readRekeyScoped:513` | `readRekey`/`readChannelRekey` callers | `canRemoveSelf?.(rotator) === true` | ✓ WIRED | Both root callers (`community.ts:700`, `sync.ts:188-201`) and both channel callers (`private-channel.ts:265`, `channel-sync.ts:81`) supply it |
| `refound()`'s outrank loop | `buildRefounding`/publish calls | positioned before both | ✓ WIRED | `community.ts:1117-1120` precedes `:1122` (`excluded` set) and all publish calls at `:1146-1153` |
| Guestbook store epoch key | `adoptRefounding`'s retention trim | `trimStaleGuestbookStores()` | ✓ WIRED | Called at `community.ts:715`, inside `adoptRefounding`, after the key roll |

### Rule 1 Deviation Check (per verification instructions)


### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| ROTATE-01 | 06-01 | New-epoch control/guestbook addresses match spec formula over new root | ✓ SATISFIED | `keys.test.ts:227-288` |
| ROTATE-02 | 06-01, 06-02 | Epoch walk addresses each held epoch distinctly | ✓ SATISFIED | `keys.test.ts:290-325` (base-rekey), `sync.ts:279-283` (guestbook store key), `sync.ts:253-268` (buildChain, pre-existing) |
| ROTATE-04 | 06-02 | Refounding drops excluded members from Complete Memberlist | ✓ SATISFIED | `community.test.ts:515-829`, `helpers/keys.ts`/`sync.ts`/`community.ts`/`models/community.ts` routing changes |
| AUTH-01 | 06-03 | Receive-path fails closed, denies removal from non-outranking rotator | ✓ SATISFIED | `keys.ts:513`, `keys.test.ts:192-220` |
| AUTH-02 | 06-03 | `refound()` rejects excluding a non-outranked target | ✓ SATISFIED | `community.ts:1113-1120`, `community.test.ts:685-743` |

All 5 requirement IDs from the phase directive are present in the phase's PLAN frontmatter (`06-01`: ROTATE-01/02; `06-02`: ROTATE-04/ROTATE-02; `06-03`: AUTH-01/AUTH-02) and cross-referenced in REQUIREMENTS.md, all marked `[x]` complete with Traceability table entry "Phase 6 | Complete". No orphaned requirements found for Phase 6.

### Anti-Patterns Found

None. Grep for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` across every file touched in this phase (`git diff --name-only dad6545e..HEAD`) returned zero matches. No default-permit guard patterns (`!held.canRemoveSelf ||`) remain anywhere in the tree.

### Spec Cross-Reference (upstream CORD spec, per project memory note)


### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|

### Human Verification Required

None. All must-haves are code-verifiable (pure derivation functions, integration tests over an in-memory fake pool/relay harness) — no UI, real-time, or external-service behavior in this phase's scope.

### Gaps Summary

No gaps found. All 5 phase success criteria are verified against the actual codebase (not merely SUMMARY claims): the address-rotation formulas, the epoch-scoped guestbook store, the memberlist exclusion behavior, and both authority guards (send + receive) all have direct code evidence and independently spec-derived tests. The one deviation the plans documented (the Rule 1 channel-scope thread-through) was checked and found to be a correctness-preserving, non-scope-creeping fix, not a regression. `helpers/guestbook.ts`'s `foldMembers` — explicitly required to stay untouched — is confirmed unmodified across the entire phase.

---

_Verified: 2026-07-16T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
