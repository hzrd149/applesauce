# Phase 14: Auth Lifecycle Debug Logging - Pattern Map

**Mapped:** 2026-08-08
**Files analyzed:** 8 (all modified, none net-new except 1 test file)
**Analogs found:** 8 / 8 (all in-repo, all within the same package tree — this phase edits existing files, it does not introduce a new architectural shape)

Per RESEARCH.md's corrections, all line numbers below use the corrected values (`relay.ts:1121`, `:1149`, `:1156`), and the `group.ts:359` dropped-relay line is treated as an existing line to review/adjust, not create.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/relay/src/types.ts` (`RelayAuthContext`, `PublishResponse`, `FilterInput`) | model/type | transform | same file, existing `RelayAuthOperation`/`RelayAuthContext` definitions | exact (self-analog — this is a type-shape edit in place) |
| `packages/relay/src/relay.ts` (`this.log`/`authLog` fields) | service (stateful class) | event-driven | same file, `this.log` derivation (`:234`, `:436`) | exact |
| `packages/relay/src/relay.ts` (`resetState()`) | service (state mutation) | event-driven | same file, existing guarded clears (`:407-414`) | exact |
| `packages/relay/src/relay.ts` (`buildAuthContext`, `authRetryOperator`) | service (assembly/adapter) | transform | same file, existing implementation | exact |
| `packages/relay/src/relay.ts` (`req()`, `event()`, `auth()`, `negentropy()`, `authenticate()` log sites) | service (protocol call sites) | streaming/request-response | same file, existing `tap`/`catchError` log calls (`:930`/`:1055`(now `:1148`)/`:1156`) | exact |
| `packages/relay/src/operators/auth-retry.ts` | service (RxJS operator) | event-driven | same file, existing `config.log?.(...)` call at `:265` | exact |
| `packages/relay/src/negentropy.ts` | service (protocol function) | streaming | same file, `let id = nanoid()` at `:71`, module `log` const at `:26` | exact |
| `packages/relay/src/group.ts` (`RelayGroup.sync`'s `catchError`) | service (fan-out wrapper) | event-driven | same file, `errorToPublishResponse` (`:75-81`) and the existing dropped-relay `catchError` (`:356-360`) | exact — review/adjust, not create |
| `packages/loaders/src/loaders/sync-loader.ts` (`:611` hoist) | service (RxJS pipeline builder) | streaming | same file, every other per-relay `const` hoisted at `buildRelayStream(url)`'s top level (e.g. `timeline-loader.ts:58`'s per-call derive-once pattern) | exact |
| new test file, `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` (or similar) | test | integration/event-driven | `packages/concord/src/helpers/__tests__/relays.test.ts:230-260` (`captureDebugOutput()`) + `packages/relay/src/__tests__/relay.test.ts` (WS mock server + real `Relay` setup) | strong (cross-package harness lift + in-package test conventions) |
| `.changeset/relay-operation-scoped-auth-callbacks.md` (edit) | config (changelog) | — | existing changeset body, per CLAUDE.md's one-sentence style | exact |

## Pattern Assignments

### `packages/relay/src/types.ts` — retiring `RelayAuthOperation`, adding the wire-verb union (D-02)

**Analog:** the file's own existing shape (self-referential edit) plus the discriminated-union style used elsewhere in the monorepo for exhaustive checks.

**Current shape to remove** (`types.ts:59-77` approx):
```typescript
/** The kind of operation an auth-required response was received for */
export type RelayAuthOperation = "read" | "publish" | "sync";

export type RelayAuthContext = {
  relay: Relay;
  url: string;
  challenge: string | null;
  operation: RelayAuthOperation;
  requirement: AuthRequirement;
  missingPubkeys: string[] | null;
  reason: string;
  // ...
};
```

**Pattern to apply — exhaustive discriminated union** (D-02 requires a compile error on an unhandled verb). This repo's established idiom for exhaustiveness is a `switch` with a `never`-typed default, matching the "total progress predicate" lesson from 13-14/CR-02 (`isProgress: ProgressPredicate<T>` in `auth-retry.ts` — see below) and `validateInviteBundle`'s rule-table style (grep did not surface a literal `validateInviteBundle` symbol in `packages/concord/src` under this name at time of mapping; treat CONTEXT.md's reference as pointing at the general "rule table keyed on a closed set of string literals" idiom already used for `RelayAuthOperation` itself — the type being replaced is exactly this kind of closed union, so the replacement should preserve that same "string literal discriminant + exhaustive consumer" shape one level deeper):
```typescript
export type RelayAuthWireRequest =
  | { verb: "REQ"; id: string; filters: Filter[] }
  | { verb: "COUNT"; id: string; filters: Filter[] }
  | { verb: "EVENT"; event: NostrEvent }
  | { verb: "NEG-OPEN"; id: string; filter: Filter };
```
Every switch/if-chain that consumes this at a new call site should end with an `exhaustive: never` fallthrough (the pattern `auth-retry.ts`'s `config.operation` string is consumed positionally today — there is no existing exhaustive switch on `RelayAuthOperation` in this file to copy verbatim, so the new union's consumers are new code, not a refactor of an existing switch).

**`PublishResponse.error` discriminator** (`types.ts:128`, already exists per D-18 of Phase 13) — D-11 reuses this field as-is; no shape change needed here, only a new call site setting it (see `relay.ts:1156` below).

---

### `packages/relay/src/relay.ts` — `:auth` sub-logger (D-13/D-20)

**Analog:** same file, `this.log` field + constructor re-derivation (`:234`, `:436`).

**Imports/field pattern** (`relay.ts:233-234`, unchanged import block — `logger` from `applesauce-core`):
```typescript
export class Relay {
  protected log: typeof logger = logger.extend("Relay");
```

**Derive-once pattern to copy, constructor site** (`relay.ts:436`):
```typescript
constructor(public url: string, opts?: RelayOptions) {
  this.log = this.log.extend(url);
  // D-13: add immediately after, following the identical derive-once-per-instance convention
  this.authLog = this.log.extend("auth");
```
Field declaration goes right next to `protected log`:
```typescript
protected log: typeof logger = logger.extend("Relay");
protected authLog: typeof logger = this.log.extend("auth"); // re-derived in constructor after url folds in
```

---

### `packages/relay/src/relay.ts` — `resetState()` auth-invalidation line (D-12)

**Analog:** same file, the guarded-clear pattern already at `:405-415`.

**Pattern to extend** (`relay.ts:405-415`, current):
```typescript
protected resetState() {
  // NOTE: only update the values if they need to be changed, otherwise this will cause an infinite loop
  if (this.challenge$.value !== null) this.challenge$.next(null);
  if (Object.keys(this.authentications$.value).length > 0) this.authentications$.next({});
  if (this.authenticationResponse$.value) this.authenticationResponse$.next(null);
  if (this.authentication$.value !== null) this.authentication$.next(null);
  if (this.notices$.value.length > 0) this.notices$.next([]);

  if (this.receivedAuthRequiredForReq.value) this.receivedAuthRequiredForReq.next(false);
  if (this.receivedAuthRequiredForEvent.value) this.receivedAuthRequiredForEvent.next(false);
}
```
D-12 adds a log line gated on the SAME guard conditions already present (`this.authentications$.value` keys count, `this.challenge$.value !== null`) — do not invent new guard logic, read the existing values before they're cleared:
```typescript
protected resetState() {
  const droppedCount = Object.keys(this.authentications$.value).length;
  const hadChallenge = this.challenge$.value !== null;
  if (droppedCount > 0 || hadChallenge)
    this.authLog(`Resetting connection: dropped ${droppedCount} authenticated pubkey(s)${hadChallenge ? ", challenge invalidated" : ""}`);

  if (this.challenge$.value !== null) this.challenge$.next(null);
  // ...unchanged...
}
```

---

### `packages/relay/src/relay.ts` — connection track: challenge / signing / sent / result (D-08, D-09, D-10)

**Analog:** same file, existing challenge-receipt tap (`:588-598`) and the existing `tap`-based log calls in `req()`/`event()`.

**Challenge receipt, existing pattern to extend** (`relay.ts:588-598`):
```typescript
const ListenForChallenge = this.socket.pipe(
  filter((message) => message[0] === "AUTH"),
  map((m) => m[1]),
  tap((challenge) => {
    this.log("Received AUTH challenge", challenge);   // becomes this.authLog(...)
    this.challenge$.next(challenge);
  }),
);
```

**Signing line placement — `authenticate()`** (`relay.ts:1303`, D-10):
```typescript
authenticate(signer: AuthSigner): Promise<PublishResponse> {
  if (!this.challenge) throw new Error("Have not received authentication challenge");
  this.authLog("Signing AUTH event"); // new, load-bearing per D-09
  const p = signer.signEvent(makeAuthEvent(this.url, this.challenge));
  const start = p instanceof Promise ? from(p) : of(p);
  return lastValueFrom(start.pipe(switchMap((event) => this.auth(event))));
}
```

**Sent/result lines — `auth()`** (`relay.ts:1201`ish, existing `tap` in the returned promise chain):
```typescript
return lastValueFrom(
  this.event(event, "AUTH").pipe(
    tap((result) => {
      // existing pubkey-state update unchanged
      // + D-09: this.authLog(`AUTH result for ${event.pubkey}: ${result.ok ? "accepted" : result.message}`)
    }),
  ),
);
```
"Sent" is the `this.socket.next([verb, event])` side effect inside `event()`'s `control = defer(...)` (shared for both EVENT and AUTH verbs) — gate the new log line on `verb === "AUTH"` so it doesn't fire for ordinary EVENT publishes.

---

### `packages/relay/src/relay.ts` — `event()`'s timeout discriminator (D-11)

**Analog:** same file, the existing `timeout({...})` operator and the sibling relay-rejection `map` immediately above it.

**Relay-rejection build** (corrected line, `relay.ts:1121`):
```typescript
map((m) => ({ ok: m[2] as boolean, message: m[3] as string, from: this.url })),
```

**Manufactured timeout to fix** (corrected line, `relay.ts:1156`):
```typescript
timeout({
  first: this.eventTimeout,
  with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" }),
}),
```
Apply D-11 by adding the discriminator field that already exists on the type (`PublishResponse.error`, `types.ts:128`) — set only on this branch:
```typescript
with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout", error: new Error("Timeout") }),
```
Do not touch the relay-rejection `map` above — its `.error` stays absent, which is the whole discriminator.

**Auth-required flag write, corrected line** (`relay.ts:1148-1149`):
```typescript
tap(({ ok, message }) => {
  if (ok === false && message?.startsWith(AUTH_REQUIRED_PREFIX) && !this.receivedAuthRequiredForEvent.value) {
    this.log("Auth required for publish");   // becomes this.authLog(...)
    this.receivedAuthRequiredForEvent.next(true);
  }
}),
```

---

### `packages/relay/src/operators/auth-retry.ts` — phase-state logging (D-14, already-partially-present)

**Analog:** same file, existing `config.log?.(...)` call.

**Existing call to extend, `:265`ish**:
```typescript
config.gate.begin();
config.log?.(`Auth required for ${config.operation}: ${signal.reason}`);
```
The `log?: (...args: unknown[]) => void` config field (`:232`) is already injected with `this.log` at `relay.ts:821` — D-13 changes ONLY the injected value (swap `this.log` for `this.authLog` at the `relay.ts` injection site inside `authRetryOperator`); `auth-retry.ts` itself needs no new field, only additional `config.log?.(...)` calls at each state D-14 lists (handler invoked/absent, waiting, resolved/threw/rejected, wait satisfied, per-phase timeout, retries exhausted) — each call follows the identical `config.log?.(\`...${config.operation}...\`)` shape as the existing line, just at different points in `runPhase`.

**Injection site to change, `relay.ts:821`** (inside `authRetryOperator`):
```typescript
return authRetry<T>({
  operation,
  waitForAuth,
  onAuthRequired: opts?.onAuthRequired,
  authTimeout,
  authRetries,
  isProgress,
  buildContext: (reason) => this.buildAuthContext(operation, waitForAuth, reason),
  authSatisfied$: (requirement) => this.authSatisfied$(requirement),
  gate,
  log: this.log,   // → this.authLog
  errors: { /* unchanged */ },
});
```

---

### `packages/relay/src/negentropy.ts` — id ownership move (D-05, Pitfall 5)

**Analog:** same file, current internal mint site.

**Current** (`negentropy.ts:71`):
```typescript
export async function negentropySync(
  storage: NegentropyStorageVector,
  socket: MultiplexWebSocket & { next: (msg: any) => void },
  filter: Filter,
  reconcile: ReconcileFunction,
  opts?: NegentropySyncOptions,
): Promise<boolean> {
  let id = nanoid();
```

**Pattern per Pitfall 5 (research-recommended, not a locked decision) — new explicit parameter, NOT folded into `NegentropySyncOptions`:**
```typescript
export async function negentropySync(
  storage: NegentropyStorageVector,
  socket: MultiplexWebSocket & { next: (msg: any) => void },
  filter: Filter,
  reconcile: ReconcileFunction,
  opts?: NegentropySyncOptions,
  id: string = nanoid(),   // caller-supplied for D-05 stability across retries; defaults for standalone callers
): Promise<boolean> {
```
Caller site, `Relay.negentropy()` (`relay.ts:1230`ish) mints the id once, before `runSync`'s `defer(...)` so it survives the shared operator's resubscribe-on-retry:
```typescript
const id = nanoid(); // D-05: minted once per Relay.negentropy() call, stable across auth retries
const runSync: Observable<boolean | AuthRequiredSignal> = defer(() =>
  from(buildStorage().then((storage) => negentropySync(storage, this.socket, filter, reconcile, opts, id))),
).pipe(/* unchanged */);
```
Module-level `log` const at `negentropy.ts:26` (`const log = logger.extend("negentropy");`) is the derive-once pattern already compliant per D-20 — no change needed to it, only the call sites that use it should route auth-specific lines appropriately (discretion: keep on this module const, or thread `this.authLog` in via `opts`/a new param — Claude's Discretion per CONTEXT.md).

---

### `packages/relay/src/group.ts` — dropped-relay line review (D-19/D-14, already exists — Pitfall 1)

**Analog:** same file, `errorToPublishResponse` (`:75-81`) for the "attach structured error" convention, and the line itself at `:359`.

**Existing line, do not duplicate** (`group.ts:359`):
```typescript
catchError((err) => {
  this.log(`dropping relay from group sync (D-19): ${relay.url}`, err);
  return EMPTY;
}),
```
Per RESEARCH.md Pitfall 1, this is a *review/prose* task: strip the `(D-19)` plan-citation per D-15's human-prose rule. Recommended (research, not locked) — keep on `RelayGroup`'s own `logger.extend("RelayGroup")` channel (`group.ts:84`), not routed through `Relay`'s per-connection `:auth` namespace, since `RelayGroup` has no per-relay auth-connection concept of its own:
```typescript
catchError((err) => {
  this.log(`Dropping relay from group sync: ${relay.url}`, err);
  return EMPTY;
}),
```

**`errorToPublishResponse` structured-error convention** (`group.ts:75-81`, for reference on how this file already attaches `.error`):
```typescript
message: err?.message || "Unknown error",
error: err,
} satisfies PublishResponse),
```

---

### `packages/loaders/src/loaders/sync-loader.ts` — D-18 hoist

**Analog:** same file, every other per-relay `const` derivation in `buildRelayStream(url)`.

**Non-compliant site** (`sync-loader.ts:606-614`, inside `switchMap`):
```typescript
switchMap((nips) => {
  const negentropy = !!nips?.includes(77);
  state[url].negentropy = negentropy;
  state[url].method = negentropy ? "negentropy" : "request";
  state[url].state = "loading";
  log("Loading from %s via %s", url, state[url].method);

  const request$ = () =>
    toMessages(
      withTimeout(
        paginatedRequest(request, url, filter, limit, log.extend(url).extend("request"), relayMethodOptions),
      ),
    );
```
**Fix — hoist to top of `buildRelayStream(url)`**, matching how every other per-relay logger in this file is derived once (mirrors `timeline-loader.ts:58`'s per-call-not-per-emission derivation style):
```typescript
function buildRelayStream(url: string, /* ...existing params... */) {
  const requestLog = log.extend(url).extend("request"); // hoisted per D-18, was inside switchMap
  // ...
  return /* ... */.pipe(
    switchMap((nips) => {
      // ...
      const request$ = () =>
        toMessages(withTimeout(paginatedRequest(request, url, filter, limit, requestLog, relayMethodOptions)));
```

---

### New test file — D-16 capture harness

**Analog:** `packages/concord/src/helpers/__tests__/relays.test.ts:230-260` (`captureDebugOutput()`) + `packages/relay/src/__tests__/relay.test.ts` (WS mock + real `Relay` + real clock).

**Harness to lift verbatim, adjusted namespace** (source: `relays.test.ts:230-259`):
```typescript
import debugFactory from "debug";
import { format } from "node:util";

const NAMESPACE = "applesauce:Relay:*:auth";

function captureDebugOutput(): { calls: unknown[][]; restore: () => void } {
  const wasEnabled = debugFactory.enabled(NAMESPACE);
  debugFactory.enable(NAMESPACE);
  const originalLog = debugFactory.log;
  const calls: unknown[][] = [];
  debugFactory.log = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      debugFactory.log = originalLog;
      if (!wasEnabled) debugFactory.disable();
    },
  };
}

function messagesOf(calls: unknown[][]): string[] {
  return calls.map((c) => format(...(c as [unknown, ...unknown[]])));
}
```

**Test-file WS/Relay setup convention to reuse** — do not re-invent, pull `beforeEach`/`afterEach` mock-server setup directly from `packages/relay/src/__tests__/relay.test.ts` (uses `vitest-websocket-mock`'s `WS`, a real `Relay` instance, and real timers per 13-D-20 — no `vi.useFakeTimers()`).

**Setup/teardown discipline** (Pitfall 4) — every `it()` must call `restore()` in a `finally`, matching the harness's own contract; do not rely on `afterEach` alone since `debug`'s state is module-level shared across tests in one file.

---

### `.changeset/relay-operation-scoped-auth-callbacks.md` — D-01 edit

**Analog:** the changeset's own current body, and CLAUDE.md's changeset style (one sentence, no bullets/code).

Read the existing body first (must be re-read at plan-writing time — this is D-01's premise re-verification target); rewrite the single sentence to describe the wire-verb union instead of the retired `operation` field, keeping the same one-sentence, no-bullets, no-code-block form. Example shape only (not the literal wording to use):
```markdown
---
"applesauce-relay": minor
---

Relay auth-required handlers now receive the exact wire request (REQ/COUNT/EVENT/NEG-OPEN) that triggered them instead of a three-value operation category.
```

## Shared Patterns

### Derive-once logger fields (D-13/D-20)
**Source:** `packages/relay/src/relay.ts:234,436`; `packages/relay/src/negentropy.ts:26`; `packages/relay/src/group.ts:84`; `packages/relay/src/management.ts:123`
**Apply to:** every new logger field in this phase (`this.authLog` on `Relay`), and the sole D-18 hoist target in `sync-loader.ts`.
```typescript
protected log: typeof logger = logger.extend("Relay");
protected authLog: typeof logger = this.log.extend("auth");
constructor(public url: string, opts?: RelayOptions) {
  this.log = this.log.extend(url);
  this.authLog = this.log.extend("auth");
}
```

### Value-signalling over string-sniffing (13-D-01, continued by D-11)
**Source:** `packages/relay/src/relay.ts`'s existing `AUTH_REQUIRED_PREFIX` checks throughout `req()`/`event()`/`negentropy()`; `types.ts:128`'s `PublishResponse.error`.
**Apply to:** the `event()` timeout-vs-rejection fix — set `.error` structurally, never check `message === "Timeout"`.

### `debug` output capture in tests (D-16)
**Source:** `packages/concord/src/helpers/__tests__/relays.test.ts:230-259`
**Apply to:** the new `packages/relay/src/__tests__/` test file — lift `captureDebugOutput()`/`messagesOf()` verbatim, changing only `NAMESPACE`.

### Guarded state-clear before logging (D-12)
**Source:** `packages/relay/src/relay.ts:405-415`'s `resetState()`
**Apply to:** the new invalidation log line — reuse the same guard conditions that already exist, read values before clearing.

## No Analog Found

None — every file this phase touches already has an established in-package or cross-package precedent to copy from; this is a pure application-of-existing-conventions phase per RESEARCH.md's own framing ("not new infrastructure").

## Metadata

**Analog search scope:** `packages/relay/src/`, `packages/loaders/src/loaders/`, `packages/concord/src/helpers/__tests__/`, `packages/concord/src/client/__tests__/`
**Files scanned:** `relay.ts` (targeted ranges), `types.ts` (imports + `RelayAuthOperation`/`RelayAuthContext`), `group.ts` (logger + dropped-relay site), `operators/auth-retry.ts` (config shape + existing log call), `negentropy.ts` (full), `sync-loader.ts` (`:595-615`), `relays.test.ts` (`:230-260`)
**Pattern extraction date:** 2026-08-08
