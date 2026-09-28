# Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2 - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Back `applesauce-react`'s declared React 18/19 compatibility with real rendering tests, move the workspace's normal React development baseline to React 19, migrate both `apps/examples` worker-relay integrations to `@snort/worker-relay` v2, and close the three selected low-priority Phase 05.1 follow-ups. This work remains independent of relay method re-layering.

</domain>

<decisions>
## Implementation Decisions

### React Version Matrix
- **D-01:** Enforce React 18 and React 19 compatibility in CI by running the same `packages/react` rendering suite once against each major.
- **D-02:** Each CI leg uses the latest compatible release in its React major, with matching `react`, `react-dom`, `@types/react`, and `@types/react-dom` majors rather than fixed historical versions.
- **D-03:** Move the normal workspace install and local development baseline to React 19. CI remains responsible for the React 18 compatibility leg.
- **D-04:** Do not add a dedicated local command that reproduces the two-version matrix; ordinary local tests use the workspace React 19 installation.

### Hook Behavior Coverage
- **D-05:** Rendering tests for `use$` and `useObservableState` cover both synchronous and asynchronous sources: synchronous sources expose their first value immediately, while sources without a synchronous emission initially expose `undefined` and rerender after emission.
- **D-06:** Observable replacement tests cover the full lifecycle: unsubscribe the old source, expose the replacement's synchronous value or `undefined`, ignore late values and errors from the old source, and continue rendering new-source emissions.
- **D-07:** Errors emitted both before and after effects attach must reach a React error boundary. Replacement must prevent a stale source's error from leaking into the active render.
- **D-08:** Cleanup tests cover unmount, source replacement, and React Strict Mode remount behavior, proving every active subscription instance is released exactly once.

### Provider Coverage
- **D-09:** Center direct provider rendering tests on `EventStoreProvider`; exercise `AccountsProvider` and `ActionsProvider` through the public higher-level hooks that consume them rather than duplicating equivalent provider-only suites.
- **D-10:** Lock every missing-provider contract: `useEventStore()` and `useActionRunner()` throw their exact documented missing-provider errors, `useAccountManager()` throws its exact error, and `useAccountManager(false)` returns `undefined`.
- **D-11:** Rerendering with a different event store, account manager, or action runner updates the consumer and does not retain the old instance.
- **D-12:** Nested providers resolve to the nearest value; removing the nested provider reveals the outer value correctly.

### Folded Todos
- **D-13:** Fold the remaining todo “Phase 05.1 code-review follow-ups (deferred, mostly pre-existing)” into Phase 25: correct the stale `stamp` comment, clear `WalletRelaysSymbol` in `lockWallet`, and make `getAppDataContent` handle valid falsy parsed values.

### the agent's Discretion
- Choose the CI job structure, temporary dependency-install mechanism, rendering-test library, test file layout, and fixture helpers that best fit the existing Vitest workflow.
- Choose focused verification for the three folded fixes, proportionate to their small surface while preventing regression.
- Choose worker-relay v2 smoke and functional verification depth sufficient to prove both example integrations run correctly, since that area was not selected for detailed discussion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract
- `.planning/ROADMAP.md` § Phase 25 — phase goal and success criteria for React rendering coverage and worker-relay v2.
- `.planning/REQUIREMENTS.md` § Ecosystem — ECO-02 and ECO-03 contracts.
- `.planning/todos/pending/05.1-review-followups.md` — original history and exact three still-open follow-ups.

### React and CI Surfaces
- `packages/react/package.json` — declared React 18/19 peer range, current dev dependencies, and package test command.
- `packages/react/src/hooks/use-$.ts` — public observable/factory overloads that require rendering coverage.
- `packages/react/src/hooks/use-observable-state.ts` — eager subscription, replacement, error, and cleanup behavior under test.
- `packages/react/src/providers/` — the three provider implementations and context defaults.
- `.github/workflows/test.yml` — existing workspace test matrix and integration point for dual React-major coverage.

### Worker Relay and Folded Fixes
- `apps/examples/src/examples/cache/worker-relay.tsx` — first worker-relay v1 call site with removed `insertBatchSize` usage.
- `apps/examples/src/examples/database/worker-relay.tsx` — second worker-relay v1 call site with removed `insertBatchSize` usage.
- `packages/core/src/operations/event.ts` — stale `stamp` commentary to reconcile with current non-enumerable cache behavior.
- `packages/wallet/src/helpers/wallet.ts` — `lockWallet` cache cleanup and `WalletRelaysSymbol` behavior.
- `packages/common/src/helpers/app-data.ts` — falsy parsed-value handling in `getAppDataContent`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Vitest 4 and the existing GitHub Actions test workflow provide the base for package rendering tests and a React-major matrix.
- RxJS `BehaviorSubject`, `Observable`, and subscription teardown hooks provide deterministic synchronous, asynchronous, replacement, error, and cleanup fixtures.
- Public consumer hooks expose provider wiring and missing-provider behavior without testing context internals directly.

### Established Patterns
- `packages/react` already declares `react: ^18.0.0 || ^19.0.0` but currently has export snapshots rather than rendering tests.
- The workspace currently resolves React 18; this phase deliberately changes the everyday baseline to React 19 while retaining React 18 only as a CI compatibility leg.
- Tests use Vitest, package-scoped scripts, and focused regression cases; changesets must contain exactly one markdown sentence per change.

### Integration Points
- `packages/react/package.json`, the lockfile, root/example dependency graph, and `.github/workflows/test.yml` jointly define the React baseline and compatibility matrix.
- `use-$.ts`, `use-observable-state.ts`, provider files, and their public consumer hooks define the rendering-test surface.
- Both example worker-relay files instantiate v1 options and must migrate together with the dependency upgrade.
- Core, wallet, and common helper tests are the natural homes for the three folded follow-up regressions.

</code_context>

<specifics>
## Specific Ideas

- Use the identical rendering suite in both CI legs so React-major results remain directly comparable.
- Treat Strict Mode remount behavior and stale-source isolation as explicit compatibility evidence, not incidental coverage.
- Keep the normal developer path simple: one React 19 workspace install and ordinary package tests, with no local matrix wrapper.

</specifics>

<deferred>
## Deferred Ideas

None — the user explicitly folded the reviewed Phase 05.1 todo into this phase.

</deferred>

---

*Phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2*
*Context gathered: 2026-09-02*
