---
phase: 13-operation-scoped-nip-42-auth-hooks
reviewed: 2026-08-06T22:56:57Z
depth: standard
round: gap-closure (supersedes the 2026-08-06T11:48:11Z review of waves 1-7)
files_reviewed: 22
files_reviewed_list:
  - packages/relay/src/operators/auth-retry.ts
  - packages/relay/src/relay.ts
  - packages/relay/src/group.ts
  - packages/relay/src/pool.ts
  - packages/relay/src/negentropy.ts
  - packages/relay/src/types.ts
  - packages/relay/src/__tests__/auth-retry.test.ts
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/__tests__/pool.test.ts
  - packages/relay/src/__tests__/exports.test.ts
  - packages/loaders/src/loaders/sync-loader.ts
  - packages/loaders/src/loaders/__tests__/sync-loader.test.ts
  - packages/loaders/src/loaders/__tests__/exports.test.ts
  - .changeset/relay-auth-handler-sync-throw-mapped.md
  - .changeset/relay-auth-resend-req-count-observed.md
  - .changeset/relay-auth-retry-bound-not-reset-by-req-open.md
  - .changeset/relay-group-logger-routing.md
  - .changeset/relay-group-request-timeout-suspended.md
  - .changeset/relay-request-timeout-can-fire.md
  - .changeset/sync-loader-auth-phase-timer-leak-fixed.md
  - .changeset/sync-loader-handlerless-stall-suspension.md
findings:
  critical: 3
  warning: 11
  info: 0
  total: 14
status: issues_found
---

# Phase 13: Code Review Report (gap-closure round)

**Reviewed:** 2026-08-06T22:56:57Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

This gap-closure round genuinely closes CR-01..CR-04 and WR-01..WR-06 as scoped. I traced each fix
rather than trusting the SUMMARY files, and each holds:

- `authRetry`'s `isProgress` and `suspendableTimeout`'s `firstWhen` are structurally required; a
  call site that omits them is a compile error, not a runtime surprise.
- `req()` (13-09) and `count()` (13-10) now build the send side effect and the terminating listen
  chain together inside one unshared `defer`. I traced the reentrant path — the `share()` Subject
  delivers `next` to the `ignoreElements` notifier and the control `switchMap` before `complete`,
  and `expand` resubscribes the defer synchronously inside that `next` dispatch — and confirmed the
  resend now reaches a live chain.
- `event()` satisfies the send/listen invariant for the reason stated (its `messages` share never
  terminates, and attempt 2 joins it before attempt 1 drops the refcount to zero).
  `negentropy()`/`sync()` satisfy it because `runSync` is a `defer` over a Promise, so the
  resubscribe is always asynchronous. `publish()`/`subscription()` inherit from `event()`/`req()`.
- D-06 holds: `packages/loaders/package.json` declares only `applesauce-core`, `nanoid` and `rxjs`,
  and no file under `packages/loaders/src` imports `applesauce-relay` at value or type level.
- 13-13's WR-04 timer work holds; all three leak paths (arm-after-close, synchronous throw,
  teardown) are covered and the `finalize` placement rationale is correct as far as it goes.
- All eight changesets comply with CLAUDE.md: one change each, a single sentence of markdown, no
  bullets, no code blocks, no multiple paragraphs. `patch` is the right bump for eight bug fixes;
  the phase's new public surface is already covered by the pre-existing `minor`
  `relay-operation-scoped-auth-callbacks.md`.

What this round did **not** close is the defect *class* it claims to have made unrepresentable.
Three blockers below are live, remotely triggerable, unbounded-hang or wrong-error defects that I
reproduced against the real `Relay`/`RelayGroup` with `vitest-websocket-mock` (probe files written
under `packages/relay/src/__tests__/`, run individually, deleted after use; `git status --short`
confirmed a clean tree afterwards). One of them (CR-02 below) is the *exact* WR-01 "bookkeeping
value counted as progress" defect, reintroduced at the very group call site plan 13-11 was written
to fix.

The four suites I ran are green (238/238). The blockers are invisible to them because no test
exercises a multi-round negentropy negotiation, a group request mixing erroring and silent relays,
or a `CLOSED` reason whose prefix collides with `Object.prototype`.

## Critical Issues

### CR-01: `negentropySync` never sends the follow-up `NEG-MSG` — any multi-round sync hangs forever

**File:** `packages/relay/src/negentropy.ts:129-157` (specifically 144-148); dead capability declared at `:66`

**Issue:** The reconciliation loop computes the next client message and stores it, but never writes
it to the socket:

```ts
const [newMsg, have, need] = await ne.reconcile<string>(received.data);
await reconcile(have, need);
msg = newMsg;          // <- assigned, never sent
```

`socket.multiplex`'s `open` callback sends `["NEG-OPEN", id, filter, initialMessage]` exactly once
on subscribe. `incoming` is `share()`d and held open by `sub` (line 123), so the refcount never
reaches zero and the multiplex never re-opens. The `socket` parameter is typed
`MultiplexWebSocket & { next: (msg: any) => void }` — the `next` capability exists precisely so this
loop can send `["NEG-MSG", id, msg]` — and `socket.next` is never called anywhere in the file.

Consequence: whenever `ne.reconcile()` returns a non-null `newMsg`, the loop iterates and blocks on
`firstValueFrom(race(incoming, abortSignal$))` waiting for a reply the relay will never send,
because the client never asked. Nothing bounds it: `Relay.negentropy()` documents "no
operation-level clock of its own (that's `sync()`'s to manage)" (relay.ts:1271-1273) and
`Relay.sync()` has no clock either — it is a bare `new Observable` around the promise. So
`relay.sync()`, `pool.sync()` and `RelayGroup.sync()` hang indefinitely unless the caller aborts.
`applesauce-loaders`' `SyncLoader` is the only bounded caller, and only because its own `withTimeout`
stall guard fires — which then reports a spurious "sync failed" and burns the paginated fallback.

Reproduced: driving the real `lib/negentropy.ts` `Negentropy` on both sides with two diverging
500-item sets required **2** client→server messages before `reconcile` returned null. Only the first
is ever written. The existing suite passes only because `relay.test.ts:2748-2751` deliberately keeps
both sides under 32 items, where the negotiation always resolves in a single round trip — the test's
own comment says exactly this.

**Fix:**

```ts
const [newMsg, have, need] = await ne.reconcile<string>(received.data);
await reconcile(have, need);
msg = newMsg;
// Ask for the next round; without this the relay has nothing to reply to
if (msg) socket.next(["NEG-MSG", id, msg]);
```

Add a regression test driving a >32-item diverging negotiation to completion (assert `reconcile`
fires more than once and the promise resolves `true`), and bound the loop so a non-responding relay
cannot hang the caller forever.

---

### CR-02: `RelayGroup.request()`'s operation clock is permanently cancelled by a per-relay `ERROR` message — unbounded hang

**File:** `packages/relay/src/group.ts:274-276`

**Issue:** The `firstWhen` predicate casts the group message type away and reuses `isReqProgress`,
which only excludes `OPEN`:

```ts
suspendableTimeout(opts?.timeout ?? 30_000, gate, {
  firstWhen: (message: GroupReqMessage) => isReqProgress(message as RelayReqMessage),
}),
```

`GroupReqMessage = RelayReqMessage | GroupReqErrorMessage`, and `GroupReqErrorMessage` carries
`type: "ERROR"` (types.ts:251). That value is synthesised by `internalSubscription`'s `catchError`
(group.ts:156) when a relay's connection fails. It is not progress from any relay — it is the group
layer's own bookkeeping for a relay that produced *nothing*. `isReqProgress` accepts it
(`"ERROR" !== "OPEN"`), so `firstEmitted` latches and `clearTimer()` runs; the clock can never fire
again for the rest of the operation.

Reproduced against real `Relay` + `vitest-websocket-mock`:

- **Control** — 2-relay group, `timeout: 100`, both relays accept the REQ and stay silent: errors at
  ~100ms as intended (this is the case `group.test.ts`'s new WR-02 test covers).
- **Defect** — same group, relay1's socket errors (one `ERROR` value), relay2 silent:
  `receivedError() === false`, `receivedComplete() === false`, `getValues() === []` **after 500ms
  with a 100ms timeout**. Raw `group.req()` on the same setup emits `["OPEN","OPEN","ERROR"]`,
  confirming `ERROR` is the value that latches the gate.

One unreachable relay in a set — the single most common real-world condition for a group read —
makes `RelayGroup.request()` and `RelayPool.request()` ignore the caller's `timeout` and never
terminate. The default complete condition does not save it: `completeOnAllEose` requires every relay
to leave `OPEN`, and the silent relay never does.

The code comment shows the `ERROR` case *was* considered ("a per-relay connection-error value
`isReqProgress`'s parameter type does not admit even though its OPEN-exclusion check applies
identically") and the wrong conclusion was drawn. The `as RelayReqMessage` cast is what let it
through the type system.

**Fix:** declare the group's own predicate instead of casting.

```ts
/** A value the group synthesised for a relay that produced nothing is not progress (WR-01 class). */
export function isGroupReqProgress(message: GroupReqMessage): boolean {
  return message.type !== "OPEN" && message.type !== "ERROR";
}
// ...
suspendableTimeout(opts?.timeout ?? 30_000, gate, { firstWhen: isGroupReqProgress }),
```

Removing the cast entirely is the structural part of the fix: it forces the next group message type
added to `GroupReqMessage` through this same decision. Add the regression test (2-relay group,
`timeout: 100`, relay1 errors, relay2 silent → must error).

---

### CR-03: relay-controlled `CLOSED`/`NEG-ERR` reason indexes a prototype-inheriting object literal in `parseClosedError`

**File:** `packages/relay/src/relay.ts:180-184` (object literal at `:162-173`)

**Issue:**

```ts
function parseClosedError(reason: string): RelayClosedError | null {
  const ErrorClass = CLOSED_ERROR_PREFIXES[reason.split(":")[0] as keyof typeof CLOSED_ERROR_PREFIXES];
  if (ErrorClass) return new ErrorClass(reason);
  return null;
}
```

`CLOSED_ERROR_PREFIXES` is a plain object literal, so it inherits from `Object.prototype`, and
`reason` is fully relay-controlled. A prefix of `constructor`, `__proto__`, `toString`, `valueOf`,
`hasOwnProperty`, … resolves to a truthy `Object.prototype` member which is then `new`'d. The
declared return type `RelayClosedError | null` is a lie for those inputs.

Reproduced against real `Relay` + `vitest-websocket-mock`:

| Relay sends | Observed |
|---|---|
| `["CLOSED","s1","constructor: go away"]` | stream errors with a **`String` object** (`[object String]`), not a `RelayClosedError` |
| `["CLOSED","s2","__proto__: go away"]` | stream errors with **`TypeError: ErrorClass is not a constructor`** |
| row 1 with `reconnect: 2` | **2 REQ frames** within 1.5s — the resend loop runs |

The second-order damage is what matters for this phase: D-07's entire retry-skip contract is
`error instanceof RelayClosedError` (relay.ts:1334 and :1356). A `String` object is not one, so
`customConnectionRetryOperator` / `customRetryOperator` treat a deliberate relay rejection as a
transient connection fault and resend the REQ/EVENT — the exact "hot loop against a hostile relay"
the D-07 comment says it exists to prevent. `RelayGroup`'s `errorToPublishResponse` additionally
degrades it to `"Unknown error"` (`err?.message` is `undefined` on a `String` object). The same
function sits on the phase's own auth path via `negentropy()`'s `parseClosedError(err.reason)` and
`parsed instanceof AuthRequiredError` check (relay.ts:1258-1265), where a `String` object is truthy
and gets re-thrown by `throwError(() => parsed)`.

**Fix:** use a prototype-less map plus an own-property check.

```ts
const CLOSED_ERROR_PREFIXES: Record<string, typeof RelayClosedError> = Object.assign(Object.create(null), {
  "auth-required": AuthRequiredError,
  unsupported: RelayClosedError,
  // ...
});

function parseClosedError(reason: string): RelayClosedError | null {
  const prefix = reason.split(":")[0];
  const ErrorClass = Object.hasOwn(CLOSED_ERROR_PREFIXES, prefix) ? CLOSED_ERROR_PREFIXES[prefix] : undefined;
  return ErrorClass ? new ErrorClass(reason) : null;
}
```

Add tests for `constructor:`, `__proto__:` and `toString:` reasons asserting the observable completes
gracefully (unrecognised prefix, per the function's own docstring) and that no extra REQ frame is
sent.

## Warnings

### WR-01: a synchronous auth retry wipes `req()`'s public `reqs$` tracking

**File:** `packages/relay/src/relay.ts:955-969` (add at `:959`, delete at `:967-968`)

**Issue:** `authRetry`'s `expand` resubscribes the attempt `defer` *synchronously*, from inside the
`next` dispatch that delivered the auth-required signal — before attempt 1's `complete` has
propagated. So attempt 2's `control` map runs `this.reqs$.next({ ...value, [id]: filters })` first,
and attempt 1's `finalize` then runs `this.reqs$.next(rest)` and **deletes the id attempt 2 just
registered**.

Reproduced: `relay.req([...], { id: "sub1", onAuthRequired: <synchronous>, waitForAuth: [] })` — with
REQ #2 confirmed on the wire, `relay.reqs === {}`. The async-handler control case correctly reports
`{ sub1: [...] }`, which localises the bug to the synchronous reentrancy path this round introduced.

`reqs$` is documented public API ("Tracks active req() operations by subscription ID"). Nothing in
the package consumes it today, which is why nothing failed — but any consumer using it for
diagnostics or reconnect bookkeeping now sees a live REQ as closed.

**Fix:** make the removal attempt-aware instead of last-writer-wins:

```ts
// inside the defer, alongside relayClosedSub
let tracked: Filter[] | null = null;
// in the map:
tracked = filters;
this.reqs$.next({ ...this.reqs$.value, [id]: filters });
// in the finalize:
if (this.reqs$.value[id] === tracked) {
  const { [id]: _, ...rest } = this.reqs$.value;
  this.reqs$.next(rest);
}
```

The existing CR-02 test already drives this scenario and needs only the extra assertion.

---

### WR-02: the cross-package `.name` contract is enforced only by comments — no test pins the strings

**Files:** `packages/relay/src/relay.ts:136-159`, `packages/loaders/src/loaders/sync-loader.ts:83-90`,
`packages/loaders/src/loaders/__tests__/sync-loader.test.ts:790-830`

**Issue:** D-06 forbids `applesauce-loaders` from importing `applesauce-relay`, so `SyncLoader`'s
D-16 no-fallback guard duck-types on `RELAY_AUTH_ERROR_NAMES` — the literal strings
`"AuthRequiredError"`, `"AuthHandlerError"`, `"AuthTimeoutError"`. Both files carry prominent
comments calling these load-bearing wire. Nothing enforces it:

- `packages/relay/src/__tests__/exports.test.ts` snapshots the **exported class identifiers**, not the
  `.name` property values. Changing `this.name = "AuthRequiredError"` inside the constructor passes
  the snapshot untouched.
- The loaders-side D-16 tests construct synthetic errors (`Object.assign(new Error(...), { name })`),
  so by construction they cannot observe drift in what `relay.ts` actually produces. This is a
  vacuity of a specific kind: the tests pass identically whether or not the producing side still
  emits those names.

Net: the guard can silently stop matching, and the symptom is `SyncLoader` burning its paginated
fallback against the same auth wall D-16 forbids — with no test failure anywhere.

**Fix:** pin the strings on the producing side, in `packages/relay/src/__tests__/relay.test.ts`:

```ts
it("pins the .name strings applesauce-loaders duck-types against (D-06)", () => {
  expect(new AuthRequiredError("x").name).toBe("AuthRequiredError");
  expect(new AuthHandlerError("x", null).name).toBe("AuthHandlerError");
  expect(new AuthTimeoutError("x").name).toBe("AuthTimeoutError");
});
```

---

### WR-03: `event()` synthesises a `PublishResponse`, then declares "PublishResponse carries no bookkeeping value"

**Files:** `packages/relay/src/relay.ts:1154-1157`, `:1182`, `:1489`

**Issue:** Both progress predicates on the publish path are the trivially permissive `() => true`,
justified by inline comments ("PublishResponse carries no bookkeeping value", "every response is real
progress"). That claim is false — `event()` manufactures a response the relay never sent:

```ts
timeout({
  first: this.eventTimeout,
  with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" }),
}),
```

That value is structurally identical to `req()`'s synthetic `OPEN` — a call-site bookkeeping value —
and it flows into both `authRetryOperator("publish", ..., () => true)` (resetting the D-08 consecutive
counter) and `customSuspendableTimeoutOperator(..., () => true)` (satisfying `publishTimeout`'s
first-emission gate). This is exactly the situation the required-predicate change exists to make
impossible to state incorrectly, and the third call site (`count()`'s `() => true`) is genuinely
correct, so the file gives no signal that this one is not.

The consequence today is bounded — the synthetic value also terminates the stream, so no unbounded
retry loop results — but the invariant is violated and the comments actively mislead, which is how
this class propagated across four call sites in the first place.

**Fix:** name the bookkeeping value and reject it, mirroring `isReqProgress`:

```ts
const PUBLISH_TIMEOUT_MESSAGE = "Timeout";
function isPublishProgress(response: PublishResponse): boolean {
  return !(response.ok === false && response.message === PUBLISH_TIMEOUT_MESSAGE);
}
```

and pass it at relay.ts:1182 and :1489. If the permissive behavior is deliberate, replace the false
comment with the reason it is safe.

---

### WR-04: a still-open auth phase disarms the paginated fallback's stall guard

**File:** `packages/loaders/src/loaders/sync-loader.ts:620-677`

**Issue:** `finalize(forceCloseAuthPhases)` is attached to the *outer* per-relay pipeline (line 677),
i.e. **after** the `catchError` at line 624 that starts the paginated fallback. If the negentropy sync
fails with a non-auth error while an auth phase is still open (its `authTimeout` close-timer pending,
no stream emission having force-closed it), the fallback's freshly-constructed `withTimeout` sees
`authPhases > 0` and its `arm()` early-returns. The fallback request's stall guard stays disarmed for
up to the remaining `authTimeout` (30s by default) — the very window the D-16 stall guard exists to
bound.

The WR-04 comment correctly explains why the hook cannot live inside `withTimeout`, but not why it
needn't also run when one path hands off to another.

**Fix:** force-close before entering the fallback, in addition to the terminal `finalize`:

```ts
catchError((error) => {
  if (error?.name && RELAY_AUTH_ERROR_NAMES.has(error.name)) { /* ... */ throw error; }
  // The negentropy attempt is over; no phase it opened may suspend the fallback's own clock
  forceCloseAuthPhases();
  // ...
}),
```

---

### WR-05: `Relay.sync()`'s RECEIVE branch rejects with `EmptyError` when a relay EOSEs with zero events

**File:** `packages/relay/src/relay.ts:1554-1573`

**Issue:**

```ts
await lastValueFrom(
  this.req({ ids: need }, authOptions).pipe(
    takeWhile((message) => message.type !== "EOSE"),
    filter((message) => message.type === "EVENT"),
    /* ... */
  ),
);
```

`req()` emits `OPEN`, which `takeWhile` passes and `filter` drops. If the relay answers `EOSE` with no
`EVENT` — the ids were deleted, expired, or the relay simply no longer has what it advertised during
reconciliation — the piped observable completes empty and `lastValueFrom` rejects. Reproduced
directly against `vitest-websocket-mock`: `rejected: EmptyError no elements in sequence`.

That rejection propagates out of the `reconcile` callback → `negentropySync` throws →
`Relay.negentropy()` rejects → `Relay.sync()` errors. In `RelayGroup.sync()` the D-19 catch then
silently drops that relay from the group sync (group.ts:347-350), so a benign "relay no longer has
these events" outcome is indistinguishable from a hard failure.

**Fix:** `await lastValueFrom(this.req(...).pipe(/* ... */), { defaultValue: undefined });`

---

### WR-06: one auth-gated relay suspends the whole group's clock, so `RelayGroup.request()`'s `timeout` has no upper bound

**File:** `packages/relay/src/group.ts:252-276`

**Issue:** The single per-call `AuthPhaseGate` is shared by every relay in the fan-out, and
`suspendableTimeout` stops the clock while *any* phase is active. With `authRetries` defaulting to 1
and `authTimeout` to 30s, each auth-gated relay can hold the group's clock for ~60s, and N relays can
overlap. A caller asking for `group.request(filters, { timeout: 5_000 })` can be blocked for minutes
with no bound they can express. `Relay.request()` has the same shape, but with only one relay's
phases to absorb.

The tradeoff follows from D-15, but it is undocumented on the public option and has no ceiling.

**Fix:** at minimum document it on `RelayRequestOptions.timeout` / `GroupRequestOptions.timeout`
(wall-clock bound is `timeout + authTimeout × (authRetries + 1) × relays`). Better: give
`suspendableTimeout` an optional absolute ceiling so callers can bound total wall time.

---

### WR-07: `isReqProgress` leaked into `applesauce-relay`'s public barrel

**Files:** `packages/relay/src/relay.ts:193-195`, `packages/relay/src/index.ts:5`,
`packages/relay/src/__tests__/exports.test.ts:23`

**Issue:** `isReqProgress` was added to `relay.ts` so `group.ts` could reuse it, but `index.ts` does
`export * from "./relay.js"`, so it is now permanent published API — the exports snapshot was updated
to bless it. `operators/auth-retry.ts` opens with an explicit rationale for the opposite choice ("NOT
barrel-exported ... its exports ... would become maintained public API for no consumer benefit"). The
same reasoning applies: it is a two-line internal predicate over an internal message shape with no
consumer outside the package.

(The bump level is fine — the phase already ships a `minor` changeset for `applesauce-relay` — which
is precisely what makes this easy to miss.)

**Fix:** move `isReqProgress` (and the `isGroupReqProgress` from CR-02) into
`operators/auth-retry.ts` or a new internal module alongside the rest of the deliberately unexported
machinery, import it in both `relay.ts` and `group.ts`, and revert the exports snapshot.

---

### WR-08: `suspendableTimeout`'s `arm()` does not clear a previously armed timer

**File:** `packages/relay/src/operators/auth-retry.ts:142-146`

**Issue:**

```ts
const arm = () => {
  if (settled || firstEmitted) return;
  armedAt = Date.now();
  timer = setTimeout(fail, remaining);   // overwrites `timer` without clearing it
};
```

The sibling implementation at `sync-loader.ts:508-513` *does* call `clearArmed()` before re-arming.
Today the asymmetry is unreachable here because `gate.active$` is `distinctUntilChanged`, so
`arm`/`disarm` strictly alternate — but that is a non-local invariant propping up a local one. Any
future path that arms twice (for example, arming on emission the way `withTimeout` does) leaks an
orphaned timer that still calls `fail()`.

**Fix:** make `clearTimer()` the first statement of `arm()`, matching `withTimeout.arm()`.

---

### WR-09: stale doc on `RelayRequestOptions.timeout`, and `timeout: 0` now silently disables the clock

**File:** `packages/relay/src/types.ts:169-176` (and `packages/relay/src/relay.ts:1444`)

**Issue:** The doc still reads "Passed to rjxs timeout() operator", which is no longer true — it now
feeds `suspendableTimeout`, whose semantics differ in two user-visible ways: the countdown pauses
during auth phases, and a non-positive budget returns `identity` (auth-retry.ts:115). Under the old
`timeout({ first: 0 })` a caller passing `timeout: 0` got an immediate `TimeoutError`; now they get
**no timeout at all**. The same silent-disable applies at `group.ts:274`.

**Fix:** update the doc to describe suspension and the disabled-on-`<= 0` behavior, or make
`suspendableTimeout(0, ...)` fire immediately to preserve the previous contract.

---

### WR-10: two near-duplicate suspendable-clock implementations with undocumented divergence

**Files:** `packages/relay/src/operators/auth-retry.ts:110-194`,
`packages/loaders/src/loaders/sync-loader.ts:485-563`

**Issue:** D-06 makes sharing across the package boundary impossible, so the duplication itself is
structural. But the two ~60-line copies have silently diverged in ways not documented as intentional:

| | `suspendableTimeout` | `withTimeout` |
|---|---|---|
| `arm()` clears prior timer | no | yes |
| clock cancelled by | first `firstWhen`-accepted value, permanently | never — every emission resets `remaining` |
| emission closes auth phases | no | yes (`forceCloseAuthPhases`) |
| `error`/`complete` teardown | unsubscribes both subs | leaves `sourceSub` (harmless, asymmetric) |

A reviewer who verifies one and assumes the other matches will be wrong — which is how WR-08 stayed
invisible.

**Fix:** add a short cross-reference header on each stating the deliberate differences
("first-emission gate" vs "inter-emission stall guard") and why D-06 prevents sharing, so a future
maintainer does not "align" them.

---

### WR-11: `.extend()` called inline at log call sites in `sync-loader.ts`

**Files:** `packages/loaders/src/loaders/sync-loader.ts:248`, `:611`

**Issue:** `logger?.extend("backward").extend(nanoid(8))` (line 248) and
`log.extend(url).extend("request")` (line 611) construct fresh `Debugger` instances at the point of
use, inside per-call and `switchMap` paths, rather than being derived once and stored. The rest of
this very file follows the hoisted convention (`baseLog` at line 333, `log` at line 346), as does
`Relay` (`this.log = this.log.extend(url)` in the constructor).

**Fix:** hoist `const relayLog = log.extend(url)` into `buildRelayStream`'s scope, pass
`relayLog.extend("request")` derived once, and have `paginatedRequest` accept an already-derived
logger instead of extending internally.

---

## Phase 24 Supersession Index (2026-09-02)

Phase 13 plans 13-01 through 13-14 remain immutable historical records; their negentropy/sync contract claims are collectively superseded by Phase 24's Observable rounds, discriminated results, global auth budget, fresh reconnect, and caller-owned lifetime.

- **RESID-03(A), closed:** the loader closes an open auth phase before constructing and subscribing to the non-auth fallback, so the fallback stall clock re-arms. Evidence: `sync-loader.test.ts` “re-arms fallback timeout”.
- **RESID-03(B), closed:** a zero-event RECEIVE EOSE completes without `EmptyError`. Evidence: `sync.test.ts` “treats zero-event EOSE as a successful empty RECEIVE”.

_Reviewed: 2026-08-06T22:56:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
