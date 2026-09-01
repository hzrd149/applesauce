# Phase 21: Group Error Surface — request()/subscription() - Research

**Researched:** 2026-09-01
**Domain:** RxJS multi-source terminal-state arbitration and lifetime policy
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Export `RelayOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }`. Outcome records are keyed by normalized relay URL; the discriminator distinguishes legitimate values from failures and is the single per-source entry representation reused by Phase 23 count isolation.
- **D-02:** Export `RelayGroupError extends AggregateError` with stable `name = "RelayGroupError"`, fixed top-level message `"All relays failed"`, and `outcomes: Readonly<Record<string, RelayOutcome<never>>>`. Preserve native ordered `AggregateError.errors`; construct both views from the same URL-entry sequence and preserve each original cause by identity.
- **D-03:** Do not add custom JSON serialization. Unknown causes, native errors, and cyclic values cannot be serialized reliably; callers use `outcomes` for URL lookup and native `errors` for aggregate tooling.
- **D-04:** Only per-relay Observable errors count as failures. `EOSE` is successful request completion, and ordinary `CLOSED` remains a protocol lifecycle value unless the relay layer converts it into an error. All relays returning EOSE with zero events is successful empty output.
- **D-05:** Earlier events do not permanently immunize an operation from later total failure. If every currently active relay subsequently fails, the returned Observable errors even after emitting values. A surviving live relay or successful request EOSE prevents total-failure aggregation.
- **D-06:** Keep one public `timeout`; do not add first-progress or idle timeout options. It is primarily a convenience so consumers do not have to wrap the returned Observable in their own RxJS timeout operator.
- **D-07:** `request().timeout` is one whole logical returned-Observable lifetime budget from subscription until completion/error. Preserve the 30-second default. Events, EOSE, retries, and reconnections never disarm or reset it, closing the early-event-then-hang gap.
- **D-08:** `subscription()` has no default lifetime cap. Omitted or `false` means indefinite; an explicitly supplied numeric timeout is the caller-selected total subscription lifetime and never resets on activity or reconnection.
- **D-09:** Every enabled whole-operation timeout uses the existing call-scoped shared `AuthPhaseGate`. While any relay in the fan-out is actively authenticating, the clock pauses with its remaining budget preserved; overlapping auth phases resume it only after all finish.
- **D-10:** Explicitly amend GROUP-04 and Roadmap criteria derived from it: replace the proposed separately configurable first-progress/idle clocks with this single whole-returned-Observable lifetime contract. Restate GROUP-05 as applying to every enabled whole-operation clock while preserving auth suspension.
- **D-11:** Evaluate all-failed state against the latest active membership emitted by `relays$`. Each emission replaces the accounting cohort: added relays enter pending; removed relays and their outcomes leave immediately.
- **D-12:** An empty cohort never raises `RelayGroupError`. A finite `request()` on an empty active cohort completes successfully with no events immediately; if removals make it empty later, it completes then. A dynamic `subscription()` on an empty cohort remains open for future relays until caller unsubscribe or an explicit whole-lifetime timeout.
- **D-13:** Track current state per active URL. `EVENT` is progress but not terminal immunity. For `request()`, EOSE is successful terminal settlement and prevents the cohort from being all failed; for `subscription()`, EOSE is activity and the relay remains live. A later recognized failure replaces prior live/progress state.
- **D-14:** Use one shared terminal-state decision rather than competing completion/error observers. Request empty → complete; request all terminal failures → error; request all terminal with at least one EOSE → complete. Subscription empty → pending; subscription all failed → error.
- **D-15:** Mixed request outcomes remain successful: at least one EOSE plus failures completes normally. Only a non-empty latest cohort whose every member failed raises the aggregate.
- **D-16:** Preserve caller-supplied request `complete` operators. They may intentionally complete earlier, but if custom completion and all-failed are triggered by the same final ERROR, aggregate failure wins. Supplying `complete` never implicitly opts out of the default total-failure guarantee.
- **D-17:** Forward the Group contract unchanged through `RelayPool.request()`, `subscription()`, `subscriptionMap()`, and `outboxSubscription()`. Do not wrap or translate `RelayGroupError`; Pool callers receive the same error instance, normalized outcomes, timeout semantics, and dynamic-membership behavior.
- **D-18:** Raw `req()` retains its existing per-relay lifecycle/error bookkeeping surface. The new aggregate error belongs to high-level request/subscription members.
- **D-19:** Ship one focused major changeset for `applesauce-relay`, because default terminal behavior changes from empty completion or silent hanging to an Observable error. The changeset body is exactly one markdown sentence.
- **D-20:** Update existing Group/Pool documentation in place with concise error-handler, outcome-field, empty-cohort, and whole-timeout guidance. Do not create a standalone best-practices document.
- **D-21:** Add runtime export snapshot coverage for `RelayGroupError`, compile-time coverage for `RelayOutcome` and Group/Pool timeout forwarding, and real-wire tests for Group plus all Pool forwarding families.
- **D-22:** Tests must prove: all-failed before and after events; mixed EOSE/error success; empty static/dynamic request completion; empty dynamic subscription persistence; membership add/remove replacement; same-final-message error precedence over custom completion; request 30s whole deadline; explicit subscription lifetime; no activity reset; overlapping auth suspension; preserved cause identity and normalized URL keys.

### the agent's Discretion

- Choose internal state-machine/operator decomposition and names for private helpers, provided one shared settlement decision owns the final ERROR/completion race.
- Choose focused test-file placement and timeout error subtype consistent with existing relay errors.

### Deferred Ideas (OUT OF SCOPE)

- Phase 23 applies `RelayOutcome<RelayCountResponse>` to progressive group count records; this phase establishes but does not implement that count surface.
- Per-relay independent liveness clocks and idle-death detection for otherwise connected silent subscriptions remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GROUP-01 | High-level Group request/subscription error on total relay failure by default. | Cohort reducer and method-specific settlement table below. [VERIFIED: codebase and locked context] |
| GROUP-02 | Aggregate retains every relay cause keyed by URL. | `RelayGroupError` construction pattern below. [VERIFIED: locked context] |
| GROUP-03 | Group errors and Phase 23 count use one per-source outcome shape. | Export `RelayOutcome<T>` now; Phase 23 is otherwise deferred. [VERIFIED: locked context] |
| GROUP-04 | Amended: one whole-returned-Observable lifetime clock. | Custom suspendable lifetime operator; activity never resets it. [VERIFIED: locked D-06–D-10] |
| GROUP-05 | Amended: every enabled lifetime clock suspends during shared auth phases. | One call-scoped counter-based `AuthPhaseGate` is threaded to every relay. [VERIFIED: codebase and locked context] |
</phase_requirements>

## Summary

The implementation should preserve raw `req()` and replace only the high-level Group terminal pipeline. `internalSubscription()` currently converts relay Observable errors into URL-bearing `ERROR` values, but it does not expose cohort replacement to downstream logic. `completeWhen()` also creates a competing notifier subscription, so adding an independent all-failed observer would leave the final-ERROR race dependent on subscription order. [VERIFIED: `group.ts`, `complete-when.ts`]

Build one private cohort-aware arbitration path shared by `request()` and `subscription()`. It must receive a membership snapshot before subscribing to that cohort's inners, mutate URL-keyed state, and decide error/complete/continue in one place. Retained URLs keep state, added URLs start pending, removed URLs disappear, and synchronous relay emissions are therefore evaluated against the new cohort. [VERIFIED: codebase and locked D-11–D-16]

The existing `suspendableTimeout()` is first-progress-only and permanently disarms on an accepted value. Phase 21 needs a sibling or generalized whole-lifetime mode that stays armed until terminal teardown, preserves remaining time across the shared auth gate, and is applied after group arbitration but before event filtering/sharing. RxJS's stock `timeout` is first/gap-relative, not an auth-pausable absolute operation lifetime. [VERIFIED: `auth-retry.ts`] [CITED: https://rxjs.dev/api/operators/timeout]

**Primary recommendation:** implement a private membership-first cohort stream plus one terminal reducer/arbitrator, and add a reusable suspendable lifetime operator; keep Pool as transparent delegation. [VERIFIED: codebase]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Cohort membership and terminal arbitration | API / Backend (`RelayGroup`) | RxJS operator | Group owns fan-out and high-level terminal semantics. [VERIFIED: codebase] |
| Per-relay transport failure | API / Backend (`Relay.req`) | Group adapter | Relay errors enter the Observable error channel; Group converts them to internal bookkeeping. [VERIFIED: codebase] |
| Whole-operation deadline/auth pause | Shared operator | Group request/subscription | `AuthPhaseGate` already represents overlapping auth phases. [VERIFIED: codebase] |
| Pool propagation | API / Backend (`RelayPool`) | `RelayGroup` | Pool delegates and must preserve error identity. [VERIFIED: codebase] |
| Public outcome/error types | Package API (`types.ts`, `group.ts`, `index.ts`) | Phase 23 count | The shape is a cross-family public contract. [VERIFIED: locked context] |

## Project Constraints (from AGENTS.md)

- Update existing component docs with What it is, How to use it, Integration, and Best Practices; do not create a standalone best-practices file. [VERIFIED: `AGENTS.md`]
- Keep documentation code blocks focused and about 20 lines maximum; avoid duplication and summary sections. [VERIFIED: `AGENTS.md`]
- Verify examples, navigation, and orphan/duplicate files before completing documentation work. [VERIFIED: `AGENTS.md`]
- The changeset must describe exactly one change and have a one-sentence Markdown body; use the smallest applicable bump, locked here to major. [VERIFIED: `AGENTS.md` and D-19]

## Standard Stack

### Core

| Library / Asset | Version | Purpose | Why Standard |
|-----------------|---------|---------|--------------|
| `rxjs` | manifest `^7.8.1`, registry `7.8.2` (published 2025-02-22) | Observable fan-out, sharing, custom operators | Existing relay execution model; no new dependency is needed. [VERIFIED: npm registry and codebase] |
| TypeScript | project `^7.0.2` | Discriminated outcome and option propagation | Existing compiler/declaration surface. [VERIFIED: package manifest] |
| Native `AggregateError` | platform | Ordered aggregate causes | Standard multi-error container with an `errors` array. [CITED: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError] |

### Supporting

| Asset | Purpose | When to Use |
|-------|---------|-------------|
| `AuthPhaseGate` | Counter-based auth pause coordination | One new instance per returned high-level Observable operation. [VERIFIED: codebase] |
| `reverseSwitchMap` | Gap-free dynamic cohort replacement | Preserve if the membership-first control signal is guaranteed before new inner subscription. [VERIFIED: codebase] |
| Vitest + websocket mock + observer spy | Real-wire and Observable assertions | Existing Group/Pool suites. [VERIFIED: codebase] |

**Installation:** none. [VERIFIED: phase scope]

## Package Legitimacy Audit

No package is installed. Existing `rxjs` passed the npm legitimacy seam (`OK`, ~104M weekly downloads, upstream Reactivex repository, no postinstall); no dependency task belongs in the plan. [VERIFIED: npm registry and package-legitimacy seam]

## Architecture Patterns

### System Architecture Diagram

```text
relays$ replacement
  -> COHORT snapshot (normalized URL order) first
  -> subscribe new relay inners -> OPEN/EVENT/EOSE/CLOSED/internal ERROR
  -> single state mutation + settlement decision
       request: empty -> complete
                all failed -> RelayGroupError
                all terminal + any EOSE -> complete
       subscription: empty -> remain open
                     all failed -> RelayGroupError
  -> whole-lifetime auth-suspendable clock
  -> EVENT filter/dedupe/share -> caller

RelayPool family -> RelayGroup unchanged -> same error instance
```

### Recommended Project Structure

```text
packages/relay/
├── src/group.ts                         # aggregate error + cohort arbitrator
├── src/types.ts                         # RelayOutcome + timeout option types
├── src/operators/auth-retry.ts          # suspendable lifetime clock
├── src/__tests__/group-error.test.ts     # focused state/clock proofs
├── src/__tests__/pool.test.ts            # four forwarding families
├── src/__tests__/exports.test.ts         # runtime class export
└── type-tests/group-error-types.ts       # compile-time surface
```

### Pattern 1: Membership-First Cohort Stream

Emit a private cohort control value before subscribing to new inners; otherwise synchronous `OPEN`/`ERROR` can be evaluated against the previous cohort. Key and deduplicate by normalized URL, not Relay object. Keep this private so raw `req()` retains `GroupReqMessage`. [VERIFIED: codebase and D-11/D-18]

```typescript
return relays$.pipe(
  reverseSwitchMap((relays) => {
    const cohort = normalizeCohort(relays);
    return concat(of({ kind: "COHORT", cohort }), merge(...createInners(cohort)));
  }),
);
```

### Pattern 2: One State Mutation, One Decision

Use states `pending | live | eose | failed`. `EVENT` sets live, request `EOSE` sets successful terminal, subscription `EOSE` stays live, and `ERROR` replaces any prior state with failed. After every cohort/message mutation, evaluate the method-specific table exactly once. [VERIFIED: D-12–D-16]

| Method | Cohort | Decision |
|--------|--------|----------|
| request | empty | complete |
| request | non-empty, every state failed | error |
| request | all terminal, at least one EOSE | complete |
| subscription | empty | continue |
| subscription | non-empty, every state failed | error |
| either | otherwise | continue |

Custom completion is an advisory signal inside this arbitration path. For a message that both triggers custom completion and makes the cohort all-failed, update state and choose aggregate error before honoring completion. Do not place `completeWhen(custom)` beside a separate error observer. [VERIFIED: `complete-when.ts` race and D-16]

### Pattern 3: Construct Both Error Views from One Sequence

Normalize and retain cohort order, collect `[url, cause]` entries once, pass `entries.map(([, cause]) => cause)` to `super`, and create `outcomes` from those same entries. Pin `name`; do not clone/wrap causes or add serialization. [VERIFIED: D-01–D-03]

```typescript
export class RelayGroupError extends AggregateError {
  readonly outcomes: Readonly<Record<string, RelayOutcome<never>>>;
  constructor(entries: readonly (readonly [string, unknown])[]) {
    super(entries.map(([, cause]) => cause), "All relays failed");
    this.name = "RelayGroupError";
    this.outcomes = Object.fromEntries(entries.map(([url, error]) => [url, { ok: false, error }]));
  }
}
```

`Readonly` is a TypeScript contract, not runtime immutability; freezing was not requested. [VERIFIED: locked public type]

### Pattern 4: Whole-Lifetime Suspendable Clock

Add a sibling such as `suspendableLifetimeTimeout` or an explicit mode to the existing helper. It starts on subscription, never observes/reset/disarms for `next`, subtracts only active non-auth elapsed time, and clears on error/complete/unsubscribe. Request resolves omitted to `30_000`; subscription resolves omitted/`false` to identity and a number to enabled lifetime. Thread the same private `AUTH_PHASE_GATE` into every `relay.req()` call for both methods. [VERIFIED: `auth-retry.ts`, D-07–D-09]

The timeout is an operation error, not a per-relay failure, so it must not be inserted into `RelayGroupError.outcomes`. Reuse RxJS `TimeoutError` or the existing project-consistent timeout factory; lock its test by type/name rather than fragile prose unless a new public subtype is intentionally introduced. [VERIFIED: locked discretion and existing error patterns]

### Anti-Patterns to Avoid

- **Competing terminal subscriptions:** makes final ERROR versus custom completion order-dependent. [VERIFIED: `completeWhen` implementation]
- **Message-only membership inference:** cannot distinguish removed relays or complete an empty request because the outer membership Observable stays open. [VERIFIED: `internalSubscription`]
- **First-progress timeout reuse:** existing helper disarms forever on the first event. [VERIFIED: `suspendableTimeout`]
- **Object-keying by raw URL/Relay:** violates normalized URL contract and mishandles logically duplicate sources. [VERIFIED: D-01/D-11]
- **Treating CLOSED as failure:** violates the protocol-value boundary. [VERIFIED: D-04]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-error container | Custom error list protocol | Native `AggregateError` subclass | Keeps standard `errors` tooling and inheritance. [CITED: MDN AggregateError] |
| URL canonicalization | Local string cleanup | Existing `normalizeURL` helper | Pool already uses the project normalization contract. [VERIFIED: `pool.ts`] |
| Auth overlap | Boolean pause flag | Existing counter-based `AuthPhaseGate` | Overlap would resume a boolean gate early. [VERIFIED: `auth-retry.ts`] |
| Dynamic fan-out | Manual socket lifecycle | Existing Group fan-out/reverse-switch pattern | Preserves relay subscription teardown and sharing. [VERIFIED: codebase] |

## Common Pitfalls

### Final ERROR loses to custom completion
**What goes wrong:** the Observable completes instead of raising `RelayGroupError`.  
**Avoid:** state mutation and all-failed decision must precede custom completion for the same source notification.  
**Proof:** use a custom operator that turns the final `ERROR` into a synchronous truthy value. [VERIFIED: codebase]

### New cohort receives a synchronous message before accounting replacement
**What goes wrong:** a new relay error is ignored or evaluated with removed relays.  
**Avoid:** emit the cohort control record before subscribing to new inners. [VERIFIED: reverse-switch semantics]

### Earlier EVENT disarms the request clock
**What goes wrong:** early-event-then-hang remains unbounded.  
**Avoid:** lifetime clock ignores `next`; rewrite the current CR-02 control test that expects an event to cancel the clock. [VERIFIED: existing group tests and D-07]

### Empty behavior collapses across methods
**What goes wrong:** empty dynamic subscription completes, or empty request hangs.  
**Avoid:** encode empty handling in the method mode, not `merge([])` completion behavior. [VERIFIED: D-12]

## Code Examples

### Consumer error handling

```typescript
group.request(filters).subscribe({
  next: handleEvent,
  error(error) {
    if (error instanceof RelayGroupError) {
      for (const [url, outcome] of Object.entries(error.outcomes)) report(url, outcome.error);
    }
  },
});
```

Source: locked public API contract and native Observable error handling. [VERIFIED: codebase]

## State of the Art

| Old Approach | Current Phase Contract | Impact |
|--------------|------------------------|--------|
| Group relay errors become bookkeeping values then filter away | Non-empty all-failed becomes typed Observable error | Default behavior is breaking; major changeset. [VERIFIED: codebase/D-19] |
| Request timeout ends on first progress | One auth-suspendable whole-lifetime budget | Early activity cannot hide a later hang. [VERIFIED: codebase/D-07] |
| Subscription has no timeout option | Optional explicit lifetime, no default | Long-lived silence remains valid unless caller opts in. [VERIFIED: D-08] |
| Completion and failure are separate observers | One cohort settlement arbitrator | Deterministic same-message precedence. [VERIFIED: codebase/D-16] |

## Assumptions Log

All implementation claims were verified against locked context, repository source, official RxJS documentation, or MDN. No `[ASSUMED]` claims remain.

## Open Questions

None blocking. Private helper names and whether to add a sibling lifetime operator or explicit mode remain deliberate implementation discretion; prefer a sibling to avoid changing Phase 13 first-progress consumers. [VERIFIED: call-site analysis]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build/tests | ✓ | 22.23.1 | — |
| pnpm | workspace commands | ✓ | 11.10.0 | — |
| Vitest | relay tests | ✓ | 4.1.10 | — |
| TypeScript | type/build gate | ✓ | project `^7.0.2` | — |

**Missing dependencies with no fallback:** none. [VERIFIED: local environment]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 + `vitest-websocket-mock` + observer spy |
| Config file | workspace/project defaults; `packages/relay/tsconfig.type-tests.json` for compile-time fixtures |
| Quick run command | `pnpm --filter applesauce-relay test -- group-error.test.ts` |
| Full suite command | `pnpm --filter applesauce-relay test && pnpm --filter applesauce-relay build && pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| GROUP-01 | total failure before/after events; mixed success | real-wire/unit | `pnpm --filter applesauce-relay test -- group-error.test.ts` | ❌ Wave 0 |
| GROUP-02 | normalized keys, ordering, cause identity | unit | same | ❌ Wave 0 |
| GROUP-03 | exported generic outcome type | compile/runtime export | type-test + exports test | ❌ Wave 0 |
| GROUP-04 | request default and explicit subscription whole lifetimes; no reset | fake/real timer | same | ❌ Wave 0 |
| GROUP-05 | overlapping auth suspension | real-wire timing | same | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** focused relay test file plus type test when public types change.
- **Per wave merge:** full relay test/build/type-test command.
- **Phase gate:** full relay suite, build, type tests, and changeset format green.

### Wave 0 Gaps

- [ ] `packages/relay/src/__tests__/group-error.test.ts` — state, empty, membership, precedence, timeout, auth proofs.
- [ ] `packages/relay/type-tests/group-error-types.ts` — `RelayOutcome` and Group/Pool timeout forwarding.
- [ ] Pool real-wire cases for `request`, `subscription`, `subscriptionMap`, and `outboxSubscription`.
- [ ] Update the existing event-cancels-clock expectation to the new lifetime contract.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing relay auth handler and shared `AuthPhaseGate`; no auth redesign. [VERIFIED: codebase] |
| V3 Session Management | no | Library does not own user sessions. [VERIFIED: phase boundary] |
| V4 Access Control | no | No authorization policy is added. [VERIFIED: phase boundary] |
| V5 Input Validation | yes | Normalize relay URLs and treat causes as opaque values; do not deserialize/execute them. [VERIFIED: codebase] |
| V6 Cryptography | no | No cryptographic operation changes. [VERIFIED: phase boundary] |

### Known Threat Patterns for the Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prototype-sensitive URL keys | Tampering | Construct outcome records with `Object.fromEntries` from normalized known URL entries; test `__proto__`-like inputs if normalization permits them. [VERIFIED: public record contract] |
| Cause object mutation/serialization | Tampering/DoS | Preserve opaque identity and provide no custom serialization. [VERIFIED: D-02/D-03] |
| Timer/resource leak | Denial of Service | Clear clock and unsubscribe gate/source on every terminal path. [VERIFIED: existing operator teardown pattern] |

## Sources

### Primary (HIGH confidence)

- Repository: `packages/relay/src/group.ts`, `pool.ts`, `types.ts`, `operators/auth-retry.ts`, `operators/complete-when.ts`, `operators/reverse-switch-map.ts`, and relay tests — current behavior and seams.
- `.planning/phases/21-group-error-surface-request-subscription/21-CONTEXT.md` — locked semantics and requirement amendments.
- `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md` and `19-RESEARCH.md` — URL-keyed outcome and whole-operation timeout precedent.

### Secondary (MEDIUM confidence)

- https://rxjs.dev/api/operators/timeout — RxJS 7.8.2 first/each timeout semantics.
- https://rxjs.dev/guide/operators — custom Observable operator and teardown pattern.
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError — native aggregate contract.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing dependency and registry verified.
- Architecture: HIGH — derived from current source plus locked decisions.
- Pitfalls: HIGH — reproduced structurally from current operator composition.

**Research date:** 2026-09-01  
**Valid until:** 2026-10-01
