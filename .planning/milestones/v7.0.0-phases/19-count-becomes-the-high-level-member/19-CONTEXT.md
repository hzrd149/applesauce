# Phase 19: COUNT Becomes the High-Level Member - Context

> **Phase 23 D-24 amendment:** Historical `combineLatest`, bare response-record, and all-or-nothing Group/Pool claims are superseded. `Relay.count()` remains scalar with HLL/auth/retry/timeout behavior unchanged; the Observable-of-record topology remains while entries are now progressive `RelayOutcome` values.

**Gathered:** 2026-08-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Keep `count()` as the COUNT family's single high-level Observable API, add configurable reconnect/retry/timeout policy, validate and preserve the forward-compatible NIP-45 response, and ship merge plus cardinality helpers for its fixed 256-register HLL representation. Do not introduce an artificial low-level COUNT method or redesign group aggregation before Phase 23.

</domain>

<decisions>
## Implementation Decisions

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
- Keep auth and generic retry counters distinct, call-scoped, and additive. Positively allow only eligible reconnectable unclean transport failures into generic retry policy while time remains before the whole-operation deadline. Timeout expiry terminates COUNT and is not retryable.
- Emit only validated COUNT responses. Completion/close without a COUNT reply, malformed response, relay refusal or typed CLOSED, terminal auth errors, and arbitrary/programming errors are terminal Observable errors.
- Preserve established boolean/number retry defaults. Test custom timeout, reconnect, real retry resend, no-retry terminal/arbitrary errors, independent concurrent calls, synchronous auth reentrancy, auth-clock suspension, sharing, forward-compatible fields, and HLL utilities with mutation/non-vacuity probes.
- Update docs and a focused single-change changeset. Leave Phase 23 an explicit contract to consume progressive per-relay Observables and never sum overlapping relay counts.

### the agent's Discretion
- Choose helper module placement and typed error subclass details consistent with existing relay exports.
- Choose the standard NIP-45/HLL estimator implementation details as long as the independent fixtures establish correctness.

### Post-Discussion Resolution
- **D-01 (2026-08-21):** A caller-supplied `timeout` covers the whole logical request across retries and reconnections for every request family. It includes readiness and backoff, suspends during active auth under the accepted policy, and never resets per attempt. For COUNT, deadline expiry is terminal and cannot consume the generic retry budget; only eligible reconnectable transport failures before the deadline may retry.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Current Relay/Group/Pool count methods are Observable APIs with extensive real-wire auth and reentrancy tests.
- Phase 18 supplies the positive transient retry whitelist, call-scoped additive counter pattern, shared readiness contract, and fresh unshared attempt pattern.
- `AuthPhaseGate` and suspendable timeout utilities already provide operation-clock suspension during authentication.

### Established Patterns
- High-level methods own configurable policy; low-level methods exist only when a real raw consumer needs them.
- Public responses may preserve unknown protocol fields while validating known fields at the boundary.
- Changesets contain exactly one change in one sentence.

### Integration Points
- Response parsing and COUNT policy live in `packages/relay/src/relay.ts`; public types live in `types.ts`.
- RelayGroup/RelayPool signatures and tests must continue forwarding IDs and options.
- Phase 23 consumes the widened response/HLL utilities and replaces all-or-nothing `combineLatest` behavior.

</code_context>

<specifics>
## Specific Ideas

- Observable error semantics are intentional and replace the roadmap's non-authoritative Promise proposal.
- COUNT's justified family differences are: no separate low-level method, strict NIP-45 validation, and a shorter 10-second default clock.
- Forward compatibility includes unknown response fields; validation must not become field stripping.

</specifics>

<deferred>
## Deferred Ideas

- Progressive, failure-isolated group count records and cross-relay aggregation policy remain Phase 23 scope.
- A separate Promise convenience API is not needed for this phase; callers can continue using `firstValueFrom`/`lastValueFrom` when desired.

</deferred>
