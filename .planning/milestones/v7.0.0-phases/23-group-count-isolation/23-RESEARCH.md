# Phase 23: Group count() Isolation - Research

**Researched:** 2026-09-01
**Domain:** Progressive dynamic-cohort Observable aggregation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Group/Pool COUNT returns `Observable<Record<string, RelayOutcome<RelayCountResponse>>>`, keyed by normalized URL; pending relays are omitted.
- Emit a fresh cumulative snapshot on every active relay success/failure. All per-relay failures, including synchronous projection throws, become identity-preserved failure outcomes; they never raise `RelayGroupError`.
- Complete after the latest finite cohort fully settles, including all-failure records. Only membership-source and internal normalization/invariant failures use the outer error channel.
- Normalize latest membership with last same-URL instance winning. Replacements cancel/discard old work and start fresh; retained instances retain work/outcomes; removals cancel and retract.
- Emit a retraction snapshot when removal changes a non-empty settled result. Empty latest cohorts complete without emitting `{}`. Membership completion allows active counts to settle before completion.
- Each snapshot is a new ordinary object in latest cohort order; preserve outcome/value/error identities and do not freeze.
- Mint one ID eagerly per call unless supplied, reuse it across all relays/replacements, execute once, share, and replay the latest snapshot. Late subscribers after completion get final snapshot plus completion without new COUNTs; empty operations replay completion only.
- Forward filters, ID, and `RelayCountOptions` unchanged. Every scalar `relay.count()` remains fully independent and all active counts run concurrently.
- Final outer unsubscribe or membership-source error cancels all counts/timers/auth waits and preserves membership error identity.
- Add no aggregate total. Document successful-HLL extraction plus existing merge/estimate helpers; never sum overlapping counts or treat missing HLL as zero.
- Keep Relay scalar return unchanged. Export `RelayOutcome` and a named Group/Pool count-outcome record alias from root and `/types`; add narrowing and parity type proofs.
- Update existing docs and Phase 19 provenance, remove stale all-or-nothing/deferred claims, and add one one-sentence major changeset.
- Mutation proof: replacing the accumulator with `combineLatest` must make fast/slow progression and success/offline isolation tests fail RED, then GREEN after restoration.
- Runtime coverage must include progression, mixed/all failures, duplicate/replacement/removal cohorts, empties, order, sharing/replay, forwarding, Pool parity, membership error, cancellation, and HLL extraction.

### the agent's Discretion

- Choose names for the exported count-outcome record alias and private progressive cohort helper.
- Choose focused test-file placement and RxJS decomposition consistent with Phase 21's cohort implementation.

### Deferred Ideas (OUT OF SCOPE)

- Per-relay query/filter option maps and Group-specific retry/concurrency controls remain out of scope.
- Automatic aggregate total emission remains out of scope; existing explicit HLL utilities are sufficient.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| COUNT-04 | One relay failure does not fail the group | Per-relay materialization boundary and outer-error taxonomy |
| COUNT-05 | Emit progressively as relays settle | Ordered cumulative cohort accumulator and replay contract |
</phase_requirements>

## Summary

Current Group COUNT uses `switchMap(relays => combineLatest({...relay.count()}))`: it waits for every relay, propagates the first inner error, discards all work whenever membership emits, keys by raw URL, and cannot express retractions or same-URL replacement safely. Pool delegates directly and currently exposes `Observable<Record<string, RelayCountResponse>>`. [VERIFIED: codebase grep]

Replace only Group aggregation with one private state machine modeled on Phase 21's corrected cohort machinery. Maintain normalized order, active instance/subscription, settled outcomes, and a generation token per URL. Diff membership before starting new inners; then subscribe concurrently using `defer(() => relay.count(...))`, materialize success/error, publish fresh ordered snapshots, and decide completion from the latest cohort. Wrap the operation in a `ReplaySubject(1)`-backed shared boundary that caches completion but cancels active upstream work when the last active subscriber leaves. [VERIFIED: 23-CONTEXT.md]

**Primary recommendation:** implement a dedicated progressive COUNT cohort helper; do not reuse `settledSubscription()` directly because COUNT has one-shot outcomes, retraction emissions, and no aggregate-error rule.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Scalar COUNT validation/auth/retry/timeout | Relay | Transport | Remains unchanged and independent per relay |
| Dynamic cohort diff and accumulation | RelayGroup | RxJS lifecycle | Owns normalized multi-source state |
| Type-safe forwarding | RelayPool | RelayGroup | Pool derives and delegates without translation |
| Cross-relay HLL interpretation | Caller | NIP-45 helpers | Coverage policy is caller-visible and cannot be inferred safely |

## Project Constraints (from AGENTS.md)

- Update existing component docs using What/How/Integration/Best Practices structure; do not add a standalone best-practices or summary document.
- Keep examples focused and roughly 20 lines maximum, link instead of duplicating, verify examples and navigation.
- Each changeset body must be exactly one markdown sentence describing exactly one change.

## Standard Stack

No dependency changes. Use existing RxJS 7.8.x, TypeScript 7, Vitest 4, `normalizeURL`, `RelayOutcome`, and NIP-45 helpers. [VERIFIED: package manifests]

| Asset | Use |
|---|---|
| `Observable` + explicit teardown | Cohort state machine and deterministic cancellation |
| `defer` | Capture synchronous `relay.count()` construction failures as inner outcomes |
| `share({ connector: () => new ReplaySubject(1), ... })` | One concurrent execution, final replay, active ref-count cancellation |
| `normalizeURL` | Canonical URL identity and duplicate collapse |
| `mergeHllRegisters` / `estimateHllCardinality` | Explicit union estimation from successful sketches |

## Architecture Patterns

### Data Flow

```text
relays$ emission
  -> normalize (last same URL wins, ordered)
  -> diff retained / replaced / removed / added
  -> cancel removed and replaced
  -> start added/replacements concurrently
  -> success OR caught failure -> outcome[url]
  -> build fresh ordered settled-only snapshot
  -> emit -> replay latest
  -> all latest settled? complete
```

### Recommended State

```ts
type Active = {
  relay: Relay;
  token: object;
  subscription: Subscription;
};

let order: string[] = [];
const active = new Map<string, Active>();
const outcomes = new Map<string, RelayOutcome<RelayCountResponse>>();
```

The token must be checked by every inner callback in addition to URL membership. URL-only checks let a late signal from a replaced instance settle the replacement's slot. [VERIFIED: Phase 21 adversarial replacement fixes]

### Cohort Update Order

1. Normalize the full incoming array into an insertion-ordered `Map`; repeated normalized URLs overwrite values but retain the first insertion position unless the contract/test chooses to reconstruct last-occurrence order. The locked contract says latest cohort membership order and last instance wins, so explicitly build an ordered last-wins sequence rather than relying accidentally on `Map.set` position behavior.
2. Publish `order` and latest membership before starting any new inner; synchronous `relay.count()` errors must be evaluated against the new cohort.
3. Unsubscribe removed/replaced active entries and delete their outcomes.
4. Retain only exact same Relay instances.
5. Start each added/replacement via `defer`; attach a unique token; materialize one success or failure.
6. After the structural diff, emit one retraction snapshot if removals changed a previously emitted non-empty result and no synchronous settlement already emitted the same state.

### Snapshot Builder

Iterate `order`, copy only present outcomes to `{}` using assignment, and emit only if at least one key exists. Never expose the mutable internal Map. Preserve outcome object identity; each settlement creates its outcome once. A completion caused by an empty cohort emits no object. [VERIFIED: 23-CONTEXT.md]

### Sharing and Replay

Use an explicit replaying share configuration rather than bare `shareReplay(1)`:

```ts
share({
  connector: () => new ReplaySubject(1),
  resetOnComplete: false,
  resetOnError: false,
  resetOnRefCountZero: true,
});
```

This caches the final snapshot/completion, preserves membership-source error identity for late subscribers, and tears down active work when the final live subscriber leaves. Verify actual RxJS 7 behavior with tests because reset interactions are subtle. [CITED: https://rxjs.dev/api/operators/share]

## Public Types

Recommended discretionary alias:

```ts
export type RelayCountOutcomes = Record<
  string,
  RelayOutcome<RelayCountResponse>
>;
```

Use it in `RelayGroup.count()` and the Pool return type. Keep `Relay.count(): Observable<RelayCountResponse>` unchanged. Pool should derive `filters`, `id`, and `opts` from `RelayGroup["count"]` where practical, avoiding a second handwritten policy surface. [VERIFIED: AGENTS/type-layer convention]

## Error Boundary

| Source | Representation |
|---|---|
| Scalar response | `{ ok: true, value }` |
| Scalar transport/auth/timeout/refusal/malformed failure | `{ ok: false, error }` |
| Synchronous `relay.count()` throw | `{ ok: false, error }` via `defer` |
| Membership Observable error | Outer error, exact identity |
| URL normalization/internal invariant failure | Outer error |
| All relays fail | Final all-failure snapshot, then complete |

Never use `RelayGroupError` for COUNT. Catch errors at each inner boundary, not around the merged/cohort Observable; an outer catch cannot reliably attribute synchronous construction and may swallow membership failures. [VERIFIED: locked context]

## Completion and Cancellation Matrix

| Condition | Behavior |
|---|---|
| Initially empty | Complete, no emission |
| Latest cohort becomes empty | Cancel removed work, complete, no `{}` |
| All latest entries settle | Emit final record, then complete |
| Membership source completes with active pending counts | Keep counts alive; complete after settlement |
| Same instance retained | Preserve outcome/in-flight subscription |
| Same URL, new instance | Cancel old, retract old outcome, start new pending |
| Removed then re-added | Fresh scalar COUNT with same call ID |
| Last outer subscriber unsubscribes while active | Cancel membership and every active count |
| Late old callback | Ignore by token/active-instance check |

## Don't Hand-Roll

| Problem | Do not build | Use instead |
|---|---|---|
| Relay COUNT retry/auth/timeout | Group-level duplicate policy | Existing independent `relay.count()` |
| URL canonicalization | String trimming | `normalizeURL` |
| Union cardinality | Sum `count` fields | HLL merge + estimate helpers |
| Discriminated result | New success/error shape | Existing `RelayOutcome<T>` |
| Replay cache | Mutable public last-result object | `ReplaySubject(1)` through configured `share` |

## Common Pitfalls

### `combineLatest` mutation survives superficially green tests

A fixture where all relays answer successfully and quickly cannot distinguish the new contract. The two required mutation oracles are: fast success must emit before slow settlement, and one success plus one error must emit both cumulative outcomes and complete rather than error. Both fail under `combineLatest`. [VERIFIED: D-26]

### `switchMap` cancels retained work

Rebuilding the full aggregation per membership emission restarts unchanged scalar operations and their deadlines/auth counters. Diff membership manually; retain exact instances. [VERIFIED: current `group.ts`]

### Completing when membership source completes

Membership completion is not cohort completion. Track `membershipDone`; only complete when current membership is empty or every current URL has an outcome. [VERIFIED: D-09]

### Replay that reconnects after completion

Bare `share()` loses the final result; reset-on-complete sharing can issue duplicate COUNT frames to late subscribers. Test late subscription frame counts, reference equality, final record, and completion. [VERIFIED: D-13]

### Incorrect ordering after duplicate normalization

Response timing must never determine object key order. Explicitly test reversed response order, duplicate spellings that normalize together, replacement, and remove/re-add order. [VERIFIED: D-05/D-10]

### Accidental `{}` emission

Retraction logic can emit an empty object before completing. Guard snapshot emission on at least one settled active entry. [VERIFIED: D-08]

## Validation Architecture

### Framework

| Property | Value |
|---|---|
| Runtime | Vitest 4 + observer-spy/test Observables |
| Type gate | `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` |
| Focused | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group-count.test.ts src/__tests__/pool.test.ts src/__tests__/exports.test.ts` |
| Full | `pnpm --filter applesauce-relay test` |

### Test Map

| Area | Required assertions |
|---|---|
| Progression | fast/slow emissions are `[fast]`, then `[fast,slow]`; fresh objects; stable identities/order |
| Isolation | mixed success/failure and all-failure records complete normally |
| Cohort | duplicate normalized URL, retained work, replacement, ignored late signals, removal/retraction, remove/re-add |
| Empty/completion | static empty, dynamic empty, membership completion while pending |
| Sharing | concurrent subscribers cause one COUNT per relay; late completed subscriber replays without frames |
| Forwarding | exact filters object/array, eager stable ID, exact opts object to every relay/replacement |
| Cancellation | last unsubscribe and membership error cancel inners; membership error identity preserved |
| Types | narrowing; illegal bare `.count`; unchanged scalar Relay; Pool/Group equality; root and `/types` aliases |
| HLL docs/test | extract only `ok && value.hll`; missing/failed excluded; never sum counts |

### Mandatory Mutation Proof

Temporarily replace the accumulator with the prior `switchMap + combineLatest`. Run named fast/slow and success/offline tests and record concrete failures (no early emission; outer error/no successful record). Restore, rerun GREEN, and confirm `git diff` contains no mutation residue. A merely green final suite does not satisfy D-26.

### Wave 0 Gaps

- Add `packages/relay/src/__tests__/group-count.test.ts` for focused state-machine tests rather than expanding unrelated Group request tests.
- Extend `packages/relay/type-tests/group-error-types.ts` or add a count-specific fixture and include it in `tsconfig.type-tests.json`.
- Update runtime export snapshot only if the alias has a runtime companion (type-only aliases do not appear at runtime).

## Documentation and Provenance

- Rewrite only the Count Method, Integration, and Best Practices portions of `apps/docs/loading/relays/pool.md`.
- Show `if (outcome.ok)` narrowing, per-URL failure handling, and successful HLL extraction in focused examples.
- State that snapshots are cumulative/provisional until completion and failures/missing HLL reduce coverage.
- Remove “all-or-nothing”, bare `CountResponse` record access, and “deferred to Phase 23”.
- Amend Phase 19 context/roadmap provenance: the Observable-of-record topology stayed stable, while record entries intentionally changed to the preplanned shared outcome representation.
- Add one major `applesauce-relay` changeset whose body is one sentence.

## Security Domain

| ASVS area | Applies | Control |
|---|---|---|
| Authentication/session | inherited | Each scalar COUNT keeps independent bounded NIP-42 state |
| Access control | inherited | Refusals remain original error outcomes |
| Input validation | yes | Existing scalar response validation and normalized membership identity |
| Resource management | yes | Cancel replacement/removal/unsubscribe; ignore stale callbacks |
| Cryptography | no new work | Reuse validated HLL representation; no cryptographic changes |

Primary threats are denial-of-service through leaked replaced subscriptions and integrity errors from attributing late responses to replacement URLs. Exact cancellation counts and token checks are required controls. [VERIFIED: locked context]

## Environment Availability

Node 22.23.1 and pnpm 11.10.0 are available. No external dependencies or package installs are required; package-legitimacy audit is not applicable.

## Assumptions Log

| # | Claim | Risk if Wrong |
|---|---|---|
| — | None; implementation guidance derives from locked decisions, current code, and verified Phase 19/21 artifacts | — |

## Open Questions

None blocking. Alias/helper names and focused test placement are explicitly discretionary; `RelayCountOutcomes` and `group-count.test.ts` are recommended.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/23-group-count-isolation/23-CONTEXT.md`
- `packages/relay/src/group.ts`, `pool.ts`, `relay.ts`, `types.ts`, `nip45.ts`
- `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md`
- `.planning/phases/21-group-error-surface-request-subscription/21-VERIFICATION.md`
- `packages/relay/src/__tests__/group.test.ts`, `pool.test.ts`, `nip45.test.ts`

### Secondary (MEDIUM confidence)

- [RxJS share](https://rxjs.dev/api/operators/share)
- [RxJS defer](https://rxjs.dev/api/index/function/defer)

## Metadata

**Confidence breakdown:** stack HIGH; architecture HIGH; cohort pitfalls HIGH due to Phase 21 adversarial evidence and locked mutation requirements.

**Research date:** 2026-09-01  
**Valid until:** 2026-10-01
