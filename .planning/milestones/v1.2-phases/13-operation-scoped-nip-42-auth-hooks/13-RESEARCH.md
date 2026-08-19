# Phase 13: Operation-Scoped NIP-42 Auth Hooks - Research

**Researched:** 2026-08-05
**Domain:** RxJS-based relay client internals (`applesauce-relay`), sync loader pass-through (`applesauce-loaders`)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Signalling model — value, not throw**
- **D-01:** Auth-required is signalled as a **value on an internal type**, not by throwing. The shared operator consumes that signal and never forwards it downstream. `AuthRequiredError`, `AuthTimeoutError`, and `AuthHandlerError` are constructed **only at the caller boundary** — when the operation gives up.
- **D-02:** Applies at **all four** auth sites. `req` and `count` stop throwing **for auth-required** — they keep throwing for the other `CLOSED` prefixes, which are genuine failures. `event` already emits `{ ok: false, message: "auth-required:" }` as a value and needs no conversion — it becomes the model the others follow. `negentropy` translates `NegentropyError` from `negentropySync` into the same signal at its boundary; that is error *translation at an edge* from a lower layer, not throw-as-signal, and it stays.
- **D-03:** Do NOT extend this treatment to the other `parseClosedError` prefixes (blocked, rate-limited, invalid) — see Deferred Ideas.

**Where the auth flow lives**
- **D-04:** **One shared protected operator** owns handler invocation, `missingPubkeys` computation, the per-phase timeout, retry counting and reset, error mapping, and operation-clock suspension. Each of the four sites supplies only its operation label and normalizes its auth-required signal. RAUTH-07's "available on all eight" becomes a property of the operator rather than four independent implementations that happen to agree. (`request`/`subscription` inherit from `req`, `publish` from `event`, `sync` from `negentropy`.)
- **D-05:** A `RelayAuthOptions` mixin holds `waitForAuth` / `onAuthRequired` / `authTimeout` / `authRetries`, intersected into `RelayReqOptions`, `PublishOptions`, `NegentropySyncOptions`, and **new** `RelayCountOptions` / `RelayEventOptions` / `RelaySyncOptions`.
- **D-06:** `applesauce-loaders` keeps its **structural mirror** — it declares its own `SyncAuthContext` with a minimal relay interface (what a handler actually needs: `url`, `authenticate`, `auth`), annotated "structurally matches applesauce-relay's …" like the existing `SyncAuthRequirement` and `SyncLoaderRelay`. **No new dependency** — loaders deliberately depends only on `applesauce-core`, `nanoid`, `rxjs`. Document the one-way assignability: a handler written against the loaders type accepts a real `Relay`, but one written against relay's full `RelayAuthContext` is not assignable to the loaders handler.

**Retry budget composition**
- **D-07:** **Separate budgets, auth innermost.** Auth-required is fully handled below `customRetryOperator`; an exhausted auth failure surfaces as terminal and the generic publish retry does **not** retry it. Max EVENT sends = `authRetries + 1`, independent of `retries`; connection failures keep their own budget.
- **D-08:** The `authRetries` counter **resets on progress** — once the operation gets past auth and makes progress (REQ opens / events flow / publish accepted), mirroring `DEFAULT_RETRY_CONFIG`'s `resetOnSuccess: true`. `resetState()` clears `authentications$` and both flags on every disconnect, so a long-lived `subscription()` re-receives `auth-required:` after each reconnect; a per-lifetime counter would kill it on the first one.
- **D-09:** Existing pipe order in `req()` is unchanged — auth innermost, then `customConnectionRetryOperator`, then `customRepeatOperator`.
- **D-10:** **No backoff** between auth retries — the `authSatisfied$` wait is the gate.
- **D-11:** When `auth-required:` arrives but `waitForAuth` is **already satisfied**, the handler is still invoked and the wait resolves instantly. One uniform rule, no special case; costs one extra round-trip, bounded by `authRetries`.

**Timeouts**
- **D-12:** `authTimeout` is **one clock over the whole auth phase** — it starts when `auth-required:` is received and covers handler execution *plus* the subsequent wait. `authTimeout: false` therefore means genuinely unbounded, prompt included.
- **D-13:** `authTimeout` is applied **per auth phase** — each `auth-required:` starts a fresh clock. Worst case `(authRetries + 1) × authTimeout`.
- **D-14:** The **uniform 30s default applies with or without a handler**. With no handler the auth phase collapses to just the wait, so `authTimeout` bounds how long the operation waits for out-of-band auth to land on that connection. Today both the pre-block and `req`'s retry delay wait on `authSatisfied$` with no bound at all, so an app with **no auth code whatsoever** hangs forever and never errors — the default converts that silent hang into an `AuthRequiredError`. Callers doing slow out-of-band auth pass `authTimeout: false`; the changeset must say so.
- **D-15:** **Operation-level clocks are suspended across the auth phase** — `count`'s 10s, `request`'s 30s, and `publish`'s `publishTimeout` do not run while waiting for auth, and the operation gets its full timeout for the actual work afterwards.
- **D-16:** In `SyncLoader`, the `withTimeout` stall guard (`rxTimeout({ first, each })`) does not run during an auth wait, **and** an auth-required from the negentropy path does **not** trigger the paginated fallback — only a genuine sync failure does.

**Error surface**
- **D-17:** **Distinct subclasses:** `AuthHandlerError` (carrying the handler's rejection as `cause`) and `AuthTimeoutError`, both extending `RelayClosedError` so `customConnectionRetryOperator`'s `instanceof RelayClosedError` skip keeps working unchanged. Retries-exhausted surfaces as the final `AuthRequiredError`. RAUTH-06's `waitForAuth: false` → `AuthRequiredError` is unchanged.
- **D-18:** `PublishResponse` gains an **optional `error` field**, and `errorToPublishResponse` (`group.ts`) attaches the original error alongside the message. Additive to a published type.
- **D-19:** `RelayGroup.sync` gets **per-relay `catchError`** so one relay's auth failure no longer kills the sync for the rest — matching what the REQ path, the publish path, and `SyncLoader` already do. `sync()` returns `Observable<NostrEvent>` with no error channel, so the dropped relay is visible in debug output only (Phase 14 / ALOG-02 territory).

**Verification**
- **D-20:** **Wire-trace oracle, real timers, short values.** Assert the exact frame sequence and count the mock relay observes — REQ → `CLOSED auth-required:` → AUTH → REQ — derived independently from NIP-42's specified exchange, never from our own state; plus handler-invocation counts for RAUTH-05's concurrency independence. Keep the relay suite's existing real clock (`vitest-websocket-mock` + `subscribeSpyTo`; it uses no fake timers today) and pass small explicit `authTimeout` values.

### Claude's Discretion

- The exact internal signal type name and shape, and where the shared operator lives in the file.
- Whether `RelayAuthContext.relay` stays a concrete `Relay` in `applesauce-relay` itself (only the loaders mirror is decided, D-06).
- Naming of the new error classes beyond the two named in D-17.
- How `missingPubkeys` is computed follows the 999.5 draft verbatim: `true` → `null`, `"pk"` → `["pk"]` if missing else `[]`, `["a","b"]` → only the not-yet-authenticated ones.

### Deferred Ideas (OUT OF SCOPE)

- Value-signal the remaining `CLOSED` prefixes (blocked, rate-limited, invalid) — same principle as D-01, outside this phase's charter. Worth a backlog entry.
- A lint rule enforcing "no throw as an internal signal" — same disposition as the SEED-001 logger rule REQUIREMENTS.md already scoped out.
- A separate bound for handler execution (rejected in favor of D-12's single clock) — revisit only if a real consumer needs a long human-prompt window with a short state wait.
- Relay-internal auth dedupe, single-flight guards, or signer-prompt suppression — apps/libraries own this (REQUIREMENTS.md Out of Scope table).
- Removing `authRequiredForRead$`/`authRequiredForPublish$` — they stay as informational status (RAUTH-09).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RAUTH-01 | `onAuthRequired` invoked with operation-local context (relay, url, challenge, operation, requirement, missingPubkeys, reason) | See "Current Auth Surface" and "Code Examples" — the four auth sites and their current signal shapes are mapped exactly; `RelayAuthContext` fields are all derivable from state already on `Relay` (`challenge$`, `authentications$`, `url`) |
| RAUTH-02 | An operation not itself auth-required is never pre-blocked by an unrelated earlier operation | See "Concurrency" — `waitForAuth()`'s pre-block via `authRequiredForRead$`/`authRequiredForPublish$` is the exact mechanism to remove; confirmed as the sole pre-block site for `req`/`count`/`negentropy` |
| RAUTH-03 | Handler resolves → wait for `waitForAuth` → retry, bounded by `authRetries` (default 1) | See "Retry/Timeout Mechanics" — `authSatisfied$()` already exists and is reusable verbatim; `expand()` is the idiomatic RxJS operator for value-driven recursive retry |
| RAUTH-04 | `authTimeout` (default 30_000ms) bounds the wait; `false` waits indefinitely | See "Retry/Timeout Mechanics" — `customTimeoutOperator`'s existing `false`/`true`/number pattern is the template |
| RAUTH-05 | Concurrent operations each invoke their own handler independently, no relay-internal dedupe | See "Concurrency" — confirmed no shared per-relay auth-attempt state exists today beyond the two boolean flags being removed as pre-block triggers; each operation's own `messages` stream is already independently scoped by REQ/COUNT/EVENT id |
| RAUTH-06 | `waitForAuth: false` → immediate `AuthRequiredError`, never invokes handler; `event(..., "AUTH")` never invokes it | See "Current Auth Surface" — `event()`'s existing `verb === "AUTH" \|\| !waitForAuth` short-circuit (relay.ts:993) is the exact site to preserve |
| RAUTH-07 | Available on `req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, negentropy; passes through `RelayPool`/`RelayGroup` | See "Per-Operation Signatures" — full signature/inheritance map for all 8 operations across 3 classes, including which already derive via `Parameters<>` vs. hand-duplicate |
| RAUTH-08 | `SyncLoader` threads options into both negentropy and paginated paths identically | See "SyncLoader" — both call sites identified (`sync-loader.ts:351`, `:361`); confirms `methodOptions` is the single threading point but flags the internal-call gaps in `Relay.sync()` itself |
| RAUTH-09 | `authRequiredForRead$`/`authRequiredForPublish$` keep updating as informational status only | See "Current Auth Surface" — the two flags' write sites are fully enumerated; all survive, only their *read* sites as pre-block gates are removed |
</phase_requirements>

## Summary

This phase is a **refactor of an existing, working RxJS pipeline**, not new library adoption — there is no new package to install and no external API to learn. The entire task is internal to `packages/relay/src/relay.ts` (1429 lines, single file) plus small threading changes in `group.ts`, `pool.ts`, `negentropy.ts`, and `packages/loaders/src/loaders/sync-loader.ts`. All decisions needed to plan this phase are already locked in `13-CONTEXT.md` — this research's job is to verify those decisions against the *current* source (they check out almost exactly, confirmed line-by-line below) and surface the mechanical gaps the CONTEXT.md decisions don't spell out.

Four concrete gaps were found that the pre-drafted 999.5 plan and CONTEXT.md do not address and that the planner must account for:

1. **`customRetryOperator` (used by `publish()`) has no `RelayClosedError` skip today.** D-07 requires an exhausted auth failure to be terminal and not retried by the generic publish retry, but `customRetryOperator` — unlike its sibling `customConnectionRetryOperator` — is a bare `retry()` with no error-type filtering. Without adding an equivalent skip, removing the auth pre-block turns `publish()`'s existing 3-retry linear-backoff loop into exactly the hot loop D-07 exists to prevent.
2. **Operation-level timeouts (`count`'s 10s, `request`'s 30s, `publish`'s `publishTimeout`) are applied via bare `rxjs timeout()` operators that wrap the *entire* operation pipeline externally** — they have no way to "pause" during an internal auth phase. D-15 requires suspension; the mechanism is undecided and non-trivial (see Common Pitfalls).
3. **`SyncLoader`'s own stall-guard (`rxTimeout({ first, each })`) cannot see into the relay layer's auth phase** — `SyncLoaderRelay`'s minimal structural interface (D-06) only exposes `Observable<NostrEvent>` with no progress/heartbeat signal, so during an auth wait no events flow and the stall guard will fire unless `SyncLoader` is given its own visibility mechanism.
4. **`Relay.sync()`'s two internal calls (`this.event(event)` for the SEND direction, `this.req({ids: need})` for the RECEIVE direction) currently pass no options at all** — under the new no-pre-block model these calls will each independently default to `waitForAuth: true` with no handler, rather than inheriting the caller's `onAuthRequired`/`authTimeout`/`authRetries`/`waitForAuth`. This is required for `sync()`'s own auth behavior to be coherent and is a prerequisite for Phase 15's stream-key-scoped auth to work through the sync path.

A fifth correction: CONTEXT.md's D-05 states "roughly nine literals to keep in sync" for the anonymous `{ waitForAuth?: AuthRequirement }` option type. Verified against source: there are actually **5** independent declarations (`Relay.count`, `Relay.event`, `Relay.sync` each declare their own; `RelayGroup.sync` and `RelayPool.sync` additionally hand-declare rather than deriving via `Parameters<>` the way their `count`/`event` siblings already do). The named-type mixin (D-05) is still the right fix; the planner should scope it as "5 literals, 2 of which also need to switch to deriving via `Parameters<>`" rather than nine independent sites.

**Primary recommendation:** Implement D-04's shared operator as a new file under `packages/relay/src/operators/` (matching the existing `complete-when.ts`/`only-events.ts`/`reverse-switch-map.ts` pattern), built around RxJS `expand()` for the value-driven retry (not `retry()`, which is throw-driven and is exactly the mechanism D-01 is moving away from for the auth-required case). Keep `customConnectionRetryOperator` and `customRepeatOperator` unchanged and downstream of the new operator, per D-09.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth-required detection (per operation) | `applesauce-relay` / `Relay` (API tier — library core) | — | Each of `req`/`count`/`event`/`negentropy` parses its own wire message; detection must live where the wire message is received |
| Auth handler invocation + wait + retry | `applesauce-relay` / `Relay` (shared operator) | — | D-04: one shared operator owns this so behavior is a property of the operator, not four independent implementations |
| Auth callback execution (signing/authenticating) | Consumer application code | `applesauce-concord` (Phase 15) | `onAuthRequired` is a caller-supplied callback; `applesauce-relay` never signs or decides auth policy itself (Out of Scope: no relay-internal dedupe/signer-prompt suppression) |
| Fan-out to multiple relays | `RelayPool`/`RelayGroup` (API tier) | — | Pool/Group forward options to each `Relay` unchanged and aggregate responses; no auth logic of their own beyond RAUTH-05's "each relay/each operation independent" |
| Bulk sync orchestration (multi-relay, dedup, pagination) | `applesauce-loaders` / `SyncLoader` (API tier, loader layer) | — | Structurally decoupled from `applesauce-relay` (D-06); threads options through without owning auth semantics |
| Informational auth status for UI | `Relay.authRequiredForRead$`/`authRequiredForPublish$` (API tier, observable) | Consumer UI/status watchers | Survives unchanged as an observable; only its use as a pre-block gate is removed (RAUTH-09) |

## Standard Stack

No new external dependencies. This phase is a refactor within `applesauce-relay` (rxjs, nostr-tools, nanoid — all already dependencies) and `applesauce-loaders` (applesauce-core, nanoid, rxjs).

### Core (already in use, no version change needed)

| Library | Version (verified) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rxjs | `^7.8.1` (both `applesauce-relay` and `applesauce-loaders` package.json) `[VERIFIED: repo package.json]` | Observable pipeline for the entire relay wire protocol layer | Already the foundation of every operation; the auth flow must be expressed as operators, not Promise/async-await, to compose with existing `retry`/`repeat`/`timeout`/`share` usage |
| vitest | `^4.0.15` `[VERIFIED: repo package.json]` | Test runner | Existing convention across the monorepo |
| vitest-websocket-mock | `^0.5.0` `[VERIFIED: repo package.json]` | Mock WebSocket server for relay wire-protocol tests | Already used exclusively for `relay.test.ts`; D-20 requires continuing to use it with real timers (no fake-timer setup exists today) |
| @hirez_io/observer-spy | `^2.2.0` `[VERIFIED: repo package.json]` | `subscribeSpyTo()` helper for asserting emitted values/errors on an Observable under test | Already the exclusive assertion mechanism in `relay.test.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nanoid | `^5.0.9` (relay) `[VERIFIED: repo package.json]` | REQ/COUNT/NEG-OPEN id generation | Unchanged; no new usage needed for this phase |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RxJS `retry({delay: fn})` (current pattern for auth-required today) | RxJS `expand()` for the shared auth operator | `retry()` is inherently throw-driven — the delay callback only runs on an *error*. Since D-01 moves auth-required off the error channel onto a value channel, `retry()` is the wrong primitive for the new design; `expand()` is designed for exactly "inspect an emitted value, decide whether to recursively re-subscribe to a derived observable" without ever erroring |
| Fake timers for auth-timeout tests | Real timers with short explicit `authTimeout` values (e.g., 50-200ms) | D-20 locks this choice: the relay test suite has never used fake timers, and D-15's clock-suspension behavior is much more crisply observed as real wall-clock ordering than as a mocked virtual-time advance |

**Installation:** None — no new packages.

## Package Legitimacy Audit

Not applicable. This phase introduces zero new external dependencies to any package.json. All work is internal refactoring of `applesauce-relay` and `applesauce-loaders` using libraries already present in both packages' `dependencies`.

## Current Auth Surface

Verified directly against `packages/relay/src/relay.ts` (current source, all line numbers below match the file as read during this research session):

### The two informational flags (RAUTH-09 — survive unchanged)

- `receivedAuthRequiredForReq` / `receivedAuthRequiredForEvent` (`relay.ts:346-347`) — protected `BehaviorSubject<boolean>`, both start `false`.
- Exposed publicly as `authRequiredForRead$` / `authRequiredForPublish$` (`relay.ts:350-351`, wired at `:489-490`).
- **Write sites (must survive):** `req()`'s `retry({delay})` callback sets `receivedAuthRequiredForReq.next(true)` on the first auth-required CLOSED (`:857-858`); `count()`'s `catchError` sets it (`:930-932`); `event()`'s `tap` sets `receivedAuthRequiredForEvent.next(true)` on `ok:false` + `auth-required:` prefix (`:977-981`); `negentropy()`'s `retry({delay})` sets `receivedAuthRequiredForReq.next(true)` (`:1071-1073`).
- **Reset site:** `resetState()` (`:353-363`) sets both back to `false` on every connect and every disconnect — this is why D-08's authRetries-resets-on-progress decision is required (a long-lived subscription reconnecting must re-receive `auth-required:` cleanly).
- **Read-as-pre-block sites to REMOVE:** `req()` at `:845-847` (`this.waitForAuth(this.authRequiredForRead$, observable, waitForAuth)`), `count()` at `:943-945`, `negentropy()` at `:1063`. `event()` has **no** such pre-block today — it already only reacts after receiving the OK response (`:990-995`), confirming D-02's claim that `event` needs no conversion.
- **Read-as-status sites to KEEP:** `status$` (`:519-520`), the two `this.log(...)` subscriptions (`:493-508`).

### The `waitForAuth()` protected method (`relay.ts:702-718`) — the mechanism being removed as a pre-block

```typescript
// Source: packages/relay/src/relay.ts:702-718 (current)
protected waitForAuth<T extends unknown = unknown>(
  requireAuth: Observable<boolean>,
  observable: Observable<T>,
  waitFor: AuthRequirement = true,
): Observable<T> {
  return combineLatest([requireAuth, this.authSatisfied$(waitFor)]).pipe(
    mergeWith(this.watchTower),
    filter(([required, authenticated]) => !required || authenticated),
    take(1),
    switchMap(() => observable),
  );
}
```

This is what makes an *unrelated* earlier auth-required (any REQ on the relay) delay a *new* REQ that has never itself been rejected — exactly RAUTH-02's defect. It is called three times as a pre-gate (`req`, `count`, `negentropy`) and once post-hoc, differently, inside `event()`'s branch (`:995`) where it wraps the *already-in-flight* publish observable rather than gating it before sending — worth noting `event()`'s existing call is **not** a pre-block in the RAUTH-02 sense (it never blocks a fresh EVENT send; it only affects the *retry* wait after a real rejection was already received on that specific EVENT). The new shared operator supersedes all four call sites uniformly.

### Reusable building blocks (verified present, no need to build from scratch)

- `authSatisfied$(requirement)` (`:696-699`) — already maps `AuthRequirement` (`true | string | string[]`) to `this.authenticated$` or `this.authenticatedFor$(requirement)`. The new operator's wait step reuses this verbatim.
- `authenticatedFor$(pubkeys)` (`:687-693`) and `isAuthenticated(pubkeys)` (`:681-684`) — the basis for computing `missingPubkeys`: for a `string[]` requirement, filter the array by `!this.isAuthenticated(pubkey)` (or its observable form for a reactive check).
- `challenge$` (`:199`, `BehaviorSubject<string | null>`) and `this.url` — the remaining two `RelayAuthContext` fields (`challenge`, `url`) that are trivially available.

## Architectural Responsibility Map — Auth Sites Table

| Site | Current signal on auth-required | Current pre-block? | Target signal (D-01/D-02) |
|------|----------------------------------|---------------------|----------------------------|
| `req()` (`:786-796`, `:850-869`) | `tap()` throws a typed `AuthRequiredError` (via `parseClosedError`) into the `messages` stream; `retry({delay})` at `:850-869` catches it | Yes, `:845-847` | Value on the `messages` stream; `req`/`request`/`subscription` inherit |
| `count()` (`:889-900`, `:929-935`) | Same `tap`-throw-in-map pattern (`:892-897`); `catchError` at `:929-935` re-throws after flipping the flag (pure pass-through — exists only because it's on the throw channel) | Yes, `:943-945` | Value; `catchError` re-throw becomes unnecessary once auth-required is a value, not an error |
| `event()` (`:977-995`) | Already a value: `{ ok: false, message: "auth-required:...", from }` | No (see note above) | **No change to the signal shape** — becomes the model the other three follow |
| `negentropy()` (`:1051-1058`, `:1066-1082`) | `NegentropyError` from `negentropySync` → `catchError` maps via `parseClosedError` → re-thrown as typed `RelayClosedError`; `retry({delay})` at `:1066-1082` catches | Yes, `:1063` | Value, translated at the edge (D-02: this translation step is legitimate and stays, only the *result* moves from throw to value) |

## Per-Operation Signatures (RAUTH-07 map)

Verified against `packages/relay/src/types.ts`, `relay.ts`, `group.ts`, `pool.ts`, `negentropy.ts`:

| Operation | Relay signature | Options type today | Derives via `Parameters<>`? | RelayGroup | RelayPool |
|-----------|------------------|---------------------|------------------------------|------------|-----------|
| `req` | `req(filters, opts?: RelayReqOptions)` | Named: `RelayReqOptions` (`types.ts:81-99`) | — | `req(filters, opts?: GroupReqOptions)` — `GroupReqOptions = RelayReqOptions` (`types.ts:185`) | `req(relays, filters, opts?: GroupReqOptions)` (`pool.ts:152-154`, calls `group().req()`) |
| `request` | `request(filters, opts?: RelayRequestOptions)` | Named: `RelayRequestOptions = RelayReqOptions & {timeout?, complete?}` (`types.ts:114-121`) | — | `request(filters, opts?: GroupRequestOptions)` — own type, extends `RelayRequestOptions` (`types.ts:188-193`) | `request(relays, filters, opts?: Parameters<RelayGroup["request"]>[1])` (derived) |
| `subscription` | `subscription(filters, opts?: RelaySubscriptionOptions)` | Named: `RelaySubscriptionOptions = RelayReqOptions` (`types.ts:130`) | — | `subscription(filters, opts?: GroupSubscriptionOptions)` — own type (`types.ts:179-182`) | `subscription(relays, filters, opts?: Parameters<RelayGroup["subscription"]>[1])` (derived) |
| `count` | `count(filters, id, opts?: { waitForAuth?: AuthRequirement })` (`relay.ts:880-884`) | **Anonymous literal** — needs new named `RelayCountOptions` | N/A (this is the literal itself) | `count(filters, id, opts?: Parameters<Relay["count"]>[2])` (`group.ts:285-289`, **already derived**) | `count(relays, filters, id?, opts?: Parameters<RelayGroup["count"]>[2])` (`pool.ts:242-250`, **already derived**) |
| `publish` | `publish(event, opts?: PublishOptions)` | Named: `PublishOptions` (`types.ts:60-75`) | — | *(no direct `publish` on RelayGroup — `event()` is the primitive; `publish` exists only on `Relay` and `RelayPool`)* | `publish(relays, event, opts?: Parameters<RelayGroup["publish"]>[1])` (`pool.ts:177-183`) — **note: this derives from `RelayGroup["publish"]`, but `RelayGroup` has no `publish` method; it has `event()`.** See Pitfall below. |
| `event` | `event(event, verb?, opts?: { waitForAuth?: AuthRequirement })` (`relay.ts:950-954`) | **Anonymous literal** — needs new named `RelayEventOptions` | N/A (literal itself) | `event(event, opts?: Parameters<Relay["event"]>[2])` (`group.ts:204-206`, **already derived**) | `event(relays, event, opts?: Parameters<RelayGroup["event"]>[1])` (`pool.ts:157-163`, **already derived**) |
| `sync` (public) | `sync(store, filters, direction?, opts?: { waitForAuth?: AuthRequirement })` (`relay.ts:1243-1247`) | **Anonymous literal** — needs new named `RelaySyncOptions` | N/A (literal itself) | `sync(store, filter, direction?, opts?: { waitForAuth?: AuthRequirement })` (`group.ts:300-304`) — **hand-declared, NOT derived via `Parameters<>`, unlike this class's own `count`/`event`** | `sync(relays, store, filter, direction?, opts?: { waitForAuth?: AuthRequirement })` (`pool.ts:253-258`) — **also hand-declared, NOT derived** |
| `negentropy` (low-level) | `negentropy(store, filter, reconcile, opts?: NegentropySyncOptions)` (`relay.ts:1028-1032`) | Named: `NegentropySyncOptions` (`negentropy.ts:18-26`) | — | `negentropy(store, filter, reconcile, opts?: GroupNegentropySyncOptions)` — `GroupNegentropySyncOptions = NegentropySyncOptions & {parallel?}` (`types.ts:173-176`) | `negentropy(relays, store, filter, reconcile, opts?: NegentropySyncOptions)` (`pool.ts:166-174`) — note: passes a plain `NegentropySyncOptions`, not `GroupNegentropySyncOptions`, into `group.negentropy()` which expects `parallel`; this is a **pre-existing quirk unrelated to auth**, not introduced or required to be fixed by this phase |

**Corrected literal count (see Summary):** 5 independent anonymous `{ waitForAuth?: AuthRequirement }` declarations exist (`Relay.count`, `Relay.event`, `Relay.sync`, `RelayGroup.sync`, `RelayPool.sync`), not "nine." `RelayGroup.count`/`RelayGroup.event` and `RelayPool.count`/`RelayPool.event` already derive via `Parameters<>` and will pick up the new named types automatically once `Relay.count`/`Relay.event` are updated — no separate edit needed at the Group/Pool level for those two. `RelayGroup.sync`/`RelayPool.sync` are the two that need to be **converted** from hand-declared literals to `Parameters<Relay["sync"]>[3]`-style derivation (matching their own `count`/`event` siblings) as part of this phase, not just retyped in place.

## Retry/Timeout Mechanics

### Current pattern (auth-required on the throw channel)

`req()` and `negentropy()` both use the same shape today:

```typescript
// Source: packages/relay/src/relay.ts:849-869 (req, current)
return defer(() => this.waitForReady(reqWithAuthStrategy)).pipe(
  retry({
    delay: (error) => {
      if (!(error instanceof AuthRequiredError)) return throwError(() => error);
      this.log(`Auth required for REQ`);
      this.receivedAuthRequiredForReq.next(true);
      if (!waitForAuth) return throwError(() => error);
      return this.authSatisfied$(waitForAuth).pipe(
        filter((satisfied) => satisfied),
        take(1),
      );
    },
  }),
  this.customConnectionRetryOperator(opts?.reconnect),
  this.customRepeatOperator(opts?.resubscribe, () => shouldResubscribe),
  share(),
);
```

`retry()`'s `delay` callback only runs when the source **errors**. Under D-01, auth-required stops being an error, so this whole pattern must be restructured around a value-driven mechanism.

### Recommended pattern for the new shared operator (idiomatic RxJS for D-01's value-signal model)

RxJS `expand()` is designed exactly for "look at an emitted value, and if it needs further work, return an observable that continues the sequence" without involving the error channel at all:

```typescript
// Illustrative sketch — exact signal type/shape is Claude's discretion (CONTEXT.md)
type AuthRequiredSignal = { kind: "auth-required"; reason: string };
type OperationResult<T> = T | AuthRequiredSignal;

function isAuthRequired<T>(value: OperationResult<T>): value is AuthRequiredSignal {
  return typeof value === "object" && value !== null && (value as any).kind === "auth-required";
}

source$.pipe(
  expand((value) => {
    if (!isAuthRequired(value)) return EMPTY; // no further expansion; value passes through once
    // handler + wait, bounded by one authTimeout clock (D-12), counted against authRetries (D-03/D-08)
    return runAuthPhase(value).pipe(switchMap(() => resendSource$()));
  }),
  filter((value) => !isAuthRequired(value)), // never let the raw signal reach the subscriber (D-01)
);
```

This keeps auth-required entirely off the RxJS error channel, satisfying D-01's stated cost list (`customConnectionRetryOperator` no longer needs to special-case an auth error that isn't really an error; `count()`'s catch-and-rethrow disappears because there's nothing to catch; no forced stream teardown/resubscribe — `expand()` naturally re-invokes the "resend" sub-observable while keeping the outer subscription alive).

### `authTimeout` — one clock, per-phase (D-12/D-13)

The existing `customTimeoutOperator` (`relay.ts:1173-1183`) already has the exact `false | true | number` pattern `authTimeout` needs:

```typescript
// Source: packages/relay/src/relay.ts:1173-1183 (existing pattern to mirror for authTimeout)
protected customTimeoutOperator<T extends unknown = unknown>(
  timeout: undefined | boolean | number,
  defaultTimeout: number,
): MonoTypeOperatorFunction<T> {
  if (timeout === false) return identity;
  else if (timeout === true) return simpleTimeout(defaultTimeout);
  else return simpleTimeout(timeout ?? defaultTimeout);
}
```

For `authTimeout`, the operand is not a whole operation pipeline but the handler-invocation-plus-wait sub-observable (`runAuthPhase()` in the sketch above) — wrap that single sub-observable with `rxjs timeout()` (or the existing `simpleTimeout` from `applesauce-core/observable`) using `authTimeout ?? 30_000`, and skip entirely (`identity`) when `authTimeout === false`. Because it wraps only the auth sub-phase (not the whole operation), "one clock per auth phase" (D-13) falls out naturally — a fresh `runAuthPhase()` sub-observable is created (and re-wrapped) on every `expand()` recursion.

### Concurrency (RAUTH-05)

No relay-internal state exists today that would cause two concurrent operations to share an auth outcome, beyond the two informational flags being removed as pre-block *inputs*. Confirmed:

- `req()`'s `messages` stream is filtered `m[1] === id` (the REQ subscription id) — scoped per-call.
- `count()`'s `messages` stream is filtered `m[1] === id` (the COUNT id) — scoped per-call.
- `event()`'s `messages` stream is filtered `m[1] === event.id` — scoped per-call.
- `negentropy()`'s `incoming` stream is filtered `m[1] === id` (the NEG-OPEN id) — scoped per-call.

Each operation already has its own independent message stream; the only *cross-operation* coupling today is exactly the `authRequiredForRead$`/`authRequiredForPublish$` pre-block being removed. Once the shared operator computes and acts on state purely local to its own `expand()` closure (no shared mutable relay-level auth-attempt registry), RAUTH-05 falls out by construction — there is nothing to add for isolation, only something to *stop doing* (the pre-block read).

## SyncLoader

Verified against `packages/loaders/src/loaders/sync-loader.ts` (current source):

- **Negentropy path:** `sync(url, filter, methodOptions)` at `:361`, inside the `switchMap` branch for `negentropy === true`.
- **Paginated path:** `paginatedRequest(request, url, filter, limit, log.extend(url).extend("request"), methodOptions)` at `:351`, called both for the `!negentropy` branch (`:356`) and the negentropy-fallback branch (`:371`, same `request$()` closure).
- **Single threading point confirmed:** `methodOptions: SyncMethodOptions = { waitForAuth }` (`:270`) is passed to both `sync(...)` and `paginatedRequest(...)` — this is exactly where `onAuthRequired`/`authTimeout`/`authRetries` need to be added, satisfying RAUTH-08's "identically" requirement in one place.
- **`SyncMethodOptions`** (`:77`) is currently `{ waitForAuth?: SyncAuthRequirement }` — needs the same three new fields, typed against the loaders' own mirror handler type (D-06), not `applesauce-relay`'s.
- **`SyncLoadRequest`** (`:119-143`) is the outer, caller-facing type that already has `waitForAuth` (`:142`) — the three new fields land here too and flow down into `methodOptions`.

### Gap: `withTimeout` stall guard cannot see the auth phase (D-16, first half)

`withTimeout` (`:278-279`) wraps both `sync(...)` and `paginatedRequest(...)` with `rxTimeout({ first: timeoutMs, each: timeoutMs })`, default `timeoutMs = 30_000` (same default as the new `authTimeout`). Both underlying calls return `Observable<NostrEvent>` only — no progress/heartbeat emission exists during an internal auth wait, so if an auth cycle (handler + wait) takes anywhere close to `timeoutMs`, the `each` reset has nothing to reset on and the stall guard fires, which is exactly what D-16 prohibits.

`SyncLoaderRelay`'s minimal interface (D-06) means `SyncLoader` cannot subscribe to the real `Relay`'s internal auth-phase state directly. The mechanism available without violating D-06: **`SyncLoader` can wrap the caller-supplied `onAuthRequired` itself**, since `onAuthRequired` is a value `SyncLoader` already owns and threads into `methodOptions` — it fully controls what callback actually reaches the underlying `sync`/`request` methods. A wrapper that flips a local flag/`Subject` immediately before invoking the real handler and (optionally) resets it after the handler resolves gives `SyncLoader` a self-contained signal to pause its own stall-guard clock around at least the handler-execution portion of the auth phase, without any new dependency or interface change. The residual "wait after handler resolves" sub-phase is bounded by the relay's own `authTimeout` (which the SyncLoader passes through and which defaults to the same 30s as `SyncLoader`'s own timeout) — this is a coincidence of matching defaults, not a guarantee, and should be called out explicitly in code comments/tests rather than silently relied upon. See Open Questions.

### Gap: distinguishing exhausted-auth failure from genuine sync failure (D-16, second half)

The negentropy→fallback `catchError` (`:362-374`) currently treats *any* error from `sync(...)` as cause to fall back to the paginated path. Under the new model, `sync(...)` will itself retry auth-required internally (bounded by `authRetries`) and only reach `SyncLoader`'s `catchError` with a terminal error once exhausted, when `waitForAuth: false`, or on a genuine non-auth failure. D-16 requires the fallback to trigger only for the genuine-failure case.

**Constraint:** `applesauce-loaders` must not import `applesauce-relay`'s `AuthRequiredError`/`AuthHandlerError`/`AuthTimeoutError` classes (D-06 — no new dependency), so an `instanceof` check is unavailable.

**Recommended resolution (duck-typed, dependency-free, matches existing codebase convention):** every relay-layer error class in this file sets `this.name` explicitly (confirmed: `RelayClosedError` → `"RelayClosedError"`, `AuthRequiredError` → `"AuthRequiredError"`). `SyncLoader`'s `catchError` can check `error?.name` against the known auth-error names (or, more robustly, a single shared string convention if the new `AuthHandlerError`/`AuthTimeoutError` classes also set distinguishing names) without any type-level coupling. This is consistent with how the rest of `sync-loader.ts` already treats errors as untyped/duck-typed (`error?.message ?? error` throughout the file's logging). Confirm the exact `.name` values chosen for the new error classes during planning so this check can be written precisely (Claude's Discretion per CONTEXT.md — naming beyond `AuthHandlerError`/`AuthTimeoutError` is open).

## Common Pitfalls

### Pitfall 1: `publish()`'s generic retry has no error-type filter — the D-07 hot-loop risk is real and unaddressed by name in either CONTEXT.md's operator inventory or the 999.5 draft's file list

**What goes wrong:** `customRetryOperator` (`relay.ts:1117-1125`), used by `publish()` (`relay.ts:1235`), is a bare `retry({...count})` with no `delay` callback and no error-type check — unlike `customConnectionRetryOperator` (`:1128-1147`), which explicitly re-throws (skips) `instanceof RelayClosedError`. If the new `event()`/`publish()` auth handling still ultimately surfaces a terminal `AuthRequiredError`/`AuthHandlerError`/`AuthTimeoutError` (all `extends RelayClosedError` per D-17) up through `publish()`'s pipe, `customRetryOperator` will retry it exactly like any other failure — 3 times by default, with only 1-second linear backoff — which is the hot loop D-07's rationale explicitly warns about, just moved one layer up.

**Why it happens:** `customRetryOperator` and `customConnectionRetryOperator` look like siblings but only one of them has the `RelayClosedError` skip. The skip was added for a different reason (protect the CLOSED-error retry from a connection-layer retry double-count) and nobody has needed to protect `publish()`'s own retry from a `RelayClosedError` subtype before, because until now `AuthRequiredError` was consumed entirely inside `event()`'s auth wait before ever reaching `publish()`'s pipe.

**How to avoid:** Give `customRetryOperator` the same `instanceof RelayClosedError` skip `customConnectionRetryOperator` already has (or an equivalent guard), OR ensure the shared auth operator's terminal error is caught and re-thrown at a point in `event()`'s own pipe that `publish()`'s `customRetryOperator` never even observes as a distinct error worth retrying. Either way, this must be an explicit task in the plan, not an assumed side effect of D-07's operator ordering.

**Warning signs:** A test asserting "publish sends at most `authRetries + 1` EVENT messages for a persistent auth-required" will catch this if written; without it, the defect is invisible until a live relay that never satisfies auth causes rapid repeated EVENT sends.

### Pitfall 2: Operation-level timeouts wrap the *entire* pipeline externally via bare `rxjs timeout()` — "suspend during auth" has no obvious mechanism

**What goes wrong:** `count()`'s 10s (`timeout({first: 10_000, ...})`, `:937`), `request()`'s 30s (`timeout({first: opts?.timeout ?? 30_000})`, `:1211`), and `publish()`'s `publishTimeout` (via `customTimeoutOperator`, `:1237`) are each a single `rxjs timeout()` call wrapping the operation's whole observable, including — once the pre-block is removed — any internal auth phase that now happens *inside* that same observable. `rxjs timeout()` has no built-in "pause" primitive; it only knows "no emission within N ms of source-start (or since the last emission)."

**Why it happens:** Today these clocks appear to work correctly only because the pre-block (`waitForAuth()` gating the observable's construction) makes the auth wait happen *before* the timeout-wrapped observable is even subscribed. Once RAUTH-02 removes the pre-block, auth-required is discovered mid-flight, inside the timeout window.

**How to avoid:** The shared auth operator needs to communicate elapsed/remaining budget to the outer operation-level timeout, or the outer timeout needs restructuring into something auth-phase-aware (e.g., tracking "time spent actively working" separately from "time spent in an auth phase" and re-arming a timer with the remaining budget after each auth phase completes, mirroring how `customConnectionRetryOperator`'s `delay` callback already recomputes per-attempt). This is **not decided** in CONTEXT.md (D-15 states the required *behavior*, not the *mechanism*) — flag as an explicit design task in the plan, likely to live inside or alongside the D-04 shared operator itself so all four (eight) operations get the suspension uniformly rather than reinventing it per call site.

**Warning signs:** A test with `authTimeout` set higher than the operation's own default timeout (e.g., `count()` with `authTimeout: 5000` against the unchanged 10_000ms COUNT timeout) that fails today would prove the mechanism is missing — CONTEXT.md already anticipated this exact scenario as the motivating case for D-15 ("`count()`'s hard 10s could never survive an auth round-trip").

### Pitfall 3: `Relay.sync()`'s internal `this.event(event)` and `this.req({ids: need})` calls pass no auth options at all

**What goes wrong:** `sync()` (`relay.ts:1243-1324`) internally calls `this.event(event)` (`:1280`, for the SEND direction) and `this.req({ ids: need })` (`:1290`, for the RECEIVE direction) with **no opts argument** — today this silently relies on the ambient pre-block flags to gate these internal calls consistently with the outer `negentropy()` call's own auth handling. Once the pre-block is removed and auth-required becomes fully per-call, these two internal calls will each independently default to `waitForAuth: true` with **no handler**, meaning: (a) they will not receive the caller's `onAuthRequired`, `authTimeout`, or `authRetries`, and (b) per D-14 they will each wait up to the uniform 30s default for *any* pubkey to authenticate, which may be entirely disconnected from what the caller's `sync()` call actually configured.

**Why it happens:** Neither the pre-drafted 999.5 plan's "Sync And Negentropy Changes" section nor CONTEXT.md's canonical-refs list mention these two internal call sites — both documents describe `sync()`/`negentropy()` as if there were one auth surface, but `sync()` is actually three (the negotiation itself via `negentropy()`, plus these two internal helper calls).

**How to avoid:** Thread `sync()`'s own `opts` (the new `RelaySyncOptions`, containing `onAuthRequired`/`authTimeout`/`authRetries`/`waitForAuth`) into both `this.event(event, "EVENT", opts)` and `this.req({ ids: need }, opts)` explicitly. This should be scoped as its own task in the plan — it is required for RAUTH-07/RAUTH-08 correctness and is a direct prerequisite for Phase 15 (CAUTH-01/02's stream-key-scoped `waitForAuth` must apply uniformly across everything `sync()` does, not just its negotiation phase).

**Warning signs:** A test that configures `sync()` with a custom `onAuthRequired` and a SEND-direction payload, then asserts the handler is invoked for the EVENT send (not just the negentropy negotiation), would catch this; without such a test the gap is invisible.

### Pitfall 4: `RelayGroup.sync`/`RelayPool.sync` option types are hand-declared, not derived — easy to update one and silently miss the other

**What goes wrong:** Unlike `count`/`event`, where `RelayGroup`/`RelayPool` already derive their option types via `Parameters<Relay["count"]>[2]`/`Parameters<Relay["event"]>[2]` (so updating `Relay.count`'s type automatically propagates), `RelayGroup.sync` (`group.ts:304`) and `RelayPool.sync` (`pool.ts:258`) both independently declare `opts?: { waitForAuth?: AuthRequirement }` inline. Updating only `Relay.sync`'s new `RelaySyncOptions` type will not change these two signatures — they must be edited (and ideally converted to derive via `Parameters<>`, matching the sibling pattern) as their own explicit sub-task.

**Warning signs:** TypeScript will not catch a missed update here at the call sites that only pass `{ waitForAuth }` (still valid against the stale literal); it will only surface as a runtime gap where `onAuthRequired` silently has no effect when called through `pool.sync(...)`/`group.sync(...)`.

## Code Examples

### `event()`'s existing value-based signal — the model D-01/D-02 generalizes

```typescript
// Source: packages/relay/src/relay.ts:970-995 (current, unchanged by D-02)
const observable = merge(this.watchTower, messages).pipe(
  takeUntil(messages.pipe(ignoreElements(), endWith(true))),
  take(1),
  tap(({ ok, message }) => {
    if (ok === false && message?.startsWith(AUTH_REQUIRED_PREFIX) && !this.receivedAuthRequiredForEvent.value) {
      this.log("Auth required for publish");
      this.receivedAuthRequiredForEvent.next(true);
    }
  }),
  timeout({
    first: this.eventTimeout,
    with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" }),
  }),
);

// skip wait for auth if verb is AUTH or waitForAuth is false — the exact site RAUTH-06 must preserve
const waitForAuth = opts?.waitForAuth ?? true;
if (verb === "AUTH" || !waitForAuth) return this.waitForReady(observable).pipe(share());
```

### `missingPubkeys` computation basis (D-11 / Claude's Discretion, per 999.5 draft rules)

```typescript
// Illustrative — uses relay.ts's existing isAuthenticated() (relay.ts:681-684)
function computeMissingPubkeys(relay: Relay, requirement: AuthRequirement): string[] | null {
  if (requirement === true) return null;
  if (typeof requirement === "string") return relay.isAuthenticated(requirement) ? [] : [requirement];
  return requirement.filter((pk) => !relay.isAuthenticated(pk));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Relay-wide cached `authRequiredForRead$`/`authRequiredForPublish$` used as a pre-block gate before every REQ/COUNT/negentropy send | Per-operation `onAuthRequired` invoked only when *that* operation itself receives `auth-required:`; the two flags survive as informational status only | This phase (13) | Removes the cross-operation coupling that made an unrelated relay-wide auth requirement delay operations that were never rejected (RAUTH-02); requires four callers to stop using `AuthRequiredError` as an internal control-flow signal |
| `auth-required:` on `req`/`count`/`negentropy` signalled via `throw` into the RxJS error channel, caught by `retry({delay})` | Signalled as a value on the emission channel, consumed by a dedicated operator that never lets it reach the subscriber | This phase (13) | `AuthRequiredError`/new `AuthHandlerError`/`AuthTimeoutError` become caller-boundary-only constructs (D-01); `customConnectionRetryOperator`'s `instanceof RelayClosedError` skip and the new subclasses' inheritance from it must both hold for D-17's constraint to keep working |
| No bound on how long a REQ/EVENT/COUNT/negentropy call waits for out-of-band authentication (silent indefinite hang with no auth code at all) | `authTimeout` (default 30_000ms) bounds every auth phase; `authTimeout: false` opts back into indefinite waiting explicitly | This phase (13) | Breaking behavior change for any app that relied on the old silent-forever-hang as an implicit "wait for auth eventually" pattern — this is the change the `applesauce-relay` changeset must call out explicitly per CONTEXT.md's Specific Ideas |

**Deprecated/outdated:** None — no NIP-42-specific tooling or API in this codebase becomes obsolete; this is a purely internal restructuring of how the existing protocol handling is expressed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The recommended `expand()`-based operator sketch is *a* correct idiomatic way to express D-01's value-driven retry without the error channel — not the only way, and not binding | Retry/Timeout Mechanics | Low — CONTEXT.md explicitly leaves "the exact internal signal type name and shape, and where the shared operator lives" to Claude's Discretion; if the executor picks a different RxJS idiom (e.g., a hand-rolled recursive `Subject`-driven loop), that is within scope as long as D-01/D-09's ordering and D-10's no-backoff constraint hold |
| A2 | The recommended mechanism for `SyncLoader`'s stall-guard suspension (wrapping the caller's `onAuthRequired` to flip a local flag) is sufficient to satisfy D-16 in practice, even though it only covers the handler-execution portion of the auth phase, not the full wait | SyncLoader — Gap: withTimeout stall guard | Medium — if a real deployment's post-handler wait routinely exceeds the remaining stall-guard budget, D-16 would still be violated in that residual window; this should be validated with an explicit test during planning/execution rather than assumed correct from this research alone |
| A3 | `RelayPool.negentropy`'s pass-through of a plain `NegentropySyncOptions` into `RelayGroup.negentropy` (which expects `GroupNegentropySyncOptions`, i.e. `NegentropySyncOptions & {parallel}`) is a pre-existing quirk unrelated to auth and out of this phase's scope | Per-Operation Signatures table | Low — if the planner disagrees and wants it fixed in-phase, it is a two-line unrelated fix; flagged here only so it isn't mistaken for something this phase's D-05 mixin work is expected to touch |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **What exact mechanism suspends operation-level timeouts (`count`'s 10s, `request`'s 30s, `publish`'s `publishTimeout`) during an internal auth phase (D-15)?**
   - What we know: The behavior is locked (D-15); the current implementation is a bare external `rxjs timeout()` with no pause primitive (Pitfall 2).
   - What's unclear: Whether the shared D-04 auth operator should itself track elapsed-vs-suspended time and re-arm the outer timeout with the remaining budget, or whether each of the three operation-level timeouts needs its own bespoke adjustment.
   - Recommendation: Resolve this as part of designing the shared operator itself (D-04) rather than per-call-site, since all three (count/request/publish) need the same suspension property and the shared operator already owns "how long was the auth phase."

2. **How exactly does `SyncLoader` observe "an auth phase is in progress" without depending on `applesauce-relay` (D-06)?**
   - What we know: `SyncLoader` fully controls the `onAuthRequired` value it threads into `methodOptions`, so it can wrap the caller's handler to observe start/end of *handler execution*.
   - What's unclear: Whether wrapping just the handler execution (not the full post-handler wait) is sufficient for D-16's "does not run during an auth wait" in every real scenario, or whether a stronger signal is needed (see Assumption A2).
   - Recommendation: Implement the wrapped-handler approach first (simplest, no interface change), and add a test that specifically exercises a slow post-handler wait (handler resolves quickly, but `authSatisfied$` takes a while to actually become true) to confirm the stall guard still behaves correctly in that window before considering the design complete.

3. **Exact naming for `AuthHandlerError`/`AuthTimeoutError`'s `.name` values, since `SyncLoader`'s duck-typed error check (Pitfall/Gap section) needs to match them precisely without importing the classes.**
   - What we know: Both extend `RelayClosedError`; D-17 names the classes but not their `.name` string values, and the existing codebase convention sets `this.name = "<ClassName>"` verbatim (confirmed for `RelayClosedError`/`AuthRequiredError`).
   - What's unclear: Nothing structurally — this is a naming decision, not a design gap.
   - Recommendation: Follow the existing convention (`this.name = "AuthHandlerError"` / `"AuthTimeoutError"`) so `SyncLoader`'s duck-typed check can be written as a simple string-set membership test, and document the coupling in a comment at both the error-class definitions and the `SyncLoader` check site so a future rename doesn't silently break it.

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies beyond what is already installed and verified above (rxjs, vitest, vitest-websocket-mock, @hirez_io/observer-spy — all present in the relevant package.json files). No database, no network service, no CLI tool beyond the existing `pnpm`/`vitest` toolchain.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.0.15` `[VERIFIED: repo package.json]` |
| Config file | Root `vitest.config.ts` (no per-package workspace projects — positional path filters only bind when vitest runs from the repo root, per STATE.md's `vitest-per-file-filter` lesson) |
| Quick run command | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` (from repo root) |
| Full suite command | `pnpm --filter applesauce-relay test` and `pnpm --filter applesauce-loaders test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RAUTH-01 | `onAuthRequired` invoked with full context on the operation that received `auth-required:` | unit (wire-trace, `vitest-websocket-mock`) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ existing file, new `describe`/`it` blocks needed |
| RAUTH-02 | Unrelated earlier operation's auth-required does not pre-block a fresh operation | unit (wire-trace, two REQs on distinct ids) | same | ✅ existing file |
| RAUTH-03 | Handler resolves → wait → retry, bounded by `authRetries` | unit (wire-trace, count REQ sends) | same | ✅ existing file |
| RAUTH-04 | `authTimeout` bounds the wait; `false` waits indefinitely | unit (real-timer, short explicit `authTimeout`, D-20) | same | ✅ existing file |
| RAUTH-05 | Concurrent operations each invoke their own handler independently | unit (two concurrent REQs, handler-invocation-count assertion, D-20) | same | ✅ existing file |
| RAUTH-06 | `waitForAuth: false` → immediate `AuthRequiredError`, no handler call; `event(..., "AUTH")` never invokes it | unit | same (extends existing `:301-308` pattern) | ✅ existing file |
| RAUTH-07 | Available on all 8 operations, passes through Pool/Group | unit (pool.test.ts, group.test.ts pass-through assertions) | `pnpm vitest run packages/relay/src/__tests__/pool.test.ts packages/relay/src/__tests__/group.test.ts` | ✅ existing files |
| RAUTH-08 | `SyncLoader` threads options into both paths identically | unit (mock `request`/`sync` functions, assert call args, matching existing `:125/:142/:158` pattern) | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | ✅ existing file |
| RAUTH-09 | `authRequiredForRead$`/`authRequiredForPublish$` keep updating | unit | same as RAUTH-01 file | ✅ existing file |

### Sampling Rate

- **Per task commit:** `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` (or the specific file touched)
- **Per wave merge:** `pnpm --filter applesauce-relay test` and, once loaders changes land, `pnpm --filter applesauce-loaders test`
- **Phase gate:** Both full suites green before `/gsd-verify-work`; per REQUIREMENTS.md's Verification Standard, `pnpm --filter applesauce-concord test` is not required until Phase 15 lands, but running it as a smoke check is cheap and catches any accidental behavior change in the flags Concord's `relay-auth.ts`/`invite-watcher.ts`/`community.ts` still read (`authRequiredForRead`/`authRequiredForPublish` on `RelayStatus`, confirmed still consumed by `packages/concord/src/client/relay-auth.ts:110,206`, `invite-watcher.ts:258,428,435`).

### Wave 0 Gaps

None — `relay.test.ts`, `pool.test.ts`, `group.test.ts`, and `sync-loader.test.ts` all already exist with an established `vitest-websocket-mock` + `subscribeSpyTo` (relay) / mocked-function (sync-loader) convention that directly supports every requirement above. No new test infrastructure or fixture file is needed; only new `describe`/`it` blocks within the existing files.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Yes — this phase's entire subject is NIP-42 authentication flow control | This phase does not change *how* authentication is cryptographically performed (signing/verifying kind 22242 events is unchanged, still delegated to the caller's `AuthSigner`/`onAuthRequired` callback); it changes *when and how often* the client attempts and waits for it. No new crypto surface is introduced. |
| V3 Session Management | Marginal | `authentications$`/`authenticatedPubkeys$` (per-connection, per-pubkey auth state) are read-only inputs to this phase's logic, unchanged in shape. `resetState()`'s clear-on-disconnect behavior (unchanged by this phase) is the existing session-reset boundary. |
| V4 Access Control | No | This phase does not decide *who* may authenticate or *what* an authenticated pubkey may do — that remains entirely relay-side and (for Concord) Phase 15's scope. |
| V5 Input Validation | Marginal | `AuthRequirement` (`boolean \| string \| string[]`) and the wire-parsed `reason`/`challenge` strings are already validated/typed at their existing boundaries (`parseClosedError`, `AUTH` message handler); no new untrusted-input surface is introduced by adding `onAuthRequired`/`authTimeout`/`authRetries` as options. |
| V6 Cryptography | No | No cryptographic operation is added, changed, or removed by this phase. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Malicious/misbehaving relay sends `auth-required:` on every response to force the client into a retry storm | Denial of Service | `authRetries` (default 1) + `authTimeout` (default 30s) bound every auth cycle per operation (D-03/D-04/D-12/D-13); the caller's own `onAuthRequired` handler is the point where an app could add its own suspicion/backoff policy — deliberately left as app-owned per REQUIREMENTS.md's Out of Scope table (no relay-internal dedupe/suppression) |
| A caller's `onAuthRequired` handler throws/rejects for a reason unrelated to auth (e.g., a bug), and the operation silently swallows or mis-attributes the failure | Repudiation / Information Disclosure (weak) | D-17's distinct `AuthHandlerError` (carrying the handler's original rejection as `.cause`) ensures a handler bug surfaces distinctly from a genuine relay timeout/rejection, which the caller can branch on (via `PublishResponse.error`, D-18, for the publish path) |
| Two concurrent operations against the same relay race to authenticate the same pubkey, potentially double-sending AUTH events | Tampering (low severity — AUTH events are ephemeral, harmless if duplicated) | Explicitly out of scope for this phase (RAUTH-05 requires *no* relay-internal dedupe); `Relay.auth()` (`relay.ts:999-1025`) already re-inserts by pubkey key on every call, so a duplicate AUTH is idempotent-ish at the state level even without dedupe |

## Sources

### Primary (HIGH confidence)

- `packages/relay/src/relay.ts` (current source, read in full during this session) — every auth site, retry operator, and timeout operator cited above `[VERIFIED: local source read]`
- `packages/relay/src/types.ts`, `packages/relay/src/group.ts`, `packages/relay/src/pool.ts`, `packages/relay/src/negentropy.ts` (current source, read in full) — full RAUTH-07 signature map `[VERIFIED: local source read]`
- `packages/loaders/src/loaders/sync-loader.ts` (current source, read in full) — SyncLoader threading points and gaps `[VERIFIED: local source read]`
- `packages/relay/src/__tests__/relay.test.ts`, `pool.test.ts`, `group.test.ts`, `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` (existing test conventions, greped and sampled) `[VERIFIED: local source read]`
- `packages/relay/package.json`, `packages/loaders/package.json`, `.changeset/config.json` — dependency versions and changeset/monorepo conventions `[VERIFIED: local source read]`
- `.planning/phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md`, `13-DISCUSSION-LOG.md` — locked decisions D-01 through D-20, cross-checked line-by-line against current source (all confirmed accurate within a few lines of drift, noted where relevant) `[VERIFIED: local source read]`
- `.planning/phases/999.5-operation-scoped-nip-42-auth-hooks/operation-scoped-nip-42-auth-hooks-plan.md` — pre-drafted plan, cross-checked against current source; gaps identified in Pitfalls 3 and the `customRetryOperator` finding are not covered by this document `[VERIFIED: local source read]`
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — requirement IDs, phase sequencing, and standing project conventions (`vitest-per-file-filter` lesson applied above) `[VERIFIED: local source read]`

### Secondary (MEDIUM confidence)

- GitHub `nostr-protocol/nips/blob/master/42.md` — confirmed the exact NIP-42 wire sequence (`AUTH` challenge → client attempts `REQ`/`EVENT` → `auth-required:` on `CLOSED`/`OK` → client sends signed kind-22242 `AUTH` → client retries) matches the D-20 wire-trace oracle described in CONTEXT.md `[CITED: github.com/nostr-protocol/nips/blob/master/42.md]`

### Tertiary (LOW confidence)

None — every substantive claim in this document was verified against local source or the NIP-42 spec text.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all versions read directly from package.json
- Architecture: HIGH — every claim cross-checked against current source with exact line citations; the four gaps in the Summary/Pitfalls are net-new findings not present in CONTEXT.md or the 999.5 draft, derived directly from reading the code they describe
- Pitfalls: HIGH — each pitfall traces to a specific, cited code location and a specific decision (D-07, D-15, D-06/D-16) it interacts with
- Validation Architecture: HIGH — test framework and conventions read directly from existing test files, no assumptions

**Research date:** 2026-08-05
**Valid until:** 30 days (stable internal refactor of code already in the repo; the only external-facing risk is if `rxjs` or `vitest-websocket-mock` ship a breaking change in that window, which is unlikely at their current pinned minor ranges)
