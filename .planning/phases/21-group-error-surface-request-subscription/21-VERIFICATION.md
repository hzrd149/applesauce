---
phase: 21-group-error-surface-request-subscription
verified: 2026-09-01T15:55:00Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 21: Group Error Surface — request()/subscription() Verification Report

> **Phase 23 D-24 amendment:** Historical COUNT deferral is resolved by progressive `RelayOutcome` entries without changing scalar Relay COUNT, HLL utilities, or the Observable record topology.

> **Phase 22 D-23/D-24 amendment:** Subscription lifetime and subscription `authSuspendableLifetime` verification is historical and superseded; request timeout and immediate total failure remain current.

**Phase Goal:** A `RelayGroup.request()` or `subscription()` that loses every relay reports that as a real error, and the aggregate's per-relay causes settle the one representation reused by later count-isolation work.
**Verified:** 2026-09-01T15:55:00Z
**Status:** passed
**Re-verification:** No — initial verification after code-review fixes

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | A non-empty current cohort whose relays all fail raises `RelayGroupError` before or after events; mixed EOSE/error requests succeed. | ✓ VERIFIED | `settledSubscription()` updates each relay state before deciding at `group.ts:237-257,291-307`; focused real-wire tests cover initial failure, post-EVENT failure, and zero-event mixed success. |
| 2 | The aggregate exposes normalized URL outcomes and ordered, identity-preserved causes through `RelayOutcome`. | ✓ VERIFIED | `RelayGroupError` derives native `errors` and `outcomes` from one ordered entry array at `group.ts:45-56`; runtime and compile-time tests verify normalization, order, identity, and union narrowing. |
| 3 | Empty/static/dynamic membership and latest-cohort replacement settle correctly. | ✓ VERIFIED | Membership is normalized and replaced before inner subscription at `group.ts:267-311`; tests cover empty request, persistent empty subscription, removed outcomes, same-URL instance replacement, and remove/re-add without duplicate causes. |
| 4 | Synchronous per-relay projection failures enter aggregate settlement. | ✓ VERIFIED | `defer(() => project(relay))` at `group.ts:291` contains synchronous construction errors; the named factory-throw test proves all relays initialize and both causes aggregate. |
| 5 | All-failed settlement wins over synchronous custom completion, while completion-operator errors propagate unchanged. | ✓ VERIFIED | Failure state and `decide()` run before `messages.next()` at `group.ts:301-307`; completion observer forwards errors at `group.ts:260-264`. Both precedence paths have passing named tests. |
| 6 | `request()` has one default 30-second whole-returned-Observable lifetime that activity never resets. | ✓ VERIFIED | Request resolves omission to `30_000` and applies `authSuspendableLifetime`; the activity-at-40ms test still times out at 50ms, and existing group tests cover accepted-but-silent relays. |
| 7 | `subscription()` is indefinite when timeout is omitted/false and bounded by a numeric whole lifetime when enabled. | ✓ VERIFIED | Public type is `number | false`; the fake-timer test proves 60 seconds remains open with `false` and a numeric budget expires. |
| 8 | Every enabled whole-operation clock pauses across overlapping call-scoped auth phases and resumes with remaining budget. | ✓ VERIFIED | One `AuthPhaseGate` is threaded to active relays and `authSuspendableLifetime`; the overlapping two-relay gate test proves the clock remains paused until the final `end()`. |
| 9 | Pool request, subscription, subscriptionMap, and outboxSubscription preserve Group failure and membership behavior. | ✓ VERIFIED | `pool.ts:181-233` delegates directly using `Parameters<RelayGroup[...]>`; parameterized runtime tests exercise all four paths and dynamic map replacement. |
| 10 | Runtime exports and compiler-visible Group/Pool timeout/outcome contracts are correct. | ✓ VERIFIED | `index.ts` export-stars `group.ts` and `types.ts`; export snapshot includes `RelayGroupError`; `tsconfig.type-tests.json` fixture accepts numeric/false forms and rejects string/object/boolean forms. |
| 11 | Documentation and canonical provenance describe aggregate, empty/mixed, custom-completion, whole-clock, and auth-suspension semantics. | ✓ VERIFIED | `pool.md` and `v5-v6.md` cover each edge; docs build passes. ROADMAP success criteria and GROUP-04/05 use the D-10 whole-operation wording, with no stale first-progress/idle match. |
| 12 | Release metadata and complete quality gates are valid. | ✓ VERIFIED | Exact one-package major changeset contains the required single sentence; 75 focused tests, all 374 relay tests, type fixture, relay build, docs build, and manifest/lockfile integrity gate pass. |

**Score:** 12/12 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/relay/src/types.ts` | Shared outcome and timeout contracts | ✓ VERIFIED | Substantive public `RelayOutcome<T>` plus request/subscription option declarations; exported through barrel and exercised by type tests. |
| `packages/relay/src/group.ts` | Typed aggregate, cohort arbitrator, timeout policy | ✓ VERIFIED | Substantive and wired through public methods; all review defects are fixed in production code and regression-tested. |
| `packages/relay/src/operators/auth-retry.ts` | Auth-suspendable whole-lifetime operator | ✓ VERIFIED | Timer ignores values, accounts remaining time during gate activity, forwards source errors, and tears down timer/gate/source. |
| `packages/relay/src/__tests__/group-error.test.ts` | Behavioral proofs | ✓ VERIFIED | 13 focused tests cover aggregate, membership, precedence, lifetime, and overlapping auth. |
| `packages/relay/src/__tests__/pool.test.ts` | Four Pool paths | ✓ VERIFIED | Parameterized forwarding test plus dynamic membership proof. |
| `packages/relay/src/__tests__/exports.test.ts` | Runtime export proof | ✓ VERIFIED | Sorted export snapshot includes `RelayGroupError`. |
| `packages/relay/type-tests/group-error-types.ts` | Compiler contract | ✓ VERIFIED | Positive narrowing/options and non-vacuous `@ts-expect-error` negatives compile successfully. |
| `apps/docs/loading/relays/pool.md` | Primary usage/integration/best-practices docs | ✓ VERIFIED | Contract matches code and follows repository documentation structure; docs build passes. |
| `apps/docs/migration/v5-v6.md` | Breaking migration guidance | ✓ VERIFIED | Distinguishes raw lifecycle messages and same-final-error aggregate precedence. |
| `.changeset/relay-group-error-surface.md` | Exact major release record | ✓ VERIFIED | One package, major bump, one required sentence. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `group.ts` | `types.ts` | `RelayOutcome<never>` | ✓ WIRED | Public error outcomes use the shared representation. |
| `group.ts` | `auth-retry.ts` | `AuthPhaseGate` + `authSuspendableLifetime` | ✓ WIRED | Same call-scoped gate controls relay auth phases and the outer lifetime. |
| `pool.ts` | `group.ts` | Direct delegation and `Parameters<>` | ✓ WIRED | No catch, wrapping, cloning, or option-shape duplication. |
| `index.ts` | `group.ts` / `types.ts` | Export-star barrels | ✓ WIRED | Runtime error and type-only outcome are publicly reachable. |
| Docs | implementation | Named API/error/options | ✓ WIRED | Executable documentation examples and prose match tested behavior. |

### Data-Flow Trace (Level 4)

Not applicable: Phase 21 artifacts are library state-machine/operators and documentation, not UI artifacts rendering dynamic data. Error data was instead traced from relay stream failure → cohort state → ordered `RelayGroupError` entries → Pool caller.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Aggregate/membership/timeout/Pool/export behavior | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group-error.test.ts src/__tests__/group.test.ts src/__tests__/pool.test.ts src/__tests__/exports.test.ts` | 4 files, 75 tests passed | ✓ PASS |
| Complete relay regression suite | `pnpm --filter applesauce-relay test` | 13 files, 374 tests passed | ✓ PASS |
| Public type contract | `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` | exit 0 | ✓ PASS |
| Relay declaration/build output | `pnpm --filter applesauce-relay build` | exit 0 | ✓ PASS |
| Documentation and examples | `pnpm --dir apps/docs build` | VitePress build complete; chunk-size warning only | ✓ PASS |
| Dependency integrity | `git diff --exit-code -- package.json pnpm-lock.yaml packages/relay/package.json` | exit 0 | ✓ PASS |
| Exact changeset | Node structural/content assertion | `changeset exact` | ✓ PASS |

### Probe Execution

No Phase 21 probe scripts are declared or implied; executable evidence is provided by the focused and full test/type/build gates above.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| GROUP-01 | 21-01, 21-03, 21-04 | Total request/subscription failure is a default error | ✓ SATISFIED | Real-wire Group and all Pool-path tests. |
| GROUP-02 | 21-01, 21-03, 21-04 | URL-keyed original causes | ✓ SATISFIED | Normalized ordered identity tests and Pool forwarding tests. |
| GROUP-03 | 21-01, 21-03, 21-04 | One reusable per-source outcome representation | ✓ SATISFIED | Exported `RelayOutcome<T>` is used by `RelayGroupError`; Phase 23 implementation is explicitly later scope. |
| GROUP-04 | 21-02, 21-03, 21-04 | One whole-returned-Observable timeout, no activity reset | ✓ SATISFIED | Fake-timer behavior tests, types, forwarding, docs, and provenance. |
| GROUP-05 | 21-02, 21-03, 21-04 | Enabled clocks suspend through overlapping auth | ✓ SATISFIED | Shared-gate identity and overlapping-phase timing test. |

No Phase 21 requirements are orphaned.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | No unreferenced TBD/FIXME/XXX, TODO/HACK/PLACEHOLDER, static empty output, or detached implementation found in Phase 21 files. | — | None |

### Disconfirmation Pass

- Potential partial requirement checked: Pool runtime timeout behavior is not repeated independently for every facade, but option types are compiler-checked for every facade, the facades directly delegate without translation, and the underlying Group lifetime has behavioral coverage. This is sufficient non-duplicative evidence.
- Potential misleading test checked: the same-URL replacement test asserts the replacement `req()` call and proves the removed stream's later error cannot settle the current cohort; it is not merely an aggregate-message assertion.
- Potential uncovered error path checked: synchronous filter construction and custom completion-operator errors were the two previously uncovered paths; both now have named behavioral tests and production error routing.

### Human Verification Required

None. The phase exposes deterministic library behavior with automated runtime, fake-timer, type, export, build, and documentation evidence; it has no visual or external-service-only acceptance item.

### Gaps Summary

No blocking or warning gaps found. The four critical review findings—same-URL replacement, remove/re-add ordering, synchronous projection errors, and completion-operator error propagation—are fixed, wired, and covered by targeted passing tests. Phase 23's progressive count-record consumption of `RelayOutcome` remains intentionally deferred by the roadmap and is not a Phase 21 gap.

---

_Verified: 2026-09-01T15:55:00Z_
_Verifier: the agent (gsd-verifier)_
