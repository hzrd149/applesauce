# Phase 19: COUNT Becomes the High-Level Member - Research

**Researched:** 2026-08-21
**Domain:** RxJS COUNT policy, NIP-45 response validation, and fixed-register HyperLogLog utilities
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Public count Contract
- Preserve `Observable<RelayCountResponse>` for Relay, RelayGroup, and RelayPool. A relay count emits one validated response and completes; timeout, refusal, malformed reply, and other failures use the Observable error channel.
- Preserve the established `(filters, id?, opts?)` signatures and caller-controlled request ID.
- Add auth options plus `reconnect`, `retries`, and configurable `timeout` to `RelayCountOptions`. Retain the intentional 10-second COUNT timeout default and suspend the operation clock during active auth.
- Preserve RelayGroup/RelayPool Observable APIs and forward the widened options directly. Phase 23 replaces `combineLatest` with progressive per-relay isolation without another return-type change.
- Correct ROADMAP's derived “rejected promise” wording to “observable error,” recording that canonical COUNT-01 requires failure as an error and the user explicitly preserved the existing Observable API.

### NIP-45 Response Validation
- Require `count` to be a finite, non-negative safe integer. Reject missing, fractional, negative, non-finite, string-coerced, or unsafe values with a typed `RelayCountResponseError`.
- Accept `approximate` only when absent or boolean; preserve it exactly and infer no coupling with `hll`.
- Accept `hll` only as a 512-character hexadecimal string representing 256 one-byte registers. Accept either hex case and normalize to lowercase.
- Preserve forward-compatible unknown own enumerable response fields. Model the response with typed known fields plus a string index compatible with `Record<string, unknown>`.
- Require a non-null, non-array object; copy own enumerable entries into a fresh object with data-property-safe construction so a `__proto__` key cannot mutate the result prototype. Validate and overwrite normalized known fields. Malformed known required or optional fields error before any value is emitted.

### NIP-45 HLL Utilities
- Export `mergeHllRegisters(values: Iterable<string>): string`, requiring at least one input and performing register-wise maximum across any number of validated 256-register HLL values.
- Export a separate `estimateHllCardinality(hll: string): number` helper now so the correct merged union total is directly usable while merge and estimation remain independently testable.
- Reuse the exact response HLL validator, normalize output lowercase, reject malformed inputs, and never mutate caller input.
- Prove merge with hand-authored register arrays where different inputs win different positions. Prove estimation against separately calculated harmonic-mean fixtures, including any required empty/small-range correction, rather than comparing the implementation with itself.

### Cross-Family Policy Invariants
- Family boundaries: `event()`/`req()` are low-level interactions wrapped by `publish()`/`request()`/`subscription()`; COUNT intentionally has only the high-level `count()` member.
- Preserve one shared COUNT operation per returned Observable and the same shared transport readiness precondition as EVENT/REQ. Each auth or retry resend creates a fresh unshared COUNT send/listen attempt.
- Since COUNT is high-level-only, it owns one configurable whole-operation clock with no duplicated inner/outer clock. The clock includes readiness/backoff, suspends during active auth, and defaults to 10 seconds.
- Keep auth and generic retry counters distinct, call-scoped, and additive. Per D-01, only eligible reconnectable unclean transport failures may enter generic retry policy while time remains; whole-request deadline expiry is terminal.
- Emit only validated COUNT responses. Completion/close without a COUNT reply, malformed response, relay refusal or typed CLOSED, terminal auth errors, and arbitrary/programming errors are terminal Observable errors.
- Preserve established boolean/number retry defaults. Test custom timeout, reconnect, real retry resend, no-retry terminal/arbitrary errors, independent concurrent calls, synchronous auth reentrancy, auth-clock suspension, sharing, forward-compatible fields, and HLL utilities with mutation/non-vacuity probes.
- Update docs and a focused single-change changeset. Leave Phase 23 an explicit contract to consume progressive per-relay Observables and never sum overlapping relay counts.

### the agent's Discretion
- Choose helper module placement and typed error subclass details consistent with existing relay exports.
- Choose the standard NIP-45/HLL estimator implementation details as long as the independent fixtures establish correctness.

### Deferred Ideas (OUT OF SCOPE)
- Progressive, failure-isolated group count records and cross-relay aggregation policy remain Phase 23 scope.
- A separate Promise convenience API is not needed for this phase; callers can continue using `firstValueFrom`/`lastValueFrom` when desired.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COUNT-01 | `count()` is the high-level family member with `reconnect`, `retries`, configurable `timeout`, and error-channel failures. | The current call graph, fresh-attempt seam, call-scoped auth counter requirement, retry classifier, D-01 whole-request deadline, and Group/Pool forwarding are mapped below. [VERIFIED: codebase, locked context, and D-01] |
| COUNT-02 | `RelayCountResponse` carries validated `count`, `approximate?`, and `hll?` instead of an unchecked cast. | The exact NIP-45 wire shape, validation matrix, safe-copy pattern, error class, unknown-field preservation, and boundary tests are specified below. [VERIFIED: codebase] [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |
| COUNT-03 | A register-wise maximum merge over NIP-45's 256-register HLL payload ships. | The public helper placement, shared HLL normalizer, merge loop, original-HLL estimator, and independent fixture constants are specified below. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] [CITED: https://research.google.com/pubs/archive/40671.pdf] |
</phase_requirements>

## Summary

Phase 19 should evolve the existing `Relay.count()` pipeline in place. The current method already has the hard parts that must survive: caller-controlled ids, shared readiness, a fresh unshared `defer` per auth attempt, a call-scoped `AuthPhaseGate`, synchronous auth-resend coverage, `take(1)`, and one final `share()`. The missing work is boundary validation, typed failure classes, generic transient retry/reconnect policy, a configurable 10-second default clock, and pure NIP-45 HLL utilities. `RelayGroup.count()` and `RelayPool.count()` already derive and forward the Relay signature structurally, so this phase should test their forwarding but must not replace `combineLatest`; that belongs to Phase 23. [VERIFIED: `packages/relay/src/relay.ts`, `group.ts`, `pool.ts`, and tests]

NIP-45 requires an integer count, permits an optional boolean `approximate`, and encodes HLL as 256 concatenated uint8 registers, hence exactly 512 hexadecimal characters; multi-relay sketches merge by taking the maximum at each register. The specification deliberately does not prescribe one client estimator. Use the original HLL raw harmonic-mean estimate for `m = 256`, with linear counting when the raw estimate is at most `2.5m` and zero registers remain. This is small, dependency-free, independently testable, and directly matches the representation NIP-45 standardizes. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] [CITED: https://research.google.com/pubs/archive/40671.pdf]

The initial clock/retry collision is resolved by post-research decision D-01: the single suspendable whole-request deadline sits outside the retry loop, includes readiness and backoff, never resets, and terminates COUNT when it expires. Generic retry observes only eligible reconnectable transport failures that occur before that deadline. [VERIFIED: D-01 and operator-order analysis against current pipeline] [CITED: https://rxjs.dev/api/index/function/retry] [CITED: https://rxjs.dev/api/operators/timeout]

**Primary recommendation:** Preserve the current COUNT attempt factory and outer `share()`, add a prototype-safe response parser plus typed COUNT errors, add pure `nip45.ts` merge/estimate helpers, and implement D-01 with the suspendable whole-request deadline outside reconnect retry. [VERIFIED: codebase, locked context, and D-01]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| COUNT wire send/listen, matching id, CLOSE cleanup | API / Backend (`Relay.count`) | WebSocket transport | `Relay` owns connection readiness and matching COUNT/CLOSED frames. [VERIFIED: codebase] |
| Auth handling, reconnect/retry, operation timeout, sharing | API / Backend (`Relay.count`) | RxJS operators | COUNT has no low-level sibling, so the one public Observable owns policy while keeping each wire attempt fresh. [VERIFIED: locked context] |
| COUNT response parsing and typed timeout | API / Backend (`relay.ts`) | Public type surface (`types.ts`) | Untrusted relay data must be validated before becoming a `RelayCountResponse`; the operation boundary owns timeout failure. [VERIFIED: locked context] |
| HLL normalization, response error, merge, and estimate | Pure protocol utility (`nip45.ts`) | Relay response parser | The utility is transport-independent, owns the shared validator/error without importing `relay.ts`, and is consumed by the wire parser. [VERIFIED: locked context and dependency-direction analysis] |
| Per-relay count record | API / Backend (`RelayGroup.count`) | `Relay.count` | Group retains current `combineLatest` aggregation in Phase 19 and only forwards the widened options/response. [VERIFIED: codebase and deferred scope] |
| Pool count routing | API / Backend (`RelayPool.count`) | `RelayGroup.count` | Pool derives Group's option type and delegates unchanged. [VERIFIED: codebase] |
| User guidance | Existing VitePress relay docs | Package API exports | Existing Relay and Pool pages should explain validated fields, policy options, HLL integration, and the no-summing rule. [VERIFIED: `apps/docs/loading/relays/`] |

## Standard Stack

### Core

| Library / Asset | Version | Purpose | Why Standard |
|-----------------|---------|---------|--------------|
| `rxjs` | manifest `^7.8.1`; installed `7.8.2`; published 2025-02-22 | `Observable`, `defer`, `retry`, error routing, `take`, and `share` | Existing relay execution model; `defer` creates a factory result per subscription and `retry` resubscribes only after errors. [VERIFIED: npm registry] [CITED: https://rxjs.dev/api/index/function/defer] [CITED: https://rxjs.dev/api/index/function/retry] |
| TypeScript | installed `7.0.2` | Public option/response/error declarations | Existing package compiler and declaration gate. [VERIFIED: codebase and local environment] |
| NIP-45 | current official draft | COUNT response and HLL interoperability contract | It is the authoritative source for the three response fields, 256-register encoding, and max merge. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |

### Supporting

| Library / Asset | Version | Purpose | When to Use |
|-----------------|---------|---------|-------------|
| Existing `authRetry` / `AuthPhaseGate` / `suspendableTimeout` | repository source | Auth resend, call-scoped clock suspension, and progress semantics | Reuse unchanged except for threading an explicit call-scoped COUNT auth counter. [VERIFIED: codebase] |
| `vitest` | manifest `^4.0.15`; installed `4.1.10`; published 2026-07-06 | Unit, mutation, and export tests | Existing test runner; do not upgrade in this phase. [VERIFIED: codebase and npm registry lookup] |
| `vitest-websocket-mock` | manifest/installed `0.5.0`; published 2025-03-25 | Real COUNT/CLOSED frame traces | Use for resend, sharing, timeout, auth reentrancy, and malformed wire replies. [VERIFIED: codebase and npm registry lookup] |
| `@hirez_io/observer-spy` | installed `2.2.0`; published 2022-02-28 | Observable value/error/completion assertions | Reuse the package's current `subscribeSpyTo` test style. [VERIFIED: codebase and npm registry lookup] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Root `nip45.ts` pure utility | Put merge/estimate inside `relay.ts` | Rejected: couples transport code to reusable math and makes independent fixtures harder to isolate. [VERIFIED: project structure and locked helper requirement] |
| Focused boundary parser | Add a schema-validation package | Rejected: the shape is three known fields plus preserved unknown fields; a dependency adds install/supply-chain surface without solving the custom forward-compatible copy rule. [VERIFIED: locked response contract] |
| Original HLL plus linear counting | Full HLL++ bias tables or an arbitrary generic HLL package | Rejected for this phase: NIP-45 fixes the register wire format but not estimator quirks, and generic packages need not accept this representation. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] [CITED: https://research.google.com/pubs/archive/40671.pdf] |
| Preserve Observable | Convert COUNT to Promise | Out of scope and explicitly rejected by the user; `firstValueFrom`/`lastValueFrom` remain available to callers. [VERIFIED: locked context] |

**Installation:** None. This phase uses only existing dependencies and platform APIs. [VERIFIED: package manifests and phase scope]

## Package Legitimacy Audit

> This phase installs no package. The gate was still run against the existing test/runtime packages because the phase explicitly requested an audit. [VERIFIED: package manifest and package-legitimacy seam]

| Package | Registry | Age / Release | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|---------------|-----------|-------------|---------|-------------|
| `rxjs` | npm | latest `7.8.2`, published 2025-02-22 | ~86.0M/week | `github.com/reactivex/rxjs` | OK | Existing approved dependency; no install. [VERIFIED: npm registry] |
| `vitest` | npm | latest `4.1.11` published 2026-08-18; installed `4.1.10` published 2026-07-06 | ~77.7M/week | `github.com/vitest-dev/vitest` | SUS (`too-new` latest release) | Existing dev dependency only; do not upgrade. No checkpoint is needed unless a plan adds an install/upgrade task. [VERIFIED: codebase and package-legitimacy seam] |
| `vitest-websocket-mock` | npm | latest `0.7.0` published 2026-07-11; installed `0.5.0` published 2025-03-25 | ~77K/week | `github.com/akiomik/vitest-websocket-mock` | OK | Existing dev dependency; no install. [VERIFIED: codebase and package-legitimacy seam] |
| `@hirez_io/observer-spy` | npm | `2.2.0`, published 2022-02-28 | ~98K/week | `github.com/hirezio/observer-spy` | OK | Existing dev dependency; no install. [VERIFIED: codebase and package-legitimacy seam] |

All four report no `postinstall` script. [VERIFIED: registry metadata lookup]

**Packages removed due to [SLOP] verdict:** none. [VERIFIED: package-legitimacy seam]

**Packages flagged as suspicious [SUS]:** `vitest` latest only; Phase 19 must not upgrade it, so no install checkpoint is required. [VERIFIED: package-legitimacy seam]

## Architecture Patterns

### System Architecture Diagram

```text
caller -> Relay.count(filters, id, opts) -> call-scoped gate + auth/transient counters
  -> shared readiness precondition
  -> fresh unshared attempt
       -> install COUNT/CLOSED listener -> send COUNT -> validate response
       -> COUNT valid -------------------------------> one response
       -> auth-required -> auth phase -> fresh resend
       -> transient transport error -> retry/backoff -> fresh resend
       -> malformed/refusal/terminal error ----------> Observable error
  -> one configurable suspendable operation clock
  -> final share -> all subscribers observe one upstream operation

validated hll -> nip45 normalizer -> merge register-wise max -> estimate cardinality
RelayGroup.count -> unchanged combineLatest record (Phase 23 replaces this)
RelayPool.count  -> unchanged delegation to RelayGroup
```

The timeout-to-retry arrow is deliberately unresolved until the clock/retry checkpoint chooses semantics; ordinary RxJS ordering cannot satisfy both locked statements. [VERIFIED: operator-order analysis]

### Recommended Project Structure

```text
packages/relay/src/
├── relay.ts                         # COUNT policy, parser, timeout error
├── types.ts                         # RelayCountOptions/RelayCountResponse
├── nip45.ts                         # response error + HLL normalize/merge/estimate
├── index.ts                         # public helpers and errors
└── __tests__/
    ├── relay.test.ts                # wire, policy, response validation
    ├── nip45.test.ts                # independent HLL fixtures
    ├── group.test.ts                # option/response forwarding only
    ├── pool.test.ts                 # extra-hop forwarding only
    └── exports.test.ts              # public runtime exports
```

Existing docs stay in `apps/docs/loading/relays/relays.md` and `pool.md`; do not create a standalone COUNT best-practices file. [VERIFIED: AGENTS.md and existing docs]

### Pattern 1: Preserve the Fresh-Attempt / Shared-Operation Boundary

**What:** Keep the current per-attempt `defer` around both listener construction and the COUNT send, and keep exactly one `share()` outside all auth/retry policy. [VERIFIED: current CR-03 implementation and locked context]

**When to use:** Every COUNT subscription, auth resend, and generic retry. [VERIFIED: locked context]

```typescript
const gate = new AuthPhaseGate();
const authCounter = { consecutive: 0 };

const operation = defer(() => createCountAttempt()).pipe(
  this.authRetryOperator(describeRequest, opts, gate, () => true, authCounter),
  take(1),
  throwIfEmpty(() => new RelayCountResponseError("COUNT completed without a response")),
);

return applyResolvedCountPolicy(operation, opts, gate).pipe(share());
```

The planner must replace `applyResolvedCountPolicy` with D-01's resolved ordering: reconnect retry inside one suspendable whole-request deadline. It is not a suggested new abstraction by itself. [VERIFIED: D-01]

### Pattern 2: Validate at the Socket Boundary and Preserve Unknown Fields Safely

**What:** Parse `m[2]` before it enters the typed Observable, require own known properties, copy only own enumerable string fields into a fresh normal object with data-property creation, then overwrite normalized known fields. [VERIFIED: locked context]

**When to use:** The `m[0] === "COUNT"` branch in `relay.ts`. [VERIFIED: codebase]

```typescript
function parseCountResponse(value: unknown): RelayCountResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("object");
  const raw = value as Record<string, unknown>;
  if (!Object.hasOwn(raw, "count") || !Number.isSafeInteger(raw.count) || (raw.count as number) < 0) fail("count");
  if (Object.hasOwn(raw, "approximate") && typeof raw.approximate !== "boolean") fail("approximate");
  if (Object.hasOwn(raw, "hll") && typeof raw.hll !== "string") fail("hll");
  const response = Object.fromEntries(Object.entries(raw)) as RelayCountResponse;
  response.count = raw.count as number;
  if (Object.hasOwn(raw, "hll")) response.hll = normalizeHll(raw.hll);
  return response;
}
```

`Object.fromEntries` creates own data properties, so a `"__proto__"` entry does not invoke the legacy prototype setter; the test must still prove the result has `Object.prototype`, owns `__proto__`, and has no inherited pollution. [VERIFIED: locked context]

### Pattern 3: Typed and Positive Retry Classification

**What:** Add `RelayCountTimeoutError` and `RelayCountResponseError`; parameterize the existing retry plumbing with a classifier or add an equally centralized classifier so only `RelayCountTimeoutError` and reconnectable unclean `CloseEvent` values can consume the generic retry budget. [VERIFIED: locked context and Phase 18 pattern]

**When to use:** Inside D-01's whole-request deadline. Timeout expiry, terminal auth subclasses, `RelayClosedError`, response errors, clean completion errors, and arbitrary errors must bypass retry. [VERIFIED: D-01 and locked context]

```typescript
function isRetryableCountError(error: unknown): boolean {
  return isReconnectableTransportError(error);
}

// Reuse retry config parsing/backoff; inject the family classifier.
this.customRetryOperator(
  opts?.retries ?? opts?.reconnect ?? true,
  DEFAULT_RETRY_CONFIG,
  isRetryableCountError,
);
```

Do not broaden `customConnectionRetryOperator`; it retries arbitrary non-`RelayClosedError` exceptions and would violate the positive whitelist. [VERIFIED: `relay.ts`]

Add `countTimeout?: number` to `RelayOptions`, a public `countTimeout = 10_000` instance default beside `eventTimeout`/`publishTimeout`, and constructor assignment when supplied. Resolve per-call `timeout` through the existing `customSuspendableTimeoutOperator` boolean/number semantics after the clock/retry decision. [VERIFIED: backlog 999.27, existing Relay option pattern, and locked 10-second default]

`RelayCountTimeoutError` should mirror `RelayEventTimeoutError` with the relay URL and a stable name/message; `RelayCountResponseError` should live in `nip45.ts` beside the shared normalizer so `relay.ts` imports the utility module in one direction and no `nip45.ts -> relay.ts -> nip45.ts` runtime cycle is introduced. [VERIFIED: existing error pattern and dependency-direction analysis]

### Pattern 4: One HLL Normalizer, Two Public Utilities

**What:** Parse exactly 256 byte pairs after a full-string hex check, return normalized lowercase, and reuse that routine in response parsing, merge, and estimation. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md]

```typescript
const HLL_HEX = /^[0-9a-fA-F]{512}$/;

function normalizeHll(value: unknown): string {
  if (typeof value !== "string" || !HLL_HEX.test(value)) {
    throw new RelayCountResponseError("hll must be 512 hexadecimal characters");
  }
  return value.toLowerCase();
}
```

Do not impose a smaller register-value ceiling: NIP-45 defines each register as a uint8, and the locked validator requires the encoding/length contract only. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] [VERIFIED: locked context]

### Pattern 5: Fixed-m Original HLL Estimator

**What:** For `m = 256`, compute `alpha = 0.7213 / (1 + 1.079 / m)`, raw estimate `alpha * m² / Σ2^-register`, and linear counting `m * ln(m / V)` when raw is at most `2.5m` and `V > 0`. [CITED: https://research.google.com/pubs/archive/40671.pdf]

```typescript
const M = 256;
const ALPHA = 0.7213 / (1 + 1.079 / M);

export function estimateHllCardinality(hll: string): number {
  const registers = decodeHll(normalizeHll(hll));
  const sum = registers.reduce((total, value) => total + 2 ** -value, 0);
  const raw = (ALPHA * M * M) / sum;
  const empty = registers.filter((value) => value === 0).length;
  return raw <= 2.5 * M && empty > 0 ? M * Math.log(M / empty) : raw;
}
```

Inference: omit the original paper's 32-bit large-range correction. That correction is tied to a fixed 32-bit hash space, while NIP-45 derives registers/ranks from a 32-byte pubkey at a deterministic offset and expressly leaves client estimator quirks open. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] [CITED: https://research.google.com/pubs/archive/40671.pdf]

### Pattern 6: Register-Wise Maximum Merge

**What:** Initialize the result from the first validated input, update each byte with `Math.max`, require at least one value, and encode a new lowercase string. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md]

```typescript
export function mergeHllRegisters(values: Iterable<string>): string {
  let merged: number[] | undefined;
  for (const value of values) {
    const current = decodeHll(normalizeHll(value));
    if (!merged) merged = current;
    else for (let i = 0; i < 256; i++) merged[i] = Math.max(merged[i], current[i]);
  }
  if (!merged) throw new RelayCountResponseError("at least one hll value is required");
  return encodeHll(merged);
}
```

Strings are immutable, but the test should freeze the iterable's backing array and compare it before/after so mutation/non-vacuity is explicit. [VERIFIED: locked test requirement]

### Anti-Patterns to Avoid

- **Unchecked `m[2] as RelayCountResponse`:** admits missing, coerced, unsafe, and malformed data as a typed value. Parse before emission. [VERIFIED: current `relay.ts`]
- **Field stripping:** returning only `{count, approximate, hll}` loses future protocol fields. Safe-copy unknown own enumerable fields first. [VERIFIED: locked context]
- **Object spread for adversarial keys without a dedicated probe:** even when the chosen language operation is safe, acceptance must explicitly prove `__proto__` stays an own data property and does not alter the result prototype. [VERIFIED: locked context]
- **Auth counter inside a retry-created closure:** outer retry would recreate the auth budget and turn the additive bound into a multiplicative one. Use one explicit call-scoped counter. [VERIFIED: Phase 18 implementation and D-07]
- **Attempt-level `share()`:** synchronous auth resend can rejoin a terminating listener and miss the reply. Keep only the final outer share. [VERIFIED: CR-03 tests]
- **`customConnectionRetryOperator` for COUNT:** it admits arbitrary non-`RelayClosedError` failures; COUNT requires a positive whitelist. [VERIFIED: codebase and locked context]
- **Summing relay counts:** overlapping relays double-count events. Merge HLL registers when sketches exist; leave group aggregation policy to Phase 23. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] [VERIFIED: deferred scope]
- **Using NIP example `count` as an exact estimator oracle:** NIP-45 permits estimator quirks and does not require `count` to equal a client's estimate from `hll`. Use formula-derived fixtures instead. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth phase orchestration | A COUNT-only handler/wait loop | Existing `authRetryOperator`, `AuthPhaseGate`, and explicit call-scoped counter | Preserves D-04/D-08/D-10..17 and synchronous reentrancy behavior. [VERIFIED: codebase and Phase 13 decisions] |
| Observable retry mechanics | Manual recursive subscribe/unsubscribe | RxJS `defer`, `retry`, and one final `share` after the clock decision | RxJS supplies teardown and resubscription semantics already used by the package. [CITED: https://rxjs.dev/api/index/function/defer] [CITED: https://rxjs.dev/api/index/function/retry] |
| New schema framework | Runtime dependency for three fields | Focused boundary parser plus shared HLL normalizer | Forward-compatible unknown-field preservation and `__proto__` handling are custom requirements anyway. [VERIFIED: locked context] |
| Generic multi-precision HLL | Configurable precision, hashing, sparse formats, bias tables | Fixed 256-register NIP-45 merge and original estimator | Phase input is already a dense fixed wire sketch; generic machinery adds unneeded behavior. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |
| Cross-relay total by addition | `sum(response.count)` | `estimateHllCardinality(mergeHllRegisters(hlls))` when compatible HLL values exist | Max merge represents set union; summing duplicated relay events is not a union. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |

**Key insight:** This phase is mostly boundary and policy composition. The only new algorithm is a fixed-size 256-register loop plus a published HLL formula; adding dependencies or parallel internal implementations would increase divergence risk. [VERIFIED: scope] [CITED: https://research.google.com/pubs/archive/40671.pdf]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — repository search found no database, cache, or persisted record containing the Relay COUNT response contract. [VERIFIED: `rg` across packages/apps/docs] | No data migration. |
| Live service config | None — COUNT operates against caller-supplied relay connections; no out-of-git dashboard/workflow/service configuration is referenced by the implementation. [VERIFIED: codebase] | No service migration. |
| OS-registered state | None — no task, service, process-manager, or OS registration contains the method/type names. [VERIFIED: repository search and phase scope] | None. |
| Secrets/env vars | None — `Relay.count`, COUNT options, and HLL utilities read no environment variable or secret key. [VERIFIED: codebase] | None. |
| Build artifacts | `packages/relay/dist/` is regenerated by `pnpm --filter applesauce-relay build`; no installed/global package or image tag embeds the old response shape. [VERIFIED: package scripts and local build] | Rebuild declarations; no artifact migration. |

The public Observable contract is preserved, so there is no runtime subscriber migration; external consumers gain optional fields and new error cases. [VERIFIED: locked context]

## Exact Validation and Error Matrix

| Input / outcome | Required result | Retry? |
|-----------------|-----------------|--------|
| `{count: 0}` or any finite non-negative safe integer | Emit fresh validated object once, then complete. [VERIFIED: locked context] | No |
| `approximate: true` or `false` | Preserve exact boolean, including `false`. [VERIFIED: locked context] | No |
| uppercase valid `hll` | Emit lowercase normalized `hll`. [VERIFIED: locked context] | No |
| unknown own enumerable field | Preserve unchanged as an own field. [VERIFIED: locked context] | No |
| `__proto__` own JSON field | Preserve as own data property without changing the output prototype. [VERIFIED: locked context] | No |
| null, array, missing/inherited `count` | `RelayCountResponseError`, zero values. [VERIFIED: locked context] | Never |
| negative, fractional, string, non-finite, or unsafe `count` | `RelayCountResponseError`, zero values. [VERIFIED: locked context] | Never |
| non-boolean present `approximate` | `RelayCountResponseError`, zero values. [VERIFIED: locked context] | Never |
| non-string, non-hex, or non-512-character `hll` | `RelayCountResponseError`, zero values. [VERIFIED: locked context] | Never |
| `CLOSED auth-required:` | Existing value signal consumed by auth operator; resend if auth budget remains, otherwise terminal auth subclass. [VERIFIED: D-01/D-03/D-17 and current code] | Auth branch only |
| Any other `CLOSED`, including unprefixed reason | Terminal `RelayClosedError`; no clean empty completion. [VERIFIED: locked context] | Never |
| Source completes/closes before COUNT | `RelayCountResponseError`; zero values. [VERIFIED: locked context and recommended error placement] | Never |
| Reconnectable unclean transport failure | Typed/structural transport error. [VERIFIED: Phase 18 classifier] | Yes, within generic budget |
| COUNT timeout | `RelayCountTimeoutError`. [VERIFIED: locked context] | Terminal whole-request deadline per D-01; never enters generic retry |
| Arbitrary/programming error | Same error identity reaches subscriber. [VERIFIED: locked context] | Never |

## Independent HLL Fixture Guidance

The estimator tests must hard-code expected numbers derived outside production helpers. For `m = 256`, `alpha = 0.7182725932495458` and the small-range threshold is `640`. [CITED: https://research.google.com/pubs/archive/40671.pdf]

| Registers | Independent calculation | Expected estimate |
|-----------|-------------------------|------------------|
| 256 × `0` | `V=256`; `256*ln(256/256)` | `0` |
| one `1`, 255 × `0` | `V=255`; `256*ln(256/255)` | `1.0019582262108966` |
| 128 × `1`, 128 × `0` | `V=128`; `256*ln(2)` | `177.445678223346` |
| 256 × `1` | `V=0`; raw `alpha*256²/128` | `367.7555677437675` |
| 256 × `2` | raw `alpha*256²/64`; above small-range threshold | `735.511135487535` |

Use `toBeCloseTo` for non-integer estimates and exact equality for the all-zero case. The `256 × 1` case proves the `V === 0` branch does not attempt `ln(m/0)`, while `256 × 2` proves the implementation does not apply linear counting above the threshold. [VERIFIED: independently calculated fixtures] [CITED: https://research.google.com/pubs/archive/40671.pdf]

For merge, hand-author three 256-byte arrays: left wins at one position, right wins at another, equal values remain unchanged, and a third input wins a third position. Encode expected bytes with a test-local trivial hex encoder, assert the full 512-character string, assert the winning positions separately for non-vacuity, freeze/compare the source array, and rerun with uppercase input to prove normalization. [VERIFIED: locked fixture requirements]

Malformed utility controls must cover empty iterable, 510/514-character strings, a non-hex character at the first/middle/last position, and a mixed valid/invalid iterable whose invalid later member throws rather than returning a partial merge. [VERIFIED: locked validation requirements]

## Common Pitfalls

### Pitfall 1: Timeout/Retry Operator Ordering Pretends to Satisfy Both Contracts

**What goes wrong:** `attempt -> timeout -> retry` resets the clock per attempt and excludes retry delay from the previous timer, while `attempt -> retry -> timeout` makes timeout terminal because `retry` is upstream and never sees it. [CITED: https://rxjs.dev/api/index/function/retry] [CITED: https://rxjs.dev/api/operators/timeout]

**Why it happens:** RxJS retries by resubscribing to its source after an upstream error; downstream errors do not flow backward into upstream operators. [CITED: https://rxjs.dev/api/index/function/retry]

**How to avoid:** Implement D-01 exactly: one suspendable whole-request deadline outside retry, with only reconnectable transport failures eligible for resend before expiry. [VERIFIED: D-01]

**Warning signs:** A test shows multiple fresh 10-second timers, retry delay does not consume the total budget, or a timeout test expects a resend that can occur only after the total deadline. [VERIFIED: operator-order analysis]

### Pitfall 2: Outer Retry Recreates the Auth Budget

**What goes wrong:** Auth retries reset inside each transient retry and total COUNT writes become multiplicative. [VERIFIED: Phase 18 reproduced behavior]

**Why it happens:** `authRetry` keeps local state per subscription unless given the explicit counter object. [VERIFIED: `operators/auth-retry.ts`]

**How to avoid:** Create `{consecutive: 0}` once in `count()` and pass it to `authRetryOperator`, outside the retry-resubscribed attempt. [VERIFIED: Phase 18 pattern]

**Warning signs:** A terminal auth error triggers another COUNT after generic retry delay, or concurrent calls affect each other's frame counts. [VERIFIED: D-07/RAUTH-05]

### Pitfall 3: Malformed COUNT Completes Empty

**What goes wrong:** A caller using `firstValueFrom` receives `EmptyError`, or a group `combineLatest` waits forever, rather than seeing the protocol failure. [VERIFIED: current clean-CLOSED behavior and group CR-03 test]

**Why it happens:** The current pipeline maps an unprefixed CLOSED to `null`, completes `messages`, and has no `throwIfEmpty`/typed no-response boundary. [VERIFIED: `relay.ts`]

**How to avoid:** Throw for every non-auth CLOSED and convert any remaining empty completion into a typed COUNT response/no-response error before sharing. [VERIFIED: locked context]

**Warning signs:** `receivedComplete() === true` with zero values or `combineLatest` never emits after one relay closes. [VERIFIED: existing tests]

### Pitfall 4: Forward-Compatible Copy Enables Prototype Mutation

**What goes wrong:** A naïve copy path treats `__proto__` as a setter and changes the response prototype. [VERIFIED: locked threat model]

**Why it happens:** Unknown fields are intentionally retained, including adversarial names. [VERIFIED: locked context]

**How to avoid:** Use a data-property creation operation, require own known fields with `Object.hasOwn`, and assert the prototype explicitly. [VERIFIED: locked context]

**Warning signs:** `response.polluted` resolves through the prototype, `Object.hasOwn(response, "__proto__")` is false, or inherited `count` is accepted. [VERIFIED: locked validation requirements]

### Pitfall 5: Estimator Tests Reimplement Production Logic

**What goes wrong:** The same wrong constant, threshold, or correction exists in both helper and test, so the suite stays green. [VERIFIED: locked non-vacuity requirement]

**Why it happens:** Generating expected values by calling a second local implementation feels independent but duplicates the defect. [VERIFIED: locked fixture guidance]

**How to avoid:** Hard-code the constants in the fixture table above and separately test raw and linear-counting branches. [CITED: https://research.google.com/pubs/archive/40671.pdf]

**Warning signs:** Test expected values are computed in a loop over registers or import any production HLL symbol. [VERIFIED: test-design analysis]

### Pitfall 6: Phase 19 Quietly Redesigns Group Aggregation

**What goes wrong:** Progressive isolation and aggregation policy land before Phase 21's shared per-source outcome type and Phase 23's explicit group contract. [VERIFIED: ROADMAP and deferred scope]

**Why it happens:** HLL merge makes cross-relay totals tempting to add immediately. [VERIFIED: phase dependency]

**How to avoid:** Export utilities and document correct use; leave `RelayGroup.count()` on `combineLatest` and only test widened option/response forwarding. [VERIFIED: locked context]

**Warning signs:** `group.ts` replaces `combineLatest`, catches per-relay errors, or emits a scalar total in Phase 19. [VERIFIED: deferred scope]

## Code Examples

Verified patterns for plan task actions are included above. Documentation examples should stay shorter than 20 lines and add COUNT integration to the existing Relay/Pool pages. [VERIFIED: AGENTS.md]

### Forward-Compatible Public Type

```typescript
export type RelayCountResponse = {
  count: number;
  approximate?: boolean;
  hll?: string;
  [key: string]: unknown;
};
```

This lets known fields remain strongly typed while unknown future string keys remain representable. [VERIFIED: locked context]

### Count Policy Type

```typescript
export type RelayCountOptions = {
  retries?: boolean | number | Parameters<typeof retry>[0];
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  timeout?: number | boolean;
} & RelayAuthOptions;
```

Use the same boolean/number/config vocabulary and precedence as `PublishOptions`; `false` disables, `true` selects the default retry configuration, and `timeout: true` selects the 10-second default while `false` disables it. [VERIFIED: existing PublishOptions semantics and locked context]

### Named COUNT Default

```typescript
export type RelayOptions = {
  countTimeout?: number;
  // existing options...
};

countTimeout = 10_000;
```

The constructor should copy an explicitly supplied `countTimeout`, including `0`, using the existing `!== undefined` pattern. [VERIFIED: `RelayOptions`/constructor patterns and backlog 999.27]

### Correct Cross-Relay HLL Integration

```typescript
const responses = await firstValueFrom(group.count(filters));
const sketches = Object.values(responses)
  .map((response) => response.hll)
  .filter((hll): hll is string => hll !== undefined);

const estimate = estimateHllCardinality(mergeHllRegisters(sketches));
```

The docs must guard the empty-sketch case before calling `mergeHllRegisters`, and must say not to sum overlapping relay counts. [VERIFIED: locked helper contract] [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md]

### Focused Changeset

```markdown
---
"applesauce-relay": minor
---

Make COUNT a validated high-level Observable with configurable policy and NIP-45 HLL utilities.
```

This is one cohesive COUNT-family capability sentence; `minor` is the smallest bump because the Observable signature is preserved while options, optional response fields, typed errors, and helpers are added. [VERIFIED: locked context and AGENTS.md]

## State of the Art

| Old Approach | Current Phase-19 Approach | When Changed | Impact |
|--------------|---------------------------|--------------|--------|
| `m[2] as RelayCountResponse` | Validate known fields, preserve unknown own fields safely, normalize HLL | Phase 19 | Malformed relay data becomes a typed Observable error. [VERIFIED: codebase and locked context] |
| `{count}` only | `{count, approximate?, hll?, [key:string]: unknown}` | Phase 19 | Approximation metadata and mergeable sketches reach callers without blocking future fields. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |
| Hardcoded anonymous 10-second error | Configurable named 10-second COUNT policy and typed timeout | Phase 19 | Callers can tune/disable the clock and branch on failure type. [VERIFIED: locked context] |
| Auth resend only | High-level auth plus bounded transient reconnect/retry | Phase 19 | COUNT joins the high-level family policy vocabulary without inventing a low-level sibling. [VERIFIED: locked context] |
| No correct cross-relay union mechanism | Register-wise max merge plus separate estimate | Phase 19 | Phase 23 and callers can construct an HLL union instead of summing duplicates. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |
| Roadmap Promise proposal | Existing shared `Observable<RelayCountResponse>` preserved | Context decision 2026-08-21 | Group/Pool composition remains source-shaped for Phase 23. [VERIFIED: `19-CONTEXT.md`] |

**Deprecated/outdated:**

- The ROADMAP success criterion saying “rejected promise” is non-canonical; the accepted contract is an Observable error. [VERIFIED: locked context]
- `RelayCountOptions = RelayAuthOptions` is incomplete once COUNT owns high-level retry/reconnect/timeout policy. [VERIFIED: requirements]
- A clean completion on CLOSED before COUNT is no longer acceptable. [VERIFIED: locked context]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | None. All factual claims are verified from repository sources or cited from NIP-45, RxJS documentation, and the published HLL paper. | — | — |

## Open Questions

None. D-01 resolves the timeout/retry ordering: timeout is one terminal whole-request deadline, while generic retry is limited to eligible reconnectable transport failures before expiry.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build/tests | ✓ | `22.23.1` (project requires `>=20.19.0`) | — [VERIFIED: local environment and root manifest] |
| pnpm | workspace commands | ✓ | `11.10.0` | — [VERIFIED: local environment and root manifest] |
| TypeScript | declaration build | ✓ | `7.0.2` | — [VERIFIED: local environment] |
| Vitest | unit/integration tests | ✓ | `4.1.10` | — [VERIFIED: local environment] |
| WebSocket mock | wire-trace tests | ✓ | `vitest-websocket-mock 0.5.0` | — [VERIFIED: local environment] |
| External relay/service | none | not required | — | Existing mock server supplies deterministic protocol traces. [VERIFIED: test suite] |

**Missing dependencies with no fallback:** none. [VERIFIED: environment audit]

**Missing dependencies with fallback:** none. [VERIFIED: environment audit]

The current baseline passes 233 focused Relay/Group/Pool/export tests and `pnpm --filter applesauce-relay build`. [VERIFIED: local run on 2026-08-21]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.10`, observer-spy `2.2.0`, vitest-websocket-mock `0.5.0`. [VERIFIED: local environment] |
| Config file | Root `vitest.config.ts`. [VERIFIED: codebase] |
| Quick run command | `pnpm --filter applesauce-relay exec vitest run src/__tests__/nip45.test.ts src/__tests__/relay.test.ts` |
| Full suite command | `pnpm --filter applesauce-relay test && pnpm --filter applesauce-relay build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COUNT-01 | Options, typed timeout/error, reconnect resend, additive counters, concurrency, auth reentrancy/suspension, sharing | WebSocket integration + compile | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts src/__tests__/group.test.ts src/__tests__/pool.test.ts` | ✅ extend existing |
| COUNT-02 | Strict known-field validation, forward fields, prototype safety, zero values before error | WebSocket integration + unit | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts` | ✅ extend existing |
| COUNT-03 | exact max merge, validation, lowercase, no mutation, original estimate/linear correction | Pure unit | `pnpm --filter applesauce-relay exec vitest run src/__tests__/nip45.test.ts` | ❌ Wave 0 |
| Public API | helpers/errors exported; types compile; Observable signatures preserved | snapshot + build | `pnpm --filter applesauce-relay exec vitest run src/__tests__/exports.test.ts && pnpm --filter applesauce-relay build` | ✅ extend existing |
| Documentation | Relay/Pool examples match public API and do not recommend summing | static review/build | `pnpm --dir apps/docs build` | ✅ existing docs/build script |

### Exact Test Patterns

1. Keep wire policy tests in the existing `describe("count")` and auth sections; use `await expect(server).toReceiveMessage(...)` as the non-vacuous resend oracle. [VERIFIED: existing tests]
2. Extend the table-driven Group/Pool option-forwarding cases with `reconnect`, `retries`, and `timeout`, asserting the exact caller id and `expect.objectContaining(opts)`. [VERIFIED: existing group/pool patterns]
3. For sharing, subscribe four times to one returned Observable, assert one COUNT frame, send one response, and assert every subscriber receives the validated object. [VERIFIED: existing sharing test and locked context]
4. For concurrent calls, use distinct ids and handlers, trigger auth/transport outcomes independently, and assert separate frame/handler counts; do not reuse one Observable. [VERIFIED: RAUTH-05 and locked context]
5. For arbitrary-error non-retry, mirror Phase 18's publish test: spy the inner attempt path to throw one sentinel after a real wire interaction, assert error identity and exactly one COUNT frame. [VERIFIED: `relay.test.ts` publish pattern]
6. For malformed response non-retry, send a malformed COUNT under `retries: {count: 1, delay: 0}`, assert `RelayCountResponseError`, zero values, and one frame. [VERIFIED: locked positive whitelist]
7. For terminal CLOSED, cover recognized and unprefixed reasons under retry-enabled options, wait beyond a zero-delay retry turn, and assert one frame. [VERIFIED: existing CLOSED tests and locked context]
8. Preserve the delayed-reply synchronous auth test exactly: second frame alone is insufficient; the delayed valid reply must be observed and only the successful attempt sends CLOSE. [VERIFIED: CR-03 test]
9. Replace the old 10-second fake-timer test with a short explicit custom timeout for functionality, while keeping D-20's real-timer setTimeout-arm/suspension oracle adapted to the configurable budget. [VERIFIED: D-20 and current tests]
10. Record RED→GREEN mutation probes: restore unchecked cast, change max to min, remove linear correction, hoist attempt listener, remove outer share, broaden retry classifier, and reverse the chosen timeout/retry order. [VERIFIED: standing verification standard and locked non-vacuity requirement]

### Sampling Rate

- **Per task commit:** targeted affected test file plus `pnpm --filter applesauce-relay build`. [VERIFIED: repository workflow]
- **Per wave merge:** `pnpm --filter applesauce-relay test`. [VERIFIED: package scripts]
- **Phase gate:** full relay tests/build, docs build, changeset sentence audit, export snapshot, and recorded mutation evidence green before `$gsd-verify-work`. [VERIFIED: AGENTS.md and prior Phase 18 gate]

### Wave 0 Gaps

- [ ] `packages/relay/src/__tests__/nip45.test.ts` — independent merge/estimate/validation fixtures for COUNT-03.
- [ ] Compile-time fixture or build assertion that Relay/Group/Pool preserve Observable return types and structurally forward the widened options.
- [ ] Focused malformed-response/prototype-safety table in `relay.test.ts` for COUNT-02.
- [ ] Explicit timeout/retry decision and a RED test for the selected clock semantics before changing the pipeline.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing bounded operation-scoped NIP-42 auth handler and counter; no relay-wide dedupe. [VERIFIED: Phase 13 decisions] |
| V3 Session Management | yes | One `AuthPhaseGate` and auth counter per COUNT operation; relay authentication state remains informational. [VERIFIED: codebase] |
| V4 Access Control | no | The client preserves relay refusal; it makes no authorization decision. [VERIFIED: phase scope] |
| V5 Input Validation | yes | Strict own-property validation, safe integer checks, exact HLL regex/length, and data-property-safe unknown-field copy. [VERIFIED: locked context] |
| V6 Cryptography | no | HLL is probabilistic cardinality state, not a cryptographic primitive; this phase changes no signing/hash code. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |

### Known Threat Patterns for COUNT/NIP-45

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `__proto__`/future key mutates prototype | Tampering | Copy own enumerable fields using data-property creation and test the output prototype. [VERIFIED: locked context] |
| Malformed numeric payload becomes trusted data | Tampering | Require an own finite non-negative safe integer; never coerce. [VERIFIED: locked context] |
| Relay drives retry amplification through terminal errors | Denial of Service | Positive retry whitelist and independent bounded auth/transient counters. [VERIFIED: locked context and D-07] |
| Auth wait consumes operation budget | Denial of Service | Suspend the operation clock only while the call-scoped auth gate is active; retain separate per-phase auth timeout. [VERIFIED: D-12..15] |
| Crafted pubkeys inflate HLL ranks | Spoofing | Treat HLL totals as probabilistic and prefer relays whose filtering makes bot/artificial-key publication harder; NIP-45 identifies this attack directly. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] |
| Oversized sketch consumes resources | Denial of Service | Reject anything not exactly 512 hex characters before allocation/merge. [VERIFIED: locked context] |

## Project Constraints (from AGENTS.md)

- Do not create standalone best-practices documentation; add Integration and focused Best Practices sections to the existing relevant docs. [VERIFIED: `AGENTS.md`]
- Component docs follow What it is → How to use it → Integration → Best Practices. [VERIFIED: `AGENTS.md`]
- Keep documentation code blocks short and focused, approximately 20 lines maximum; omit unnecessary imports, boilerplate, repeated setup, and verbose error handling. [VERIFIED: `AGENTS.md`]
- Keep framework concerns separated, avoid duplicate explanations, and link to existing docs rather than repeating them. [VERIFIED: `AGENTS.md`]
- Use focused actionable Best Practices and compact comparison examples; do not add summary sections to component docs. [VERIFIED: `AGENTS.md`]
- Comprehensive documentation work should use parallel explore agents with distinct focus areas and synthesize rather than restate their findings. All collaboration slots were occupied during this research run, so the researcher performed the audit inline; the planner should retain distinct doc/code/test tasks where parallel capacity exists. [VERIFIED: `AGENTS.md` and agent availability]
- Before completing documentation work, verify code examples, update real examples to match, check VitePress navigation when files move, and leave no duplicate/orphaned files. No navigation change is needed if the existing Relay/Pool pages remain in place. [VERIFIED: `AGENTS.md` and docs structure]
- Each changeset describes exactly one change, its body is one markdown sentence, and it uses the smallest applicable bump. [VERIFIED: `AGENTS.md`]
- If `apps/agent-skills/` is modified, load and follow the project `skill-creator` skill. Phase 19 has no identified need to change that app; the existing overview only lists COUNT as a capability. [VERIFIED: `AGENTS.md` and codebase]
- UI-only rules (no shadows/cards; no DaisyUI `.form-control`) are not triggered because Phase 19 adds no UI. [VERIFIED: phase scope]
- The new-NIP checklist is not triggered: applesauce-relay already supports NIP-45; this phase hardens and completes that existing support rather than introducing a new NIP family. [VERIFIED: `packages/relay/README.md` and current implementation]

## Sources

### Primary (HIGH confidence)

- `packages/relay/src/relay.ts`, `types.ts`, `group.ts`, `pool.ts`, `operators/auth-retry.ts`, and relay tests — current call graph, options, errors, retry classifier, readiness, sharing, and CR-03 behavior. [VERIFIED: codebase]
- `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md` — accepted response, Observable, HLL, policy, and phase-boundary decisions. [VERIFIED: planning artifact]
- `.planning/REQUIREMENTS.md` COUNT-01..03, `.planning/ROADMAP.md` Phase 19 and backlog 999.27/999.21, `.planning/STATE.md` — scope, dependencies, and provenance. [VERIFIED: planning artifacts]
- Phase 18 context/research/summaries and Phase 13 D-01..20 context/tests — established fresh-attempt, additive-counter, positive-classifier, auth-clock, and wire-trace patterns. [VERIFIED: planning artifacts and codebase]
- `AGENTS.md` — documentation, changeset, agent-skill, and verification constraints. [VERIFIED: codebase]

### Secondary (MEDIUM confidence)

- https://github.com/nostr-protocol/nips/blob/master/45.md — official current NIP-45 response, HLL encoding, merge, client use, and attack vectors. [CITED: official specification]
- https://rxjs.dev/api/index/function/defer — per-subscription factory semantics. [CITED: official RxJS docs]
- https://rxjs.dev/api/index/function/retry and https://rxjs.dev/api/operators/RetryConfig — error-only resubscription and retry configuration. [CITED: official RxJS docs]
- https://rxjs.dev/api/operators/timeout — timeout error/fallback semantics. [CITED: official RxJS docs]
- https://research.google.com/pubs/archive/40671.pdf — original HLL estimator formula, alpha constant, and linear-counting small-range correction as reproduced in the HLL-in-practice paper. [CITED: published research]

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools/packages are existing, locally installed, registry-checked, and baseline-tested; no installation is proposed. [VERIFIED: codebase, local environment, and package-legitimacy seam]
- Architecture: HIGH — current Relay/Group/Pool/auth paths and Phase 13/18 invariants were read directly; one contradiction is explicitly isolated instead of guessed through. [VERIFIED: codebase and planning artifacts]
- Response validation: HIGH — locked field semantics match the official current NIP-45 wire shape. [VERIFIED: locked context] [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md]
- HLL merge: HIGH — the official spec defines fixed encoding and register-wise maximum exactly. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md]
- HLL estimator: MEDIUM — the formula is published and fixtures are independent, but NIP-45 deliberately leaves estimator choice/quirks open. [CITED: https://github.com/nostr-protocol/nips/blob/master/45.md] [CITED: https://research.google.com/pubs/archive/40671.pdf]
- Pitfalls: HIGH — grounded in reproduced CR-03/D-07 failures, current code, locked decisions, and official RxJS semantics. [VERIFIED: codebase and planning artifacts] [CITED: https://rxjs.dev/api/index/function/retry]

**Research date:** 2026-08-21
**Valid until:** 2026-08-28 (NIP-45 is draft and the phase has an unresolved clock/retry decision; revalidate the spec and context after either changes)
