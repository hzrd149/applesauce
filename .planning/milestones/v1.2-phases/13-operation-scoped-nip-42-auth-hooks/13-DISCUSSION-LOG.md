# Phase 13: Operation-Scoped NIP-42 Auth Hooks - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-05
**Phase:** 13-operation-scoped-nip-42-auth-hooks
**Areas discussed:** Retry budget composition, What authTimeout clocks, Failure error types, Where the auth flow lives

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Retry budget composition | How authRetries composes with the retry operators already in the pipe | ✓ |
| What authTimeout clocks | Handler execution vs only the post-handler wait | ✓ |
| Failure error types | What the operation rejects with per failure mode | ✓ |
| Where the auth flow lives | One shared operator vs four inline sites | ✓ |

**Notes:** All four selected. The 999.5 draft already locks the API shape, defaults,
`missingPubkeys` rules, no-dedupe policy, and changeset targets — those were not re-asked.
`05.1-review-followups.md` matched `todo.match-phase` at 0.6 on generic keywords only; reviewed and
not folded.

---

## Retry budget composition

### Q1 — How should authRetries and the existing publish `retries` budget compose?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate, auth innermost | Auth handled below `customRetryOperator`; exhausted auth error is terminal and not retried by the generic publish retry. Max EVENT sends = authRetries+1 | ✓ |
| Shared budget | auth-required consumes the publish `retries` count; authRetries only caps how many may be auth-driven | |
| Nested — both apply | Generic retry wraps the auth retry; worst case retries × (authRetries+1) = 6 sends | |

**User's choice:** Separate, auth innermost
**Notes:** Traced first — publish's existing retry (`:1235`) only *looks* correct today because the
pre-block at `:995` is what gives it something to wait on. Remove the pre-block and it becomes a hot
loop burning 3 attempts in ~6s. Not cosmetic bookkeeping; a live regression risk.

### Q2 — When does the authRetries counter reset?

| Option | Description | Selected |
|--------|-------------|----------|
| On progress | Reset once the operation gets past auth and makes progress, mirroring `DEFAULT_RETRY_CONFIG`'s `resetOnSuccess: true` | ✓ |
| Per connection | Scope to the current socket; `resetState()` is the natural boundary | |
| Per operation lifetime | One budget ever; simplest, matches a literal reading of RAUTH-03 | |

**User's choice:** On progress
**Notes:** `resetState()` (`:353-363`) clears auth state on every disconnect, so a long-lived
subscription re-receives `auth-required:` after each reconnect — a per-lifetime counter kills it on
the first one.

### Q3 — Do the operation-level timeouts keep running while an operation waits for auth?

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude the auth wait | Operation clock suspended across the auth phase; authTimeout is the sole bound | ✓ |
| Keep running | Auth wait counts against the operation timeout as today | |
| Keep running, raise the defaults | Bump count()'s 10s and document that operation timeouts must exceed authTimeout | |

**User's choice:** Exclude the auth wait
**Notes:** count()'s hard 10s (`:937`) could never survive an auth round-trip, and request()'s 30s
(`:1211`) races authTimeout's 30s so the user-visible error depends on which fires first.

### Q4 — How should SyncLoader's stall timeout and negentropy→request fallback treat an auth wait?

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude wait + no auth fallback | Stall clock doesn't run during auth; auth-required doesn't trigger the paginated fallback | ✓ |
| No auth fallback only | Stop the fallback but leave the 30s stall clock running through auth waits | |
| Pass-through only | Do exactly what RAUTH-08 literally requires and change nothing else | |

**User's choice:** Exclude wait + no auth fallback
**Notes:** `withTimeout` (`sync-loader.ts:279`) wraps both paths, so an auth wait trips the
`catchError` at `:362` and logs a spurious "negentropy sync failed, falling back" — then the
fallback hits the same wall.

### Q5 — What should happen when auth-required arrives but waitForAuth is already satisfied?

| Option | Description | Selected |
|--------|-------------|----------|
| Invoke handler, wait resolves instantly | One uniform rule; handler can still authenticate a key outside waitForAuth | ✓ |
| Fail fast when nothing is missing | Skip the handler and reject, since waiting cannot change a met requirement | |
| Wait for auth state to change | Wait for a new AUTH to be accepted rather than for the requirement to read satisfied | |

**User's choice:** Invoke handler, wait resolves instantly
**Notes:** Costs one extra round-trip, bounded by authRetries.

### Q6 — Should auth retries carry a backoff delay?

| Option | Description | Selected |
|--------|-------------|----------|
| No delay — the wait is the gate | authSatisfied$ supplies the pause; the spin case is bounded by the caller's authRetries | ✓ |
| Small fixed backoff | ~1s before each auth retry, matching DEFAULT_RETRY_CONFIG's linear timer | |
| Delay only when the wait was instant | Targets the spin case only; adds a branch to specify and test | |

**User's choice:** No delay — the wait is the gate
**Notes:** Pipe order in `req()` confirmed unchanged — auth innermost, then connection retry, then
repeat; `AuthRequiredError extends RelayClosedError` already makes the connection retry re-throw it.

---

## What authTimeout clocks

### Q1 — Does authTimeout bound the handler's own execution, or only the wait after it resolves?

| Option | Description | Selected |
|--------|-------------|----------|
| One clock over the whole auth phase | Starts at auth-required, covers handler + wait; a hung prompt can't wedge an operation | ✓ |
| Wait only — handler unbounded | Literal reading of the draft; app owns its prompt timeouts | |
| Separate bounds | Distinct option for the handler; most precise, a fourth auth option | |

**User's choice:** One clock over the whole auth phase
**Notes:** `RelayAuthHandler` returns `void | Promise<void>`; an unanswered NIP-46 or extension
prompt never settles, and under a wait-only reading nothing bounds it — the operation holds a live
REQ id forever, which RAUTH-05's "a timeout rejects only its own operation" wouldn't cover.

### Q2 — With no handler, what should authTimeout's default be?

| Option | Description | Selected |
|--------|-------------|----------|
| Uniform 30s | Same default handler or not; turns today's silent forever-hang into an AuthRequiredError | ✓ |
| Default false without a handler | Indefinite without a handler, 30s with one; preserves every ambient call site exactly | |
| Uniform 30s, warn on the no-handler timeout | Same semantics plus a debug line naming onAuthRequired / authTimeout: false | |

**User's choice:** Uniform 30s
**Notes:** User asked what authTimeout even applies to without a handler. Answer: the wait for
out-of-band auth to land on that connection — the app's own `status$` watcher, a concurrent
operation's handler, or an in-flight `relay.auth()`. That is RAUTH-04's "waits indefinitely for
external auth state" clause. Reframing narrowed the regression risk: today an app with no auth code
at all hangs forever and never errors, so the default is closer to a fix; the exposure is only apps
whose out-of-band auth reliably exceeds 30s.

### Q3 — Is authTimeout applied per auth phase, or as one budget?

| Option | Description | Selected |
|--------|-------------|----------|
| Per auth phase | Each auth-required starts a fresh clock; worst case (authRetries+1) × authTimeout | ✓ |
| One budget for the operation | Total bound regardless of retries; a second cycle inherits what's left | |
| Per phase with a total cap | Bounds both, at the cost of a fifth knob | |

**User's choice:** Per auth phase
**Notes:** Since D-15 suspends the operation clocks, authTimeout is the only bound in play, so its
span sets the true worst case.

---

## Failure error types

### Q1 — How should the auth failure modes be distinguished?

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct subclasses | AuthHandlerError (with `cause`) + AuthTimeoutError, both extending RelayClosedError | ✓ |
| One type, discriminant field | AuthRequiredError with reason: "required" \| "rejected" \| "timeout" \| "exhausted" | |
| Propagate the handler's own error | Rethrow unchanged; most informative but unbounded error type | |

**User's choice:** Distinct subclasses
**Notes:** Hard constraint surfaced: `customConnectionRetryOperator` (`:1141-1148`) routes on
`instanceof RelayClosedError`, so a new auth error not inheriting from it would be retried by the
connection layer, contradicting the auth-innermost decision.

### Q2 — Should a group publish preserve the auth error object, not just its message?

| Option | Description | Selected |
|--------|-------------|----------|
| Add an optional error field to PublishResponse | Additive; group publish callers can branch per relay | ✓ |
| Message only | No API change; group publish callers get a string | |
| Encode the mode in the message | Standardize `auth-timeout:` / `auth-rejected:` prefixes, mirroring NIP-01 | |

**User's choice:** Add an optional error field to PublishResponse
**Notes:** The group REQ path already preserves the error object (`group.ts:147`) while
`errorToPublishResponse` (`:56-59`) keeps only `err?.message` — an asymmetry Phase 15 would hit.

### Q3 — Should one relay's auth failure fail the whole group sync?

| Option | Description | Selected |
|--------|-------------|----------|
| Isolate per relay, log it | Per-relay catchError in RelayGroup.sync, matching REQ, publish, and SyncLoader | ✓ |
| Leave as is | One relay's failure fails the whole group sync; loud rather than silent | |
| Out of scope for Phase 13 | Note the consequence, don't touch group.sync | |

**User's choice:** Isolate per relay, log it
**Notes:** `RelayGroup.sync` (`:300-320`) has no per-relay catchError. The path is largely
unreachable today because the pre-block makes an auth-gated relay wait rather than error — this
phase is what makes it routine. `sync()` has no error channel, so the dropped relay is
debug-output-only.

---

## Where the auth flow lives

### Q1 — One shared operator, or inline at each of the four sites?

| Option | Description | Selected |
|--------|-------------|----------|
| One shared operator | Owns handler, missingPubkeys, per-phase timeout, counting, error mapping, clock suspension | ✓ |
| Shared helpers, inline retries | Extract helpers but keep the four retry blocks, which already differ | |
| Inline at each site | Smallest diff; every decision re-implemented and re-tested four times | |

**User's choice:** One shared operator
**Notes:** Makes RAUTH-07's "available on all eight" a property of the operator rather than four
implementations that happen to agree.

### Q2 — How should event() feed the shared operator? (first framing — rejected)

**Rejected by user.** The framing offered "normalize in, denormalize out" (convert event()'s
emission to a throw so an operator could catch it, then convert back), "operator accepts both
signals", or "make event() error".

**User's correction, verbatim:** *"this needs a lot more explanations and examples, generally any
time an internal method throws and the wrapper method is using it as a signal or exepected state.
that is a bad thing and code smell"*

This invalidated the question's premise. Re-derived and documented the costs already paid in
`relay.ts`: `customConnectionRetryOperator` filtering a signal that isn't a failure;
`AuthRequiredError extends RelayClosedError` encoding routing rather than identity; `count()`
conscripted into catching and re-throwing; a stream teardown per signal forcing `retry()` +
resubscribe; and the fact that adding two error classes would require revisiting every one of those
filters. Saved as a durable preference (`no-throw-as-internal-signal`).

### Q2′ — How far should the value-signalled auth flow go in this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| All four sites, errors only at the caller boundary | req/count stop throwing for auth-required; event needs no conversion; negentropy translates at its edge | ✓ |
| Only where it's free | Value path for event/publish, keep req/count/negentropy throwing; operator carries two paths | |
| All CLOSED prefixes, not just auth | Most consistent, but rewrites error handling for blocked/rate-limited/invalid | |

**User's choice:** All four sites, errors only at the caller boundary
**Notes:** req/count keep throwing for the *other* CLOSED prefixes — those are genuine failures.
`negentropy` translating `NegentropyError` from a lower layer into the signal is error translation
at an edge, not throw-as-signal, and stays.

### Q3 — How should onAuthRequired's context type reach applesauce-loaders?

| Option | Description | Selected |
|--------|-------------|----------|
| Structural mirror, as the package already does | Own SyncAuthContext with a minimal relay interface; no new dependency | ✓ |
| Generic over the relay type | SyncAuthContext<TRelay>; solves variance, propagates a type parameter | |
| Type-only dependency on applesauce-relay | One canonical handler type; reverses a deliberate decoupling | |

**User's choice:** Structural mirror, as the package already does
**Notes:** loaders depends only on applesauce-core, nanoid, rxjs, and annotates its mirrors in
source (`:34`, `:89`, `:96`). One-way assignability documented: a handler written against the
loaders type accepts a real `Relay`; the reverse is not assignable.

### Q4 — How should the three auth options be introduced into the option types?

| Option | Description | Selected |
|--------|-------------|----------|
| Mixin + named types for the three stragglers | RelayAuthOptions intersected everywhere; new RelayCountOptions / RelayEventOptions / RelaySyncOptions | ✓ |
| Mixin only, used directly | Fewest new names; a rename needed the day count() gains a non-auth option | |
| Add the fields inline | Nine literals across three classes to keep in sync | |

**User's choice:** Mixin + named types for the three stragglers

### Q5 — What should the oracle be for the auth behavior tests?

| Option | Description | Selected |
|--------|-------------|----------|
| Wire trace, real timers, short values | Assert frame sequence/count derived from NIP-42; keep the relay suite's real clock | ✓ |
| Wire trace, fake timers for timeouts | Fast and deterministic — and the setup that made 999.10's overflow invisible | |
| Observable state assertions | Simplest, but compares the implementation to its own state (TEST-01 forbids) | |

**User's choice:** Wire trace, real timers, short values

---

## Claude's Discretion

- Internal signal type name and shape; where the shared operator lives in the file.
- Whether `RelayAuthContext.relay` stays a concrete `Relay` within `applesauce-relay` itself.
- Naming of new error classes beyond `AuthHandlerError` and `AuthTimeoutError`.
- `missingPubkeys` computation follows the 999.5 draft verbatim.

## Deferred Ideas

- Value-signal the remaining `CLOSED` prefixes (blocked, rate-limited, invalid) — same principle,
  outside this phase's charter. Worth a backlog entry.
- A lint rule enforcing "no throw as an internal signal" — same disposition as the SEED-001 logger
  rule that REQUIREMENTS.md already scoped out.
- A separate bound for handler execution — revisit only if a consumer needs a long human-prompt
  window with a short state wait.
