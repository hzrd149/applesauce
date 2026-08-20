# Phase 13: Operation-Scoped NIP-42 Auth Hooks - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning

<domain>
## Phase Boundary

NIP-42 authentication moves out of ambient, relay-wide cached flags and into the specific
operation that receives `auth-required:`. `onAuthRequired` / `authTimeout` / `authRetries` land on
`req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, and negentropy in
`applesauce-relay`, pass through `RelayPool`/`RelayGroup`, and thread into `applesauce-loaders`'
`SyncLoader` on both its negentropy and paginated paths.

`authRequiredForRead$` / `authRequiredForPublish$` survive as informational status only — their use
as a *pre-block gate* is what is removed.

**Not this phase:** auth lifecycle debug logging (Phase 14), Concord's stream-auth migration
(Phase 15, hard-blocked on this one), and any relay-internal dedupe / single-flight / prompt
suppression (permanently out of scope per REQUIREMENTS.md).

</domain>

<decisions>
## Implementation Decisions

### Signalling and method layering

- **D-01:** Low-level relay methods perform one wire interaction and surface its failure; high-level
  methods own configurable policy such as authentication, retries, reconnects, resubscription,
  clocks, and concurrency. A thrown expected-state signal is a smell when it crosses uninterested
  intermediaries or a multi-hop chain, because every layer must understand a signal that is not
  theirs. A throw is appropriate when the immediate consumer deliberately retries or aggregates the
  upstream call. `req()` therefore signals auth-required as a **value on an internal type** because
  that state crosses the shared operator chain; the operator consumes it and never forwards it
  downstream. `AuthRequiredError`, `AuthTimeoutError`, and `AuthHandlerError` are constructed at the
  caller boundary when the operation gives up. The former blanket throw-as-signal rule had already
  cost this file four things — `customConnectionRetryOperator` special-casing `RelayClosedError`
  (`relay.ts:1141-1148`), `AuthRequiredError extends RelayClosedError` (`:113`) encoding routing
  rather than describing the error, `count()` catching and re-throwing only because the signal
  passes through it (`:929-935`), and a stream teardown per signal that forces `retry()` +
  resubscribe where a value could drive a resend.
  **Phase 18 amendment (2026-08-20):** EVENT is the canonical one-hop exception: raw `event()` performs
  one wire interaction and throws `AuthRequiredError` directly to its immediate `publish()` consumer.
  REQ, COUNT, and negentropy retain value signalling because their auth state crosses multi-hop chains.
- **D-02:** Applies at **all four** auth sites. `req` (`:845-869`) and `count` (`:929-946`) stop
  throwing **for auth-required** — they keep throwing for the other `CLOSED` prefixes, which are
  genuine failures. `event` (`:990-995`) already emits `{ ok: false, message: "auth-required:" }` as
  a value and needs no conversion — it becomes the model the others follow. `negentropy`
  (`:1063-1082`) translates `NegentropyError` from `negentropySync` into the same signal at its
  boundary; that is error *translation at an edge* from a lower layer, not throw-as-signal, and it
  stays.
- **D-03:** Do NOT extend this treatment to the other `parseClosedError` prefixes (blocked,
  rate-limited, invalid) — see Deferred Ideas.

### Where the auth flow lives

- **D-04:** **One shared protected operator** owns handler invocation, `missingPubkeys` computation,
  the per-phase timeout, retry counting and reset, error mapping, and operation-clock suspension.
  Each of the four sites supplies only its operation label and normalizes its auth-required signal.
  RAUTH-07's "available on all eight" becomes a property of the operator rather than four
  independent implementations that happen to agree. (`request`/`subscription` inherit from `req`,
  `publish` from `event`, `sync` from `negentropy`.)
- **D-05:** A `RelayAuthOptions` mixin holds `waitForAuth` / `onAuthRequired` / `authTimeout` /
  `authRetries`, intersected into `RelayReqOptions`, `PublishOptions`, `NegentropySyncOptions`, and
  **new** `RelayCountOptions` / `RelayEventOptions` / `RelaySyncOptions`. Those three methods
  currently take anonymous literals (`opts?: { waitForAuth?: AuthRequirement }`) duplicated across
  `Relay`, `RelayGroup`, and `RelayPool` — roughly nine literals to keep in sync. Named types bring
  them in line with the five methods that already have them.
- **D-06:** `applesauce-loaders` keeps its **structural mirror** — it declares its own
  `SyncAuthContext` with a minimal relay interface (what a handler actually needs: `url`,
  `authenticate`, `auth`), annotated "structurally matches applesauce-relay's …" like the existing
  `SyncAuthRequirement` (`sync-loader.ts:34`) and `SyncLoaderRelay` (`:89`). **No new dependency** —
  loaders deliberately depends only on `applesauce-core`, `nanoid`, `rxjs`. Document the one-way
  assignability: a handler written against the loaders type accepts a real `Relay`, but one written
  against relay's full `RelayAuthContext` is not assignable to the loaders handler.

### Retry budget composition

- **D-07:** **Separate call-scoped budgets, additive bound.** Auth-required is fully handled below
  `customRetryOperator`; an exhausted auth failure surfaces as terminal and the generic publish
  retry does **not** retry it. **Phase 18 amendment (2026-08-20):** publish retains independent auth
  and transient counters across resubscriptions, so max EVENT sends = `1 + authRetries + retries`;
  reconnectable connection failures consume only the transient budget. Without this, removing the pre-block turns publish's
  existing retry (`:1235`, count 3, linear backoff) into a hot loop — it currently only *appears*
  correct because the pre-block at `:995` is what gives it something to wait on.
- **D-08:** The `authRetries` counter **resets on progress** — once the operation gets past auth and
  makes progress (REQ opens / events flow / publish accepted), mirroring `DEFAULT_RETRY_CONFIG`'s
  `resetOnSuccess: true` (`:89`). So `authRetries` means *consecutive* auth failures tolerated.
  Required for correctness: `resetState()` (`:353-363`) clears `authentications$` and both flags on
  every disconnect, so a long-lived `subscription()` re-receives `auth-required:` after each
  reconnect; a per-lifetime counter would kill it on the first one.
- **D-09:** Existing pipe order in `req()` is unchanged — auth innermost, then
  `customConnectionRetryOperator`, then `customRepeatOperator`.
- **D-10:** **No backoff** between auth retries — the `authSatisfied$` wait is the gate. The
  pathological spin (already-satisfied requirement + high `authRetries`) is bounded by a number the
  caller chose.
- **D-11:** When `auth-required:` arrives but `waitForAuth` is **already satisfied**, the handler is
  still invoked and the wait resolves instantly. One uniform rule, no special case; the handler
  still gets its chance to authenticate a key outside `waitForAuth`. Costs one extra round-trip,
  bounded by `authRetries`.

### Timeouts

- **D-12:** `authTimeout` is **one clock over the whole auth phase** — it starts when
  `auth-required:` is received and covers handler execution *plus* the subsequent wait. A hung
  signer prompt (NIP-46 bunker, unanswered extension dialog) can never wedge an operation.
  `authTimeout: false` therefore means genuinely unbounded, prompt included.
- **D-13:** `authTimeout` is applied **per auth phase** — each `auth-required:` starts a fresh
  clock. Worst case `(authRetries + 1) × authTimeout`; each cycle is independently bounded and
  independently attributable in Phase 14's logs.
- **D-14:** The **uniform 30s default applies with or without a handler**. With no handler the auth
  phase collapses to just the wait, so `authTimeout` bounds how long the operation waits for
  out-of-band auth to land on that connection (the app's own `status$` watcher calling
  `relay.authenticate()`, a concurrent operation's handler authenticating the same pubkey, or an
  in-flight `relay.auth()`). This is RAUTH-04's "waits indefinitely for external auth state" clause,
  now bounded by default. Today both the pre-block (`:708`) and `req`'s retry delay (`:864`) wait on
  `authSatisfied$` with no bound at all, so an app with **no auth code whatsoever** hangs forever and
  never errors — the default converts that silent hang into an `AuthRequiredError`. Callers doing
  slow out-of-band auth pass `authTimeout: false`; the changeset must say so.
- **D-15:** **Operation-level clocks are suspended across the auth phase** — `count`'s 10s
  (`:937`), `request`'s 30s (`:1211`), and `publish`'s `publishTimeout` (`:1237`) do not run while
  waiting for auth, and the operation gets its full timeout for the actual work afterwards. Without
  this, `count()` can never survive an auth round-trip and `request()` races its own 30s against
  `authTimeout`'s 30s, so the user-visible error depends on which fires first.
- **D-16:** In `SyncLoader`, the `withTimeout` stall guard (`sync-loader.ts:279`,
  `rxTimeout({ first, each })`) does not run during an auth wait, **and** an auth-required from the
  negentropy path does **not** trigger the paginated fallback (`:362`) — only a genuine sync failure
  does. Otherwise an auth-gated relay logs a spurious "negentropy sync failed, falling back",
  burns the request path against the same wall, and reports the relay as errored.

### Error surface

- **D-17:** **Distinct subclasses:** `AuthHandlerError` (carrying the handler's rejection as
  `cause`) and `AuthTimeoutError`, both extending `RelayClosedError` so
  `customConnectionRetryOperator`'s `instanceof RelayClosedError` skip (`:1141-1148`) keeps working
  unchanged — a new auth error that did *not* inherit from it would be silently picked up by the
  connection retry and re-run the whole operation, contradicting D-07. Retries-exhausted surfaces as
  the final `AuthRequiredError`. RAUTH-06's `waitForAuth: false` → `AuthRequiredError` is unchanged.
- **D-18:** `PublishResponse` gains an **optional `error` field**, and `errorToPublishResponse`
  (`group.ts:56-59`) attaches the original error alongside the message. Additive to a published
  type. Today the group REQ path preserves the error object (`group.ts:147`) while the publish path
  keeps only `err?.message`, so a group publish that fails auth reaches Phase 15 as a bare string it
  cannot branch on.
- **D-19:** `RelayGroup.sync` (`group.ts:300-320`) gets **per-relay `catchError`** so one relay's
  auth failure no longer kills the sync for the rest — matching what the REQ path, the publish path,
  and `SyncLoader` (`sync-loader.ts:388`) already do. `sync()` returns `Observable<NostrEvent>` with
  no error channel, so the dropped relay is visible in debug output only (Phase 14 / ALOG-02
  territory). This path is largely unreachable today precisely because the pre-block makes an
  auth-gated relay *wait* rather than error; removing it is what makes it routine.

### Verification

- **D-20:** **Wire-trace oracle, real timers, short values.** Assert the exact frame sequence and
  count the mock relay observes — REQ → `CLOSED auth-required:` → AUTH → REQ — derived
  independently from NIP-42's specified exchange, never from our own state; plus handler-invocation
  counts for RAUTH-05's concurrency independence. Keep the relay suite's existing real clock
  (`vitest-websocket-mock` + `subscribeSpyTo`; it uses no fake timers today) and pass small explicit
  `authTimeout` values, so D-15's clock suspension is observed as real ordering rather than a mocked
  advance. Per the standing Verification Standard, record a RED→GREEN non-vacuity probe per
  requirement.

### Claude's Discretion

- The exact internal signal type name and shape, and where the operator lives in the file.
- Whether `RelayAuthContext.relay` stays a concrete `Relay` in `applesauce-relay` itself (only the
  loaders mirror is decided, D-06).
- Naming of the new error classes beyond the two named in D-17.
- How `missingPubkeys` is computed follows the 999.5 draft verbatim: `true` → `null`, `"pk"` →
  `["pk"]` if missing else `[]`, `["a","b"]` → only the not-yet-authenticated ones.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary input — the drafted plan
- `.planning/phases/999.5-operation-scoped-nip-42-auth-hooks/operation-scoped-nip-42-auth-hooks-plan.md`
  — the drafted implementation plan promoted from backlog 999.5. Locks the public API (`RelayAuthOperation`,
  `RelayAuthContext`, `RelayAuthHandler`), the defaults (`waitForAuth: true`, `authTimeout: 30_000`,
  `authRetries: 1`), the `missingPubkeys` rules, the file list, and the test list. ROADMAP.md names it as
  primary input for planning. **Where this CONTEXT.md and the draft disagree, this file wins** — specifically
  D-01/D-02 (the draft's implicit throw-as-signal model) and D-12 (the draft's "apply authTimeout while
  waiting for auth state", which left the handler unbounded).

### Milestone scope and requirements
- `.planning/REQUIREMENTS.md` — RAUTH-01..09 for this phase; the Out of Scope table (no relay-internal
  dedupe; `authRequiredForRead$`/`authRequiredForPublish$` stay as status; changesets for
  `applesauce-relay` and `applesauce-loaders`, none for concord); and the Verification Standard.
- `.planning/ROADMAP.md` § Phase 13 — goal and the five success criteria.
- `.planning/ROADMAP.md` § Phase 15 — the downstream consumer this API must serve (CAUTH-01..04).

### Source under change
- `packages/relay/src/relay.ts` — the four auth sites (`req` :845-869, `count` :929-946,
  `event` :990-995, `negentropy` :1063-1082), `waitForAuth()` :702, `authSatisfied$()` :696,
  `resetState()` :353, `AuthRequiredError` :113, `DEFAULT_RETRY_CONFIG` :86,
  `customConnectionRetryOperator` :1141.
- `packages/relay/src/types.ts` — `AuthRequirement` :28, `PublishOptions` :60, `RelayReqOptions` :81.
- `packages/relay/src/group.ts` — `errorToPublishResponse` :56, per-relay ERROR mapping :147,
  `sync` :300.
- `packages/relay/src/pool.ts` — `count` :258, `sync` :253-262 pass-through.
- `packages/relay/src/negentropy.ts` — `NegentropySyncOptions` :22, `NegentropyError` :36.
- `packages/loaders/src/loaders/sync-loader.ts` — `SyncAuthRequirement` :36, `SyncMethodOptions` :77,
  `SyncLoaderRelay` :89, `SyncLoadRequest.waitForAuth` :142, `withTimeout` :279, negentropy fallback :362,
  per-relay `catchError` :388.

### Project conventions
- `CLAUDE.md` § Writing Changesets — one change per file, body is a single sentence of markdown.
- `.planning/codebase/CONVENTIONS.md` — repo-wide code conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `authSatisfied$(requirement)` (`relay.ts:696`) — already maps an `AuthRequirement` to an
  observable of satisfaction; the shared operator's wait is built on it unchanged.
- `authenticatedFor$` / `isAuthenticated` (`:681-693`) — the basis for computing `missingPubkeys`.
- `customConnectionRetryOperator` (`:1141`) — its `instanceof RelayClosedError` skip is the model
  for how a class hierarchy already carries "don't retry me", and the constraint D-17 must respect.
- `parseClosedError` + `ERROR_MAP` (`:122`) — the existing NIP-01 prefix → typed error mapping;
  auth-required leaves it for the value channel, the other prefixes stay.

### Established Patterns
- **Anonymous option literals duplicated across three classes** — `count`, `event`, and `sync` take
  `opts?: { waitForAuth?: AuthRequirement }` in `Relay`, `RelayGroup`, and `RelayPool`. D-05 replaces
  them with named types intersecting one mixin.
- **Deliberate package decoupling** — `applesauce-loaders` mirrors relay types structurally rather
  than importing them, annotated in-source. D-06 continues it.
- **Per-relay failure isolation in the group** — REQ path emits `{type:"ERROR", from, error}`,
  publish path degrades to `{ok:false, message}`. D-18/D-19 make the third path (`sync`) and the
  publish path match the REQ path's fidelity.
- **`resetState()` on every disconnect** (`:353-363`) clears `authentications$`, the challenge, and
  both auth-required flags — the reason D-08 needs a resetting counter.

### Integration Points
- `RelayPool` / `RelayGroup` forward every new option to `Relay` unchanged (RAUTH-07's pool leg).
- `SyncLoader.methodOptions` (`sync-loader.ts:270`) is the single place the three options thread
  into both the negentropy and paginated paths (RAUTH-08).
- Phase 15's concord engines are the first real consumer of `onAuthRequired` + `missingPubkeys`;
  D-17's error classes and D-18's `PublishResponse.error` exist for their branching.

</code_context>

<specifics>
## Specific Ideas

- **The user's standing principle, amended by Phase 16:** a throw used as expected state across
  uninterested intermediaries or a multi-hop chain is a code smell. D-01/D-02 apply that principle
  to `req()` with a discriminated internal value. An immediate retry or aggregation boundary may
  instead consume a thrown upstream failure directly; construct terminal errors where callers must
  handle them.
- Two published packages change behavior, so both need a changeset with a single-sentence body:
  `applesauce-relay` (operation-scoped auth callbacks, timeout/retry semantics, and `waitForAuth`
  no longer pre-blocking) and `applesauce-loaders` (sync loader pass-through). `applesauce-concord`
  is unreleased and needs none.
- The changeset for `applesauce-relay` must surface the D-14 consequence: callers relying on an
  indefinite wait for out-of-band auth now need `authTimeout: false`.

</specifics>

<deferred>
## Deferred Ideas

- **Value-signal the remaining `CLOSED` prefixes** (blocked, rate-limited, invalid) so no relay
  reply anywhere is signalled by a throw. Consistent end state and the same principle as D-01, but
  it rewrites error handling across `req`, `count`, and the group's ERROR plumbing — outside this
  phase. Worth a backlog entry.
- **A lint rule enforcing "no throw as an internal signal"** — analogous to the SEED-001 logger rule
  that REQUIREMENTS.md already scoped out of this milestone. Same disposition: available as a
  follow-up, not now.
- **A separate bound for handler execution** (rejected in favor of D-12's single clock) — revisit
  only if a real consumer needs a long human-prompt window with a short state wait.

### Reviewed Todos (not folded)
- `05.1-review-followups.md` — "Phase 05.1 code-review follow-ups". Surfaced by `todo.match-phase`
  at score 0.6, but the match is on generic keywords ("phase", "pre", "status"); the content is
  gift-wrap/seal helpers in `applesauce-common` with no relation to relay auth. Not folded.

</deferred>

---

*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Context gathered: 2026-08-05*
