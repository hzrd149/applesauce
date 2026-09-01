# Phase 22: REQ Family Re-layer - Research

**Researched:** 2026-09-01
**Domain:** RxJS/Nostr REQ lifecycle ownership and public TypeScript API layering
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Raw `req()` preserves full `FilterInput`, accepts only `id?: string`, mints one call-scoped ID, waits for readiness, shares one live interaction among concurrent subscribers, emits synthetic `OPEN` and matching `EVENT`/`EOSE`/ordinary `CLOSED`, and never authenticates, reconnects, repeats, resends, or times out.
- Raw ordinary `CLOSED` is emitted inclusively then completes; `auth-required:` becomes `AuthRequiredError`; recognized terminal prefixes become typed `RelayClosedError` subclasses; socket/client failures error. Local teardown sends exactly one `CLOSE` while open and none after relay `CLOSED`; EOSE is non-terminal.
- Finite `request()` owns a call-scoped auth gate/counter, one logical REQ ID, fresh unshared raw attempts for auth/reconnect/repeat, positive-only unclean transport reconnect (default three), optional clean-CLOSED repeat, and a 30-second whole returned-Observable lifetime suspended with remaining budget during auth. Terminal/protocol/programming errors do not retry.
- Default request emits only events and completes at first EOSE; custom completion operators retain lifecycle messages and finish successfully unless the same terminal notification also errors.
- Persistent `subscription()` owns bounded auth, positively identified unclean reconnect, and optional ordinary clean-CLOSED repeat; reuses one ID; hides each internal OPEN; emits EOSE for every attempt; has no duration/inactivity timeout at Relay, Group, or Pool.
- Direct Relay subscription remains non-deduplicating. Group/Pool keep one call-scoped event store outside re-establish attempts; `eventStore: null` disables dedupe. Non-empty total Group/Pool failure still errors immediately.
- Public option types are positive declarations: `RelayReqOptions` ID only; request has ID/auth/reconnect/resubscribe/timeout/complete; subscription has ID/auth/reconnect/resubscribe only; Group adds only its completion/dedupe fields; Pool derives Group signatures. Do not use broad `Omit` or handwritten Pool duplicates.
- Build one private lifecycle compositor around fresh raw attempts. Relay high-level methods and Group consume retained OPEN/EOSE/CLOSED metadata; do not duplicate loops or reconstruct metadata from public mapped streams.
- Rewire sync RECEIVE to the finite high-level/private compositor so operation-scoped auth remains intact. Group raw req remains raw fan-out.
- Mutation proof is mandatory: reverting fresh attempt construction must lose synchronous-auth resend observation; moving repeat state into attempt scope must stop the next repeat; treating OPEN as progress must break auth bounds; treating Group ERROR as progress must break timeout/settlement evidence.
- Add exact wire/listener/CLOSE counts, positive reconnect allowlist, terminal single-attempt, independent concurrent gates/counters, stable ID, hidden OPEN, repeated EOSE, and Group/Pool dedupe-across-re-establishment proofs.
- Reverse Phase 21's subscription timeout everywhere: provenance, requirements, Roadmap, docs, tests, runtime/type surface, `authSuspendableLifetime` use, and pending changeset. Preserve request whole-timeout/auth suspension and immediate total-failure settlement. Replace subscription-timeout assertions with compile-time rejection and immediate-failure proofs.
- Update existing docs with concise caller-composed RxJS duration/inactivity examples and add exactly one focused one-sentence major `applesauce-relay` Phase 22 changeset.

### the agent's Discretion

- Choose private compositor/helper names and RxJS decomposition consistent with existing EVENT/AUTH family patterns.
- Choose exact type-fixture/test-file placement and concise documentation examples.

### Deferred Ideas (OUT OF SCOPE)

- Phase 24 may consolidate sync-owned auth/retry policy after Phase 22 preserves current RECEIVE behavior.
- Direct Relay subscription deduplication remains out of scope; Group/Pool own that stateful convenience.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| REQ-01 | Raw `req()` owns one interaction, not auth/reconnect/repeat | Raw-attempt boundary and teardown matrix below |
| REQ-02 | High-level request/subscription own policy | Private compositor state machine and error classifier |
| REQ-03 | Specify subscription re-establishment behavior | Stable ID, hidden OPEN, repeated EOSE, call-scoped dedupe |
| REQ-04 | Re-prove Phase 13 defects RED→GREEN | Four explicit mutation probes and non-vacuity oracles |
| REQ-05 | Split option types so policy cannot leak to req | Positive type declarations and Pool-derived signatures |
</phase_requirements>

## Summary

The safest plan is extraction, not a rewrite: retain the current per-attempt socket filter/write/finalize machinery as the raw `req()` implementation, then move its existing auth/reconnect/repeat operators into one private lifecycle compositor. The compositor must accept a fresh-attempt factory, keep ID/gate/auth counter/clean-CLOSED state at call scope, preserve lifecycle messages internally, and expose policy configuration to both Relay and Group. [VERIFIED: codebase grep]

Phase 21 introduced a subscription lifetime that Phase 22 explicitly reverses. Remove `timeout` from every subscription type and forwarding path and remove `authSuspendableLifetime` only from subscription composition; request retains a whole-lifetime 30-second clock and Group total-failure remains immediate. [VERIFIED: 22-CONTEXT.md]

**Primary recommendation:** implement raw attempt extraction first, then one lifecycle compositor, then rewire Relay/Group/sync consumers, and only afterward change public types/docs/provenance.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| One REQ wire interaction | Relay protocol layer | WebSocket transport | Owns listener-before-write, message parsing, readiness, CLOSE teardown |
| Auth/reconnect/repeat policy | Relay high-level composition | Group orchestration | Policy spans multiple raw interactions |
| Group settlement/dedupe | Group orchestration | Relay lifecycle compositor | Requires per-relay metadata but group-scoped cohort/store state |
| Pool forwarding | Pool facade | Group | Signatures must derive from Group to prevent drift |
| Sync RECEIVE preservation | Sync orchestration | Private lifecycle compositor | Needs finite/auth-aware behavior without exposing policy on raw req |

## Project Constraints (from AGENTS.md)

- Documentation must update existing topic docs, include Integration and focused Best Practices sections, avoid standalone best-practice or summary files, avoid duplication, and keep code blocks focused at roughly 20 lines maximum.
- Verify examples, update navigation only if files are added, and leave no orphaned/duplicate docs.
- Each changeset describes exactly one change and its body is exactly one markdown sentence.

## Standard Stack

No packages are added. Use the installed `rxjs` 7.8.x operators and existing relay helpers. The registry currently reports RxJS 7.8.2 (modified 2026-08-04), while `applesauce-relay` declares `^7.8.1`. [VERIFIED: npm registry]

| Component | Existing version | Purpose |
|---|---:|---|
| RxJS | `^7.8.1` | `defer`, `share`, retry/repeat, lifecycle teardown and caller timeout composition |
| TypeScript | `^7.0.2` | Positive public option types and compile-time rejection fixtures |
| Vitest | `^4.0.15` | Real-wire, fake-timer, mutation, export and regression tests |

## Architecture Patterns

### System Architecture Diagram

```text
FilterInput -> raw req attempt -> OPEN -> EVENT / EOSE / CLOSED
                    |                         | auth-required / typed failure
                    +-- exact CLOSE teardown  v
              private lifecycle compositor (stable ID + call-scoped budgets)
                  | request: finite + whole timeout
                  | subscription: persistent, no clock
                  | Group: cohort settlement + call-scoped dedupe
                  + sync RECEIVE: preserved operation-scoped auth
```

### Recommended Component Responsibilities

| Location | Responsibility |
|---|---|
| `packages/relay/src/relay.ts` | Raw attempt, private compositor, Relay request/subscription, sync RECEIVE |
| `packages/relay/src/types.ts` | Positive Relay/Group option declarations; no subscription timeout |
| `packages/relay/src/group.ts` | Dynamic cohort settlement and call-scoped dedupe around lifecycle compositor |
| `packages/relay/src/pool.ts` | Derived forwarding signatures only |
| `packages/relay/src/operators/auth-retry.ts` | Reuse auth gate/retry; retain whole-lifetime operator for request only |

### Pattern 1: Fresh Raw Attempt Under `defer`

Construct socket filtering, relay-closed flag, control/write, listener sharing, and finalize cleanup inside one `defer`. Put the returned Observable's public `share()` outside policy resubscription. This preserves synchronous auth reentrancy and means each real resend installs a fresh listener before writing. [CITED: https://rxjs.dev/api/index/function/defer] [VERIFIED: Phase 13 plans 13-09/13-10]

### Pattern 2: Call-Scoped Policy State

Mint ID, `AuthPhaseGate`, auth counter, and clean-CLOSED repeat holder once per returned high-level Observable. A policy branch re-subscribes to a fresh raw-attempt factory but never reinitializes those holders. Request's lifetime operator also sits outside every retry/repeat branch, so readiness, backoff, and all wire attempts consume one budget. [VERIFIED: 22-CONTEXT.md]

### Pattern 3: Explicit Terminal Classification

Route only `CloseEvent`-shaped failures with `wasClean === false` through reconnect. Route only ordinary unprefixed CLOSED completion through optional repeat. Route only `AuthRequiredError` through bounded auth handling. Typed CLOSED refusals, auth terminal errors, timeout, arbitrary errors, and programming errors escape immediately. The current `customConnectionRetryOperator` excludes only `RelayClosedError` and is therefore too broad for the new contract; reuse the positive `isReconnectableTransportError` classifier already used by publish/count. [VERIFIED: codebase grep]

### Pattern 4: Lifecycle Before Public Mapping

Apply custom completion, Group settlement, and retry classification while messages still carry `OPEN`/`EOSE`/`CLOSED`. Only at the public edge map request to events and subscription to events/`"EOSE"`. Never infer attempt boundaries after OPEN has been removed. [VERIFIED: 22-CONTEXT.md]

## Don't Hand-Roll

| Problem | Do not build | Use instead |
|---|---|---|
| Observable resource lifetime | Manual subscriber registry | `defer` + existing `share`/`finalize` pattern |
| Auth waiting/retry | New Promise loop | Existing `authRetry`/`AuthPhaseGate` helpers |
| Retry delays | New timer bookkeeping | Existing retry config normalization and RxJS retry/repeat |
| Subscription duration | New library option/clock | Caller `timeout`, `takeUntil(timer(...))`, or abort stream |
| Group dedupe | Per-attempt Set | Existing call-scoped `EventMemory`/`filterDuplicateEvents` |

## Common Pitfalls

### Sharing at the wrong boundary

If an attempt is shared inside the auth/retry boundary, a synchronous handler can rejoin a terminating listener: a REQ frame is resent but its reply is not observed. Keep each attempt unshared and place sharing around the complete returned operation. [VERIFIED: Phase 13 13-09]

### Attempt-scoped repeat state

If the ordinary-CLOSED marker is recreated inside each attempt, the repeat condition reads a dead/default holder and suppresses the enabled next attempt. Keep it call-scoped and reset/write it per attempt. [VERIFIED: 22-CONTEXT.md]

### Progress misclassification

Synthetic OPEN is bookkeeping and manufactured Group ERROR is failure bookkeeping. Neither resets auth retry accounting nor proves request progress. EOSE/EVENT/ordinary CLOSED are relay lifecycle values; the exact terminal classifier still controls whether they cause completion, repeat, or error. [VERIFIED: Phase 13 verification]

### CLOSE duplication

Finalize runs on completion, error, and unsubscribe. Mark relay CLOSED before inclusive completion; send client CLOSE only when that attempt remains open. Filter-input completion and request EOSE/custom completion must each produce one CLOSE, while relay CLOSED produces none. [CITED: https://rxjs.dev/api/operators/finalize]

### Phase 21 timeout residue

Removing only the runtime operator leaves type/docs/Pool drift. Audit `GroupSubscriptionOptions`, Relay subscription types, all Pool-derived families, tests, docs, ROADMAP/REQUIREMENTS, Phase 21 provenance, and `.changeset/relay-group-error-surface.md` together. [VERIFIED: codebase grep]

## Code Examples

### Positive option declarations

```ts
type RelayReqOptions = { id?: string };
type RelayRequestOptions = RelayAuthOptions & {
  id?: string; reconnect?: RetryInput; resubscribe?: RepeatInput;
  timeout?: number; complete?: RelayRequestCompleteOperator;
};
type RelaySubscriptionOptions = RelayAuthOptions & {
  id?: string; reconnect?: RetryInput; resubscribe?: RepeatInput;
};
```

### Caller-owned subscription lifetime

```ts
pool.subscription(relays, filters).pipe(
  takeUntil(timer(60_000)),
);
```

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest 4.x + `vitest-websocket-mock` |
| Quick run | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` |
| Group/Pool run | `pnpm vitest run packages/relay/src/__tests__/group.test.ts packages/relay/src/__tests__/group-error.test.ts packages/relay/src/__tests__/pool.test.ts` |
| Type/build gate | `pnpm --filter applesauce-relay build` |
| Full suite | `pnpm --filter applesauce-relay test` |

### Phase Requirements → Test Map

| Req | Required proof | Placement |
|---|---|---|
| REQ-01 | raw no auth/reconnect/repeat; inclusive CLOSED; exact CLOSE/listener/write counts; dynamic filters/readiness | `relay.test.ts` raw req block |
| REQ-02 | independent request/subscription policy; positive reconnect allowlist; terminal single attempt; timeout/auth semantics | `relay.test.ts` high-level blocks |
| REQ-03 | stable ID, hidden repeated OPEN, repeated EOSE, Group/Pool dedupe across re-establishment | relay/group/pool suites |
| REQ-04 | four deliberate RED mutations with recorded symptoms | focused regression block plus plan summaries |
| REQ-05 | req rejects auth/reconnect/resubscribe; subscriptions reject timeout; Pool derived APIs reject timeout | compile-time fixture/build |

### Mutation Oracles

1. Hoist attempt creation outside `defer`: synchronous auth resend frame occurs but reply/listener assertion fails RED.
2. Move clean-CLOSED holder into attempt: configured second repeat never writes; exact REQ count fails RED.
3. Count OPEN as progress: persistent auth-required exceeds `authRetries + 1` exact frame/handler bound.
4. Count Group ERROR as progress: one failed plus one silent relay defeats expected request timeout/settlement evidence.

### Wave 0 Gaps

- Add a compile-only option-surface fixture if the package has no established `@ts-expect-error` fixture; build it with the package `tsc` command.
- Add focused lifecycle-compositor tests before rewiring Group so metadata/error precedence is locked independently.
- Preserve existing Phase 13 wire tests and add mutation notes; relocated green tests alone are insufficient.

## Error, Timeout, and Retry Semantics

| Signal | Raw req | request | subscription |
|---|---|---|---|
| EVENT | value | emit event | emit event |
| EOSE | value, non-terminal | default successful completion + CLOSE | emit `"EOSE"`, remain open |
| ordinary CLOSED | value then complete, no client CLOSE | optional clean repeat else completion | optional clean repeat else completion |
| auth-required CLOSED | `AuthRequiredError` | bounded auth/resend | bounded auth/resend |
| recognized refusal | typed error | terminal, no retry | terminal, no retry |
| unclean transport loss | error | positive reconnect policy | positive reconnect policy |
| clean socket close | not reconnectable | terminal/complete per actual source shape | terminal/complete per actual source shape |
| whole timeout | none | 30s default, auth-suspended, terminal | none |
| arbitrary/programming error | error | terminal | terminal |

## Security Domain

### Applicable ASVS Categories

| Category | Applies | Control |
|---|---|---|
| V2 Authentication | yes | Existing bounded NIP-42 handler/gate; independent per-call counters |
| V3 Session Management | yes | Auth state remains connection-scoped; reconnect cannot reuse stale success |
| V4 Access Control | yes | Typed `restricted`/`blocked` refusals are terminal, never generic retry |
| V5 Input Validation | yes | Match message type and subscription ID; parse only recognized CLOSED prefixes |
| V6 Cryptography | no new work | Existing signer/auth implementation; do not alter cryptography |

Threat controls: retry amplification is bounded by exact auth/reconnect/repeat counters; information leakage is limited by matching IDs and fresh listeners; denial-of-service from silent requests is bounded only for finite request, while persistent subscription lifetime is intentionally consumer-owned. [VERIFIED: codebase and locked context]

## Environment Availability

| Dependency | Available | Version |
|---|---|---:|
| Node.js | yes | 22.23.1 |
| pnpm | yes | 11.10.0 |
| npm | yes | 10.9.8 |

No missing blocking dependency and no external package installation is required; package-legitimacy audit is therefore not applicable.

## Assumptions Log

| # | Claim | Risk if Wrong |
|---|---|---|
| — | None; recommendations derive from locked context, repository evidence, or official protocol/operator documentation | — |

## Open Questions

None blocking. The planner should choose the private helper name and compile-time fixture location, both explicitly delegated to agent discretion.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/22-req-family-re-layer/22-CONTEXT.md` — locked behavior and reversal contract.
- `packages/relay/src/relay.ts`, `group.ts`, `pool.ts`, `types.ts`, `operators/auth-retry.ts` — current implementation seams.
- `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/` — regression provenance and RED→GREEN criteria.
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — REQ/CLOSE/EVENT/EOSE/CLOSED protocol.
- [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) — auth-required CLOSED and REQ resend flow.

### Secondary (MEDIUM confidence)

- [RxJS defer](https://rxjs.dev/api/index/function/defer), [share](https://rxjs.dev/api/operators/share), [finalize](https://rxjs.dev/api/operators/finalize), and [takeUntil](https://rxjs.dev/api/operators/takeUntil).

## Metadata

**Confidence breakdown:** stack HIGH (installed manifests/registry); architecture HIGH (locked contract plus live code); pitfalls HIGH (historical mutation-backed regressions).

**Research date:** 2026-09-01  
**Valid until:** 2026-10-01
