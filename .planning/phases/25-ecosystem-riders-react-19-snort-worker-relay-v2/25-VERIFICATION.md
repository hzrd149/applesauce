---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
verified: 2026-09-03T16:25:28Z
status: human_needed
score: 20/20 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 19/20
  gaps_closed:
    - "Per D-06 and D-07, observable replacement immediately adopts the new source, releases and ignores the old source, and routes only active-source errors to a React error boundary."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run both worker-relay routes in a real browser with existing seeded OPFS data and exercise initialization, cache load/live/load-more, database import/search/open/export/clear, recovery controls, responsive overflow, and partial-result retention."
    expected: "Both databases remain queryable without reset, every operation settles, exact recovery controls work, and existing content remains visible after an unrelated operation fails."
    why_human: "Real Web Worker, OPFS persistence, browser layout, and interaction feel cannot be proven by static/build checks."
  - test: "Review the release and CI evidence for the ECO-02 transparency prohibition."
    expected: "React 19 evidence does not replace or weaken the React 18 consumer contract; the dual-major peer and both CI legs remain required."
    why_human: "The PLAN prohibition is explicitly flagged unverified and requires authoritative human judgment."
  - test: "Open both routes against pre-migration OPFS data and review the ECO-03 preservation prohibition."
    expected: "Neither database is cleared, renamed, or silently replaced during v2 initialization."
    why_human: "Static inspection finds no reset shortcut, but only a browser persistence check can prove dependency-owned migration behavior."
  - test: "Inspect both rendered routes during initialization and after success/failure for the ECO-03 transparency prohibition."
    expected: "No decorative dependency-version UI or page-blocking migration screen appears."
    why_human: "The PLAN prohibition is explicitly flagged unverified and requires authoritative human judgment."
---

# Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2 Verification Report

**Phase Goal:** `applesauce-react`'s already-declared React 19 support is backed by real tests, and `apps/examples` runs on the current `@snort/worker-relay` major — both fully independent of the relay re-layering.
**Verified:** 2026-09-03T16:25:28Z
**Status:** human_needed
**Re-verification:** Yes — after Plan 25-05 gap closure

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | The same rendering suite is used with separately installed matching-major React 18 and 19 runtime/type sets. | ✓ VERIFIED | `.github/workflows/test.yml:51-79` defines `react-major: [18, 19]`, swaps all four packages in one command, and runs the identical unfiltered package suite. |
| 2 | The workspace uses React 19 while the published peer accepts React 18 and 19. | ✓ VERIFIED | `packages/react/package.json` has React/type dev ranges `^19.0.0` and peer `^18.0.0 || ^19.0.0`. |
| 3 | The examples declare matching React 19 runtime/type ranges and build from the committed install. | ✓ VERIFIED | All four manifest ranges remain `^19.0.0`; prior build evidence remains consistent with the unchanged manifests and lockfile. |
| 4 | `useObservableState` proves synchronous initial and delayed asynchronous values. | ✓ VERIFIED | Renderer tests at `use-observable-state.test.tsx:15-29`; independently run package suite passed 16/16. |
| 5 | Replacement immediately adopts the new observable, rejects stale signals, and routes only active errors. | ✓ VERIFIED | Plan 25-05 moved retained subscription ownership to `useIsomorphicLayoutEffect` at `use-observable-state.ts:97-154`. The ordered-sibling regression at `use-observable-state.test.tsx:48-83` asserts consumer layout → emitter layout → passive ordering and renders the same-commit hot value. The independently run package suite passed 16/16. |
| 6 | Unmount, replacement, and Strict Mode release subscriptions exactly once with none active. | ✓ VERIFIED | Renderer regression at `use-observable-state.test.tsx:126-138` remains present and passed in the package suite after the lifecycle move. |
| 7 | Provider hooks preserve exact missing-provider, optional access, replacement, and nested-provider behavior. | ✓ VERIFIED | `providers.test.tsx` still imports and exercises all three public hooks; its tests passed in the independently run package suite. |
| 8 | CI independently checks React 18 and 19 with the same applesauce-react suite. | ✓ VERIFIED | Dedicated two-leg job remains wired at `.github/workflows/test.yml:51-79`; no major-specific selection exists. |
| 9 | Both examples target worker-relay v2, omit `insertBatchSize`, and contain no promise-dependent `setEventMetadata`. | ✓ VERIFIED | Manifest remains `^2.0.1`; direct scan of both worker-relay modules finds neither removed option nor promise-dependent metadata calls. |
| 10 | Cache route retains database name, live toggle, load-more, stats, notes, results, and no migration reset. | ✓ VERIFIED | Quick regression check confirms `cache-relay.db` and the existing worker-backed route remain substantive. |
| 11 | Database route retains database name and import/export/clear/search/detail flows; Open actions are labelled. | ✓ VERIFIED | Quick regression check confirms `relay.db`, substantive CRUD/search flows, and `aria-label="Open Event"`. |
| 12 | Required empty-state text is present in the documented contexts. | ✓ VERIFIED | Exact notes, searched-empty, and database-empty strings remain present behind their route predicates. |
| 13 | Loading is operation-scoped and initialization settles to content or visible failure. | ✓ VERIFIED | Previously verified implementation files are unchanged by Plan 25-05; quick sanity check finds both worker routes substantive. |
| 14 | Worker and cache failures show exact recovery copy and controls. | ✓ VERIFIED | Exact `Reload Example` and `Try Again` controls remain in both route components. |
| 15 | Database failures and validation errors show the exact specified copy/actions. | ✓ VERIFIED | Exact retry controls remain present; previously verified handling files are unchanged. |
| 16 | Successful/partial data preserves rendered content, stable keys, interactions, and containment. | ✓ VERIFIED | Previously verified worker route implementations are unchanged by the gap closure. Visual/browser behavior remains a human check. |
| 17 | Stamp documentation matches its non-enumerable cache behavior. | ✓ VERIFIED | Previously verified source and regression are unchanged by Plan 25-05. |
| 18 | `lockWallet` clears relay metadata with the other decrypted caches. | ✓ VERIFIED | Previously verified source and regression are unchanged by Plan 25-05. |
| 19 | App-data parsing preserves valid falsy JSON and distinguishes parse failure with `undefined`. | ✓ VERIFIED | Previously verified source and regressions are unchanged by Plan 25-05. |
| 20 | Each folded change has one package-scoped, one-sentence patch changeset. | ✓ VERIFIED | The three previously verified changesets remain present and unchanged. |

**Score:** 20/20 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact group | Expected | Status | Details |
|---|---|---|---|
| `use-observable-state.ts` | Gapless retained replacement lifecycle | ✓ VERIFIED | Exists, substantive, exported through the existing public hook path, and replacement setup/cleanup executes in the isomorphic layout-effect lifecycle. |
| `use-observable-state.test.tsx` | Direct CR-01 behavioral regression | ✓ VERIFIED | Exists, substantive, imports the public hook, drives real React commits, asserts phase ordering, and passes. |
| React manifests, lockfile, renderer suites, and CI | Dual-major React contract | ✓ VERIFIED | Quick regression check confirms React 19 baseline, dual-major peer, matching-major CI swap, and identical suite command. |
| Worker-relay example manifest/modules | v2 integration for both OPFS examples | ✓ VERIFIED | Quick regression check confirms v2 range, supported init options, real database names, and substantive routes. |
| Folded correctness source/tests/changesets | Three isolated follow-ups | ✓ VERIFIED | Previously passed artifacts remain present with no Plan 25-05 regression. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Hook consumer | Hot replacement source | retained subscription created in isomorphic layout effect before later sibling layout emission | ✓ WIRED | Source lines 97-154 and ordered-sibling regression lines 48-83 close and exercise CR-01's exact window. |
| Active observable identity | value/error callbacks | `state$Ref.current === state$` gates | ✓ WIRED | Stale-source isolation remains at source lines 129-139; existing stale value/error tests pass. |
| React CI matrix | applesauce-react renderer suite | one matching-major dependency swap and identical package test command | ✓ WIRED | Both majors execute the same suite. |
| Example routes | worker-relay v2 | worker imports and `WorkerRelayInterface.init` | ✓ WIRED | Both OPFS database names remain connected to real query/persistence flows. |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|---|---|---|---|---|
| `useObservableState` | rendered observable value/error | active RxJS subscription callbacks | Yes | ✓ FLOWING — same-commit replacement value reaches React state in the regression. |
| Cache worker route | notes/stats/saved ids | worker query, RelayPool, EventStore observables | Yes | ✓ FLOWING |
| Database worker route | search results/import stats/detail | worker-backed `IAsyncEventDatabase` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| React renderer suite including CR-01 regression | `pnpm --filter applesauce-react test -- -t "subscribes to a replacement before a later sibling emits in the same commit"` | Vitest executed the package suite: 7 files, 16 tests passed | ✓ PASS |
| React 18/19 compatibility | committed CI matrix plus Plan 25-05 commit evidence | Same unfiltered suite command is wired in both legs; closure commits `068a81a6`, `3a106104`, and `61a878e2` exist | ✓ PASS |
| Worker-relay v2 call-site contract | manifest/source scan | `^2.0.1`; no `insertBatchSize` or promise-dependent `setEventMetadata` at either call site | ✓ PASS |

### Probe Execution

No Phase 25 probe scripts were declared or discovered; Step 7c is not applicable.

### Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
|---|---|---|---|---|
| ECO-02 | 25-01, 25-02, 25-04, 25-05 | Rendering evidence under React 18/19 for hooks/providers | ✓ SATISFIED | The former D-06 blocker now has a production layout-lifecycle fix and a passing ordered-sibling behavioral regression; the dual-major CI contract remains wired. |
| ECO-03 | 25-03, 25-04 | Worker-relay v2 migration at both example call sites | ✓ SATISFIED | v2 range, removed-option absence, synchronous metadata audit, and both substantive adapters remain intact. |

No additional Phase 25 requirement IDs are orphaned in `REQUIREMENTS.md`. Both ECO-02 and ECO-03 are claimed by plans. `REQUIREMENTS.md` still labels their phase tracking as `Gaps Found` (and ECO-03's checkbox is unchecked), which is stale planning metadata rather than contradictory code evidence and should be reconciled by the orchestrator after human verification.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `apps/examples/src/routes/example.tsx` | 34-50 | Async route loads lack reset/cancellation/rejection handling (25-REVIEW WR-01) | ⚠️ Warning | Rapid navigation can install stale example state or leave stale/spinner UI; this remains advisory and outside ECO-02/ECO-03 and the Phase 25 must-haves. |

No unreferenced `TBD`, `FIXME`, or `XXX` marker was found in the Plan 25-05 implementation files. CR-01's former passive-effect subscription anti-pattern is no longer present.

### Human Verification Required

#### 1. Worker/OPFS end-to-end smoke

**Test:** Run both worker-relay routes in a real browser with existing seeded OPFS data; exercise initialization, cache load/live/load-more, database import/search/open/export/clear, retries, responsive overflow, and partial-result retention.
**Expected:** Both databases remain queryable without reset, every operation settles, exact recovery controls work, and existing content remains visible after an unrelated operation fails.
**Why human:** Real Web Worker, OPFS persistence, browser layout, and interaction feel cannot be proven by static/build checks.

#### 2. ECO-02 transparency prohibition

**Test:** Review the release/CI evidence and confirm React 19 evidence does not replace or weaken the React 18 consumer contract.
**Expected:** The dual-major peer remains published and both CI legs remain required.
**Why human:** This PLAN prohibition is explicitly flagged unverified and requires authoritative human judgment.

#### 3. ECO-03 OPFS preservation prohibition

**Test:** Open both routes against pre-migration OPFS data.
**Expected:** Neither database is cleared, renamed, or silently replaced.
**Why human:** Static inspection finds no reset shortcut, but only a browser persistence check can prove dependency-owned migration behavior.

#### 4. ECO-03 transparency prohibition

**Test:** Inspect both rendered routes during initialization and after success/failure.
**Expected:** No decorative dependency-version UI or page-blocking migration screen appears.
**Why human:** This PLAN prohibition is explicitly flagged unverified and requires authoritative human judgment.

### Gaps Summary

Plan 25-05 closes the only prior automated blocker. The production hook now creates and cleans retained replacement subscriptions during the isomorphic layout phase, and the ordered-sibling renderer test exercises the exact deterministic interval that previously lost hot values. Stale-source identity gates, active error routing, and exact teardown regressions remain green. ECO-02 and ECO-03 are satisfied in code.

The report remains `human_needed` because the browser/OPFS flow and three explicitly flagged prohibitions require authoritative human confirmation. There are no remaining structured implementation gaps and no later-phase deferrals.

---

_Verified: 2026-09-03T16:25:28Z_
_Verifier: the agent (gsd-verifier)_
