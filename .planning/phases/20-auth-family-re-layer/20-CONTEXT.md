# Phase 20: AUTH Family Re-layer - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Re-layer the AUTH family so `auth()` is the fixed low-level one-frame/one-reply operation and `authenticate()` owns bounded challenge acquisition, signing, freshness, and caller policy. Remove the public EVENT/AUTH verb selector without duplicating transport machinery, and keep all terminal auth errors recognizable across relay, group, and loader boundaries.

</domain>

<decisions>
## Implementation Decisions

### Challenge Acquisition and Freshness
- **D-01:** `authenticate()` waits for the first non-null relay challenge instead of synchronously reading `this.challenge` or throwing when no challenge has arrived. The wait activates and holds the relay connection and is bounded by the caller's whole-operation timeout.
- **D-02:** Snapshot the acquired challenge, construct and sign an AUTH event for it, then compare that snapshot with the current challenge immediately before the low-level AUTH attempt. A null or different current challenge invalidates the candidate: discard it without a wire write or bookkeeping update, reacquire, and re-sign.
- **D-03:** Repeated emissions of the same challenge are not freshness failures and do not consume retry budget. A stable relay `OK false` is a genuine verdict and does not trigger freshness retry.
- **D-04:** Add an explicit `challengeRetries` option with default `1`, permitting at most two signing attempts. The budget counts only challenge changes after signing began; exhaustion rejects with a typed terminal freshness error.

### High-level `authenticate()` Policy
- **D-05:** Preserve the public Promise API and signer-first call shape, adding an optional second `RelayAuthenticateOptions` argument with `timeout?: number | false`, `challengeRetries?: number`, and `signal?: AbortSignal`.
- **D-06:** One caller-supplied timeout is a non-suspending wall-clock deadline for the complete logical call: readiness, challenge acquisition, signer latency, freshness retries, and the AUTH reply. It never resets across retries or reconnections. `false` disables only this outer deadline; the low-level fixed reply bound remains.
- **D-07:** Every non-verdict failure reaches callers as Promise rejection, so `.catch()` and `try`/`await` agree. Challenge acquisition expiry and freshness exhaustion use dedicated typed errors; signer failures preserve their original error/cause; stable matching `OK true` and `OK false` remain `PublishResponse` values.
- **D-08:** Abort rejects with the signal's reason or a standard `AbortError`, removes listeners, ignores a late signer result, and never sends or updates bookkeeping for an abandoned candidate.
- **D-09:** Each `authenticate()` call starts one logical Promise operation. Multiple awaits of that Promise share the same execution; separate calls remain independent. Do not introduce cross-call deduplication or coalescing.
- **D-10:** Readiness is a shared transport precondition, not policy owned separately by `auth()` or `authenticate()`. Challenge acquisition must activate/hold the connection; the raw exchange retains the final readiness gate. Do not add a separately budgeted duplicate readiness wait.

### Fixed Low-level EVENT and AUTH Boundaries
- **D-11:** Remove the public `event(event, verb)` selector. Public `event(event)` always writes `EVENT`; public `auth(event)` always writes `AUTH`. This is an intentional v7 source break — **Reversibility: costly** — restoring the selector would reopen a public bypass around AUTH bookkeeping and lifecycle logging.
- **D-12:** Extract the common readiness-aware one-frame/one-matching-`OK` exchange into a private verb-parameterized helper. It owns listener-before-write ordering, one fresh unshared attempt per subscription, matching by event id, fixed reply timeout, clean/unclean close behavior, and normalized `PublishResponse`; it owns no signing, challenge, retry, configurable timeout, or auth policy.
- **D-13:** `event()` applies EVENT-only `auth-required:` translation to `AuthRequiredError`; other matching `OK false` frames remain verdict values. `auth()` preserves every matching `OK`, including an auth-required-looking `OK false`, as a verdict value so AUTH can never recurse into the EVENT auth loop.
- **D-14:** `auth()` remains a Promise and exactly one low-level AUTH interaction. It wraps the private helper directly, never `event()` or `publish()`, and owns AUTH send/result logging plus per-attempt `authentication$`, `authentications$`, and response bookkeeping.
- **D-15:** Discarded or aborted signed candidates never call `auth()` and never touch authentication state. Once `auth()` owns a genuine queued attempt, bookkeeping is valid; protect response mirrors with latest-attempt identity so an older concurrent response cannot overwrite newer state.

### Cross-package Error and Release Contract
- **D-16:** Add every new terminal AUTH error name to `applesauce-loaders`' duck-typed `RELAY_AUTH_ERROR_NAMES` and the relay-group mirrored classifier in the same phase. Dedicated parity tests must construct actual relay error instances and prove they classify as auth failures without replacing production duck typing.
- **D-17:** Preserve structured, redacted lifecycle logs for challenge wait, signing attempt, challenge change/re-sign, actual AUTH send, accepted/rejected result, timeout, and abort. Never log full challenges, signed events, or private key material.
- **D-18:** Amend AUTHF-04 and ROADMAP wording from “`auth()` calls `event(event, "AUTH")`” to the stronger invariant: `auth()` uses the same private one-frame/one-reply primitive as `event()`, has fixed AUTH routing, and never calls `publish()`.
- **D-19:** Amend Phase 18 provenance explicitly: its substantive one-attempt EVENT/AUTH transport invariants remain, while Phase 20 intentionally replaces the public verb distinction with fixed public family members. Record removal of the public second parameter in a focused `applesauce-relay` v7 changeset whose body is one sentence.

### Verification Contract
- **D-20:** Real-wire tests must cover fresh-relay connect/wait, relay-never-sends-challenge timeout, signer rejection, null/different challenge during signing, same-challenge repetition, exact freshness exhaustion, whole timeout across every stage, abort and late signer suppression, stable `OK false`, transport failure, multi-await versus separate calls, and concurrent same-pubkey bookkeeping.
- **D-21:** Raw parity tests must prove public `event()` can only write EVENT, public `auth()` writes exactly one AUTH and never calls `publish()`, AUTH `OK false` containing `auth-required:` does not invoke auth handling, listener-before-write survives synchronous replies, and readiness/timeout/close/repeated-subscription behavior stays aligned through the private helper.
- **D-22:** Add a compile-time guard that `relay.event(event, "AUTH")` is rejected, and update relay types, exports, documentation, examples, focused changesets, Concord/Vertex compatibility checks, and loader classifier tests together.

### the agent's Discretion
- Choose names and internal RxJS/Promise decomposition for the private raw exchange, authenticate options, and terminal errors, provided the locked responsibility and error-channel contracts remain exact.
- Choose focused test-file placement and logging phrasing consistent with the existing relay auth namespace and redaction helpers.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract
- `.planning/ROADMAP.md` § Phase 20 and § Phase 999.26 — phase goal, success criteria, provenance, stale-challenge defect, and original AUTH layering intent.
- `.planning/REQUIREMENTS.md` § AUTH Family — AUTHF-01 through AUTHF-05.
- `.planning/phases/18-event-family-re-layer/18-CONTEXT.md` — accepted EVENT-family one-attempt boundary and the public verb decision superseded in this phase.
- `.planning/phases/18-event-family-re-layer/18-VERIFICATION.md` — verified transport behaviors that must survive the private-helper extraction.

### Public Integration Surfaces
- `apps/docs/loading/relays/relays.md` — documented direct EVENT and manual/multi-user authentication flows.
- `packages/concord/src/client/auth.ts` — operation-scoped consumers of `authenticate()` and verdict/error handling.
- `packages/loaders/src/loaders/sync-loader.ts` — structural Relay auth interface and duck-typed terminal auth classifier.
- `packages/extra/src/vertex.ts` — challenge-driven automatic authentication consumer.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Relay.waitForReady()`, `watchTower`, and the current `event()` defer/listen/write chain provide the raw exchange machinery to extract rather than duplicate.
- `makeAuthEvent()`, `challenge$`, auth namespace logging/redaction helpers, and the per-pubkey `authentications$` map provide the current signing and state foundations.
- Existing relay error classes and loader/group name classifiers provide the terminal error integration pattern.

### Established Patterns
- A fresh unshared `defer` installs the matching listener before every wire write, preventing synchronous reply and resubscription races.
- Genuine relay protocol verdicts are values; client, transport, timeout, signer, freshness, and abort failures use the error/rejection channel.
- User-supplied `timeout` bounds the whole logical request across readiness, retries, reconnections, and backoff; it is not a per-attempt reset.
- Public high-level one-result methods remain Promise based, while low-level streaming members retain Observable semantics where already public.

### Integration Points
- `packages/relay/src/relay.ts` contains `event()`, `auth()`, `authenticate()`, readiness, challenge state, and bookkeeping.
- `packages/relay/src/types.ts` declares `AuthSigner`, response types, and the new authenticate options surface.
- `packages/relay/src/__tests__/relay.test.ts` and auth lifecycle suites contain the current raw EVENT/AUTH and multi-user behavior tests.
- `packages/loaders` and relay group classifiers must recognize new auth error names without relying on cross-package `instanceof`.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly preferred the architectural pairing `event()`/`publish()`, `req()`/`request()`, and `auth()`/`authenticate()`, while keeping readiness as shared transport behavior rather than assigning it as policy to either public layer.
- The user requested removal of the customizable public EVENT/AUTH selector after auditing the bookkeeping bypass; the accepted design keeps a private discriminated helper instead.

</specifics>

<deferred>
## Deferred Ideas

- No group or pool authentication aggregate is added; authentication remains on a concrete `Relay` obtained directly or from a pool.
- Cross-call authentication deduplication/coalescing remains out of scope.
- Generic transport retries inside `authenticate()` remain out of scope; freshness retries only address observed challenge movement.

</deferred>

---

*Phase: 20-auth-family-re-layer*
*Context gathered: 2026-08-31*
