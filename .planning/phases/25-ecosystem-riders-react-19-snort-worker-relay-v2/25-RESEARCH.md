# Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2 - Research

**Researched:** 2026-09-02
**Domain:** React hook/provider rendering compatibility, CI dependency matrices, and Web Worker relay migration
**Confidence:** HIGH for repository/API surface; MEDIUM for runtime behavior until the new rendering/browser tests execute

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

None — the user explicitly folded the reviewed Phase 05.1 todo into this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ECO-02 | `applesauce-react`'s already-declared React 19 support is backed by evidence: first rendering tests pass against React 18 and 19 for `use$`/`useObservableState` and providers. | Use React Testing Library 16.3.3 with jsdom, one shared suite, instrumented RxJS fixtures, and a separate two-major CI job. [CITED: https://testing-library.com/docs/react-testing-library/api/] [VERIFIED: codebase] |
| ECO-03 | `apps/examples` runs on `@snort/worker-relay` v2 with removed `insertBatchSize` and synchronous `setEventMetadata` handled at both integrations. | Upgrade only `applesauce-examples` to the latest v2 (2.0.1), remove both obsolete init fields, compile/build both imported examples, and perform a browser smoke test against their two OPFS databases. [VERIFIED: npm tarball + codebase] |
</phase_requirements>

## Summary

The phase should be planned as four reviewable slices: establish React 19 plus DOM-test infrastructure; add one behavior-driven rendering suite and its React 18/19 CI matrix; migrate and smoke-test both worker-relay examples; then land the three focused regressions with package-local tests. `applesauce-react` already declares `react: ^18.0.0 || ^19.0.0`, but has no `react-dom` dev dependency and only export-snapshot tests, so the compatibility claim currently exercises neither a renderer nor lifecycle behavior. [VERIFIED: codebase]

Use `@testing-library/react` 16.3.3 and jsdom 30.0.1. The library officially exposes `renderHook`, `rerender`, `unmount`, wrappers, error callbacks, and `reactStrictMode`; its peers cover both React majors. A DOM emulator keeps this hook/provider suite fast and independent of Playwright, while the worker-relay verification still needs the existing browser-capable example build because OPFS, Web Workers, and WASM are real browser boundaries. [CITED: https://testing-library.com/docs/react-testing-library/api/] [VERIFIED: package-legitimacy seam — Testing Library SUS] [VERIFIED: codebase]

`@snort/worker-relay` 2.0.1 is the latest release in major 2 even though npm `latest` is now 3.0.0. Its authoritative v2 declarations remove `insertBatchSize`, retain the two worker entry paths currently imported, and change `setEventMetadata` to fire-and-forget `void`. Its bundled README incorrectly still shows `insertBatchSize`, so planning and review must follow the shipped types/source. There are currently no explicit `setEventMetadata` calls in the repository; “handle at both call sites” therefore means both integrations must compile against v2 and must not introduce promise-dependent handling. [VERIFIED: published 2.0.1 tarball + package-legitimacy seam — SUS + codebase]

**Primary recommendation:** Add a package-local jsdom rendering harness and shared behavioral suite first, matrix only that suite in a dedicated CI job, then update the React 19 baseline and worker-relay v2 dependency/lockfile with package-specific builds and browser smoke checks. [VERIFIED: codebase] [CITED: https://testing-library.com/docs/react-testing-library/api/]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Observable-to-render lifecycle | Browser / Client | — | React owns render/effect timing; RxJS supplies the external source. [VERIFIED: codebase] |
| Provider lookup and nesting | Browser / Client | — | React context resolution happens in the rendered tree. [VERIFIED: codebase] |
| React-major compatibility enforcement | CI / Build | Browser / Client | CI swaps renderer/type majors and runs the identical package suite. [VERIFIED: CONTEXT.md] |
| Worker relay interface | Browser / Client | Database / Storage | The app talks through a Worker; the worker persists to SQLite OPFS and runs migrations. [VERIFIED: worker-relay 2.0.1 source] |
| Falsy application-data parsing | API / Backend library | — | Framework-agnostic helper parsing/cache semantics live in `applesauce-common`. [VERIFIED: codebase] |
| Wallet lock cache clearing | API / Backend library | — | Framework-agnostic wallet helper owns decrypted memo lifecycle. [VERIFIED: codebase] |

## Project Constraints (from AGENTS.md)

- Documentation must integrate with existing topic docs rather than create standalone best-practice files; component docs follow What/How/Integration/Best Practices and omit recap summaries. [VERIFIED: AGENTS.md]
- Documentation examples must stay focused and roughly 20 lines or fewer, avoid repeated setup, and separate framework-agnostic material from React material. [VERIFIED: AGENTS.md]
- Every changeset describes exactly one change and contains a one-sentence Markdown body; use the smallest applicable bump. [VERIFIED: AGENTS.md]
- Example UI changes must use simple borders, no drop shadows/cards, and DaisyUI has no `.form-control`; this phase should not require UI redesign. [VERIFIED: AGENTS.md]
- Before completion, compile/work-check examples, update navigation if documentation moves, and leave no duplicate/orphaned files. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react` / `react-dom` | workspace `^19.2.8`; CI `^18` and `^19` | Renderer and lifecycle under test | Current workspace baseline plus locked two-major compatibility matrix. Published React 18 tops out at 18.3.1; registry latest React 19 is 19.2.8. [VERIFIED: npm registry] |
| `@types/react` / `@types/react-dom` | workspace major 19; CI matching major | Type compatibility for each renderer leg | Locked decision requires type majors to match runtime majors. Current registry releases are 19.2.18 and 19.2.5; latest major-18 lines are 18.3.31 and 18.3.7. [CITED: https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom] [VERIFIED: package-legitimacy seam — react OK, react-dom SUS] |
| `@testing-library/react` | 16.3.3 | Render hooks and provider consumers through React DOM | Official API supports `renderHook`, wrappers, rerender, unmount, Strict Mode, and both React majors. [CITED: https://testing-library.com/docs/react-testing-library/api/] [VERIFIED: package-legitimacy seam — SUS] |
| `jsdom` | 30.0.1 | DOM environment for package rendering tests | Fast test-only DOM; its current Node engine supports the repository's current/latest CI lines, but CI must use versions satisfying `^22.22.2 || ^24.15.0 || >=26`. [VERIFIED: npm registry] |
| `rxjs` | existing `^7.8.1` | Deterministic sync/async/error/teardown fixtures | Already a runtime dependency and exposes `BehaviorSubject`, `Observable`, and teardown functions needed by locked coverage. [VERIFIED: codebase] |
| `@snort/worker-relay` | `^2.0.1` | Worker-backed SQLite relay in examples | 2.0.1 is the latest v2 and exactly matches ECO-03, while 3.0.0 is out of phase scope. [VERIFIED: published 2.0.1 tarball + package-legitimacy seam — SUS] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | workspace 4.1.6 / package range 4.0.15 | Runner, assertions, spies | All new unit/rendering tests; keep commands package-scoped for quick feedback. [VERIFIED: codebase] |
| React class error boundary | built into React 18/19 | Capture errors thrown by hooks during render | Use a tiny test fixture for pre-effect and post-effect observable errors. [CITED: https://react.dev/reference/react/Component] |
| Vite 8 | existing 8.0.16 | Build worker imports and WASM asset graph | ECO-03 compilation/build smoke for `apps/examples`. [VERIFIED: codebase] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| jsdom + React Testing Library | Existing Vitest Browser/Playwright dependencies | Better real-browser fidelity but higher setup/runtime cost for nonvisual hook tests; retain browser smoke only for worker/WASM behavior. [VERIFIED: codebase] |
| React Testing Library | `react-test-renderer` | Do not use: React marks the renderer deprecated and recommends Testing Library. [CITED: https://react.dev/warnings/react-test-renderer] |
| Dedicated React compatibility CI job | Multiply the entire Node/Bun workspace matrices by React major | Wasteful and confounds unrelated package failures; only `packages/react` owns the peer contract. [VERIFIED: codebase + CONTEXT.md] |

**Installation:**

```bash
pnpm --filter applesauce-react add -D @testing-library/react@^16.3.3 jsdom@^30.0.1 react-dom@^19.2.8 @types/react-dom@^19
pnpm --filter applesauce-examples up @snort/worker-relay@^2.0.1 react@^19.2.8 react-dom@^19.2.8 @types/react@^19 @types/react-dom@^19
```

The implementation must let pnpm update `pnpm-lock.yaml`; the commands above are planning targets, not a request to bypass the lockfile. [VERIFIED: codebase]

## Package Legitimacy Audit

| Package | Registry | Age / Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----------------|-------------|---------|-------------|
| `react` | npm | established / 171M weekly | `github.com/react/react` | OK | Approved. [VERIFIED: npm registry] |
| `react-dom` | npm | established / 161M weekly | `github.com/react/react` | OK | Approved. [VERIFIED: npm registry] |
| `@types/react` | npm | established / 157M weekly | `github.com/DefinitelyTyped/DefinitelyTyped` | OK | Approved. [VERIFIED: npm registry] |
| `@types/react-dom` | npm | established / 130M weekly | `github.com/DefinitelyTyped/DefinitelyTyped` | SUS (`too-new` release signal) | Flagged — planner must add `checkpoint:human-verify` before install. [VERIFIED: package-legitimacy seam] |
| `@testing-library/react` | npm | established / 57M weekly | `github.com/testing-library/react-testing-library` | SUS (`too-new` release signal) | Flagged — planner must add `checkpoint:human-verify` before install. [VERIFIED: package-legitimacy seam] |
| `jsdom` | npm | established / 98M weekly | `github.com/jsdom/jsdom` | OK | Approved. [VERIFIED: npm registry] |
| `@snort/worker-relay` | npm | since 2024 / 255 weekly | `git.v0l.io/Kieran/snort` | SUS (`too-new`, low downloads) | Flagged — planner must add `checkpoint:human-verify` before install despite direct source/tarball validation. [VERIFIED: package-legitimacy seam] |

No audited package has a postinstall script. [VERIFIED: npm registry]

**Packages removed due to [SLOP] verdict:** none. [VERIFIED: package-legitimacy seam]
**Packages flagged as suspicious [SUS]:** `@types/react-dom`, `@testing-library/react`, `@snort/worker-relay`; planner inserts a human-verification checkpoint before each install. [VERIFIED: package-legitimacy seam]

## Architecture Patterns

### System Architecture Diagram

```text
RxJS source ──sync/async/error──> useObservableState ──value/throw──> React render
     │                                  │                              │
     └──── replacement/teardown <──── effect cleanup <──── rerender/unmount/StrictMode

Provider prop ──> React Context ──> public consumer hook ──> rendered identity/error

Example route ──> WorkerRelayInterface ──postMessage──> Web Worker
                                                       ├─> SQLite WASM / OPFS
                                                       └─> in-memory fallback
```

This reflects the current code and worker-relay v2 boundaries. [VERIFIED: codebase + worker-relay 2.0.1 source]

### Recommended Project Structure

```text
packages/react/src/hooks/__tests__/
├── use-observable-state.test.tsx  # lifecycle, replacement, errors, cleanup
└── use-$.test.tsx                 # observable/factory public overload behavior
packages/react/src/providers/__tests__/
└── providers.test.tsx             # public-hook provider contracts
packages/react/src/__tests__/
└── rendering-fixtures.tsx         # boundary and tracked-observable helpers if shared
```

Keep fixture helpers local to the React package; do not create a workspace testing abstraction for three files. [VERIFIED: codebase] [ASSUMED]

### Pattern 1: Tracked Observable Lifecycle

**What:** Wrap an `Observable` whose subscribe and teardown closures increment counters, while retaining a controlled subscriber for late values/errors. [VERIFIED: RxJS API used in codebase]

**When to use:** Replacement, unmount, stale emission/error, and Strict Mode tests. [VERIFIED: CONTEXT.md]

```tsx
let active = 0;
const source$ = new Observable<number>((subscriber) => {
  active++;
  current = subscriber;
  return () => active--;
});
```

Use `act` around controlled emissions before asserting committed output. [CITED: https://react.dev/reference/react/act]

### Pattern 2: Public Consumer Provider Test

**What:** Render a probe that calls `useEventStore`, `useAccountManager`, or `useActionRunner`, then expose identity in the DOM/callback. Rerender the provider tree to prove replacement/nesting. [VERIFIED: codebase + CONTEXT.md]

**When to use:** All provider behavior; do not test context internals. [VERIFIED: CONTEXT.md]

```tsx
const { rerender } = render(<EventStoreProvider eventStore={outer}><Probe /></EventStoreProvider>);
rerender(<EventStoreProvider eventStore={next}><Probe /></EventStoreProvider>);
expect(seen.at(-1)).toBe(next);
```

### Pattern 3: Separate Compatibility Job

**What:** Add a `test-react` matrix with `react-major: [18, 19]`; after a frozen workspace install, temporarily replace the four React packages in `applesauce-react` using pnpm `--no-lockfile`, then run the same focused suite. [VERIFIED: pnpm CLI + codebase + CONTEXT.md]

```yaml
strategy:
  matrix: { react-major: [18, 19] }
steps:
  - run: pnpm install --frozen-lockfile
  - run: pnpm --filter applesauce-react add -D --no-lockfile react@^${{ matrix.react-major }} react-dom@^${{ matrix.react-major }} @types/react@^${{ matrix.react-major }} @types/react-dom@^${{ matrix.react-major }}
  - run: pnpm --filter applesauce-react test
```

Validate this ephemeral install command in the implementation branch because pnpm's shared workspace linker can surface peer-resolution details not inferable from static inspection. [ASSUMED]

### Anti-Patterns to Avoid

- **Asserting a fixed subscription count under Strict Mode:** assert that every created subscription is torn down once and that active count returns to zero; React deliberately adds a development setup/cleanup cycle. [CITED: https://react.dev/reference/react/StrictMode]
- **Testing only `BehaviorSubject`:** it cannot prove the required initial-`undefined` path; include controlled non-emitting `Observable`/`Subject` fixtures. [VERIFIED: CONTEXT.md]
- **Emitting outside `act`:** React 19 warns for unwrapped updates and assertions can race the commit. [CITED: https://react.dev/reference/react/act]
- **Trusting worker-relay's bundled README:** v2.0.1 README still includes the removed field; use declarations/source. [VERIFIED: published npm tarball]
- **Upgrading to worker-relay 3:** npm `latest` is 3.0.0, but ECO-03 explicitly requires v2; pin the range to `^2.0.1`. [VERIFIED: npm registry + REQUIREMENTS.md]
- **Adding a changeset for examples only:** `applesauce-examples` is ignored by Changesets; only published-package behavioral fixes need their own one-sentence changesets. [VERIFIED: codebase + AGENTS.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| React rendering harness | Direct `createRoot` container/cleanup wrapper | React Testing Library `render`/`renderHook` | It supplies `act`, cleanup, rerender, unmount, wrapper, and Strict Mode handling. [CITED: https://testing-library.com/docs/react-testing-library/api/] |
| DOM emulation | Ad-hoc document/window mocks | jsdom environment | React DOM and Testing Library expect coherent DOM behavior. [VERIFIED: npm registry] |
| Observable test doubles | Custom observable protocol | RxJS `Observable`, `Subject`, `BehaviorSubject` | Tests the exact producer interface used in production. [VERIFIED: codebase] |
| Worker RPC or SQLite migration | Local compatibility wrapper | `WorkerRelayInterface` v2 and its built-in migration path | The dependency already owns worker messages, batching, WASM, fallback, and schema versions. [VERIFIED: worker-relay 2.0.1 source] |
| Error capture | `try/catch` around hook calls | Render a React Error Boundary | Effect-triggered rerenders throw through React's boundary contract. [CITED: https://react.dev/reference/react/Component] |

**Key insight:** The phase should verify third-party lifecycle contracts at their real boundary rather than mimic React, RxJS, Worker, or SQLite behavior. [VERIFIED: codebase] [CITED: https://react.dev/reference/react/StrictMode]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Browser OPFS databases named `cache-relay.db` and `relay.db`; worker-relay v2 opens them and runs a versioned SQLite migration table through v7. [VERIFIED: codebase + worker-relay 2.0.1 source] | Browser smoke should open existing-format data or at minimum initialize/query/reload each path; do not delete databases as a migration strategy. [ASSUMED] |
| Live service config | None found: both integrations configure the worker entirely in tracked TSX. [VERIFIED: codebase grep] | None. |
| OS-registered state | None: browser Workers are instantiated by module imports and not registered as OS services. [VERIFIED: codebase grep] | None. |
| Secrets/env vars | None related to React or worker-relay versions/options; Vite's `import.meta.env.DEV` only selects the worker entry. [VERIFIED: codebase grep] | None. |
| Build artifacts | `pnpm-lock.yaml`, Vite worker/WASM bundles, and installed `node_modules` retain old package resolution until reinstall/build. [VERIFIED: codebase] | Update lockfile, reinstall, rebuild examples; no committed generated dist is in scope. [VERIFIED: codebase] |

## Common Pitfalls

### Pitfall 1: Strict Mode Makes Subscription Accounting Look Wrong

**What goes wrong:** Tests expect one subscribe/one unsubscribe and fail or conceal a leaked render-phase subscription. [CITED: https://react.dev/reference/react/StrictMode]

**Why it happens:** `useObservableState` subscribes in a `useState` initializer, while React Strict Mode adds development render and effect stress cycles. [VERIFIED: codebase] [CITED: https://react.dev/reference/react/StrictMode]

**How to avoid:** Track each subscription instance, its teardown call count, and aggregate active count; assert every instance tears down once and zero remain after unmount. [VERIFIED: CONTEXT.md]

**Warning signs:** duplicate subscribe logs, negative active counts, or emissions changing output after unmount/replacement. [ASSUMED]

### Pitfall 2: Replacement Races the Layout/Passive Effects

**What goes wrong:** The old observable emits/errors between rerender and effect cleanup and mutates the active render. [VERIFIED: codebase + CONTEXT.md]

**Why it happens:** `state$Ref` updates in an isomorphic layout effect, but subscription replacement and callbacks are installed in a passive effect. [VERIFIED: codebase]

**How to avoid:** Use controlled sources and explicitly emit from the retained old subscriber during replacement tests; verify old next/error are ignored and the replacement's initial state is immediate or `undefined`. [VERIFIED: CONTEXT.md]

**Warning signs:** old values flash after rerender or the boundary catches an old-source error. [ASSUMED]

### Pitfall 3: Pre-Effect Errors Need a Real Boundary

**What goes wrong:** A synchronous source error is stored during render-phase subscription before `onError` exists; a callback-only test never observes React's thrown error behavior. [VERIFIED: codebase]

**Why it happens:** `createSubscription` records `latestError`, and the hook throws it on render; later errors use `forceUpdate` to reach the same render path. [VERIFIED: codebase]

**How to avoid:** Test both synchronous subscription-time error and later `subscriber.error()` inside `act` beneath a resettable error boundary. [VERIFIED: CONTEXT.md] [CITED: https://react.dev/reference/react/Component]

**Warning signs:** console noise without a boundary assertion or tests that only assert the observable errored. [ASSUMED]

### Pitfall 4: “Latest” Accidentally Selects Worker-Relay 3

**What goes wrong:** A general update command resolves 3.0.0, expanding scope beyond ECO-03. [VERIFIED: npm registry]

**Why it happens:** npm's `latest` tag moved after Phase 25 was specified. [VERIFIED: npm registry]

**How to avoid:** request `@snort/worker-relay@^2.0.1` explicitly and verify the lockfile resolves 2.0.1. [VERIFIED: published 2.0.1 tarball + package-legitimacy seam — SUS]

**Warning signs:** lockfile/package manifest contains `3.0.0` or type errors unrelated to the two known v2 changes. [ASSUMED]

### Pitfall 5: Falsy JSON Is Confused with Parse Failure

**What goes wrong:** `false`, `0`, `null`, and `""` parse successfully but are discarded by truthiness checks; `undefined` is the actual `safeParse` failure sentinel. [VERIFIED: codebase]

**How to avoid:** use property presence for the cache and explicit `=== undefined` checks for parsed/decrypted data; add a table test for all valid falsy JSON values and an invalid JSON control. [VERIFIED: codebase] [ASSUMED]

## Code Examples

### Asynchronous Hook Update

```tsx
const source$ = new Subject<number>();
const { result } = renderHook(() => useObservableState(source$));
expect(result.current).toBeUndefined();
act(() => source$.next(7));
expect(result.current).toBe(7);
```

Source pattern: official `renderHook`/`act` APIs. [CITED: https://testing-library.com/docs/react-testing-library/api/] [CITED: https://react.dev/reference/react/act]

### Exact Falsy Sentinel Handling

```ts
const cached = Reflect.get(event, AppDataContentSymbol) as R | undefined;
if (Reflect.has(event, AppDataContentSymbol)) return cached;
const parsed = safeParse<R>(event.content);
if (parsed === undefined) return undefined;
setCachedValue(event, AppDataContentSymbol, parsed);
return parsed;
```

This illustrates the required semantic distinction; implementation must retain encrypted-content fallback around it. [VERIFIED: codebase] [ASSUMED]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Export snapshots as React package evidence | Real React DOM rendering/lifecycle tests | Phase 25 | Peer compatibility becomes behaviorally demonstrated. [VERIFIED: codebase + REQUIREMENTS.md] |
| Workspace React 18 baseline | React 19 baseline plus React 18 compatibility CI | Locked Phase 25 decision | Normal development exercises 19 without abandoning 18 consumers. [VERIFIED: CONTEXT.md] |
| Worker-relay 1.5 configurable `insertBatchSize` | Worker-relay 2.0.1 internal batching; init accepts only `databasePath` | v2, published 2026-04 | Remove both obsolete options. [VERIFIED: npm registry + published tarball] |
| Promise-returning `setEventMetadata` RPC | synchronous fire-and-forget `void` dispatch | v2 | Never rely on awaiting completion; repository currently has no direct call. [VERIFIED: published tarball + codebase] |

**Deprecated/outdated:**

- `react-test-renderer`: deprecated and not suitable for the new suite. [CITED: https://react.dev/warnings/react-test-renderer]
- worker-relay v2 bundled README init example: stale relative to its own declarations/source. [VERIFIED: published tarball]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A shared fixture file is preferable to inline duplication after the second consumer. | Project Structure | Low; affects test organization only. |
| A2 | The proposed pnpm `add --no-lockfile` matrix command works cleanly with this workspace's shared linker. | Architecture Pattern 3 | Medium; Wave 0 must validate and adjust the ephemeral install mechanism. |
| A3 | A browser smoke can safely validate the two OPFS paths without destructive cleanup. | Runtime State Inventory | Medium; test isolation/data seeding must be designed during implementation. |
| A4 | Warning-sign descriptions predict likely failures. | Common Pitfalls | Low; diagnostics only. |
| A5 | The suggested falsy-sentinel sketch integrates cleanly with encrypted fallback. | Code Examples | Medium; regression tests, not the sketch, define correctness. |

## Open Questions

1. **Does the current hook implementation already satisfy Strict Mode teardown and stale-source isolation?**
   - What we know: subscription begins during state initialization and effect cleanup owns teardown. [VERIFIED: codebase]
   - What's unclear: behavior across both renderers cannot be proved without the new suite. [VERIFIED: absence of tests]
   - Recommendation: make the harness/test plan precede any hook refactor; fix behavior only when a failing locked case demonstrates it. [ASSUMED]

2. **How deep should worker-relay runtime verification go in CI?**
   - What we know: TypeScript/Vite build verifies both import paths and v2 API shape; true SQLite OPFS behavior needs a browser. [VERIFIED: codebase + worker-relay source]
   - What's unclear: the existing test workflow does not wire a browser project despite installed Playwright packages. [VERIFIED: codebase]
   - Recommendation: require build plus a focused manual browser smoke in phase verification; automate a Playwright smoke only if reliable routing/fixtures fit within this phase without creating general example-app E2E infrastructure. [ASSUMED]

3. **Should the three folded published-package fixes share a changeset?**
   - What we know: AGENTS.md requires exactly one change per changeset; the fixes touch core, wallet, and common independently. [VERIFIED: AGENTS.md + codebase]
   - Recommendation: create three patch changesets, one per package/fix, each with a single-sentence body. [VERIFIED: AGENTS.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all tests/builds | ✓ | 22.23.1 | CI also covers current 22/24/26. [VERIFIED: environment + workflow] |
| pnpm | dependency matrix/lockfile | ✓ | 11.10.0 | none; matches `packageManager`. [VERIFIED: environment + codebase] |
| Vitest | rendering/regressions | ✓ | workspace 4.1.6 | none. [VERIFIED: codebase] |
| Chromium | worker browser smoke | ✓ | snap-installed | Playwright-managed Chromium if configured. [VERIFIED: environment] |
| Playwright CLI | optional browser smoke | ✓ | 1.61.1 CLI (`package.json` requests 1.60.0 range) | manual Vite browser smoke. [VERIFIED: environment + codebase] |
| `@testing-library/react` | React render harness | ✗ | — | install 16.3.3 after legitimacy checkpoint. [CITED: https://testing-library.com/docs/react-testing-library/api/] [VERIFIED: environment + package-legitimacy seam — SUS] |
| jsdom | DOM test environment | ✗ | — | install 30.0.1; existing browser stack is higher-cost fallback. [VERIFIED: environment + npm registry] |

**Missing dependencies with no fallback:** none after planned dev-dependency install. [VERIFIED: environment]

**Missing dependencies with fallback:** Testing Library/jsdom are missing; direct React DOM plus existing Playwright is possible but not recommended. [VERIFIED: environment] [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 + React Testing Library 16.3.3 + jsdom 30.0.1 [VERIFIED: codebase + npm registry] |
| Config file | root `vitest.config.ts`; add package-local jsdom annotation or package config without affecting Node-only packages. [VERIFIED: codebase] [ASSUMED] |
| Quick run command | `pnpm --filter applesauce-react test` [VERIFIED: codebase] |
| Full suite command | `pnpm test` plus `pnpm --filter applesauce-examples build` [VERIFIED: codebase] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ECO-02 | sync/async values, replacement, errors, teardown in React 18/19 | rendering integration | `pnpm --filter applesauce-react test` in each CI matrix leg | ❌ Wave 0 |
| ECO-02 | provider missing/replacement/nesting contracts through public hooks | rendering integration | `pnpm --filter applesauce-react test -- providers.test.tsx` | ❌ Wave 0 |
| ECO-03 | both v2 call sites typecheck and worker assets bundle | build integration | `pnpm --filter applesauce-examples build` | ✅ build command; migration not yet applied |
| ECO-03 | worker initializes, stores/queries, reloads two databases | browser smoke | manual Vite smoke or focused Playwright command established in Wave 0 | ❌ Wave 0 |
| D-13 | wallet relay cache cleared on lock | unit | `pnpm exec vitest run packages/wallet/src/helpers/__tests__/wallet.test.ts` | ✅ extend existing |
| D-13 | valid falsy app-data values survive parse/cache | unit | `pnpm exec vitest run packages/common/src/helpers/__tests__/app-data.test.ts` | ✅ extend existing |
| D-13 | stamp comment matches non-enumerable behavior | existing regression/readability | `pnpm exec vitest run packages/core/src/operations/__tests__/event.test.ts` | ✅ existing behavior test |

### Sampling Rate

- **Per task commit:** run the directly affected package test/build command. [VERIFIED: codebase]
- **Per wave merge:** `pnpm --filter applesauce-react test`, three focused regression files, and `pnpm --filter applesauce-examples build`. [ASSUMED]
- **Phase gate:** React 18/19 matrix green, full `pnpm test` green, examples build green, and both worker routes smoke-verified. [VERIFIED: CONTEXT.md + REQUIREMENTS.md]

### Wave 0 Gaps

- [ ] Install `@testing-library/react`, `react-dom`, `@types/react-dom`, and jsdom for `applesauce-react` after required legitimacy checkpoints. [VERIFIED: environment]
- [ ] Establish jsdom selection for the new `.tsx` suite. [ASSUMED]
- [ ] Add tracked-observable and error-boundary fixtures. [VERIFIED: CONTEXT.md]
- [ ] Prove the pnpm ephemeral React-major swap command before encoding it in CI. [ASSUMED]
- [ ] Decide/record the exact worker browser smoke procedure; automated only if existing route harness makes it focused. [ASSUMED]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No authentication behavior changes. [VERIFIED: phase scope] |
| V3 Session Management | no | No session behavior changes. [VERIFIED: phase scope] |
| V4 Access Control | no | No authorization boundary changes. [VERIFIED: phase scope] |
| V5 Input Validation | yes | Preserve `safeParse`'s explicit `undefined` failure sentinel; test valid falsy JSON separately from invalid JSON. [VERIFIED: codebase] |
| V6 Cryptography | no new primitive | Wallet locking only removes existing decrypted caches; retain existing core hidden-tag helpers. [VERIFIED: codebase] |

### Known Threat Patterns for React/Worker/Cache Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Decrypted wallet relay metadata remains reachable after lock | Information Disclosure | Delete `WalletRelaysSymbol` alongside private-key/mint memos and verify all three are absent. [VERIFIED: codebase + CONTEXT.md] |
| Stale observable error crosses source replacement | Denial of Service | Identity-gate callbacks/errors to the active observable and render-test late old-source errors. [VERIFIED: codebase + CONTEXT.md] |
| Untrusted/invalid application JSON confused with valid falsy data | Tampering | Treat only `undefined` as parse failure; retain encrypted detection and cache non-enumerability. [VERIFIED: codebase] |
| Dependency major drift selects v3 | Supply chain / Tampering | Explicit `^2.0.1`, lockfile review, legitimacy checkpoint, no postinstall. [VERIFIED: npm registry + package-legitimacy seam] |

## Sources

### Primary (HIGH confidence)

- Repository source and manifests: `packages/react`, both worker-relay TSX examples, three folded helper/operation files, tests, workflows, lockfile, and Changesets config. [VERIFIED: codebase]
- Published `@snort/worker-relay@2.0.1` tarball declarations/source and registry metadata; legitimacy gate remains SUS. [VERIFIED: published npm tarball + package-legitimacy seam — SUS]

### Secondary (MEDIUM confidence)

- https://react.dev/reference/react/StrictMode — development render/effect cleanup behavior. [CITED: official React docs]
- https://react.dev/reference/react/act — flushing render updates in tests. [CITED: official React docs]
- https://react.dev/reference/react/Component — Error Boundary contract. [CITED: official React docs]
- https://testing-library.com/docs/react-testing-library/api/ — render/renderHook/wrapper/rerender/unmount/Strict Mode API. [CITED: official Testing Library docs]
- https://react.dev/warnings/react-test-renderer — deprecated renderer guidance. [CITED: official React docs]

### Tertiary (LOW confidence)

- None; unresolved implementation details are explicitly tagged `[ASSUMED]`. [VERIFIED: this research]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — versions, peers, engine constraints, and package contents verified live. [VERIFIED: npm registry]
- Architecture: HIGH — boundaries and call sites verified directly in repository/dependency source. [VERIFIED: codebase + published tarball]
- Pitfalls: MEDIUM — mechanisms are verified, but React-major runtime outcomes require the tests this phase creates. [VERIFIED: codebase] [CITED: https://react.dev/reference/react/StrictMode]

**Research date:** 2026-09-02
**Valid until:** 2026-09-09 (React/test tooling and worker-relay dist-tags are fast-moving). [ASSUMED]
