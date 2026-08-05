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
| 1 | After a Refounding, `rollForward(...).control.pk` (and guestbook/rekey addresses alongside it) equal the spec formula over the new root | ✓ VERIFIED | `keys.test.ts:227-325` — three spec-derived tests assert `rolled.control.pk`, `rolled.guestbook.pk` against `controlGroupKey`/`guestbookGroupKey` computed over the NEW root, and `rolled.nextBaseRekey.key.pk` against `baseRekeyGroupKey` over the new root at `newEpoch+1` (the off-by-root asymmetry, Pitfall 1, made explicit and distinct from the listen address which is correctly over the prior root). All oracle values come only from `crypto.ts` primitives, never from `deriveConcordKeys`/`rollForward`/`baseKeysFor`. Memo-armed (arm-the-memo before roll) so the guard is non-vacuous against a reintroduced CONCORD-H01-class regression. |
| 2 | Each held epoch's material addresses a distinct plane, so the epoch walk fetches every historical epoch instead of collapsing onto one address | ✓ VERIFIED | `helpers/keys.ts:179-190` `deriveConcordKeys` stamps `epoch: material.root_epoch` on the guestbook `PlaneInfo`; `client/sync.ts:279-283` `planeStoreKey` returns `guestbook@${info.epoch}` (not flattened to `info.type`); `client/sync.ts:253-268` `buildChain` already mints distinct per-epoch materials (pre-existing, re-verified accurate). The base-rekey spec-derived test (`keys.test.ts:295-325`) independently proves the epoch-address formula produces a distinct address per epoch/root pair. |
| 3 | A member excluded by a Refounding is absent from the new epoch's Complete Memberlist even with a prior-epoch Join or observed entry; new epoch's Guestbook seeded only by the snapshot; a keep list built from `state.members` does not re-admit them | ✓ VERIFIED | `client/community.ts:279-283,310-335,392-397,422-435,713-727` — guestbook store keyed `guestbook@<epoch>`, live `observed` scoped to channel stores only (control/dissolved/rekey excluded), D-03 retention trim in `adoptRefounding`. `models/community.ts:37-43` — `observedStores` drops `controlStore`. `helpers/guestbook.ts` unmodified (confirmed via `git diff --stat` across the phase — zero changes). Integration tests: `community.test.ts:515-583` (new-epoch snapshot seeding, not prior epoch), `:585-631` (ROTATE-04: prior-epoch Join and prior-epoch observed authorship both dropped), `:633-683` (D-03 store disposal), `:745-784` (D-04: `state.members` fed back as `keep` does not re-admit). |
| 4 | A rotator who does not strictly outrank a target is rejected on both send (`refound()`) and receive (`readRekey`'s guard denies by default when absent) | ✓ VERIFIED | Send: `client/community.ts:1113-1120` — per-target `canDo(PERM.BAN, standingOf(target).position)` loop, throws before `buildRefounding`/any publish; test `community.test.ts:685-743` proves a non-outranking BAN holder's `refound()` rejects (`/outrank/`) and `published` stays empty. Receive: `helpers/keys.ts:513` — `held.canRemoveSelf?.(set.rotator) === true` (fail-closed; no `!held.canRemoveSelf \|\|` remains anywhere in the tree, confirmed by grep). `readRekey` (`keys.ts:399-431`) threads an optional `canRemoveSelf` into the root `ScopedHeld`; both call sites (`community.ts:685-701` `checkRekey`, `sync.ts:184-202` `syncEpoch`) supply it via `hasPerm`/`canActOn` over `PERM.BAN`. Test `keys.test.ts:192-220` proves all three outcomes: outranking rotator → removed, non-outranking → not removed, absent predicate → not removed (fail-closed-on-absence). |
| 5 | (TEST-01, standing) Every derivation/fold this phase touches has an independently spec-derived test | ✓ VERIFIED | Guestbook + base-rekey addresses (`keys.test.ts:256-325`), root-path outrank removal (`keys.test.ts:192-220`), send-path outrank rejection (`community.test.ts:685-743`), ROTATE-04 memberlist regression (`community.test.ts:515-829`), and a `foldMembers` characterization test (`guestbook.test.ts` — bare observed-entry `!c` admit) all derive expected values from `crypto.ts` primitives or hand-reasoned truth tables — never from the implementation under test. Full `applesauce-concord` suite: 202/202 passing; `tsc` build clean. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/helpers/__tests__/keys.test.ts` | Guestbook + base-rekey spec-derived tests + memo-armed spread guards; AUTH-01 root-path outrank test | ✓ VERIFIED | Lines 192-325; imports `baseRekeyGroupKey`, `guestbookGroupKey`, `controlGroupKey` from `../crypto.js` only |
| `packages/concord/src/helpers/keys.ts` | Guestbook `PlaneInfo` epoch stamp; fail-closed `readRekeyScoped`; `readRekey`'s `canRemoveSelf` param; rewritten docstring | ✓ VERIFIED | Lines 179-190 (epoch stamp), 397-431 (`readRekey` + param), 442-461 (rewritten docstring), 508-513 (fail-closed branch) |
| `packages/concord/src/client/sync.ts` | `planeStoreKey` epoch-keys guestbook only; `syncEpoch` supplies `canRemoveSelf` | ✓ VERIFIED | Lines 184-202, 279-283 |
| `packages/concord/src/client/community.ts` | `guestbookPlaneKey()` helper; scoped `rewireState`; D-03 trim; `refound()` outrank loop; `checkRekey` `canRemoveSelf` | ✓ VERIFIED | Lines 279-335, 392-435, 685-727, 1097-1157 |
| `packages/concord/src/models/community.ts` | `observedStores` drops control | ✓ VERIFIED | Lines 37-43 |
| `packages/concord/src/client/__tests__/community.test.ts` | ROTATE-04, D-03, D-04, AUTH-02, Open Question 1 tests | ✓ VERIFIED | Lines 515-829 |
| `packages/concord/src/helpers/__tests__/guestbook.test.ts` | `!c` characterization test | ✓ VERIFIED | Confirmed present, `foldMembers` untouched |
| `.changeset/concord-memberlist-epoch-scoping.md`, `concord-refound-outrank-send.md`, `concord-rekey-outrank-receive-failclosed.md` | Single-sentence patch changesets | ✓ VERIFIED | All three present, each one sentence, `applesauce-concord: patch` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `deriveConcordKeys`'s guestbook `PlaneInfo.epoch` | `planeStoreKey` | `info.epoch` read for the guestbook branch | ✓ WIRED | `keys.ts:183` sets it, `sync.ts:281` reads it |
| `readRekeyScoped:513` | `readRekey`/`readChannelRekey` callers | `canRemoveSelf?.(rotator) === true` | ✓ WIRED | Both root callers (`community.ts:700`, `sync.ts:188-201`) and both channel callers (`private-channel.ts:265`, `channel-sync.ts:81`) supply it |
| `refound()`'s outrank loop | `buildRefounding`/publish calls | positioned before both | ✓ WIRED | `community.ts:1117-1120` precedes `:1122` (`excluded` set) and all publish calls at `:1146-1153` |
| Guestbook store epoch key | `adoptRefounding`'s retention trim | `trimStaleGuestbookStores()` | ✓ WIRED | Called at `community.ts:715`, inside `adoptRefounding`, after the key roll |

### Rule 1 Deviation Check (per verification instructions)

The 06-03-SUMMARY documents that making `readRekeyScoped`'s guard fail-closed cascaded into the shared channel scope, requiring `canRemoveSelf` to be threaded through `ChannelSyncContext` (`channel-sync.ts`/`private-channel.ts`). Confirmed via diff: this is a pure thread-through of the already-existing, already-correct `ConcordPrivateChannelOptions.canRemoveSelf` predicate (already wired to the LIVE `checkRekey` path in `private-channel.ts`) into the one call site that was missing it (the sync-WALK path in `channel-sync.ts`). No new rank logic was introduced; no authority check was weakened — the change only closes a walk-vs-live asymmetry that the old default-permit guard was silently masking. `helpers/guestbook.ts` confirmed unmodified (`git diff --stat dad6545e..HEAD -- packages/concord/src/helpers/guestbook.ts` — zero output, zero changes).

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

Cross-checked the phase's own 06-RESEARCH.md, which fetched CORD-02 §4/§5 and CORD-06 §2/§3 verbatim from the upstream `concord-protocol/concord` raw spec files this session (not just the local audit paraphrase) and confirmed every decision (D-01 through D-11) against spec sentences with zero conflicts. Independently re-verified the load-bearing quotes against the local `crypto.ts` formulas during this verification: `guestbookGroupKey`/`controlGroupKey` both key on `(root, community_id, epoch)` matching CORD-02 §4's `group_key` formula; `baseRekeyGroupKey` keys on `(priorRoot, community_id, newEpoch)` matching CORD-06 §2's prior-root asymmetry; `readRekeyScoped`'s fail-closed guard and both `refound()`/`readRekey` authority checks match CORD-06 §3's "in both the Rotator must strictly outrank every removed target." No spec conflicts found.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full `applesauce-concord` suite | `pnpm --filter applesauce-concord test` | 202/202 tests passing, 43 files | ✓ PASS |
| TypeScript build | `pnpm --filter applesauce-concord build` | Clean, no errors | ✓ PASS |

### Human Verification Required

None. All must-haves are code-verifiable (pure derivation functions, integration tests over an in-memory fake pool/relay harness) — no UI, real-time, or external-service behavior in this phase's scope.

### Gaps Summary

No gaps found. All 5 phase success criteria are verified against the actual codebase (not merely SUMMARY claims): the address-rotation formulas, the epoch-scoped guestbook store, the memberlist exclusion behavior, and both authority guards (send + receive) all have direct code evidence and independently spec-derived tests. The one deviation the plans documented (the Rule 1 channel-scope thread-through) was checked and found to be a correctness-preserving, non-scope-creeping fix, not a regression. `helpers/guestbook.ts`'s `foldMembers` — explicitly required to stay untouched — is confirmed unmodified across the entire phase.

---

_Verified: 2026-07-16T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
