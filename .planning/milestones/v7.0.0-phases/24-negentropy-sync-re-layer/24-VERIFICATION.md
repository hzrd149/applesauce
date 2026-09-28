---
phase: 24-negentropy-sync-re-layer
verified: 2026-09-02T18:15:00Z
status: passed
score: 18/18 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 17/18
  gaps_closed:
    - "STATE.md consistently records the current Phase 24 completion position."
  gaps_remaining: []
  regressions: []
resolved_gaps:
  - truth: "Canonical requirements provenance records SYNC-01 through SYNC-04 and RESID-03 as completed."
    status: resolved
    reason: "The implementation and all gates satisfy the requirements, but REQUIREMENTS.md still leaves all five checkboxes unchecked and its traceability table marks all five Pending, contradicting Plan 09's claimed canonical amendment and completed summaries."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "Lines 57-60 and 80 remain unchecked; lines 160-163 and 174 remain Pending."
      - path: ".planning/phases/24-negentropy-sync-re-layer/24-09-SUMMARY.md"
        issue: "Claims Requirements was amended and requirements-completed includes all five IDs, but the canonical file disagrees."
    missing:
      - "Mark SYNC-01, SYNC-02, SYNC-03, SYNC-04, and RESID-03 complete in the canonical requirement list and traceability table."
      - "Re-run the provenance gate and ensure the canonical status agrees with the implemented/tested contract."
---

# Phase 24: Negentropy & Sync Re-layer Verification Report

**Phase Goal:** Multi-round negentropy reaches the wire at protocol speed while `sync()` owns coherent auth, reconnect, bounded transfers, cancellation, and honest bidirectional outcomes without a built-in timeout.
**Verified:** 2026-09-02T18:15:00Z
**Status:** passed
**Re-verification:** Yes — canonical requirements and exceptional metadata-only STATE closure verified

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Raw negentropy is one cold shared readiness-aware Observable that emits every decoded round. | ✓ VERIFIED | `negentropy.ts:55-120`; raw tests cover readiness, sharing, empty/terminal rounds, and teardown. |
| 2 | Genuine >32-item reconciliation writes the follow-up NEG-MSG and completes a second round. | ✓ VERIFIED | Real multi-round test passes; mutation 1 deletes the write and causally times out RED. |
| 3 | Each follow-up write occurs before round emission and subscriber work cannot delay the protocol. | ✓ VERIFIED | `negentropy.ts:100-107`; synchronous ordering test passes; mutation 2 fails the wire-count oracle RED. |
| 4 | Raw termination/errors/cancellation are exact, including premature upstream completion. | ✓ VERIFIED | Terminal flag and typed premature-completion error at `negentropy.ts:80,102,108-115`; abort/unsubscribe/exact NEG-CLOSE tests and review-fix test pass. |
| 5 | Raw options are only id/frameSizeLimit/signal; raw Group/Pool negentropy surfaces are removed. | ✓ VERIFIED | Positive declarations and `sync-types.ts` negative compiler checks pass. |
| 6 | Sync owns one global auth gate/counter across NEG/EVENT/REQ. | ✓ VERIFIED | Call-scoped coordinator at `relay.ts:1694-1716`; global-budget integration test passes; mutation 6 produces excess EVENT subscriptions RED. |
| 7 | Only positive unclean transport failures reconnect and every retry has fresh protocol/attempt state. | ✓ VERIFIED | Negotiation `defer` creates new state/ID at `relay.ts:1835-1849`; mutation 7 catches ID reuse; terminal errors remain non-retryable. |
| 8 | Reconnect discards queued and in-flight work from the failed generation. | ✓ VERIFIED | Generation-owned controller/queues at `relay.ts:1721-1769`; review-fix tests prove queued work never starts and late stale settlements do not emit. |
| 9 | One fair global concurrency-four scheduler preserves per-lane FIFO and prevents starvation. | ✓ VERIFIED | Scheduler at `relay.ts:1799-1828`; concurrency/fairness tests pass; mutations 4/5 causally exceed four/starve RECEIVE. |
| 10 | Negotiation advances at protocol speed while transfers run, then drains before completion. | ✓ VERIFIED | Round work is enqueued without awaiting; blocked-transfer round-two test passes; mutation 3 withholds round two RED. |
| 11 | Exact SyncMessage values honestly report received, sent, and send-failed outcomes. | ✓ VERIFIED | Discriminated union and scheduler mapping preserve response/error identity; negative and thrown SEND tests pass. |
| 12 | Writable/read-only store behavior and zero-event EOSE semantics are correct. | ✓ VERIFIED | Receive path tests cover post-write emission, read-only emission, terminal write rejection, and successful empty EOSE without EmptyError. |
| 13 | Group and Pool isolate/attribute relay failure and track current dynamic membership. | ✓ VERIFIED | `group.ts:510-584` tracks normalized instance/token subscriptions; review-fix tests cover removal, replacement, late stale signals, and observable-controlled groups; Pool delegates unchanged. |
| 14 | Loader non-auth fallback closes open auth phases before fallback subscription. | ✓ VERIFIED | Loader test “re-arms fallback timeout” passes in the 130-test loader suite; auth-family failures still bypass fallback. |
| 15 | Public types, exports, docs, examples, changesets, and Phase 13 supersession match the new contract. | ✓ VERIFIED | Type/export tests, docs build, live inventory, release notes, and historical RESID-03 amendments all pass inspection/gates. |
| 16 | All seven deliberate mutations have exact causal RED and restored GREEN evidence. | ✓ VERIFIED | `24-06-SUMMARY.md` and `24-07-SUMMARY.md` record exact diffs, named commands, exit 1 symptoms, identical exit 0 reruns, residue gates, and removed detached worktrees; all named oracles pass in the independent full run. |
| 17 | Canonical requirement completion state matches verified implementation. | ✓ VERIFIED | All five Phase 24 IDs are checked and their traceability rows are Complete in `REQUIREMENTS.md`. |
| 18 | Project state consistently records the current Phase 24 completion position. | ✓ VERIFIED | `STATE.md` frontmatter and body consistently record Phase 24, 11/11 complete, verified complete, and ready for—but not transitioned to—Phase 25. |

**Score:** 18/18 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/relay/src/negentropy.ts` | Multi-round raw engine | ✓ VERIFIED | Substantive, cold/shared, serial, write-before-emit, typed premature completion. |
| `packages/relay/src/relay.ts` | Sync coordinator/scheduler/results | ✓ VERIFIED | Auth, retry, fresh generations, fair bounded scheduling, cancellation, and outcome mapping are wired. |
| `packages/relay/src/group.ts` | Current-membership attributed sync | ✓ VERIFIED | Instance/token tracking cancels removed/replaced work and ignores stale signals. |
| `packages/relay/src/pool.ts` | Group forwarding | ✓ VERIFIED | Direct derived delegation. |
| `packages/relay/src/types.ts` / `sync-types.ts` | Exact public contracts | ✓ VERIFIED | Positive/negative type fixture passes. |
| `packages/loaders/src/loaders/sync-loader.ts` | Fallback residual closure | ✓ VERIFIED | Force-closes auth before non-auth fallback and consumes structural result union. |
| Docs/examples | Current Observable/result/lifetime guidance | ✓ VERIFIED | No completion-means-upload-success guidance; send failures and caller-owned lifetime are explicit. |
| Phase 24 changesets | Separate exact release records | ✓ VERIFIED | Relay negentropy major, relay sync major, loader fallback patch are one-sentence notes. |
| `.planning/REQUIREMENTS.md` | Canonical completion/provenance | ✓ VERIFIED | Contract text is unchanged and all five Phase 24 completion markers agree with verified evidence. |
| `.planning/STATE.md` | Consistent current position | ✓ VERIFIED | Frontmatter and body agree on Phase 24 verified completion and no Phase 25 transition. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `Relay.negentropy()` | protocol engine | Observable raw rounds | ✓ WIRED | Follow-up reaches socket before values. |
| `Relay.sync()` | NEG/EVENT/REQ | shared auth coordinator and scheduler | ✓ WIRED | One counter/gate spans all branches. |
| Group/Pool | Relay sync | attributed current-membership fan-out | ✓ WIRED | `relay-failed` values preserve sibling progress. |
| Loader | Relay/Pool sync | structural union and fallback transition | ✓ WIRED | Receives only `received` events and re-arms fallback clock. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Focused raw/sync/Relay/Group/Pool/export | six focused files | 293 tests passed | ✓ PASS |
| Full relay suite | `pnpm --filter applesauce-relay test` | 16 files, 408 tests passed | ✓ PASS |
| Full loader suite | `pnpm --filter applesauce-loaders test` | 16 files, 130 tests passed | ✓ PASS |
| Relay types | explicit type-test project | exit 0 | ✓ PASS |
| Relay/loaders/docs/workspace builds | package builds + VitePress + Turbo | 14/14 packages successful | ✓ PASS |
| Dependency integrity | manifest/lockfile diff gate | exit 0 | ✓ PASS |
| Review fixes | premature completion, reconnect generation isolation, dynamic Group membership | all targeted tests included in green suites | ✓ PASS |

### Probe Execution

No conventional probe scripts are declared. The seven isolated mutation runs are the phase-specific adversarial probes and have complete reproducible RED→GREEN records.

### Requirements Coverage

| Requirement | Implementation Status | Canonical Status | Evidence |
|---|---|---|---|
| SYNC-01 | ✓ SATISFIED | ✓ Complete | Genuine multi-round wire test and mutation 1. |
| SYNC-02 | ✓ SATISFIED | ✓ Complete | Write-before-emit/nonblocking round tests and mutations 2/3. |
| SYNC-03 | ✓ SATISFIED | ✓ Complete | Global auth, fresh reconnect, fair concurrency, cancellation, no timeout. |
| SYNC-04 | ✓ SATISFIED | ✓ Complete | Explicit sent/send-failed/received/relay-failed results. |
| RESID-03 | ✓ SATISFIED | ✓ Complete | Loader fallback timer and zero-event EOSE tests. |

No requirement is orphaned; canonical statuses now match verified implementation evidence.

### Anti-Patterns Found

No unreferenced TBD/FIXME/XXX markers, timeout option leak, callback-era public surface, silent SEND swallow, production stub, or contradictory workflow metadata remains.

### Human Verification Required

None. Runtime behavior and remaining provenance correction are deterministic.

### Gaps Summary

The Phase 24 runtime goal is achieved, all seven mutation oracles are non-vacuous, all three review defects are fixed, every executable gate passes, canonical requirements are complete, and STATE consistently records Phase 24 verified completion without transitioning to Phase 25.

---

_Re-verified: 2026-09-02T18:15:00Z_
_Verifier: the agent (gsd-verifier)_
