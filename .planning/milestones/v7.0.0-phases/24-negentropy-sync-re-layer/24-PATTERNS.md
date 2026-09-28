# Phase 24: Negentropy & Sync Re-layer - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 21 new/modified files or artifact groups
**Analogs found:** 21 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/negentropy.ts` | service/utility | streaming protocol / file-store I/O | `relay.ts` raw `eventExchange()` and raw REQ attempt | exact boundary, protocol-specific core |
| `packages/relay/src/relay.ts` raw `negentropy()` | service | streaming request-response | `eventExchange()` + `req()` | exact raw interaction pattern |
| `packages/relay/src/relay.ts` high-level `sync()` | service/coordinator | event-driven / scheduled transfers | `publish()`/REQ lifecycle policy plus current sync | role-match |
| private auth coordinator in `relay.ts` or helper | service/utility | event-driven | `AuthPhaseGate`, `authRetryOperator`, call-scoped counters | exact mechanism, new global scope |
| private transfer scheduler in `relay.ts` or helper | service/utility | batch / event-driven | loader `mergeMap(..., concurrency)` plus explicit cohort state machines | partial; fairness is new |
| `packages/relay/src/types.ts` | model/config | transform | existing discriminated `RelayOutcome`, request messages, `PublishResponse` | exact type style |
| `packages/relay/src/group.ts` | service | pub-sub / error isolation | current Group sync isolation at 532-573 and Phase 23 outcome materialization | exact role |
| `packages/relay/src/pool.ts` | facade | request-response forwarding | derived Group signatures at 246-257 | exact |
| `packages/relay/src/index.ts` / type exports | config | transform | star exports and named NIP-45 exports | exact |
| `packages/relay/src/__tests__/negentropy.test.ts` or relay test block | test | real-wire streaming | `relay.test.ts:3123-3198`, real negentropy fixture at 3290-3306 | exact |
| `packages/relay/src/__tests__/sync.test.ts` or relay test block | test | scheduler/event-driven | `relay.test.ts:3200-3282`, auth integration at 3514-3573 | exact role |
| `packages/relay/src/__tests__/group.test.ts` | test | fan-out/error attribution | Group sync isolation at 341-415 | exact |
| `packages/relay/src/__tests__/pool.test.ts` | test | forwarding | Pool sync forwarding at 371-405 | exact |
| relay type fixture | test/config | compile-time transform | Phase 22/23 type fixtures | exact |
| `packages/relay/src/__tests__/exports.test.ts` | test | runtime export audit | sorted inline snapshot | exact |
| `packages/loaders/src/loaders/sync-loader.ts` | service/adapter | fallback streaming | existing auth phase/fallback boundary at 426-690 | exact |
| `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | test | fallback/event transform | fallback/auth tests at 775-1065 | exact |
| `apps/docs/loading/relays/negentropy.md` | documentation | streaming protocol | current low/high examples | exact migration target |
| `apps/docs/loading/relays/relays.md` and `pool.md` | documentation | result consumption | current sync sections | exact migration target |
| Roadmap/Requirements/Phase 13 provenance | config/documentation | transform | SYNC/RESID clauses and Phase 13 review | exact |
| three new/reconciled changesets | config/release | transform | existing one-sentence relay/loaders changesets | exact |

## Pattern Assignments

### `packages/relay/src/negentropy.ts` — Observable raw negotiation

**Primary analog:** `packages/relay/src/relay.ts:1283-1317` (`eventExchange`) and raw REQ's per-attempt `defer`/finalize boundary.

Replace the callback/Promise loop at `negentropy.ts:64-166` with one cold Observable resource. Build the `Negentropy` state, matching socket listener, `NEG-OPEN` write, abort listener, serial reconcile queue, and exact `NEG-CLOSE` teardown inside one subscription factory. Share only around the complete returned interaction.

```ts
return defer(() => {
  let opened = false;
  let closed = false;
  const close = () => {
    if (opened && !closed) socket.next(["NEG-CLOSE", id]);
    closed = true;
  };
  return messages.pipe(
    concatMap(async (message) => reconcileRound(message)),
    finalize(close),
  );
}).pipe(share());
```

The current matching/teardown source is `negentropy.ts:77-101`: retain ID matching for `NEG-MSG`/`NEG-ERR`, but do not retain `firstValueFrom(race(...))`, the keepalive subscription, callback await, or boolean result.

**Wire-order rule:** current lines 144-148 reconcile and await caller work but never write `newMsg`. The replacement must perform exactly:

```ts
const [followUp, have, need] = await ne.reconcile<string>(payload);
if (followUp !== null) socket.next(["NEG-MSG", id, followUp]);
subscriber.next({ have, need });
if (followUp === null) subscriber.complete();
```

This order is load-bearing: reconcile → follow-up write → round emission. Never await subscriber/transfer work inside negotiation.

**Options/type source:** replace `ReconcileFunction` and `NegentropySyncOptions` at `negentropy.ts:9-24` with positive raw declarations (`NegentropyRound`, `NegentropyOptions { id?, frameSizeLimit?, signal? }`). Keep `NegentropyError` at 28-38 for unknown `NEG-ERR` reasons.

### `packages/relay/src/relay.ts` — public raw `negentropy()`

**Analog:** raw EVENT at `relay.ts:1283-1334` and raw REQ readiness/share semantics.

Move support checks out of the wire attempt if they imply high-level policy; the raw method should build storage, wait for `ready`, subscribe to the low-level negotiation, map `NEG-ERR` prefixes, and share one execution among concurrent subscribers. Remove the current async/callback/auth wrapper at `relay.ts:1391-1470`.

Use existing `parseClosedError` classification: auth-required becomes `AuthRequiredError`; recognized prefixes remain typed; unknown reasons keep `NegentropyError`. Transport/client/protocol failures stay errors. Abort or unsubscribe cancels without a fabricated `false` value.

Fresh state is per raw call/subscription interaction: build storage from `buildStorageVector`/`buildStorageFromFilter` (`negentropy.ts:40-57`), mint or accept the raw ID, and install the listener before `NEG-OPEN` reaches the wire.

### `packages/relay/src/relay.ts` — high-level `sync()` coordinator

**Primary analogs:** call-scoped policy in `publish()`/COUNT; current sync integration at `relay.ts:1733-1830`; positive reconnect at `relay.ts:1572-1614`.

Create one outer operation Observable with these call-scoped resources:

- one `AbortController` linked to `opts.signal` and unsubscribe;
- one global auth coordinator (`AuthPhaseGate` + total counter);
- one scheduler with validated `concurrency ?? 4`;
- one fresh-attempt factory that rebuilds storage and mints a new NEG ID on reconnect;
- one terminal path that cancels negotiation and every queued/in-flight transfer.

Reconnect only through `isReconnectableTransportError`/`customConnectionRetryOperator` at `relay.ts:1594-1614`. Put retry outside `defer` so every reconnect rebuilds the storage/vector/listeners/ID and drops queued-not-started work from the failed attempt. Do not add a timeout operator.

Keep negotiation internal and enqueue transfer work from each `NegentropyRound` synchronously. Completion waits for both negotiation completion and queue drain.

### Shared auth coordinator

**Analog:** `AuthPhaseGate` and `authRetryOperator` at `relay.ts:904-957`; call-scoped explicit counters in COUNT/publish.

The existing operator resets a consecutive counter on progress, which is unsuitable for D-08. Reuse its handler/context/wait/error mapping, but give sync one non-resetting total budget shared across NEG-OPEN, EVENT, and REQ branches. All branch requests must route auth-required into this coordinator instead of calling independent high-level `publish()`/request loops.

The current `sync()` auth option extraction at `relay.ts:1745-1754` is the forwarding precedent, but replace three independent consumers with one coordinator. Preserve wire-specific `RelayAuthWireRequest` context for `NEG-OPEN`, `EVENT`, and `REQ`.

Terminal auth failure must abort the raw negotiation and scheduler. Unrelated rounds/events must never replenish the global counter.

### Unified fair transfer scheduler

**Closest analog:** `packages/loaders/src/loaders/sync-loader.ts:694-696` uses `mergeMap(..., concurrency)` for a global cap; explicit state/teardown patterns exist in Group's Phase 21/23 cohort helpers.

Do not use separate SEND and RECEIVE `mergeMap` pipelines because each would own its own cap and can starve the other. Implement two FIFO lanes and one global active count. Alternate lane preference whenever both are non-empty.

```ts
const lanes = { send: [] as Task[], receive: [] as Task[] };
let active = 0;
let nextLane: "send" | "receive" = "send";

function drain() {
  while (active < concurrency) {
    const task = takeFairTask(lanes, nextLane);
    if (!task) return maybeComplete();
    nextLane = task.lane === "send" ? "receive" : "send";
    active++;
    run(task).finally(() => { active--; drain(); });
  }
}
```

Validate concurrency as a finite positive integer before starting side effects. Settlement callbacks emit results immediately in settlement order. Terminal cancellation clears queued work and cancels in-flight Observables/requests through their subscriptions/AbortSignal.

### SEND transfer result mapping

**Analog:** `PublishResponse` and Group's `errorToPublishResponse` boundary; current upload loop at `relay.ts:1774-1789`.

Use raw EVENT/high-level-private auth coordination, then map:

- genuine `response.ok === true` → `{ type: "sent", from, event, response }`;
- negative verdict response → `{ type: "send-failed", from, event, error: response.error ?? verdictError, response }`;
- thrown transport/client/auth-attempt failure local to one upload → `send-failed` preserving exact error identity.

Individual upload failures are values. Terminal coordinator/store/protocol failures remain outer errors.

### RECEIVE transfer mapping and zero-event EOSE

**Analog:** current RECEIVE store pipeline at `relay.ts:1792-1811` and Phase 22 private REQ lifecycle.

Use a finite lifecycle request whose EOSE completes successfully even with no events. Avoid `lastValueFrom(source)` without `defaultValue`; that is the Phase 13 `EmptyError` residual. Emit `received` only after `mapEventsToStore` succeeds for writable stores. For arrays/read-only stores, emit without claiming persistence. Store rejection is terminal and cancels all work.

### `packages/relay/src/types.ts`

**Analog:** positive option declarations and discriminated unions such as `RelayOutcome`/REQ messages.

Add:

```ts
export type NegentropyRound = { have: string[]; need: string[] };
export type NegentropyOptions = { id?: string; frameSizeLimit?: number; signal?: AbortSignal };
export type RelaySyncOptions = RelayAuthOptions & {
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  concurrency?: number;
  signal?: AbortSignal;
};
export type SyncMessage =
  | { type: "received"; from: string; event: NostrEvent }
  | { type: "sent"; from: string; event: NostrEvent; response: PublishResponse }
  | { type: "send-failed"; from: string; event: NostrEvent; error: unknown; response?: PublishResponse };
export type GroupSyncMessage = SyncMessage | { type: "relay-failed"; from: string; error: unknown };
```

Normalize `from` with the existing URL helper. Remove `GroupNegentropySyncOptions`, `ReconcileFunction`, and auth from raw negentropy options. Do not add sync timeout.

### `packages/relay/src/group.ts`

Remove raw Group negentropy at `group.ts:367-386` and its imports/types. For `sync()` at 532-573, retain per-relay isolation but replace logging-plus-EMPTY with an attributed value:

```ts
relay.sync(store, filter, direction, opts).pipe(
  catchError((error) => of({
    type: "relay-failed",
    from: normalizeURL(relay.url),
    error,
  } satisfies GroupSyncMessage)),
)
```

Support-check failure/no NIP-77 support must use the same `relay-failed` value per supplied relay, not one aggregate outer throw. Empty groups complete. Existing `group.test.ts:341-415` is the exact isolation/diagnostic test region to convert from silent drops to observable attribution.

### `packages/relay/src/pool.ts`

Remove multi-relay raw `negentropy()` at `pool.ts:159-168`. Keep `pool.relay(url).negentropy()` as explicit single-relay access. Derive `sync()` parameters and return from `RelayGroup["sync"]`, following the existing delegation at 246-257, so `GroupSyncMessage` cannot drift.

## Shared Execution and Cancellation

**Raw interaction analog:** `defer` + `share` in EVENT/REQ. One returned negentropy Observable shares one socket execution among concurrent subscribers; final unsubscribe tears it down and sends exactly one `NEG-CLOSE` if opened.

**Multi-consumer analog:** loader manual refcount at `sync-loader.ts:702-770` shows lazy start, one shared upstream, subject fan-out, and teardown at refcount zero. Prefer standard RxJS `share` when one output channel suffices, but copy its deterministic cancellation semantics.

**Abort analog:** current `negentropy.ts:103-120` correctly removes the abort listener. Retain this cleanup in Observable form and link external signal to internal controller once.

## Loader Migration

### `packages/loaders/src/loaders/sync-loader.ts`

**Exact fallback seam:** `sync-loader.ts:633-663`.

For a non-auth sync failure, call `forceCloseAuthPhases()` synchronously at the start of the fallback `catchError`, before `request$()` is constructed/subscribed. Keep the outer `finalize(forceCloseAuthPhases)` at 685-690 for every terminal path.

```ts
catchError((error) => {
  if (isAuthFamilyError(error)) throw error;
  forceCloseAuthPhases();
  return concat(fallbackStatus(), request$());
})
```

This re-arms the loader's own stall clock before paginated fallback. Do not remove its loader-specific timeout; D-09 removes only Relay sync's built-in lifetime.

Update structural mirrors at `sync-loader.ts:153-167`: define a dependency-free local received-result union (or minimal `type/from/event` shape), make `sync()` return that Observable, and filter `message.type === "received"` before existing event-store/status processing. Preserve auth-name duck typing and no relay-package dependency.

## Test Pattern Assignments

### Raw negentropy tests

Use `relay.test.ts:3123-3198` for NEG-OPEN, typed NEG-ERR, NEG-CLOSE, and abort scaffolding. Convert Promise assertions to observer-spy Observable assertions. Use the real server-side `Negentropy` fixture at 3290-3306, expanded beyond 32 items so a genuine second round is required.

Required exact proofs:

- every decoded round, including empty/terminal, is emitted;
- follow-up NEG-MSG is observed before a synchronously blocking subscriber runs;
- concurrent subscribers cause one NEG-OPEN/listener and one NEG-CLOSE;
- abort/unsubscribe/error/normal terminal each produce correct cardinality;
- premature transport close errors;
- auth/recognized/unknown NEG-ERR classification is exact.

### Sync scheduler/coordinator tests

Use `relay.test.ts:3200-3282` for cancellation/transport scaffolding and 3514-3573 for real SEND/RECEIVE auth routing. Add focused tests for:

- negotiation round two arrives while first-round transfers are blocked;
- active transfer count never exceeds four by default or configured bound;
- continuously replenished SEND lane cannot prevent RECEIVE start;
- results emit in settlement order;
- negotiation completion waits for queue drain;
- ok/negative/thrown upload mapping and identity preservation;
- writable store emits after add resolves; rejected add errors; read-only/array emits;
- zero-event EOSE completes without `EmptyError`;
- one global auth budget across all three verbs;
- reconnect uses fresh storage and a different NEG ID, dropping queued old-attempt tasks.

### Group/Pool and type tests

Convert `group.test.ts:341-415` to assert surviving `SyncMessage` values plus exactly one `relay-failed` with normalized URL and cause identity. Add unsupported-relay and empty-group cases. Mirror unchanged forwarding in `pool.test.ts:371-405`.

Use existing compile fixtures to prove exhaustive narrowing for `SyncMessage`/`GroupSyncMessage`, raw options reject auth/reconnect, sync options reject timeout/invalid result assumptions, removed Group/Pool negentropy calls fail under `@ts-expect-error`, and Pool sync exactly matches Group. Type-only exports must not be added to runtime snapshot; any new error class must be added to `exports.test.ts`.

### Loader tests

Use `sync-loader.test.ts:775-1065` for auth-vs-non-auth fallback and timer-leak coverage. Add a mutation-sensitive case where sync opens an auth phase then fails non-auth: paginated fallback's timeout must fire normally because `forceCloseAuthPhases()` ran before fallback subscription. Assert receive-only filtering ignores `sent`/`send-failed` and maps only `received.event`.

## Mandatory Mutation Proofs

| Mutation | Primary test analog/oracle |
|---|---|
| Delete follow-up NEG-MSG write | >32-item real `Negentropy` fixture stalls before terminal round |
| Emit before follow-up write | synchronous blocking subscriber makes wire-order assertion fail |
| Await transfers in negotiation | blocked first-round transfer withholds round two |
| Replace bounded scheduler with unbounded | observed active task count exceeds four |
| Remove fair lane arbitration | continuously busy SEND queue prevents RECEIVE start |
| Restore per-verb auth counters | total auth-triggered NEG/EVENT/REQ writes exceed global bound |
| Reuse failed negotiation ID/state | reconnect NEG-OPEN ID/vector freshness assertion fails |

For each, record exact RED command/failure and restored GREEN result in plan summaries; verify no mutation residue. Ordinary final green coverage does not satisfy D-24.

## Documentation and Provenance

### Existing docs

Update `apps/docs/loading/relays/negentropy.md:28-179`, `relays.md:348-398`, and Pool sync guidance in place. Replace callback/Promise raw examples with concise Observable `NegentropyRound` handling. Migrate high-level consumers to switch on `SyncMessage.type`; receive-only examples map `received.event`, and upload examples count both `sent` and `send-failed`.

Never present `complete` as proof uploads succeeded. State completion means negotiation ended and all transfers settled. Show caller-owned lifetime with `takeUntil(timer(...))` or AbortSignal, not a Relay sync timeout option. Remove Group/Pool raw negentropy examples; use `pool.relay(url).negentropy()`.

Keep code blocks under roughly 20 lines and update existing Integration/Best Practices sections rather than adding standalone summary/best-practice files.

### Provenance

Amend:

- `.planning/ROADMAP.md` Phase 24 criterion 3 from “one operation clock” to cancellable caller-owned lifetime;
- `.planning/REQUIREMENTS.md` SYNC-01..04 and RESID-03, especially SYNC-03 timeout wording;
- Phase 13 `13-REVIEW.md` WR-04 and verification/residual records when fallback cleanup and zero-event EOSE close;
- Phase 13 summaries/changesets claiming negentropy itself owns auth or sync returns raw events;
- research architecture/features/pitfalls references only where they describe the superseded current contract.

### Changesets

Create three separate files because repository policy requires exactly one change per one-sentence body:

```md
---
"applesauce-relay": major
---

Replace callback-based negentropy with a raw Observable of negotiation rounds.
```

```md
---
"applesauce-relay": major
---

Make sync own coordinated authentication, reconnect, bounded transfers, and explicit transfer outcomes.
```

```md
---
"applesauce-loaders": patch
---

Close sync authentication phases before starting the paginated request fallback.
```

Audit pending relay auth/group-sync changesets and revise/remove duplicated or false claims rather than adding contradictory notes.

## Shared Patterns

### Raw/high boundary

**Source:** EVENT/REQ relayer patterns in `relay.ts`  
Raw negentropy owns readiness, one wire interaction, parsing, and teardown; sync owns auth/reconnect/transfers/lifetime cancellation.

### Positive retry classification

**Source:** `relay.ts:1572-1614`  
Reconnect only positively identified unclean transport failures. Verdict, auth-terminal, malformed protocol, store, and programming errors escape.

### Identity-preserving result values

**Source:** `PublishResponse`, `RelayOutcome`, Phase 23 Group materialization  
Preserve event, response, and error objects by identity; use discriminated unions and normalized `from` fields.

### Per-relay isolation

**Source:** `group.ts:532-573` / `group.test.ts:341-415`  
One relay failure never cancels siblings; unlike current logging-only behavior, emit one attributed `relay-failed` value.

### Deterministic teardown

**Source:** raw REQ/EVENT finalize and loader refcount/finalize patterns  
All subscriptions, abort listeners, queues, timers, and wire interactions have one owner and one idempotent cleanup path.

## No Analog Found

No exact fair two-lane scheduler exists in the repository. Use the loader's bounded `mergeMap` only for the global-cap precedent and explicit state-machine teardown patterns for implementation; fairness/alternation must be designed and locked by tests rather than copied wholesale.

## Metadata

**Analog search scope:** relay raw/high methods, negentropy engine, Group/Pool, sync loader, Phase 13 residual artifacts, relay docs, requirements/roadmap, pending changesets  
**Strong analogs used:** EVENT/REQ raw attempts, call-scoped auth/reconnect operators, loader bounded work/refcount, Group failure isolation  
**Pattern extraction date:** 2026-09-02
