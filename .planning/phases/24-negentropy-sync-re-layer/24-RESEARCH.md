# Phase 24: Negentropy & Sync Re-layer - Research

**Researched:** 2026-09-02
**Domain:** NIP-77 multi-round protocol streaming, coordinated auth/reconnect, and bounded bidirectional scheduling
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `Relay.negentropy()` becomes a cold shared `Observable<NegentropyRound>` for one readiness-aware negotiation. Each round is `{ have, need }`; reconcile serially, write any follow-up `NEG-MSG` before emitting, emit empty/terminal rounds, complete after the terminal round, and send exactly one `NEG-CLOSE` when opened.
- Raw negentropy owns no auth, reconnect, retry, transfer, or lifetime policy. Its positive options are only `id`, `frameSizeLimit`, and `signal`. Remove `ReconcileFunction`, `NegentropySyncOptions`, Group negentropy, and Pool multi-relay negentropy.
- Abort/unsubscribe deterministically removes listeners and closes the opened negotiation without fabricating a result. Typed `NEG-ERR`, premature transport termination, decode/store/protocol, and client errors use the Observable error channel.
- `sync()` owns one call-scoped auth coordinator/gate/global retry counter across negotiation, EVENT uploads, and REQ downloads. Progress never replenishes it and overlapping branches cannot multiply it.
- `sync()` intentionally has no timeout option or built-in lifetime clock. Unsubscribe, `AbortSignal`, or caller-composed RxJS operators own duration/inactivity policy. Canonical SYNC-03/Roadmap provenance must be amended.
- Positive reconnect accepts only identified unclean transport failures. Each reconnect discards failed-attempt queued work, rebuilds storage from current state, mints a fresh NEG ID, and installs fresh listeners. Completed transfers remain reflected naturally through the store.
- One fair global scheduler defaults to concurrency four, validates a finite positive integer, preserves FIFO within SEND and RECEIVE lanes, prevents starvation, emits settlement order, and lets negotiation continue at protocol speed. After negotiation ends, drain queued/in-flight work before completion.
- Terminal operation error/unsubscribe cancels negotiation plus queued/in-flight work. Individual upload failures settle as values and never cancel siblings. Timeout is not a scheduler failure mode.
- Export exact `SyncMessage` received/sent/send-failed union with normalized `from`; negative/thrown uploads are `send-failed`, preserve response/error identity, and successful send requires `ok: true`.
- Emit received only after writable-store acceptance; read-only/array inputs emit without claiming persistence. Store write rejection is terminal. Zero-event EOSE succeeds without value.
- Export `GroupSyncMessage = SyncMessage | relay-failed`. Group materializes per-relay support/sync failures while siblings continue; Pool forwards unchanged; empty groups complete.
- Sync loader force-closes auth phases synchronously before constructing/subscribing the non-auth paginated fallback, retains outer finalize cleanup, structurally mirrors new sync results, and maps receive-only values to `.event`.
- Migrate docs/examples from callback Promise/raw-event/completion-means-success claims. SEND consumers inspect `sent`/`send-failed`; duration is caller-composed.
- Seven deliberate mutations are mandatory: dropped follow-up, emit-before-send, await-transfer-in-negotiation, unbounded scheduler, unfair scheduler, independent auth counters, and stale reconnect state/ID.
- The full matrix includes protocol ordering/rounds/close/cancellation/errors, reconnect freshness, scheduling/drain/results/store/EOSE, Group/Pool isolation, and loader fallback clock re-arming.
- Release metadata uses two separate one-sentence relay major changesets (negentropy API; sync result/policy), one loader patch changeset, and reconciles stale pending notes.

### the agent's Discretion

- Choose internal scheduler/operator decomposition, private coordinator names, and typed protocol error subclass details consistent with existing relay patterns.
- Choose whether late concurrent low-level subscribers replay the latest round, provided no duplicate execution starts and post-terminal behavior is tested/documented.
- Choose fair arbitration details while proving global bound, FIFO per lane, and no starvation.

### Deferred Ideas (OUT OF SCOPE)

None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| SYNC-01 | Follow-up messages make multi-round reconciliation work | Raw protocol state machine and >32-item wire mutation |
| SYNC-02 | Emit learned rounds without transfer backpressure | Send-before-emit and decoupled scheduler architecture |
| SYNC-03 | Sync owns coherent auth/reconnect/concurrency policy | Global auth coordinator, fresh-attempt reconnect, no-timeout amendment |
| SYNC-04 | Both transfer directions expose honest outcomes | Exact discriminated result union and settlement semantics |
| RESID-03 | Close loader auth fallback leak and zero-event EOSE | Synchronous phase close plus empty-completion-safe receive pipeline |
</phase_requirements>

## Summary

The current low-level implementation is an async callback loop. It calculates `newMsg` but never writes it, awaits caller transfers before reading the next protocol frame, and returns a boolean. Current high-level sync consequently composes three independent auth-policy owners, launches uploads with unbounded `Promise.allSettled`, emits only received raw events, and uses `lastValueFrom` without a default on RECEIVE, causing zero-event EOSE to reject. [VERIFIED: codebase grep]

Implement two explicit layers. First, make `negentropy.ts` a serial Observable protocol state machine whose only synchronous order is `reconcile → socket.next(follow-up) → subscriber.next(round)`. Second, build `Relay.sync()` as an operation coordinator with fresh negentropy attempts, a single global auth budget, a fair two-lane scheduler, and exact result mapping. Do not call public `publish()` or `request()` directly inside transfers: those APIs own independent auth/retry/deadline state. Reuse their raw EVENT and private REQ lifecycle primitives under the sync coordinator instead. [VERIFIED: Phase 18/22 contracts]

**Primary recommendation:** land the raw protocol stream and its mutation proofs first; then implement/test scheduler and global auth coordinator independently before integrating reconnect, Group/Pool, loaders, and docs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| NEG wire state machine | `negentropy.ts` | Relay socket/readiness | One protocol interaction only |
| Auth/reconnect/cancellation | `Relay.sync()` coordinator | Existing raw EVENT/REQ primitives | Policy spans all verbs and attempts |
| Transfer fairness/concurrency | Sync-private scheduler | RxJS subscriptions | Cross-direction global resource bound |
| Multi-relay isolation | RelayGroup | RelayPool forwarding | Attribution belongs at fan-out boundary |
| Loader fallback lifetime | SyncLoader | Loader silence clock | Structural consumer with independent timeout policy |

## Project Constraints (from AGENTS.md)

- Update existing component docs with What/How/Integration/Best Practices; do not create standalone best-practice or summary docs.
- Code blocks remain focused at roughly 20 lines maximum; avoid duplicated examples and verify examples/navigation.
- Each changeset body is one sentence and describes exactly one change.

## Standard Stack

No new packages. Use installed RxJS 7.8.x, existing negentropy implementation, `AuthPhaseGate`, relay auth helpers, `normalizeURL`, raw EVENT/REQ lifecycle primitives, and Vitest/websocket mocks. [VERIFIED: manifests/codebase]

| Existing asset | Required use |
|---|---|
| `Negentropy` / `NegentropyStorageVector` | Serial reconciliation and fresh reconnect vector |
| RxJS `defer`, `Observable`, `share`, teardown | Cold shared protocol/operation ownership |
| `AuthPhaseGate` | Track overlapping global sync auth activity; no operation clock consumer |
| `isReconnectableTransportError` + retry normalization | Positive reconnect only |
| Raw `event()` and private REQ lifecycle | Transfers without nested public policy budgets |
| `mapEventsToStore` semantics | Receive persistence boundary, adapted to emit after acceptance |

NIP-77 explicitly specifies alternating `NEG-MSG` messages and permits EVENT/REQ transfers in parallel with subsequent negotiation messages. [CITED: https://github.com/nostr-protocol/nips/blob/master/77.md]

## Architecture Patterns

### System Data Flow

```text
subscription -> sync operation coordinator
  -> build current storage -> fresh raw negentropy attempt
       NEG-OPEN -> NEG-MSG -> reconcile -> send follow-up -> emit round
                                      |                    |
                                      + enqueue SEND/RECEIVE jobs
  -> fair scheduler (global active <= concurrency, FIFO per lane)
       SEND raw EVENT -> sent | send-failed
       RECEIVE raw REQ -> persist -> received
  -> negotiation done + queues empty + active 0 -> complete
  -> reconnectable attempt loss -> cancel attempt jobs -> rebuild/fresh ID
```

### Raw Negentropy State Machine

Recommended responsibilities in `packages/relay/src/negentropy.ts`:

1. Validate/mint ID and build sealed storage before `NEG-OPEN`.
2. Wait for Relay readiness at the Relay wrapper; do not duplicate readiness inside socket helper.
3. Install matching `NEG-MSG`/`NEG-ERR` listener before opening.
4. Serialize async `ne.reconcile()` calls with `concatMap` or an explicit promise tail; concurrent relay frames must never mutate `Negentropy` concurrently.
5. For each decoded frame, call reconcile, write follow-up immediately if non-null, then emit the round.
6. Terminal null follow-up emits its round then completes.
7. One teardown guard sends `NEG-CLOSE` iff opened and not already closed; abort and unsubscribe share this path.

Do not use `multiplex` if its unsubscribe close callback plus explicit terminal cleanup makes exact close cardinality ambiguous. A dedicated listener/write Observable with one `opened/closed` guard is easier to prove. [VERIFIED: current double-subscription complexity]

### Cold Sharing Choice

Prefer non-replaying `share()` for raw rounds: rounds are protocol discoveries, and replaying one to a late concurrent subscriber can cause duplicate transfer decisions in advanced consumers. One returned Observable must share the live negotiation; post-terminal resubscription behavior must be pinned. If retaining terminal replay, document that replay is observational only and high-level sync subscribes once. [ASSUMED]

### Sync Attempt Boundary

Wrap a complete negotiation plus attempt-owned queued/in-flight transfers in `defer`. Call scope owns auth coordinator, validated options, outer abort composition, and reconnect count. Attempt scope owns storage vector, fresh NEG ID, raw listeners, two queues, active jobs, and cancellation token. On reconnectable attempt failure:

- invalidate token first;
- unsubscribe negotiation and attempt transfers;
- clear queued jobs;
- rebuild storage asynchronously from current store;
- mint a new NEG ID and start again.

Never reuse the `Negentropy` instance, storage vector, NEG ID, or queued work. [VERIFIED: D-11]

### One Global Auth Coordinator

Existing `authRetryOperator` uses per-call consecutive counters reset by progress, so it cannot directly express D-08. Introduce a sync-private coordinator with:

- one `AuthPhaseGate`;
- one monotonically consumed `authRetries` budget for the entire sync;
- atomic slot reservation before invoking/waiting on auth;
- one serialized/shared active auth phase so simultaneous verb refusals cannot trigger duplicate handlers or consume/restore budgets inconsistently;
- verb-specific `RelayAuthWireRequest` context preserved for the refusal that owns the phase;
- cancellation that rejects/ends all waiting jobs together.

After auth satisfaction, each blocked verb starts a fresh raw attempt. Do not reset the global counter on EVENT/REQ/NEG progress. Terminal auth error cancels negotiation and scheduler. [VERIFIED: D-08/D-24]

### Positive Reconnect Boundary

Reconnect the sync attempt only for `CloseEvent`-shaped unclean transport failure using the existing positive classifier. Typed NEG/REQ relay errors, auth exhaustion/handler/phase timeout, malformed frames, store errors, invalid concurrency, and programming exceptions bypass retry. SEND upload failures remain `send-failed` values—even transport failures—rather than silently restarting the whole operation; RECEIVE/negotiation transport loss makes the attempt unable to complete and may enter reconnect. [VERIFIED: D-10/D-14/D-16]

## Fair Transfer Scheduler

Implement a small explicit scheduler rather than `mergeMap` over a single merged stream, because FIFO per lane plus starvation freedom is observable policy.

State:

```ts
const sendQueue: SendJob[] = [];
const receiveQueue: ReceiveJob[] = [];
let nextLane: "send" | "receive" = "send";
let active = 0;
let negotiationDone = false;
```

On each pump slot, choose `nextLane` when non-empty, otherwise the other; flip after every dispatch when both have work. This round-robin arbitration preserves FIFO within each lane, caps combined active jobs, and guarantees a waiting lane receives the next available slot. Results are emitted when jobs settle. Queue drain completes only when negotiation is done, both queues empty, and active is zero. [VERIFIED: locked fairness contract]

Validate `concurrency` synchronously inside the returned Observable factory as a finite positive integer; default exactly four. Teardown marks cancelled before unsubscribing jobs so late promise/Observable settlements cannot emit.

## Transfer Semantics

### SEND

- Resolve `have` IDs to events in lane order; missing local IDs produce no fabricated result unless existing store contract defines an error. Treat store read rejection as terminal local error.
- Run raw EVENT attempt under the sync auth coordinator.
- `ok: true` → add seen relay and emit `sent` with original event/response.
- `ok: false` with attached typed verdict → emit `send-failed` preserving both response and error.
- thrown client/transport failure → emit `send-failed` preserving error identity, no response.
- A transfer value never cancels siblings and never means global success.

### RECEIVE

- One round's `need` becomes a REQ job; use the private finite lifecycle under the global coordinator, without its public 30-second request clock/reconnect/auth budget.
- EOSE with zero EVENT values settles successfully. Avoid `lastValueFrom` without `defaultValue`; Observable completion should be the job success signal.
- Writable store: await each add before emitting `received`. Rejection is terminal operation error.
- Read-only store/array: emit `received` directly and do not claim persistence.
- Do not add dedupe beyond current request/store behavior; reconnect with a read-only snapshot may therefore surface repeated received values. [VERIFIED: D-17]

## Public Types and API Surface

Place public contracts in `packages/relay/src/types.ts` (or export from `negentropy.ts` and re-export consistently), and prove both root and `/types` reachability:

```ts
type NegentropyRound = { have: string[]; need: string[] };
type NegentropyOptions = {
  id?: string;
  frameSizeLimit?: number;
  signal?: AbortSignal;
};
```

`RelaySyncOptions` is a positive declaration: auth fields, `reconnect`, `concurrency`, and `signal`; explicitly no `timeout`. `SyncMessage` and `GroupSyncMessage` must match locked unions exactly. Pool sync returns `Observable<GroupSyncMessage>` and derives Group parameters. Remove Group/Pool negentropy methods and `GroupNegentropySyncOptions`. Update type fixtures with `@ts-expect-error` for removed callback/auth/timeout/group APIs. [VERIFIED: D-06/D-07/D-09/D-15/D-19]

## Group and Pool

`RelayGroup.sync()` should snapshot/check support per active relay using the established group fan-out boundary, then merge each `relay.sync()` with an inner `catchError` mapping to one normalized `relay-failed`. Support-check rejection and unsupported NIP-77 are attributed failures. Empty groups complete. Group must not translate `send-failed` into `relay-failed`: the former is an individual transfer settlement, the latter a terminal relay sync failure. Pool directly forwards the same objects/unions without cloning or catching. [VERIFIED: D-19]

Dynamic membership semantics are not newly specified for sync; preserve the group's current snapshot behavior (`relays` getter/take-one) unless context explicitly demands otherwise. [ASSUMED]

## Loader Migration and RESID-03

Change the dependency-free structural mirror in `sync-loader.ts` to accept a minimal received/sent/send-failed union, then:

```ts
sync(...).pipe(
  filter((m) => m.type === "received"),
  map((m) => m.event),
)
```

For non-auth sync failure, call `forceCloseAuthPhases()` synchronously inside `catchError` before invoking `status(...)` or `request$()`. The existing outer `finalize(forceCloseAuthPhases)` remains. This ordering is essential because loader `withTimeout` is a silence clock; an open auth phase keeps it disarmed and the fallback can otherwise hang. Auth-family errors still rethrow without fallback. [VERIFIED: Phase 13 WR-04]

## Error and Lifetime Matrix

| Condition | Low-level negentropy | Relay sync | Group sync |
|---|---|---|---|
| auth-required NEG/REQ/EVENT | typed error | global bounded auth/resend | terminal relay failure becomes attributed value |
| recognized NEG refusal | typed error | terminal | `relay-failed` |
| unknown NEG-ERR | `NegentropyError` | terminal | `relay-failed` |
| unclean negotiation/receive transport loss | error | positive reconnect | isolated if exhausted |
| SEND negative/thrown failure | n/a | `send-failed` value | unchanged `send-failed` |
| store read/write error | n/a | terminal local error | attributed per relay |
| zero-event EOSE | n/a | successful job, no value | no failure |
| timeout | none | none | none |
| abort/unsubscribe | close/cancel | cancel all | cancel active fan-out |

## Don't Hand-Roll

| Problem | Do not build | Use instead |
|---|---|---|
| Negentropy math/storage | Custom diff algorithm | Existing `Negentropy`/storage vector |
| Wire authentication | New signer protocol | Existing NIP-42 handler/wait primitives behind coordinator |
| Duration/inactivity | Sync timeout option | Caller RxJS `timeout`, `takeUntil`, AbortSignal |
| URL attribution | Raw URL strings | `normalizeURL` |
| Group aggregate exception | New aggregate error | `relay-failed` value union |

## Common Pitfalls

### Emitting before writing follow-up

Observable `next` is synchronous. A blocking subscriber delays all statements after `next`, so wire progress must precede emission. [VERIFIED: D-02/D-24]

### Promise callback retains accidental backpressure

Awaiting transfer work in the reconciliation loop prevents round two and contradicts NIP-77 parallel transfer. Enqueue only; negotiation never awaits scheduler jobs. [CITED: NIP-77]

### Nested public policy owners

Calling `publish()`/`request()` creates independent gates, counters, reconnect rules, and request timeout. This violates one global budget and the no-timeout contract. Compose raw attempts with the sync coordinator. [VERIFIED: current source]

### Reconnect reuses stale jobs

Old queued IDs were derived from a failed vector. Drop them and rebuild. Token every attempt/job so late completion cannot emit after cancellation. [VERIFIED: D-11]

### Completion falsely signals upload success

Completion means negotiation plus queue drain only. Consumers must inspect `send-failed`. Update all completion-only SEND examples and changesets. [VERIFIED: D-16/D-22]

### Group collapses two failure levels

`send-failed` is a settled event failure; `relay-failed` is terminal relay operation failure. Never promote the former or swallow the latter. [VERIFIED: D-19]

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Relay runtime | Vitest + `vitest-websocket-mock` + real `Negentropy` peer |
| Loader runtime | Vitest fake timers and structural method doubles |
| Type gate | `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` |
| Focused relay | `pnpm --filter applesauce-relay exec vitest run src/__tests__/negentropy-sync.test.ts` |
| Group/Pool | focused group/pool tests plus export snapshots |
| Full | `pnpm --filter applesauce-relay test && pnpm --filter applesauce-loaders test` |

### Requirement → Tests

| Req | Critical proofs |
|---|---|
| SYNC-01 | genuine >32-item second round, follow-up frame, terminal/empty rounds, exact close |
| SYNC-02 | blocking subscriber sees follow-up already written; slow transfer does not withhold next round |
| SYNC-03 | total active <=4, round-robin no starvation, global auth write bound, fresh reconnect ID/vector, no timeout type/runtime |
| SYNC-04 | sent/negative response/thrown failure identities, settlement order, queue drain |
| RESID-03 | zero-event EOSE completes; force-close occurs before fallback construction and loader clock re-arms |

### Seven Mandatory Mutation Oracles

1. Delete follow-up write → >32-item negotiation stalls/no second server response.
2. Move emission before write → blocking next handler proves frame absent until released.
3. Await transfer inside round → second round withheld while held transfer remains pending.
4. Remove bound → active transfer high-water mark exceeds four.
5. Drain SEND preferentially → queued RECEIVE does not start within bounded dispatch turns.
6. Restore per-verb counters → exact auth-triggered wire count exceeds global `authRetries + 1` allowance.
7. Reuse failed attempt ID/vector → second `NEG-OPEN` has same ID/stale inventory and fixture fails.

Each mutation must record exact command and failing assertion, restore source, rerun GREEN, and confirm no mutation diff remains.

### Full Behavioral Matrix

- Raw: cold sharing, optional replay decision, listener-before-open, every/empty/terminal round, send-before-emit, typed/unknown NEG errors, premature close, pre-abort/mid-abort/unsubscribe, exact one close.
- Sync: option validation, no clock, one coordinator, concurrent refusals, fresh reconnect, FIFO/fairness/global cap, settlement ordering, post-negotiation drain, cancellation of queued/in-flight work.
- Results/store: sent/send-failed variants, identity preservation, writable add-before-emit, read-only behavior, store rejection, zero-event EOSE.
- Group/Pool: empty, unsupported, support-check error, terminal isolation, unchanged transfer failures, normalized attribution, forwarding identity.
- Consumers: loader structural types/filtering/fallback ordering and all app/docs compile sites.

### Wave 0 Gaps

- Add focused `packages/relay/src/__tests__/negentropy-sync.test.ts`; existing one-round Phase 13 fixtures are intentionally non-discriminating.
- Add sync public type fixture and removed-method/timeout negative assertions.
- Add loader fallback ordering/fake-clock test before changing fallback code.
- Build a reusable real NIP-77 peer fixture whose dataset exceeds one frame; do not mock `reconcile()` outputs for SYNC-01.

## Documentation, Consumers, and Provenance

Update:

- `apps/docs/loading/relays/negentropy.md`: Observable rounds, explicit single relay raw API, cancellation, no timeout, result unions.
- `apps/docs/loading/relays/relays.md`: discriminate received/sent/send-failed; remove “Upload complete” success claim.
- `apps/docs/loading/relays/pool.md`: GroupSyncMessage and relay-failed handling; remove obsolete direction string example if inconsistent with enum.
- all `apps/examples` `.sync()` consumers: filter `received`; SEND UI counts both outcomes; callback negentropy examples subscribe.
- `sync-loader.ts` mirror and tests; any Concord consumers inherit loader event stream unchanged.
- ROADMAP criterion 3 and SYNC-03: replace operation clock with explicit cancellable/no-built-in-timeout lifetime.
- Phase 13 WR-04/WR-05 residual records and Phase 18/22 temporary sync dispositions.
- pending `.changeset` claims involving auth/group sync, plus two relay major and one loader patch changesets required by D-26.

Run stale-claim searches for `ReconcileFunction`, `NegentropySyncOptions`, `await .*negentropy`, `.negentropy(` on Group/Pool, `Observable<NostrEvent>` sync mirrors, raw `.content` access on sync values, `Upload complete`, sync `timeout`, and dropped-relay debug-only wording.

## Security Domain

| ASVS area | Applies | Control |
|---|---|---|
| V2 Authentication | yes | Atomic global retry budget; terminal cancellation |
| V3 Session | yes | Fresh negotiation/auth state after transport reconnect |
| V4 Access control | yes | Typed relay refusals never generic-retry |
| V5 Input validation | yes | Match NEG ID/type; validate concurrency and decoded frames |
| V6 Cryptography | inherited | Existing Negentropy hashes and NIP-42 signing only |

Threats: unbounded transfer amplification (global cap), starvation (round robin), retry amplification (global auth counter/positive reconnect), stale-attempt data integrity (tokens/fresh vector), resource leaks (exact teardown), and misleading success reporting (discriminated outcomes). [VERIFIED: locked threat/mutation matrix]

## Environment Availability

Node, pnpm, Vitest, websocket mocks, and the repository's Negentropy implementation are present. No package installation is required; package-legitimacy audit is not applicable.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Prefer non-replaying raw rounds | Cold Sharing | Low; context delegates choice, but public semantics/tests must state it |
| A2 | Preserve current snapshot membership for Group sync | Group/Pool | Medium; dynamic sync membership is not locked and should be confirmed during planning if current code differs |

## Open Questions

1. **Raw round replay choice** — recommend no replay because replay can duplicate consumer work; document and test whichever discretionary choice planning adopts.
2. **Group membership snapshot** — retain current behavior unless the planner finds an explicit dynamic-membership requirement outside Phase 24.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/24-negentropy-sync-re-layer/24-CONTEXT.md`
- `packages/relay/src/negentropy.ts`, `relay.ts`, `group.ts`, `pool.ts`, `types.ts`
- `packages/loaders/src/loaders/sync-loader.ts`
- Phase 18 and Phase 22 contexts
- Phase 13 review and 13-06 summary
- [NIP-77](https://github.com/nostr-protocol/nips/blob/master/77.md)

### Secondary (MEDIUM confidence)

- `.planning/research/FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`
- Existing relay/loaders tests and public docs/examples

## Metadata

**Confidence breakdown:** protocol HIGH; architecture HIGH; scheduler HIGH; exact Group membership semantics MEDIUM due to discretionary unstated dynamic behavior.

**Research date:** 2026-09-02  
**Valid until:** 2026-10-02
