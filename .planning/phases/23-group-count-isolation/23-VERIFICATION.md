---
phase: 23-group-count-isolation
verified: 2026-09-01T23:57:00Z
status: gaps_found
score: 10/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Published COUNT guidance consistently describes progressive per-relay outcomes and safe HLL aggregation."
    status: failed
    reason: "The primary Count documentation contradicts the implemented Phase 23 contract by claiming Group/Pool remain all-or-nothing and partial records are deferred to Phase 23."
    artifacts:
      - path: "apps/docs/loading/relays/pool.md"
        issue: "Line 227 states the obsolete all-or-nothing/deferred behavior immediately after the new progressive guidance."
    missing:
      - "Remove the stale all-or-nothing bullet or replace it with current progressive/isolation guidance."
      - "Add a docs content gate that rejects this stale phrase, then rebuild docs."
  - truth: "23-VALIDATION.md truthfully reconciles every task and final sign-off."
    status: failed
    reason: "Frontmatter says complete/nyquist compliant, but 10 task rows remain pending, the sign-off instruction is unchecked, and Approval still says pending."
    artifacts:
      - path: ".planning/phases/23-group-count-isolation/23-VALIDATION.md"
        issue: "Internal status fields and evidence rows contradict one another."
    missing:
      - "Reconcile every pending row from actual executed evidence."
      - "Check the final completion item and set Approval consistently only after all rows pass."
---

# Phase 23: Group count() Isolation Verification Report

**Phase Goal:** One failing/offline relay costs only its own count, and cumulative results arrive as each relay settles.
**Verified:** 2026-09-01T23:57:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification after review fixes

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Static cohorts emit fresh cumulative snapshots progressively in membership order. | ✓ VERIFIED | `group.ts:450-530`; focused fast/slow test observes one-key then two-key snapshots. |
| 2 | Every scalar success/failure becomes that normalized URL's identity-preserved `RelayOutcome`; inner failures never terminate peers. | ✓ VERIFIED | Per-relay `defer` and `settle` at `group.ts:498-513`; offline/success test and full suite pass. |
| 3 | Synchronous construction errors and transport/auth/refusal/malformed failures are isolated while membership/invariant errors remain outer errors. | ✓ VERIFIED | Scalar call is deferred and inner error materialized; membership error is forwarded at `group.ts:517`; focused matrix passes. |
| 4 | Dynamic replacement/removal/re-add/duplicate URLs use latest normalized membership and reject stale callbacks. | ✓ VERIFIED | Instance+token tracking at `group.ts:459,475-505`; adversarial tests, including same-URL replacement, pass. |
| 5 | Empty retractions never leak `{}` or stale replay state. | ✓ VERIFIED | Private `EMPTY_RETRACTION` overwrites replay at `group.ts:455-456,495,529`; review-fix tests cover active empty retraction and terminal empty replay. |
| 6 | Membership completion/error and last-unsubscribe cancel or settle correctly. | ✓ VERIFIED | Completion calls common settlement at `group.ts:518`; teardown cancels membership/inners; EMPTY and pending-after-complete tests pass. |
| 7 | Concurrent/late subscribers share one execution and replay latest/final state without duplicate COUNTs. | ✓ VERIFIED | ReplaySubject share configuration at `group.ts:525-527`; replay/ref-count tests pass. |
| 8 | Scalar Relay COUNT policy, exact filters/ID/options, concurrency, and independent per-relay policy are unchanged. | ✓ VERIFIED | Group forwards exact arguments at `group.ts:510`; Group/Pool integration and auth policy tests pass. |
| 9 | Pool and public types preserve the Group progressive contract without translation. | ✓ VERIFIED | `pool.ts:236-243` returns `ReturnType<RelayGroup["count"]>`; type fixture narrows shared `RelayOutcome`; Pool tests pass. |
| 10 | HLL guidance explains reduced coverage and forbids naive summation/zero substitution. | ✓ VERIFIED | `pool.md:205-226` shows compatible-sketch union and explicit coverage caveats. |
| 11 | Published docs consistently describe current progressive isolation. | ✗ FAILED | `pool.md:227` says Group/Pool remain all-or-nothing and partial records are deferred, directly contradicting lines 192-203 and production behavior. |
| 12 | Final Nyquist validation is internally reconciled. | ✗ FAILED | `23-VALIDATION.md` claims complete while most task rows and final approval remain pending. |

**Score:** 10/12 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/relay/src/group.ts` | Progressive accumulator and dynamic replay lifecycle | ✓ VERIFIED | Substantive, wired, and behaviorally covered, including all three review fixes. |
| `packages/relay/src/types.ts` | Shared `RelayCountOutcomes` alias | ✓ VERIFIED | Reuses `RelayOutcome<RelayCountResponse>`. |
| `packages/relay/src/pool.ts` | Derived facade | ✓ VERIFIED | Direct delegation; no mapping/catch/combine layer. |
| `packages/relay/src/__tests__/group-count.test.ts` | Edge/review-fix behavior | ✓ VERIFIED | Includes progression, isolation, empty replay, active retraction, same-URL replacement, and membership-completion cases. |
| `packages/relay/type-tests/group-count-types.ts` | Narrowing and Pool parity | ✓ VERIFIED | Included in explicit type project and passes. |
| `apps/docs/loading/relays/pool.md` | Current COUNT/HLL guidance | ✗ CONTRADICTORY | Correct progressive section followed by stale all-or-nothing bullet. |
| `.changeset/relay-group-count-progressive.md` | Exact major release record | ✓ VERIFIED | One package, major, one sentence. |
| `23-VALIDATION.md` | Reconciled evidence | ✗ INCONSISTENT | Complete frontmatter conflicts with pending rows and approval. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Group accumulator | scalar `Relay.count()` | deferred exact filters/id/options | ✓ WIRED | Independent calls start and settle separately. |
| Group outcomes | shared types | `RelayCountOutcomes` / `RelayOutcome` | ✓ WIRED | One Phase 21 representation is reused. |
| Pool | Group | `ReturnType` + direct delegation | ✓ WIRED | No translation or behavior fork. |
| Docs | implementation | progressive/HLL guidance | ✗ PARTIAL | Main explanation matches; stale best-practice bullet reverses it. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Focused count/Group/Pool/export | `vitest run group-count.test.ts group.test.ts pool.test.ts exports.test.ts` | 4 files, 69 tests passed | ✓ PASS |
| Full relay regression | `pnpm --filter applesauce-relay test` | 14 files, 387 tests passed | ✓ PASS |
| Public types | `tsc -p tsconfig.type-tests.json --noEmit` | exit 0 | ✓ PASS |
| Relay/docs/workspace builds | relay build, VitePress, Turbo packages | 14/14 workspace packages successful | ✓ PASS |
| Dependency integrity | manifest/lockfile diff gate | exit 0 | ✓ PASS |
| Historical `combineLatest` mutation | Recorded exact named command in `23-04-SUMMARY.md` | RED withheld partial + escaped inner error; restored GREEN | ✓ PASS |

### Probe Execution

No Phase 23 probe scripts are declared or present. The required adversarial probe is the documented `combineLatest` RED→GREEN mutation.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| COUNT-04 | ✓ SATISFIED | Per-relay failures materialize while peers continue across Group and Pool. |
| COUNT-05 | ✓ SATISFIED | Fresh cumulative snapshots emit on each settlement and replay correctly. |

No Phase 23 requirement is orphaned. The blocking gaps are release/documentation truthfulness and validation reconciliation, not missing core runtime behavior.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `apps/docs/loading/relays/pool.md` | 227 | Stale deferred/all-or-nothing claim | 🛑 Blocker | Publishes the opposite of the shipping API contract. |
| `23-VALIDATION.md` | frontmatter/rows/sign-off | Premature completion state | 🛑 Blocker | Makes phase evidence non-auditable. |

No TBD/FIXME/XXX markers or production stubs were found.

### Human Verification Required

None. Both gaps are deterministic documentation/evidence defects.

### Gaps Summary

The runtime goal is achieved and all executable code gates pass, including the three review-fix edge cases. Phase 23 cannot pass yet because its primary documentation still publishes the old all-or-nothing behavior and its validation record claims completion while retaining pending evidence and approval.

---

_Verified: 2026-09-01T23:57:00Z_
_Verifier: the agent (gsd-verifier)_
