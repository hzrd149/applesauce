---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
verified: 2026-09-03T15:46:00Z
status: gaps_found
score: 19/20 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Per D-06 and D-07, observable replacement immediately adopts the new source, releases and ignores the old source, and routes only active-source errors to a React error boundary."
    status: failed
    reason: "useObservableState updates the active-source identity in a layout effect but does not subscribe to the replacement until a later passive effect, leaving a window in which hot-source values are lost; the committed replacement test flushes effects before emitting and does not exercise this window."
    artifacts:
      - path: "packages/react/src/hooks/use-observable-state.ts"
        issue: "Replacement subscription is created in useEffect at lines 98-154 after state$Ref changes in the preceding layout effect at lines 93-95."
      - path: "packages/react/src/hooks/__tests__/use-observable-state.test.tsx"
        issue: "The replacement test emits only after Testing Library rerender returns, so it cannot detect same-commit layout-effect emissions."
    missing:
      - "Subscribe to and clean up replacement observables without a commit-to-passive-effect gap."
      - "Add a regression that emits from the replacement source during the same commit's layout-effect phase."
---

# Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2 Verification Report

**Phase Goal:** `applesauce-react`'s declared React 19 support is backed by real tests, `apps/examples` runs on `@snort/worker-relay` v2, and the folded Phase 05.1 correctness follow-ups are closed.
**Verified:** 2026-09-03T15:46:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | The same rendering suite is used with separately installed matching-major React 18 and 19 runtime/type sets. | ✓ VERIFIED | `.github/workflows/test.yml:51-79` defines `react-major: [18, 19]`, swaps all four packages in one command, and runs the identical unfiltered package suite. |
| 2 | The workspace uses React 19 while the published peer accepts React 18 and 19. | ✓ VERIFIED | `packages/react/package.json` has React/type dev ranges `^19.0.0` and peer `^18.0.0 || ^19.0.0`; the lock resolves the React package importer to 19.2.8. |
| 3 | The examples declare matching React 19 runtime/type ranges and build from the committed install. | ✓ VERIFIED | All four ranges are `^19.0.0`; `pnpm --filter applesauce-examples build` passed. |
| 4 | `useObservableState` proves synchronous initial and delayed asynchronous values. | ✓ VERIFIED | Renderer tests at `use-observable-state.test.tsx:15-29`; independently run applesauce-react suite passed 15/15. |
| 5 | Replacement immediately adopts the new observable, rejects stale signals, and routes only active errors. | ✗ FAILED | `use-observable-state.ts:93-107` changes the identity during layout but subscribes in the passive effect. A hot replacement emission during that interval is lost. Existing test emits after `rerender` flushes effects. This is CR-01 and violates D-06 replacement semantics. |
| 6 | Unmount, replacement, and Strict Mode release subscriptions exactly once with none active. | ✓ VERIFIED | Renderer regression at `use-observable-state.test.tsx:89-100` exercises replacement/unmount under `StrictMode`; suite passes. |
| 7 | Provider hooks preserve exact missing-provider, optional access, replacement, and nested-provider behavior. | ✓ VERIFIED | `providers.test.tsx:20-82` consumes all three public hooks and covers exact errors, optional account access, replacement, nearest-provider resolution, and outer reveal; suite passes. |
| 8 | CI independently checks React 18 and 19 with the same applesauce-react suite. | ✓ VERIFIED | Dedicated two-leg job in `.github/workflows/test.yml:51-79`; no major-specific test selection. |
| 9 | Both examples target worker-relay v2, omit `insertBatchSize`, and contain no promise-dependent `setEventMetadata`. | ✓ VERIFIED | Manifest is `^2.0.1`, lock resolves 2.0.1, both init calls contain only `databasePath`, repository scan finds neither removed option nor `setEventMetadata`; examples build passes. |
| 10 | Cache route retains database name, live toggle, load-more, stats, notes, results, and no migration reset. | ✓ VERIFIED | `cache-relay.db` flows through the initialized worker; existing cache/query/event persistence paths and UI controls remain wired. |
| 11 | Database route retains database name and import/export/clear/search/detail flows; Open actions are labelled. | ✓ VERIFIED | `relay.db` feeds `WorkerRelayEventDatabase`; CRUD and UI handlers are wired; `aria-label="Open Event"` exists. |
| 12 | Required empty-state text is present in the documented contexts. | ✓ VERIFIED | Exact `No notes found`, searched-empty, and database-empty strings exist behind their respective state predicates. |
| 13 | Loading is operation-scoped and initialization settles to content or visible failure. | ✓ VERIFIED | Worker readiness has ready/failed branches on both routes; async operation handlers use `finally` to clear `isLoading`. Browser feel remains a human check. |
| 14 | Worker and cache failures show exact recovery copy and controls. | ✓ VERIFIED | Exact worker failure/`Reload Example` and cache failure/`Try Again` paths are wired in both route components. |
| 15 | Database failures and validation errors show the exact specified copy/actions. | ✓ VERIFIED | Exact search/import/clear messages and retry dispatch exist; validation messages remain non-retry errors. |
| 16 | Successful/partial data preserves rendered content, stable keys, interactions, and containment. | ✓ VERIFIED | Result arrays are retained on caught operations, lists key events/notes by id, and detail/result render paths are substantive. Visual/responsive behavior remains a human check. |
| 17 | Stamp documentation matches its non-enumerable cache behavior. | ✓ VERIFIED | Comment describes `setCachedValue` behavior and existing spread regression passes in the focused core test. |
| 18 | `lockWallet` clears relay metadata with the other decrypted caches. | ✓ VERIFIED | `wallet.ts:141-146` deletes all three symbols at one boundary; focused regression passes. |
| 19 | App-data parsing preserves valid falsy JSON and distinguishes parse failure with `undefined`. | ✓ VERIFIED | Explicit `===/!== undefined` checks cover plaintext/decrypted paths; false/0/null/empty-string and invalid JSON tests pass. |
| 20 | Each folded change has one package-scoped, one-sentence patch changeset. | ✓ VERIFIED | Three separate changesets each name one package at patch level and contain one Markdown sentence. |

**Score:** 19/20 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact group | Expected | Status | Details |
|---|---|---|---|
| React manifests and lockfile | React 19 baseline plus dual-major peer contract | ✓ VERIFIED | Substantive and consumed by workspace/CI. |
| React renderer fixtures/tests | Hook and provider runtime evidence | ✓ VERIFIED | Imported, renderer-backed, and passing; replacement-gap oracle is incomplete. |
| React CI job | Isolated matching-major 18/19 checks | ✓ VERIFIED | Matrix and identical suite command are wired. |
| Worker-relay example manifest/modules | v2 integration for both OPFS examples | ✓ VERIFIED | Build passes and both modules use real worker/query/persistence flows. |
| Folded correctness source/tests/changesets | Three isolated follow-ups | ✓ VERIFIED | Implementations and focused tests pass; changesets meet repository format. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| React CI matrix | applesauce-react renderer suite | one dependency swap and identical `pnpm --filter applesauce-react test` | ✓ WIRED | Both majors execute the same suite. |
| Renderer tests | public hooks/providers | direct public imports and Testing Library renders | ✓ WIRED | Tests exercise actual React commits, not context internals. |
| Example routes | worker-relay v2 | worker entry imports and `WorkerRelayInterface.init` | ✓ WIRED | Both database names feed live query/persistence adapters. |
| `lockWallet` | decrypted caches | adjacent `Reflect.deleteProperty` calls | ✓ WIRED | Relay cache is cleared with private-key and mint caches. |
| `getAppDataContent` | safeParse failure sentinel | explicit undefined comparisons | ✓ WIRED | Valid falsy values reach the non-enumerable cache. |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|---|---|---|---|---|
| Cache worker route | notes/stats/saved ids | worker query, RelayPool, EventStore observables | Yes | ✓ FLOWING |
| Database worker route | search results/import stats/detail | worker-backed `IAsyncEventDatabase` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| React renderer suite | `pnpm --filter applesauce-react test` | 7 files, 15 tests passed | ✓ PASS |
| Folded correctness regressions | `pnpm exec vitest run` with the three named files | 3 files, 15 tests passed | ✓ PASS |
| Worker-relay/type integration build | `pnpm --filter applesauce-examples build` | TypeScript and Vite build passed | ✓ PASS |

### Probe Execution

No Phase 25 probe scripts were declared or discovered; Step 7c is not applicable.

### Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
|---|---|---|---|---|
| ECO-02 | 25-01, 25-02, 25-04 | Rendering evidence under React 18/19 for hooks/providers | ✗ BLOCKED | Matrix and tests exist, but the tested D-06 immediate-replacement contract is false because same-commit hot emissions can be lost. |
| ECO-03 | 25-03, 25-04 | Worker-relay v2 migration at both example call sites | ✓ SATISFIED | v2.0.1 resolution, removed option absent, sync metadata handling audit clean, both real adapters build. |

No additional Phase 25 requirement IDs are orphaned in `REQUIREMENTS.md`; ECO-02 and ECO-03 are both claimed by plans and accounted for above. Their checked/Complete metadata is not treated as verification evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/react/src/hooks/use-observable-state.ts` | 93-107 | Replacement identity changes before replacement subscription exists | 🛑 Blocker | Hot values can be silently lost, contradicting D-06. |
| `apps/examples/src/routes/example.tsx` | 34-50 | Async route loads lack reset/cancellation/rejection handling (25-REVIEW WR-01) | ⚠️ Warning | Rapid navigation can install stale example state or leave stale/spinner UI; not one of the Phase 25 must-haves, but should be tracked. |

No unreferenced `TBD`, `FIXME`, or `XXX` debt marker was found in the Phase 25 implementation files.

### Human Verification Required

#### 1. Worker/OPFS end-to-end smoke

**Test:** Run both worker-relay routes in a real browser with existing seeded OPFS data; exercise initialization, cache load/live/load-more, database import/search/open/export/clear, retries, responsive overflow, and partial-result retention.
**Expected:** Both databases remain queryable without reset, every operation settles, exact recovery controls work, and existing content remains visible after an unrelated operation fails.
**Why human:** Real Web Worker, OPFS persistence, browser layout, and interaction feel cannot be proven by the static/build checks.

#### 2. ECO-02 transparency prohibition

**Test:** Review the release/CI evidence and confirm React 19 evidence does not replace or weaken the React 18 consumer contract.
**Expected:** The dual-major peer remains published and both CI legs remain required.
**Why human:** This PLAN prohibition is explicitly flagged unverified and requires an authoritative human judgment.

#### 3. ECO-03 OPFS preservation prohibition

**Test:** Open both routes against pre-migration OPFS data and confirm records remain present after v2 initialization.
**Expected:** Neither database is cleared, renamed, or silently replaced.
**Why human:** Static inspection finds no reset shortcut, but only a browser persistence check can prove dependency-owned migration behavior.

#### 4. ECO-03 transparency prohibition

**Test:** Inspect both rendered routes during initialization and after success/failure.
**Expected:** No decorative dependency-version UI or page-blocking migration screen appears.
**Why human:** Static inspection supports this, but the prohibition is explicitly flagged for human judgment.

### Gaps Summary

The phase is blocked by one correctness gap. CR-01 is a direct failure of D-06, not merely advisory: during observable replacement, `state$Ref` changes in the layout phase while the new subscription is deferred to the passive phase. The current passing test cannot see this ordering window. Phase 26 is release coordination and does not specifically implement React hook replacement semantics, so the gap is not deferred.

The worker-relay migration and all three folded correctness follow-ups are substantively implemented and pass their automated checks. Browser/OPFS behavior and the three explicitly flagged prohibitions still require human confirmation, but the blocking hook defect takes precedence in the overall status.

---

_Verified: 2026-09-03T15:46:00Z_
_Verifier: the agent (gsd-verifier)_
