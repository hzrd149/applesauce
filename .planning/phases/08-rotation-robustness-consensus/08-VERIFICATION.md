---
phase: 08-rotation-robustness-consensus
verified: 2026-07-19T15:21:32Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 8: Rotation Robustness & Consensus Verification Report

**Phase Goal:** Rotation behaves correctly under real-world adversity — racing Refoundings, a bunker signer that blips mid-decrypt, and malformed or partial chunk sets — instead of silently forking the community or evicting a member who was never removed.
**Verified:** 2026-07-19T15:21:32Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A transient signer/decrypt error while reading a rekey blob is retried and never interpreted as removal (no permanent eviction on a bunker blip) | ✓ VERIFIED | `readRekeyScoped` (`packages/concord/src/helpers/keys.ts:558-602`) tracks a caught decrypt at our own locator via `decryptThrew`, and `if (decryptThrew) return { kind: "none" }` runs BEFORE the no-blob removal loop — this is the exact CR-01 fix (commit `920676ee`). Regression test `keys.test.ts#"a transient decrypt failure defers even when a competing no-blob removal set exists (ROTATE-05, D-06)"` passes in isolation and in the full suite. |
| 2 | Two rotations racing to the same epoch converge down-only to a single lower-keyed sibling, the winner is computed among all authorized+continuity-checked candidates (not only ones we received), and a converged community can never re-fork | ✓ VERIFIED | `isStrictlyLowerKey` (`helpers/rekey.ts:314`) is the single down-only comparator, used identically by the live latch (`community.ts:797`, `private-channel.ts:292`) and the sync-walk cascade (`sync.ts:288`, `channel-sync.ts:134`). `readRekeyScoped` computes the winner among ALL authorized/complete/continuity-checked candidates and defers (`none`) when a decryptable winner coexists with an opaque (no-blob or decrypt-threw) competitor (D-10) rather than blindly adopting. `sync.test.ts`/`channel-sync.test.ts` 3-epoch cascade oracles pass. |
| 3 | A rotation cites the Grant it acts under (`vac`), a receiver verifies it against its folded Roster before honoring it, and compaction/snapshot wraps publish only after the root roll's publication is confirmed | ✓ VERIFIED | `RekeyRotation.vac` threads through `includeRekeyChunk`/`buildRekeyRumors`/`buildRefounding`/`buildChannelRekey` (`operations/rekey.ts`, `helpers/keys.ts`); `vacVerifier` (`helpers/permissions.ts:98`) is wired at all four receive call sites (`sync.ts:201`, `channel-sync.ts:93` via ctx, `community.ts:785`, `community.ts:707`/`private-channel.ts:231,280`). `refound()`'s `requireMajority` (`community.ts:1276-1286`) gates each root-roll/channel-rekey wrap on `⌈(n+1)/2⌉` of `relays.length` before compaction/snapshot publish (`community.ts:1289-1290`) and `adoptRefounding` (`community.ts:1292-1293`). |
| 4 | Rotation chunk sets correlate on `chunkCount` and `prevepoch` identity is validated across a rotation's chunks, so a resumed rotation's stale generation cannot complete a set or forge continuity | ✓ VERIFIED | `groupRotations` (`helpers/rekey.ts:216-266`) tracks per-bucket `chunkCounts`/`prevEpochs` sets and sets `consistent = chunkCounts.size===1 && prevEpochs.size===1`; `complete = consistent && chunks.size >= chunkCount`. Correlation key intentionally left unchanged (D-02, matches upstream CORD-06). `rekey.test.ts` n-disagreement and prevEpoch-disagreement oracles pass. |
| 5 | Historical epoch material does not inherit the tip's `refounder`, and a Refounding that cannot reliably fold the whole Control Plane aborts rather than publishing a partial compaction | ✓ VERIFIED | `types.ts:155` adds optional `held_roots[].refounder`; `sync.ts:318-335` (`buildChain`) strips the tip's own refounder and attributes each synthesized epoch from its OWN `held_roots` entry; consumed by `guestbook.ts:87-89`'s snapshot-authorization gate. `buildRefounding`'s compaction loop (`helpers/keys.ts:394-408`) throws BEFORE returning any wraps when a Control head isn't plaintext or can't be rewrapped — no partial `compactionWraps` ships. |
| 6 | (TEST-01, standing) Every derivation/fold this phase touches has a test computing its expected value independently from the CORD-06 spec (continuity math, `lowerKeyWins` tie-break, complete-set gate) | ✓ VERIFIED | `keys.test.ts` and `rekey.test.ts` contain multiple "EXPECTED, independently derived from CORD-06 §…"-labeled blocks (e.g. lines 292, 318, 330, 382, 489, 751, 770) computing expected addresses/outcomes by hand before asserting against the implementation. |

**Score:** 6/6 roadmap success criteria verified (0 present-but-behavior-unverified)

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| ROTATE-05 | 08-03 | Transient signer error while decrypting a rekey blob is retried, never removal | ✓ SATISFIED | `decryptThrew` guard in `readRekeyScoped`; `keys.test.ts` oracle passes |
| ROTATE-06 | 08-01, 08-03 | Racing rotations converge down-only; never re-fork | ✓ SATISFIED | `isStrictlyLowerKey` latch (live + walk); `sync.test.ts`/`channel-sync.test.ts` cascade oracles |
| ROTATE-07 | 08-03 | Winner computed among all authorized/complete/continuity candidates, not only ours | ✓ SATISFIED | Decryptable-vs-opaque partition in `readRekeyScoped`; defers (D-10) rather than blindly adopting |
| ROTATE-08 | 08-05 | Rotation cites `vac`; receiver verifies against folded Roster | ✓ SATISFIED | `RekeyRotation.vac` round-trip + `vacVerifier` wired at 4 receive call sites |
| ROTATE-09 | 08-04 | Compaction/snapshot publish only after root roll confirmed; adoption gated | ✓ SATISFIED | `requireMajority` gate before compaction/snapshot/adoptRefounding; `community.test.ts` oracle |
| ROTATE-10 | 08-02 | Chunk sets correlate on `chunkCount`; resumed rotation's stale generation can't complete | ✓ SATISFIED | `groupRotations` consistency guard (chunkCount multiset); ruled a real fix (D-02) in 08-DISCUSSION-LOG, not "no change" |
| ROTATE-11 | 08-02 | `prevepoch` identity validated across chunks | ✓ SATISFIED | Same `groupRotations` consistency guard, `prevEpochs` set check |
| ROTATE-12 | 08-06 | Historical epoch material doesn't inherit tip's `refounder` | ✓ SATISFIED | `held_roots[].refounder` + `buildChain` per-epoch attribution; `guestbook.ts` consumes it |
| ROTATE-13 | 08-06 | Refounding that can't fold whole Control Plane aborts, not partial compaction | ✓ SATISFIED | `buildRefounding` throws before returning wraps on unfoldable head; ruled a real fix (D-01) in 08-DISCUSSION-LOG, not "no change" |

**Note on REQUIREMENTS.md staleness:** The requirement-traceability table (lines 140, 143) still marks ROTATE-10 and ROTATE-13 as "Pending — blocked on spec ruling," but this contradicts the same file's top-of-section checkbox (`[x]`, lines 30/33) and the phase's own `08-DISCUSSION-LOG.md`, which shows both rulings were explicitly resolved during discuss/plan (ROTATE-10 → D-02 consistency-guard; ROTATE-13 → D-01 fail-closed abort — both "a real fix, not no change"). Both plans 08-02 and 08-06 implement and test the ruled fixes, and the code is present and passing. This is a stale traceability-table row in REQUIREMENTS.md, not a missed requirement — flagged for a documentation fix, not a phase gap.

No orphaned requirements: all 9 declared requirement IDs (ROTATE-05..13) are claimed across the 6 plans and match the ROADMAP's declared requirement list for Phase 8 exactly.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/concord/src/client/sync.ts` | syncEpoch re-reads known epochs; syncEpochs down-only cascade; buildChain per-epoch refounder | ✓ VERIFIED | Present, substantive, wired (353 lines) |
| `packages/concord/src/client/channel-sync.ts` | Backward re-read over channel.held | ✓ VERIFIED | Present, substantive, wired (185 lines) |
| `packages/concord/src/client/community.ts` | rekeyHandled Map latch; majority gate in refound() | ✓ VERIFIED | Present, substantive, wired (1359 lines) |
| `packages/concord/src/client/private-channel.ts` | rekeyHandled Map latch (channel scope) | ✓ VERIFIED | Present, substantive, wired (313 lines) |
| `packages/concord/src/helpers/rekey.ts` | isStrictlyLowerKey; groupRotations consistency flag | ✓ VERIFIED | Present, substantive, wired (321 lines) |
| `packages/concord/src/helpers/keys.ts` | readRekeyScoped decrypt/opaque partition + decryptThrew guard; buildRefounding abort | ✓ VERIFIED | Present, substantive, wired (786 lines) |
| `packages/concord/src/helpers/permissions.ts` | vacVerifier | ✓ VERIFIED | Present, substantive, wired (111 lines) |
| `packages/concord/src/operations/rekey.ts` | includeRekeyChunk vac param | ✓ VERIFIED | Present, substantive, wired (39 lines) |
| `packages/concord/src/types.ts` | held_roots[].refounder optional field | ✓ VERIFIED | Present, wired into sync.ts and guestbook.ts |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `sync.ts` syncEpochs walk | `readRekey`/`readRekeyScoped` | Re-read of a known/held epoch's rekey plane | ✓ WIRED | `syncEpoch`'s "known" branch folds via `readRekey`, surfacing `reReadAdopted`; cascade rebuild discards `chain[i+1..]` |
| `community.ts`/`private-channel.ts` live `checkRekey` | `rekeyHandled` latch | `isStrictlyLowerKey(latched, candidate)` | ✓ WIRED | Both scopes gate adoption identically |
| `readRekeyScoped` | `set.complete` filter | `groupRotations.consistent` forces `complete=false` on disagreement | ✓ WIRED | Confirmed at `rekey.ts:265-266` |
| `refound()` publish sequence | `adoptRefounding`/compaction/snapshot | `requireMajority` gate | ✓ WIRED | Rekey wraps gated first; compaction/snapshot/adopt only after all gated wraps clear majority |
| `includeRekeyChunk`/`buildRekeyRumors` | `parseRekey`/`groupRotations` | `vac` tag round-trip | ✓ WIRED | `ParsedRekey.vac`/`RekeyRotationSet.vac` round-trip confirmed by test |
| `readRekeyScoped` verifyVac | `vacVerifier(state, PERM)` | Threaded via `ScopedHeld.verifyVac` at 4 call sites | ✓ WIRED | root walk (`sync.ts`), root live (`community.ts`), channel walk (`channel-sync.ts`), channel live (`private-channel.ts`) |
| `guestbook.ts` snapshot gate | `epochMaterial.refounder` | Per-epoch authorization check | ✓ WIRED | `guestbook.ts:87-89` rejects a snapshot author who isn't that epoch's own refounder |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|---|---|---|---|
| CR-01 regression test (decrypt-throw beside no-blob set defers, never removes) | `vitest run keys.test.ts -t "a transient decrypt failure defers even when a competing no-blob removal set exists"` | 1 passed | ✓ PASS |
| Full concord package suite | `vitest run packages/concord` | 233/233 passed, 45 files | ✓ PASS |
| Phase-touched test files (sync/channel-sync/channel-rekey) | `vitest run sync.test.ts channel-sync.test.ts channel-rekey.test.ts` | 13/13 passed | ✓ PASS |
| Phase-touched test files (community/rekey/keys) | `vitest run community.test.ts rekey.test.ts keys.test.ts` | 62/62 passed | ✓ PASS |

### Anti-Patterns Found

None. Scanned all 9 files modified across the phase's plans (`sync.ts`, `channel-sync.ts`, `community.ts`, `private-channel.ts`, `keys.ts`, `permissions.ts`, `rekey.ts`, `operations/rekey.ts`, `types.ts`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and "not yet implemented"/"not available" — zero matches.

### Code Review Findings (08-REVIEW.md) Cross-Check

| ID | Severity | Status | Verification |
|---|---|---|---|
| CR-01 | Critical | ✓ RESOLVED | Confirmed fixed in `packages/concord/src/helpers/keys.ts` (`decryptThrew` guard, lines 559/581/602), commit `920676ee`. Regression test passes; full suite 233/233 green. |
| WR-01 | Warning | Open (advisory) | Multi-chunk rotation can pass per-wrap majority yet leave no single relay holding a complete rotation (`community.ts:1276-1286`). Not fixed in this phase — per task instructions, advisory/non-blocking. |
| WR-02 | Warning | Open (advisory) | Live `checkRekey` path structurally cannot down-heal an already-adopted epoch (`community.ts:792-800`, `private-channel.ts:287-300`) — confirmed by re-reading the code: `readRekeyScoped` only ever considers `newEpoch === heldEpoch+1`, so once epoch N is adopted, the down-heal branch for N is dead on the live path. This does not invalidate ROADMAP truth #2 or the 08-01 must-have, which are scoped specifically to "a later full sync" (the `syncEpochs` walk cascade) — that cascade path IS live and tested. Advisory/non-blocking per task instructions. |
| WR-03 | Warning | Open (advisory) | `refound` publishes/gates wraps before confirming completeness, scattering partial rotations on abort. Advisory/non-blocking per task instructions. |
| IN-01 | Info | Open (advisory) | Compaction/snapshot publish errors swallowed silently. Advisory/non-blocking. |
| IN-02 | Info | Open (advisory) | `groupRotations` captures `vac` from first-arriving chunk only. Advisory/non-blocking. |

### Human Verification Required

None. All must-haves are verifiable via static analysis and automated test execution; no visual, real-time, or external-service-dependent behavior in scope for this phase.

### Gaps Summary

No gaps. All 9 requirement IDs (ROTATE-05 through ROTATE-13) are implemented, tested, and wired to their real call sites. The one critical issue found by code review (CR-01 — a transient decrypt-throw beside a competing no-blob set caused a false, irreversible removal, contradicting the phase's own D-06 invariant) has been fixed and is confirmed present in the codebase with a passing spec-derived regression test and a green full suite (233/233). The three open warnings (WR-01/02/03) and two info findings from the code review describe real, distinct residual risk areas (multi-chunk majority-gate scatter, live-path down-heal reachability, partial-rotation cleanup) but do not contradict any must-have truth as scoped by this phase's plans and the ROADMAP success criteria — they are correctly left open for future triage rather than blocking this phase.

One documentation inconsistency was found and flagged (not a code gap): `.planning/REQUIREMENTS.md`'s traceability table rows for ROTATE-10/ROTATE-13 say "Pending — blocked on spec ruling," contradicting the same file's requirement checkboxes and the phase's own discussion log showing both rulings resolved to real fixes. This should be corrected in REQUIREMENTS.md but does not affect phase-goal achievement.

---

_Verified: 2026-07-19T15:21:32Z_
_Verifier: Claude (gsd-verifier)_
