---
phase: 18-event-family-re-layer
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-20
---

# Phase 18 Validation Strategy

## Requirement Evidence

| Requirement | Behavioral evidence | Automated command |
|---|---|---|
| EVT-01 | Real WebSocket tests prove one readiness-aware EVENT write/reply, typed EVENT auth refusal, ordinary verdict values, AUTH non-recursion, and clean/unclean termination | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts` |
| EVT-02 | Synchronous handler trace observes AUTH and a fresh second EVENT reply; concurrent publishes prove independent call-scoped state | same relay wire suite plus `src/__tests__/auth-lifecycle-logging.test.ts` |
| EVT-03 | Fixed reply timeout produces an error and a configured transient retry produces a real second EVENT frame | relay wire suite, exact `server.messages` count |
| EVT-04 | EVENT/publish tests and region-scoped searches prove direct typed consumption without gate-symbol threading or response-message reconstruction | relay suite plus source audit described below |
| EVT-05 | Compile-time Relay/Group/Pool narrowing plus region-scoped semantic agreement across D-01, D-07, RAUTH-07, `relay.ts`, `types.ts`, and `auth-retry.ts` | `pnpm --filter applesauce-relay build` plus Plan 18-04's executable semantic audit |
| EVT-06 | Group tests prove one raw attempt per relay; sync SEND trace reaches publish auth policy while AUTH remains raw | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts src/__tests__/group.test.ts src/__tests__/pool.test.ts` |
| RESID-04 | Exact known comments and four held changesets match verdict-only errors, error-channel timeout, and real progress | static audit plus changeset sentence gate |

## Wave 0 Test Obligations

- Add compile-time evidence that Relay, RelayGroup, and RelayPool `event()` reject auth/retry/reconnect/timeout options while their `publish()` methods accept them.
- Add actual-frame tests for additive `1 + authRetries + retries`, synchronous resend with observed second reply, fresh listeners, concurrent independence, and timeout retry.
- Add positive and negative classifier controls: retry reply timeout/reconnectable loss; never retry ordinary verdict, terminal CLOSED, auth exhaustion, handler rejection, or auth timeout.
- Rewrite Group/Pool tables that currently encode raw event auth options, and rewrite sync SEND coverage around publish ownership.

Wave 0 is intentionally recorded as incomplete until Plan 18-01 begins the failing tracer and Plans 18-02/03 add the remaining oracles before their behavior changes.

## Package and Phase Gates

- Per task: run the named focused Vitest file(s), then `pnpm --filter applesauce-relay build`.
- Per wave: run `pnpm --filter applesauce-relay test` after the plan's focused checks.
- Phase close: `pnpm --filter applesauce-relay test && pnpm --filter applesauce-relay build`.
- Type boundary: declaration build plus explicit compile-time negative/positive fixtures.
- Changesets: each affected body equals its filename-specific expected sentence, uses one applesauce-relay package entry, remains one Markdown sentence with no extra paragraph/bullet/code fence, and gives the breaking event signature a major bump.

## Non-Vacuity and Mutation Checks

- Replace the per-subscription attempt factory with a shared listener; the synchronous resend/second-reply test must fail.
- Reset auth state inside generic retry; the exact additive frame-count test must fail.
- Broaden transient classification to include a terminal case; its no-second-frame control must fail.
- Restore synthetic timeout response behavior; the timeout second-frame test must fail.
- Route Group.event through publish or restore raw auth options; raw fan-out/type tests must fail.
- Route sync SEND through raw event; its auth-handler/publish-path regression must fail.

## Static Acceptance Audit

- Scope `AUTH_PHASE_GATE`, `WithAuthPhaseGate`, and `authRequiredSignal` checks to EVENT/publish code and tests; remaining REQ/COUNT/negentropy uses are allowed.
- Search Relay/Group/Pool event signatures, tests, held changesets, and archived RAUTH-07 for stale raw-event auth/retry/timeout claims.
- Search timeout and `PublishResponse.error` prose for claims that client failures create response values.
- Execute region-scoped assertions proving ownership, the additive bound, raw-event narrowing, timeout semantics, and retained multi-hop signaling agree across D-01, D-07, RAUTH-07, `relay.ts`, `types.ts`, and `auth-retry.ts`.
- Compare each affected changeset body for exact equality with its filename-specific expected sentence, in addition to package, sentence, paragraph, bullet, code-fence, and breaking-bump checks.

## Source Coverage Audit

| Source | ID | Item | Plan | Status |
|---|---|---|---|---|
| GOAL | — | event() is one interaction and publish() solely owns retry/auth/timeout policy | 01-02 | COVERED |
| REQ | EVT-01 | One EVENT write/reply and direct AuthRequiredError | 01 | COVERED |
| REQ | EVT-02 | publish-owned auth handling and resend | 02 | COVERED |
| REQ | EVT-03 | Reply timeout is retryable | 01-02 | COVERED |
| REQ | EVT-04 | Remove EVENT gate-symbol threading and message round trip | 02, 04-05 | COVERED |
| REQ | EVT-05 | Restate RAUTH-07 with provenance | 03-05 | COVERED |
| REQ | EVT-06 | Deliberate Group raw fan-out and sync SEND disposition | 03 | COVERED |
| REQ | RESID-04 | Correct publish-error, progress, timeout, and release claims | 04-05 | COVERED |
| CONTEXT | D-01 | One-hop throw from raw event to immediate publish consumer; low/high ownership | 01-02, 04 | COVERED |
| CONTEXT | D-07 | Separate call-scoped budgets and additive write bound | 02, 04 | COVERED |
| CONTEXT | Raw contract | Verdict values, EVENT-only auth throw, readiness, fixed reply bound, clean completion | 01 | COVERED |
| CONTEXT | Publish policy | Sole auth/retry/reconnect/whole-clock owner and terminal classifier | 02 | COVERED |
| CONTEXT | Consumers | Group raw fan-out, Group publish isolation, sync SEND bridge, AUTH remains raw | 03 | COVERED |
| CONTEXT | Proof/provenance | Fresh listener, synchronous handler, concurrency, mutation probes, cross-artifact semantic assertions, and exact changeset-body truth | 02-05 | COVERED |
| RESEARCH | Architecture map | Relay owns raw interaction; publish owns policy; Group/Pool structural propagation | 01-03 | COVERED |
| RESEARCH | Error taxonomy | Verdict values versus typed auth/client/terminal failures | 01-02 | COVERED |
| RESEARCH | Resolved verdict shape | Exported RelayEventVerdictError extends plain Error and remains value-attached | 01 | COVERED |
| RESEARCH | Resolved raw options | Remove RelayEventOptions/options parameter because audited call sites are policy-only | 01, 03 | COVERED |
| RESEARCH | Resolved clean completion | Raw completion stays empty; publish EmptyError is terminal/non-retryable | 01-02 | COVERED |
| RESEARCH | Validation gaps | Compile-time and real-wire non-vacuity oracles | 01-03 | COVERED |
| RESEARCH | Security constraints | Typed boundary, bounded sends, per-call state, auth-clock isolation | 01-05 | COVERED |
| RESEARCH | Package constraint | No new dependency/install | 01-05 | COVERED |

Phase 24's unified sync-owned policy budget is explicitly deferred and excluded. No research out-of-scope item is planned.

## Failure Policy

Any multiplicative EVENT write count, relay verdict entering transient retry, raw event option accepting high-level policy, AUTH recursion, lost sync SEND authentication, shared concurrent gate/counter state, or false held release claim is a stop-and-investigate result.
