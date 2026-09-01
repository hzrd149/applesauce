# Phase 21: Group Error Surface — request()/subscription() - Context

> **Phase 22 D-23/D-24 amendment:** The subscription lifetime and subscription `authSuspendableLifetime` claims below are historical and superseded. Relay, Group, and Pool subscriptions now have no built-in duration or inactivity timeout; callers compose RxJS bounds. Request retains its auth-suspended 30-second whole lifetime, and non-empty aggregate total failure remains immediate.

**Gathered:** 2026-09-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Make RelayGroup and RelayPool request/subscription families report non-empty total relay failure as a typed Observable error, establish the URL-keyed per-source outcome representation Phase 23 will reuse, and give callers one convenient whole-returned-Observable timeout without redefining long-lived subscription silence as failure.

</domain>

<decisions>
## Implementation Decisions

### Aggregate Failure Representation
- **D-01:** Export `RelayOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }`. Outcome records are keyed by normalized relay URL; the discriminator distinguishes legitimate values from failures and is the single per-source entry representation reused by Phase 23 count isolation.
- **D-02:** Export `RelayGroupError extends AggregateError` with stable `name = "RelayGroupError"`, fixed top-level message `"All relays failed"`, and `outcomes: Readonly<Record<string, RelayOutcome<never>>>`. Preserve native ordered `AggregateError.errors`; construct both views from the same URL-entry sequence and preserve each original cause by identity.
- **D-03:** Do not add custom JSON serialization. Unknown causes, native errors, and cyclic values cannot be serialized reliably; callers use `outcomes` for URL lookup and native `errors` for aggregate tooling.
- **D-04:** Only per-relay Observable errors count as failures. `EOSE` is successful request completion, and ordinary `CLOSED` remains a protocol lifecycle value unless the relay layer converts it into an error. All relays returning EOSE with zero events is successful empty output.
- **D-05:** Earlier events do not permanently immunize an operation from later total failure. If every currently active relay subsequently fails, the returned Observable errors even after emitting values. A surviving live relay or successful request EOSE prevents total-failure aggregation.

### Whole Returned-Observable Timeout
- **D-06:** Keep one public `timeout`; do not add first-progress or idle timeout options. It is primarily a convenience so consumers do not have to wrap the returned Observable in their own RxJS timeout operator.
- **D-07:** `request().timeout` is one whole logical returned-Observable lifetime budget from subscription until completion/error. Preserve the 30-second default. Events, EOSE, retries, and reconnections never disarm or reset it, closing the early-event-then-hang gap.
- **D-08:** `subscription()` has no default lifetime cap. Omitted or `false` means indefinite; an explicitly supplied numeric timeout is the caller-selected total subscription lifetime and never resets on activity or reconnection.
- **D-09:** Every enabled whole-operation timeout uses the existing call-scoped shared `AuthPhaseGate`. While any relay in the fan-out is actively authenticating, the clock pauses with its remaining budget preserved; overlapping auth phases resume it only after all finish.
- **D-10:** Explicitly amend GROUP-04 and Roadmap criteria derived from it: replace the proposed separately configurable first-progress/idle clocks with this single whole-returned-Observable lifetime contract. Restate GROUP-05 as applying to every enabled whole-operation clock while preserving auth suspension.

### Dynamic Membership and Settlement
- **D-11:** Evaluate all-failed state against the latest active membership emitted by `relays$`. Each emission replaces the accounting cohort: added relays enter pending; removed relays and their outcomes leave immediately.
- **D-12:** An empty cohort never raises `RelayGroupError`. A finite `request()` on an empty active cohort completes successfully with no events immediately; if removals make it empty later, it completes then. A dynamic `subscription()` on an empty cohort remains open for future relays until caller unsubscribe or an explicit whole-lifetime timeout.
- **D-13:** Track current state per active URL. `EVENT` is progress but not terminal immunity. For `request()`, EOSE is successful terminal settlement and prevents the cohort from being all failed; for `subscription()`, EOSE is activity and the relay remains live. A later recognized failure replaces prior live/progress state.
- **D-14:** Use one shared terminal-state decision rather than competing completion/error observers. Request empty → complete; request all terminal failures → error; request all terminal with at least one EOSE → complete. Subscription empty → pending; subscription all failed → error.
- **D-15:** Mixed request outcomes remain successful: at least one EOSE plus failures completes normally. Only a non-empty latest cohort whose every member failed raises the aggregate.

### Custom Completion and Pool Propagation
- **D-16:** Preserve caller-supplied request `complete` operators. They may intentionally complete earlier, but if custom completion and all-failed are triggered by the same final ERROR, aggregate failure wins. Supplying `complete` never implicitly opts out of the default total-failure guarantee.
- **D-17:** Forward the Group contract unchanged through `RelayPool.request()`, `subscription()`, `subscriptionMap()`, and `outboxSubscription()`. Do not wrap or translate `RelayGroupError`; Pool callers receive the same error instance, normalized outcomes, timeout semantics, and dynamic-membership behavior.
- **D-18:** Raw `req()` retains its existing per-relay lifecycle/error bookkeeping surface. The new aggregate error belongs to high-level request/subscription members.

### Release and Proof
- **D-19:** Ship one focused major changeset for `applesauce-relay`, because default terminal behavior changes from empty completion or silent hanging to an Observable error. The changeset body is exactly one markdown sentence.
- **D-20:** Update existing Group/Pool documentation in place with concise error-handler, outcome-field, empty-cohort, and whole-timeout guidance. Do not create a standalone best-practices document.
- **D-21:** Add runtime export snapshot coverage for `RelayGroupError`, compile-time coverage for `RelayOutcome` and Group/Pool timeout forwarding, and real-wire tests for Group plus all Pool forwarding families.
- **D-22:** Tests must prove: all-failed before and after events; mixed EOSE/error success; empty static/dynamic request completion; empty dynamic subscription persistence; membership add/remove replacement; same-final-message error precedence over custom completion; request 30s whole deadline; explicit subscription lifetime; no activity reset; overlapping auth suspension; preserved cause identity and normalized URL keys.

### the agent's Discretion
- Choose internal state-machine/operator decomposition and names for private helpers, provided one shared settlement decision owns the final ERROR/completion race.
- Choose focused test-file placement and timeout error subtype consistent with existing relay errors.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract
- `.planning/ROADMAP.md` § Phase 21 — goal and success criteria; criteria 2, 4, and 5 require the explicit timeout provenance amendments recorded above.
- `.planning/REQUIREMENTS.md` § Group Error Surface — GROUP-01 through GROUP-05; GROUP-04 and GROUP-05 require the recorded restatement.
- `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md` — established URL-keyed count surface and whole-operation timeout precedent consumed by the shared outcome design.

### Existing Public Behavior
- `apps/docs/loading/relays/pool.md` — current primary multi-relay request/subscription examples requiring error guidance.
- `apps/docs/migration/v5-v6.md` — documented custom group completion operators that must remain supported.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RelayGroup.internalSubscription()` already converts each relay Observable failure to a URL-bearing `GroupReqErrorMessage` and uses `reverseSwitchMap` for dynamic membership.
- `AuthPhaseGate` and `suspendableTimeout` already implement counter-based shared auth suspension with remaining-budget preservation.
- `RelayGroup.completeOnAllEose()` and other completion helpers supply established finite-request customization points.

### Established Patterns
- Protocol lifecycle frames are values; transport/client failures use Observable errors.
- Relay package error classes are exported with stable explicit names and preserve original causes.
- Pool options derive from Group method parameter types and delegate without translating results.
- Changesets describe exactly one change in a single sentence.

### Integration Points
- `packages/relay/src/group.ts` owns dynamic fan-out, terminal accounting, completion, and group timeout behavior.
- `packages/relay/src/types.ts` owns `RelayOutcome`, Group options, and internal message unions.
- `packages/relay/src/pool.ts` forwards request/subscription families, including controlled dynamic groups.
- `packages/relay/src/__tests__/group.test.ts`, pool tests, type fixtures, export snapshots, and relay docs guard the public surface.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly wants `timeout` as convenience equivalent to applying a whole-returned-Observable RxJS timeout, not two liveness policy clocks.
- Finite requests and persistent subscriptions intentionally differ on empty cohorts and default lifetime: empty request completes; empty subscription remains available for future relays.

</specifics>

<deferred>
## Deferred Ideas

- Phase 23 applies `RelayOutcome<RelayCountResponse>` to progressive group count records; this phase establishes but does not implement that count surface.
- Per-relay independent liveness clocks and idle-death detection for otherwise connected silent subscriptions remain out of scope.

</deferred>

---

*Phase: 21-group-error-surface-request-subscription*
*Context gathered: 2026-09-01*
