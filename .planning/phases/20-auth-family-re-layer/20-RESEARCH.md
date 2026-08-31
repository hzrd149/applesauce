# Phase 20: AUTH Family Re-layer - Research

**Researched:** 2026-08-31
**Domain:** NIP-42 relay authentication lifecycle, RxJS/Promise cancellation, and cross-package error classification
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `authenticate()` waits for the first non-null relay challenge instead of synchronously reading `this.challenge` or throwing when no challenge has arrived. The wait activates and holds the relay connection and is bounded by the caller's whole-operation timeout.
- **D-02:** Snapshot the acquired challenge, construct and sign an AUTH event for it, then compare that snapshot with the current challenge immediately before the low-level AUTH attempt. A null or different current challenge invalidates the candidate: discard it without a wire write or bookkeeping update, reacquire, and re-sign.
- **D-03:** Repeated emissions of the same challenge are not freshness failures and do not consume retry budget. A stable relay `OK false` is a genuine verdict and does not trigger freshness retry.
- **D-04:** Add an explicit `challengeRetries` option with default `1`, permitting at most two signing attempts. The budget counts only challenge changes after signing began; exhaustion rejects with a typed terminal freshness error.
- **D-05:** Preserve the public Promise API and signer-first call shape, adding an optional second `RelayAuthenticateOptions` argument with `timeout?: number | false`, `challengeRetries?: number`, and `signal?: AbortSignal`.
- **D-06:** One caller-supplied timeout is a non-suspending wall-clock deadline for the complete logical call: readiness, challenge acquisition, signer latency, freshness retries, and the AUTH reply. It never resets across retries or reconnections. `false` disables only this outer deadline; the low-level fixed reply bound remains.
- **D-07:** Every non-verdict failure reaches callers as Promise rejection, so `.catch()` and `try`/`await` agree. Challenge acquisition expiry and freshness exhaustion use dedicated typed errors; signer failures preserve their original error/cause; stable matching `OK true` and `OK false` remain `PublishResponse` values.
- **D-08:** Abort rejects with the signal's reason or a standard `AbortError`, removes listeners, ignores a late signer result, and never sends or updates bookkeeping for an abandoned candidate.
- **D-09:** Each `authenticate()` call starts one logical Promise operation. Multiple awaits of that Promise share the same execution; separate calls remain independent. Do not introduce cross-call deduplication or coalescing.
- **D-10:** Readiness is a shared transport precondition, not policy owned separately by `auth()` or `authenticate()`. Challenge acquisition must activate/hold the connection; the raw exchange retains the final readiness gate. Do not add a separately budgeted duplicate readiness wait.
- **D-11:** Remove the public `event(event, verb)` selector. Public `event(event)` always writes `EVENT`; public `auth(event)` always writes `AUTH`. This is an intentional v7 source break — **Reversibility: costly** — restoring the selector would reopen a public bypass around AUTH bookkeeping and lifecycle logging.
- **D-12:** Extract the common readiness-aware one-frame/one-matching-`OK` exchange into a private verb-parameterized helper. It owns listener-before-write ordering, one fresh unshared attempt per subscription, matching by event id, fixed reply timeout, clean/unclean close behavior, and normalized `PublishResponse`; it owns no signing, challenge, retry, configurable timeout, or auth policy.
- **D-13:** `event()` applies EVENT-only `auth-required:` translation to `AuthRequiredError`; other matching `OK false` frames remain verdict values. `auth()` preserves every matching `OK`, including an auth-required-looking `OK false`, as a verdict value so AUTH can never recurse into the EVENT auth loop.
- **D-14:** `auth()` remains a Promise and exactly one low-level AUTH interaction. It wraps the private helper directly, never `event()` or `publish()`, and owns AUTH send/result logging plus per-attempt `authentication$`, `authentications$`, and response bookkeeping.
- **D-15:** Discarded or aborted signed candidates never call `auth()` and never touch authentication state. Once `auth()` owns a genuine queued attempt, bookkeeping is valid; protect response mirrors with latest-attempt identity so an older concurrent response cannot overwrite newer state.
- **D-16:** Add every new terminal AUTH error name to `applesauce-loaders`' duck-typed `RELAY_AUTH_ERROR_NAMES` and the relay-group mirrored classifier in the same phase. Dedicated parity tests must construct actual relay error instances and prove they classify as auth failures without replacing production duck typing.
- **D-17:** Preserve structured, redacted lifecycle logs for challenge wait, signing attempt, challenge change/re-sign, actual AUTH send, accepted/rejected result, timeout, and abort. Never log full challenges, signed events, or private key material.
- **D-18:** Amend AUTHF-04 and ROADMAP wording from “`auth()` calls `event(event, "AUTH")`” to the stronger invariant: `auth()` uses the same private one-frame/one-reply primitive as `event()`, has fixed AUTH routing, and never calls `publish()`.
- **D-19:** Amend Phase 18 provenance explicitly: its substantive one-attempt EVENT/AUTH transport invariants remain, while Phase 20 intentionally replaces the public verb distinction with fixed public family members. Record removal of the public second parameter in a focused `applesauce-relay` v7 changeset whose body is one sentence.
- **D-20:** Real-wire tests must cover fresh-relay connect/wait, relay-never-sends-challenge timeout, signer rejection, null/different challenge during signing, same-challenge repetition, exact freshness exhaustion, whole timeout across every stage, abort and late signer suppression, stable `OK false`, transport failure, multi-await versus separate calls, and concurrent same-pubkey bookkeeping.
- **D-21:** Raw parity tests must prove public `event()` can only write EVENT, public `auth()` writes exactly one AUTH and never calls `publish()`, AUTH `OK false` containing `auth-required:` does not invoke auth handling, listener-before-write survives synchronous replies, and readiness/timeout/close/repeated-subscription behavior stays aligned through the private helper.
- **D-22:** Add a compile-time guard that `relay.event(event, "AUTH")` is rejected, and update relay types, exports, documentation, examples, focused changesets, Concord/Vertex compatibility checks, and loader classifier tests together.

### the agent's Discretion
- Choose names and internal RxJS/Promise decomposition for the private raw exchange, authenticate options, and terminal errors, provided the locked responsibility and error-channel contracts remain exact.
- Choose focused test-file placement and logging phrasing consistent with the existing relay auth namespace and redaction helpers.

### Deferred Ideas (OUT OF SCOPE)
- No group or pool authentication aggregate is added; authentication remains on a concrete `Relay` obtained directly or from a pool.
- Cross-call authentication deduplication/coalescing remains out of scope.
- Generic transport retries inside `authenticate()` remain out of scope; freshness retries only address observed challenge movement.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTHF-01 | Acquire a challenge through a bounded wait. | Use an active `watchTower` + non-null `challenge$` wait under one outer deadline. [VERIFIED: `packages/relay/src/relay.ts`] |
| AUTHF-02 | Re-sign when the challenge moves during signing, within a small explicit bound. | Snapshot/sign/compare loop; increment only on changed/null post-sign challenge. [VERIFIED: NIP-42 official specification and `20-CONTEXT.md`] |
| AUTHF-03 | All authenticate failures reject its Promise. | Create the operation eagerly once, convert the single bounded observable/async operation to one Promise, and never throw before returning it. [CITED: https://rxjs.dev/api/index/function/firstValueFrom] |
| AUTHF-04 | AUTH is one raw frame/reply and cannot enter publish auth policy. | Extract private verb helper; `event()` fixes EVENT and `auth()` fixes AUTH. [VERIFIED: `packages/relay/src/relay.ts`] |
| AUTHF-05 | Every terminal relay auth error name is mirrored by loaders and group. | Update both name sets and test them using imported real relay error instances. [VERIFIED: `packages/loaders/src/loaders/sync-loader.ts`, `packages/relay/src/group.ts`] |
</phase_requirements>

## Summary

Phase 20 should be planned as a narrow refactor of `packages/relay/src/relay.ts` plus explicit compatibility work in relay, loaders, Concord, Vertex, docs, requirements/provenance, and changesets. The current `event(event, verb)` already contains the correct Phase 18 transport mechanics: `waitForReady`, an unshared `defer`, matching listener installation before `socket.next`, fixed `eventTimeout`, and normalized `PublishResponse`. Extract that body into a private helper such as `exchangeEventFrame(event, verb)`; make public `event(event)` apply only EVENT auth-required translation and make `auth(event)` invoke the helper with fixed AUTH routing. [VERIFIED: codebase inspection of `packages/relay/src/relay.ts:1262-1344`]

Implement `authenticate()` as one eagerly-started Promise operation with a single absolute deadline. It must subscribe to `watchTower` while waiting for a non-null challenge, snapshot/sign/compare, loop only on a changed or cleared challenge, and call `auth()` only after freshness and abort checks. Recommended exported errors are `RelayAuthChallengeTimeoutError` and `RelayAuthChallengeChangedError`; both should have pinned `.name` values and appear in both duck-typed classifier sets. A separate generic outer `RelayAuthenticateTimeoutError` would blur the locked dedicated acquisition-timeout contract; use the challenge-timeout class when the deadline expires before a candidate reaches `auth()`, while the existing low-level `RelayEventTimeoutError` remains the fixed written-frame reply failure. [VERIFIED: `20-CONTEXT.md`; naming is planner discretion]

The largest hidden correctness risk is concurrent bookkeeping. `auth()` already protects `authentications$[pubkey]` by event id, but always writes `authenticationResponse$`; an older response can therefore overwrite the deprecated latest-attempt mirror. Guard both response mirrors by latest-attempt identity. Candidate signing and freshness checks belong above `auth()`, so discarded/aborted candidates never mutate either subject. [VERIFIED: `packages/relay/src/relay.ts:1306-1344`]

**Primary recommendation:** Extract one private raw EVENT/AUTH exchange first, then build `authenticate()` as a single deadline/abort-aware snapshot loop above fixed `auth()`, and finish with classifier, compatibility, provenance, changeset, and real-wire parity gates.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WebSocket frame/listener exchange | API / Backend (`applesauce-relay`) | — | Relay owns socket readiness, write ordering, matching OK, close, and fixed reply timeout. [VERIFIED: codebase] |
| Challenge/sign/freshness policy | API / Backend (`Relay.authenticate`) | External signer | Relay owns challenge lifecycle; signer only signs the supplied template. [VERIFIED: codebase and NIP-42] |
| Authentication state mirrors | API / Backend (`Relay.auth`) | — | Only a genuine queued AUTH attempt may update connection auth state. [VERIFIED: `20-CONTEXT.md`] |
| Auth failure classification | API / Backend (relay group + loaders) | — | Both boundaries currently duck-type exact error names. [VERIFIED: codebase] |
| Consumer compatibility | API / Backend (Concord/Vertex) | — | Consumers call the signer-first Promise surface structurally and need compile/runtime checks. [VERIFIED: codebase] |

## Project Constraints (from AGENTS.md)

- Documentation belongs in the relevant existing document, with focused integration and best-practice guidance; do not create a standalone best-practices document. [VERIFIED: `AGENTS.md`]
- Documentation code blocks must remain short and focused (about 20 lines maximum), avoid duplicate explanations, and do not add a redundant summary section. [VERIFIED: `AGENTS.md`]
- Verify code examples and actual examples, update VitePress navigation only if a new page is introduced, and leave no duplicate/orphaned files. [VERIFIED: `AGENTS.md`]
- Every changeset describes exactly one change and its body is one Markdown sentence; use the smallest applicable bump. The locked decision requires a focused relay major changeset for the public selector removal. [VERIFIED: `AGENTS.md`, `20-CONTEXT.md`]
- The new-NIP helper/cast/operation/factory checklist does not apply: this phase changes existing NIP-42 relay behavior and introduces no new NIP support. [VERIFIED: phase boundary]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| RxJS | workspace `^7.8.1`; registry current `7.8.2` (modified 2026-08-04) | `defer`, `filter`, `take`, `timeout`, teardown, Promise conversion | Already owns Relay transport and state composition; no dependency change is needed. [VERIFIED: npm registry, package manifest] |
| `nostr-tools/nip42` | workspace dependency through `applesauce-core` | `makeAuthEvent(url, challenge)` | Existing canonical AUTH template builder; do not replace it. [VERIFIED: `packages/relay/src/relay.ts`] |
| Vitest + vitest-websocket-mock | `4.0.15` + `0.5.0` | fake timers, real-wire protocol assertions, compile/runtime regression support | Existing relay test infrastructure. [VERIFIED: `packages/relay/package.json`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| DOM `AbortSignal` / `DOMException` | Node 22 runtime / TypeScript DOM types | Abort reason and standard `AbortError` fallback | Outer authenticate lifecycle only. [VERIFIED: environment and workspace precedent] |
| Existing `truncateForLog` and `authLog` | repository-local | Redacted structured lifecycle diagnostics | Every challenge/result lifecycle log. [VERIFIED: `packages/relay/src/relay.ts`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One absolute deadline (`Date` or computed remaining time) | Reapply relative `timeout(number)` per stage | Reapplying resets the clock and violates D-06. [CITED: https://rxjs.dev/api/operators/TimeoutConfig] |
| Existing RxJS transport seam | Bespoke Promise/WebSocket listener code | Duplicates close/readiness/listener ordering and risks Phase 18 regressions. [VERIFIED: codebase] |

**Installation:** None. This phase must not add external packages. [VERIFIED: phase design]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `rxjs` | npm | since 2012 | 104M/week at audit | github.com/ReactiveX/rxjs | OK | Existing dependency; approved, no install |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
authenticate(signer, options)
  -> start one Promise operation + absolute deadline/abort race
  -> subscribe watchTower and await first non-null challenge
  -> snapshot -> makeAuthEvent -> signer.signEvent
  -> aborted? reject; current challenge differs/null?
       yes -> consume freshness retry -> reacquire/re-sign (or typed exhaustion)
       no  -> auth(signedEvent)
                -> record genuine queued attempt
                -> private rawExchange("AUTH", event)
                     -> waitForReady -> listen -> write one AUTH -> matching OK/timeout/close
                -> identity-guarded keyed + deprecated mirror update
                -> PublishResponse value (OK true or false)

event(event) -> private rawExchange("EVENT", event)
             -> EVENT-only auth-required translation -> AuthRequiredError
```

### Recommended Project Structure

```text
packages/relay/src/
├── relay.ts                         # private exchange, errors, auth/authenticate
├── types.ts                         # RelayAuthenticateOptions
└── __tests__/
    ├── relay.test.ts                # wire, deadline, freshness, concurrency
    ├── auth-lifecycle-logging.test.ts
    ├── group.test.ts                # real-error classifier parity
    └── event-auth-types.test-d.ts   # compile-time selector rejection (or existing type-test home)
packages/loaders/src/loaders/
├── sync-loader.ts                   # mirrored names
└── __tests__/sync-loader.test.ts    # actual relay error instances
```

### Pattern 1: Private Raw Exchange, Public Fixed Routing

**What:** Move the current inner `waitForReady(defer(...))` into a private verb-parameterized method. Keep EVENT-only policy in `event()` and AUTH bookkeeping/logging in `auth()`. [VERIFIED: Phase 18 implementation]

**When to use:** Both fixed public family members.

```ts
// Source: existing Relay.event transport pattern
private exchangeEventFrame(event: NostrEvent, verb: "EVENT" | "AUTH") {
  return this.waitForReady(defer(() => {
    const reply = this.socket.pipe(/* matching OK + fixed timeout */);
    const write = defer(() => {
      this.socket.next([verb, event]);
      return reply;
    });
    return merge(this.watchTower, write).pipe(/* close with reply */);
  }));
}
```

### Pattern 2: One Operation Deadline, Not Stage Timers

**What:** Capture `deadline = Date.now() + timeout` once. Every wait/sign/retry observes the same abort/deadline guard; do not construct a fresh duration at each loop iteration. RxJS `timeout({first: Date})` directly expresses an absolute deadline. [CITED: https://rxjs.dev/api/operators/TimeoutConfig]

**When to use:** The outer high-level authenticate operation only. Low-level `auth()` retains `eventTimeout` independently.

### Pattern 3: Abortable Promise Adoption

**What:** The signer Promise cannot necessarily be cancelled, so race/adopt its result under an abort/deadline guard, remove the signal listener in teardown/finally, and re-check `signal.aborted` immediately before `auth()`. A late signer resolution becomes inert. [VERIFIED: locked D-08; workspace AbortSignal precedents]

**When to use:** Challenge wait, signer latency, freshness loop, and pre-send boundary.

### Anti-Patterns to Avoid

- **Synchronous `throw` before returning the Promise:** breaks `.catch()` parity. Start with an async function invocation or a single Promise conversion. [VERIFIED: current defect at `relay.ts:1435`]
- **`challenge$.pipe(filter(Boolean))` without `watchTower`:** `challenge$` is passive; waiting alone does not activate the socket. Merge/hold `watchTower`. [VERIFIED: constructor comments and current challenge tests]
- **Calling `auth()` before freshness comparison:** mutates bookkeeping even when no wire attempt should exist. [VERIFIED: D-15]
- **Resetting timeout inside retries:** permits total duration to exceed caller timeout. [CITED: RxJS timeout semantics]
- **Sharing raw exchange attempts:** public `event()` Observables must remain cold/unshared across subscriptions. [VERIFIED: Phase 18 verification]
- **Using `instanceof` in production loader classification:** loaders intentionally avoid a relay dependency; keep `.name` duck typing. [VERIFIED: sync-loader comments]
- **Updating only keyed state:** also identity-guard `authenticationResponse$` (and keep `authentication$` representing the newest genuine attempt). [VERIFIED: current concurrency gap]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AUTH event format/signing template | Manual kind/tags/timestamp assembly | `makeAuthEvent` + caller signer | Prevents protocol drift. [VERIFIED: NIP-42] |
| WebSocket reply correlation | Separate AUTH listener subsystem | Extract existing EVENT raw exchange | Existing code already handles matching ids, sync replies, close, and fixed timeout. [VERIFIED: Phase 18] |
| Timeout scheduler | Multiple `setTimeout` calls | RxJS absolute timeout or one outer timer with cleanup | One operation deadline and deterministic fake-time testing. [CITED: RxJS docs] |
| Error detection across packages | Message substring or new dependency | Pinned `.name` sets + parity tests | Preserves package boundary and avoids false classification. [VERIFIED: codebase] |

**Key insight:** the freshness loop is policy; the wire interaction is already solved. Keep those layers separate so retries cannot accidentally multiply writes or state updates.

## Common Pitfalls

### Pitfall 1: Challenge Wait Does Not Connect
**What goes wrong:** A fresh `authenticate()` hangs until some unrelated operation activates the relay.  
**Why it happens:** `challenge$` is explicitly passive.  
**How to avoid:** hold `watchTower` during challenge acquisition; retain the raw helper's final readiness gate.  
**Warning signs:** test passes only after creating a REQ subscription. [VERIFIED: codebase]

### Pitfall 2: Retry Budget Counts Emissions Instead of Changes
**What goes wrong:** duplicate same-challenge messages exhaust retries.  
**Why it happens:** retry counter increments on every `challenge$` emission.  
**How to avoid:** compare the post-sign current value to the signed snapshot; increment only when null/different.  
**Warning signs:** same-challenge repetition produces a second signature. [VERIFIED: D-03]

### Pitfall 3: Deadline Stops at `auth()` Boundary
**What goes wrong:** sign time plus AUTH reply exceeds the caller deadline because `auth()` only has its own fixed reply clock.  
**How to avoid:** outer timeout must race the entire Promise including `auth()`; low-level timeout remains an additional fixed bound.  
**Warning signs:** a test advances nearly the full budget during signing and still gets a full new budget for OK. [VERIFIED: D-06]

### Pitfall 4: Late Work Escapes Abort
**What goes wrong:** signer resolves after abort and sends AUTH or writes state.  
**How to avoid:** listener teardown plus abort check after every await and immediately before `auth()`.  
**Warning signs:** wire receives AUTH after rejected abort Promise. [VERIFIED: D-08]

### Pitfall 5: Classifier Drift Is Silent
**What goes wrong:** new terminal error triggers loader fallback or generic group diagnostics.  
**How to avoid:** update both sets and import real relay error instances in parity tests; retain a non-auth negative control.  
**Warning signs:** tests fabricate `Error` objects by manually assigning `.name`. [VERIFIED: existing loader test weakness]

## Code Examples

### Absolute Deadline and Abort Error

```ts
// Source: RxJS TimeoutConfig + repository AbortError convention
const deadline = timeout === false ? null : new Date(Date.now() + timeout);
const abortReason = (signal?: AbortSignal) =>
  signal?.reason ?? new DOMException("Aborted", "AbortError");
```

### Freshness Loop Invariant

```ts
// Source: locked D-02..D-04
const challenge = await acquireChallenge();
const event = await signer.signEvent(makeAuthEvent(this.url, challenge));
throwIfAborted();
if (this.challenge !== challenge) {
  if (changes++ >= challengeRetries) throw new RelayAuthChallengeChangedError(this.url);
  continue;
}
return await this.auth(event);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Public `event(event, "AUTH")` selector | Fixed `event()` and `auth()` over a private verb helper | Phase 20 / v7 | Prevents public AUTH bookkeeping bypass. [VERIFIED: locked decision] |
| Synchronous challenge read | Active bounded acquisition | Phase 20 | Fresh-relay callers no longer throw synchronously. [VERIFIED: locked decision] |
| One sign against mutable state | Snapshot/sign/compare with bounded freshness retry | Phase 20 | Slow signers cannot send known-stale AUTH. [VERIFIED: NIP-42 validity rule] |

**Deprecated/outdated:** Phase 18 wording that `auth()` calls public `event(event, "AUTH")`; amend ROADMAP/AUTHF-04 and Phase 18 provenance in this phase. [VERIFIED: D-18/D-19]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Error names should be `RelayAuthChallengeTimeoutError` and `RelayAuthChallengeChangedError`. | Summary | Low; names are discretionary, but every mirror/test/doc must use the chosen names consistently. |

## Open Questions (RESOLVED)

1. **Default outer authenticate timeout value**
   - What we know: D-05 adds `timeout?: number | false`; D-06 defines semantics but not the numeric default. [VERIFIED: context]
   - Resolution: default to the existing `publishTimeout` value (30s), captured once as the whole-operation deadline and tested explicitly; do not add a second timeout property. [RESOLVED: 2026-08-31 planning]

2. **Type-test location**
   - What we know: package build excludes current runtime tests, and Phase 18 verification found an extra argument survived in a test. [VERIFIED: Phase 18 verification]
   - Resolution: create `packages/relay/type-tests/event-auth-types.ts` plus `packages/relay/tsconfig.type-tests.json`, and verify it with `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit`; runtime Vitest files remain non-authoritative for extra-argument rejection. [RESOLVED: 2026-08-31 planning]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/tests | ✓ | 22.23.1 | — |
| pnpm | workspace commands | ✓ | 11.10.0 | — |
| RxJS | implementation | ✓ | workspace ^7.8.1 | — |
| Vitest | tests | ✓ | 4.0.15 | — |

**Missing dependencies with no fallback:** none  
**Missing dependencies with fallback:** none

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.15 + vitest-websocket-mock 0.5.0 |
| Config file | root/workspace Vitest configuration already used by package scripts |
| Quick run command | `pnpm --filter applesauce-relay test -- relay.test.ts auth-lifecycle-logging.test.ts group.test.ts` |
| Full suite command | `pnpm --filter applesauce-relay test && pnpm --filter applesauce-relay build && pnpm --filter applesauce-loaders test && pnpm --filter applesauce-loaders build && pnpm --filter applesauce-concord build && pnpm --filter applesauce-extra build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTHF-01 | fresh connect waits; no challenge times out | real-wire/fake-time | relay focused test command | ✅ extend `relay.test.ts` |
| AUTHF-02 | null/different retries, same repeat ignored, exact exhaustion | real-wire/fake signer | relay focused test command | ✅ extend `relay.test.ts` |
| AUTHF-03 | all failures reject; abort/late signer; multi-await | unit + real-wire | relay focused test command | ✅ extend `relay.test.ts` |
| AUTHF-04 | fixed verbs, sync reply, close/timeout/resubscription parity | real-wire + type | relay test + relay build/type fixture | ❌ Wave 0 compile guard likely needed |
| AUTHF-05 | actual new error instances classify in loader/group | cross-package unit | loader + group focused tests | ✅ extend existing files |

### Sampling Rate
- **Per task commit:** package-focused test/build for files changed.
- **Per wave merge:** full suite command above.
- **Phase gate:** full relay/loaders tests and relay/loaders/Concord/extra builds green before `$gsd-verify-work`.

### Wave 0 Gaps
- [ ] Compile-time fixture proving `relay.event(event, "AUTH")` fails.
- [ ] Reusable deferred signer helper for changed/null/same challenge and late resolution.
- [ ] Actual relay-error imports in loader parity tests (loader may need a test-only workspace devDependency or a cross-package root test harness; do not add a production dependency).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | NIP-42 signed kind-22242 challenge event; challenge snapshot must match current connection challenge. [CITED: NIP-42] |
| V3 Session Management | yes | Clear challenge/auth state on disconnect and reject stale candidates. [VERIFIED: codebase and NIP-42] |
| V4 Access Control | no | Relay returns the authorization verdict; client records but does not decide access. [VERIFIED: protocol boundary] |
| V5 Input Validation | yes | Match OK by exact event id; treat relay challenge as opaque and redact logs. [VERIFIED: codebase] |
| V6 Cryptography | yes | Use `makeAuthEvent` and supplied signer; never implement signing. [VERIFIED: codebase] |

### Known Threat Patterns for NIP-42 Relay Authentication

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replay/stale challenge after relay rotates it | Spoofing | Compare signed snapshot to current challenge immediately before write; bounded re-sign. [CITED: NIP-42] |
| Auth state updated without wire attempt | Tampering | Keep all bookkeeping inside fixed low-level `auth()`. [VERIFIED: D-15] |
| Sensitive challenge/event leakage in logs | Information Disclosure | Existing truncation/redaction helper; never log signed event or key material. [VERIFIED: D-17] |
| Hung signer or relay challenge wait | Denial of Service | One non-suspending outer deadline plus abort teardown and fixed reply timeout. [VERIFIED: D-06/D-08] |
| Older response overwrites newer same-pubkey state | Tampering | Identity-check keyed and deprecated mirrors before response update. [VERIFIED: codebase gap]

## Sources

### Primary (HIGH confidence)
- Repository source and tests: `packages/relay/src/relay.ts`, `types.ts`, `group.ts`, relay tests.
- Cross-package consumers/classifiers: loaders sync-loader, Concord auth, Vertex.
- Phase 20 context, requirements, roadmap, Phase 18 context/verification.

### Secondary (MEDIUM confidence)
- https://github.com/nostr-protocol/nips/blob/master/42.md — official NIP-42 challenge validity, AUTH frames, and OK replies.
- https://rxjs.dev/api/index/function/defer — per-subscription factory semantics.
- https://rxjs.dev/api/index/function/firstValueFrom — Promise rejection/termination semantics.
- https://rxjs.dev/api/operators/TimeoutConfig — absolute `Date` deadline semantics.

### Tertiary (LOW confidence)
- None beyond the explicitly logged default-timeout recommendation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing workspace dependencies and registry checked.
- Architecture: HIGH — constrained by locked decisions and traced through current source.
- Pitfalls: HIGH — derived from current code, Phase 18 verification, and mandated regression cases.

**Research date:** 2026-08-31  
**Valid until:** 2026-09-30
