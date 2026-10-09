---
phase: quick-261009-kku
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/react/src/hooks/use-observable-state.ts
  - packages/react/src/hooks/__tests__/use-observable-state.test.tsx
  - .changeset/observable-state-function-values.md
autonomous: true
requirements:
  - QUICK-261009-kku

must_haves:
  truths:
    - "When an observable synchronously emits a function on mount, useObservableState returns that exact function reference and never invokes it"
    - "When an already-subscribed observable later emits a function, useObservableState returns that exact function reference and never invokes it"
    - "When the hook's source observable is replaced by one that emits a function, useObservableState returns that exact function reference and never invokes it"
    - "All existing useObservableState behaviors (sync first value, async undefined, source replacement, error routing, Strict Mode teardown) still pass"
    - "A single-sentence patch changeset for applesauce-react describes the fix"
  artifacts:
    - path: "packages/react/src/hooks/use-observable-state.ts"
      provides: "useObservableState storing observable values through the setState updater form"
      contains: "setState(() =>"
    - path: "packages/react/src/hooks/__tests__/use-observable-state.test.tsx"
      provides: "Regression tests for function-valued emissions"
      contains: "function"
    - path: ".changeset/observable-state-function-values.md"
      provides: "Patch changeset for applesauce-react"
      contains: "\"applesauce-react\": patch"
  key_links:
    - from: "createSubscription next handler -> subState.onValue"
      to: "React useState setter"
      via: "updater form wrapping the emitted value so React never calls it"
      pattern: "setState\\(\\(\\) => value\\)"
    - from: "layout effect source-change branch"
      to: "React useState setter"
      via: "updater form wrapping subState.latestValue"
      pattern: "setState\\(\\(\\) => subState\\.latestValue"
---

<objective>
Fix `useObservableState` in applesauce-react so observable values that are functions (for example a `TimelineLoader`) are stored as-is instead of being treated as React `setState` updaters.

Purpose: React interprets any function passed to a `useState` setter as an updater and stores its return value. When an observable emits a `TimelineLoader`, the hook currently stores `loader(prev)` (an Observable), so a consumer calling the returned loader throws. The `useState(() => ...)` initializer is unaffected (React stores the initializer's return value directly), but the three setter call sites in the layout effect / `onValue` callback are not.

Output: Fixed hook, regression tests proving exact function references survive mount, later emission, and source replacement, and one patch changeset.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@packages/react/src/hooks/use-observable-state.ts
@packages/react/src/hooks/__tests__/use-observable-state.test.tsx
@packages/react/src/__tests__/rendering-fixtures.tsx

<interfaces>
From packages/react/src/hooks/use-observable-state.ts (current, relevant lines):
- Line 76: `const [state, setState] = useState<TState | undefined>(() => { ... })` — initializer, already safe, DO NOT change.
- Line 112: inside the source-change branch, sync value from the new subscription is passed directly to setState.
- Line 114: `setState(undefined)` — not a function, safe, may stay as-is.
- Line 119: inside the same-observable branch, a missed `subState.latestValue` is passed directly to setState.
- Line 131: inside `subState.onValue`, the emitted `value` is passed directly to setState.

Important: the useState initializer unsubscribes its probe subscription, so on mount the layout effect always takes the source-change branch (line 112) and re-subscribes. That means a BehaviorSubject holding a function triggers the bug on the very first render, not only on later emissions.

From packages/react/src/__tests__/rendering-fixtures.tsx:
- `createControlledObservable<T>()` returns `{ observable, next(value), error(err) }` — async-only source.
- `createTrackedObservable<T>(syncValue?)` returns `{ observable, next, error, active, subscriptions }` — emits syncValue on subscribe when provided.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add function-value regression tests and switch setState call sites to the updater form</name>
  <files>packages/react/src/hooks/__tests__/use-observable-state.test.tsx, packages/react/src/hooks/use-observable-state.ts</files>
  <behavior>
    - Test A (sync mount + later emission): a `BehaviorSubject` seeded with `fnA = vi.fn(() => "called-a")`; `renderHook(() => useObservableState(subject))` returns exactly `fnA` (`toBe`). Then `act(() => subject.next(fnB))` with `fnB = vi.fn(() => "called-b")` returns exactly `fnB`. Neither `fnA` nor `fnB` has been called (`not.toHaveBeenCalled()`).
    - Test B (async emission): a `createControlledObservable<() => string>()` source; the hook returns `undefined` initially, then after `act(() => source.next(fn))` returns exactly `fn`, and `fn` was never called.
    - Test C (source replacement): `renderHook(({ source }) => useObservableState(source), { initialProps: { source: new BehaviorSubject(fnA) } })`, then `rerender({ source: new BehaviorSubject(fnC) })` returns exactly `fnC`; neither function was called.
    - All three tests FAIL against the current implementation (React invokes the function as an updater, so the hook returns the string result instead of the function).
  </behavior>
  <action>
    RED: In `packages/react/src/hooks/__tests__/use-observable-state.test.tsx`, add `vi` to the existing vitest import and append the three tests from the behavior block inside the existing `describe("useObservableState", ...)` (names such as "stores function values emitted synchronously without calling them", "stores function values emitted asynchronously without calling them", "stores function values from a replacement source without calling them"). Use `vi.fn(() => "called-x")` so a regression shows up both as a wrong `toBe` reference and as a recorded call. Keep each test short, matching the style of the existing tests (no extra comments or boilerplate). Run the package tests and confirm the new tests fail before touching the hook; commit as `test(quick-261009-kku): add failing tests for function values in useObservableState`.

    GREEN: In `packages/react/src/hooks/use-observable-state.ts`, change the three setter calls that receive observable values (current lines 112, 119 and 131) to the updater form so React stores the value verbatim: `setState(() => subState.latestValue)` at the two layout-effect sites, and `setState(() => value)` inside `subState.onValue`. Because `subState.latestValue` is typed `TState | typeof NO_VALUE` and both sites are already inside a `!== NO_VALUE` guard, capture it into a local const before the call (or keep an equivalent narrowing) so TypeScript still sees `TState` inside the arrow — the closure must not read a later-mutated `subState.latestValue`. Add ONE short inline comment at the `onValue` site explaining that the updater form is required because emitted values may themselves be functions (e.g. timeline loaders) that React would otherwise call as updaters. Leave the `useState(() => ...)` initializer and the `setState(undefined)` call unchanged. Do not change the hook's JSDoc or public signature. Re-run tests (all must pass) and typecheck; commit as `fix(quick-261009-kku): store function values from observables as-is in useObservableState`.
  </action>
  <verify>
    <automated>cd /home/robert/Projects/applesauce && pnpm --filter applesauce-react exec vitest run src/hooks/__tests__/use-observable-state.test.tsx && pnpm --filter applesauce-react exec tsc --noEmit && test "$(grep -c 'setState(() =>' packages/react/src/hooks/use-observable-state.ts)" -ge 3</automated>
  </verify>
  <done>The three new tests failed before the hook change and pass after it; every pre-existing test in use-observable-state.test.tsx still passes; `tsc --noEmit` is clean for applesauce-react; the hook file contains at least three updater-form setter calls and exactly one new inline comment explaining why.</done>
</task>

<task type="auto">
  <name>Task 2: Add the patch changeset and run the full package suite</name>
  <files>.changeset/observable-state-function-values.md</files>
  <action>
    Create `.changeset/observable-state-function-values.md` following the CLAUDE.md changeset rules (exactly one change, body is a single sentence of markdown, no bullets/code blocks/extra paragraphs). Frontmatter is a single entry `"applesauce-react": patch` between `---` lines, matching the format of existing files such as `.changeset/auth-retry-error-channel.md`. Body sentence: Fix `useObservableState` calling function values such as timeline loaders as React state updaters instead of returning them unchanged. Then run the full applesauce-react test suite to confirm nothing else regressed (use-observable-memo and use-$ delegate to this hook). Commit as `chore(quick-261009-kku): add changeset for useObservableState function values`.
  </action>
  <verify>
    <automated>cd /home/robert/Projects/applesauce && grep -q '"applesauce-react": patch' .changeset/observable-state-function-values.md && test "$(sed '1,/^---$/d' .changeset/observable-state-function-values.md | grep -c .)" -eq 1 && pnpm --filter applesauce-react test</automated>
  </verify>
  <done>The changeset exists with a single `"applesauce-react": patch` entry and a one-line, one-sentence body; the full applesauce-react test suite passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Observable source -> React state | Values emitted by app-provided observables are stored in component state and returned to consumers |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-qkku-01 | Tampering | useObservableState setter call sites | low | mitigate | Updater form stores emitted values verbatim, so a function-valued emission is no longer executed with the previous state as an argument; covered by Task 1 regression tests asserting the function is never called |
| T-qkku-02 | Denial of Service | Consumers calling the returned value (e.g. TimelineLoader) | low | mitigate | Exact-reference `toBe` assertions guarantee consumers receive the callable they expect rather than an Observable that throws when invoked |
</threat_model>

<verification>
- `pnpm --filter applesauce-react test` passes, including the three new function-value tests.
- `pnpm --filter applesauce-react exec tsc --noEmit` passes.
- `git log --oneline -3` shows separate test (RED), fix (GREEN), and changeset commits.
</verification>

<success_criteria>
- `useObservableState` returns the exact function reference emitted by its observable on mount, on later emissions, and after a source swap, without invoking it.
- No changes to the hook's public signature, JSDoc, or `useState` initializer.
- One patch changeset for applesauce-react with a single-sentence body.
</success_criteria>

<output>
Create `.planning/quick/261009-kku-fix-useobservablestate-treating-function/261009-kku-SUMMARY.md` when done
</output>
