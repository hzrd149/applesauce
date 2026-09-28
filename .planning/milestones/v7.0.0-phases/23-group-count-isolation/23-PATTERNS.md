# Phase 23: Group count() Isolation - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 14 new/modified files or artifact groups
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/group.ts` | service | event-driven / progressive aggregation | `settledSubscription()` at lines 212-318 | exact cohort identity/error-boundary analog |
| `packages/relay/src/pool.ts` | facade | request-response forwarding | Pool request/subscription derived signatures and count at 236-245 | exact |
| `packages/relay/src/types.ts` | model | transform | `RelayOutcome<T>` at lines 205-209 | exact |
| `packages/relay/src/index.ts` | config/barrel | transform | star-export of `types.ts` at line 7 | exact |
| `packages/relay/src/__tests__/group-count.test.ts` (new) | test | event-driven / progressive state | `group-error.test.ts` Phase 21 cohort tests | exact role/cohort |
| `packages/relay/src/__tests__/group.test.ts` | test | streaming / real wire | count auth inheritance at lines 436-468 | exact scalar-policy integration |
| `packages/relay/src/__tests__/pool.test.ts` | test | forwarding / streaming | existing Pool real-wire forwarding style | role-match |
| `packages/relay/type-tests/group-error-types.ts` or new count fixture | test/config | compile-time transform | existing `RelayOutcome` narrowing fixture lines 1-24 | exact |
| `packages/relay/tsconfig.type-tests.json` | config | batch | current type-test include convention | exact |
| `packages/relay/src/__tests__/exports.test.ts` | test | runtime exports | sorted inline snapshot at lines 4-39 | exact audit target |
| `apps/docs/loading/relays/pool.md` | documentation | progressive response consumption | Count/Integration/Best Practices at lines 183-218 | exact update target |
| Phase 19 provenance artifacts | documentation | transform | `19-CONTEXT.md`, `19-VERIFICATION.md`, `19-03-*` | exact reversal/clarification target |
| `.planning/ROADMAP.md` / `.planning/REQUIREMENTS.md` | config/documentation | transform | Phase 23 and COUNT-04/05 entries | exact |
| new Phase 23 changeset | config/release | transform | `.changeset/relay-count-nip45.md` | exact format/role |

## Pattern Assignments

### `packages/relay/src/group.ts` (service, progressive event-driven aggregation)

**Primary analog:** `packages/relay/src/group.ts:212-318`, Phase 21's corrected `settledSubscription()`.

Copy its explicit `Observable` state machine, normalized latest-cohort diff, subscription map, membership-first update order, synchronous `defer`, and teardown. Do not copy its aggregate-error decision: COUNT materializes every per-relay error as a value.

```ts
return new Observable((subscriber) => {
  const relaySubscriptions = new Map<string, { relay: Relay; subscription: Subscription }>();
  const states = new Map<string, CohortState>();
  let order: string[] = [];

  const membershipSubscription = this.relays$.subscribe({
    next: (relays) => {
      const normalized = new Map<string, Relay>();
      for (const relay of relays) normalized.set(normalizeURL(relay.url), relay);
      order = [...normalized.keys()];
      // diff, cancel removed/replaced, then start additions
    },
    error: (error) => subscriber.error(error),
  });
  return () => { membershipSubscription.unsubscribe(); /* cancel inners */ };
});
```

The replacement/cancellation pattern is exact at `group.ts:268-305`: compare both normalized URL and relay instance, unsubscribe replaced/removed work, install the full new cohort before starting any synchronous inner, and use `defer(() => project(relay))`.

For COUNT, use dedicated state:

```ts
type Active = { relay: Relay; token: object; subscription: Subscription };
const active = new Map<string, Active>();
const outcomes = new Map<string, RelayOutcome<RelayCountResponse>>();
let order: string[] = [];
let membershipDone = false;
```

Add a per-entry token check in both success and error callbacks. Phase 21 checks current URL membership, but COUNT replacement must additionally prevent a late old callback from settling the replacement's slot.

**Snapshot analog:** ordered `RelayGroupError` construction at `group.ts:59-70` preserves input order and cause identity. Build a new ordinary record by iterating `order`, include only URLs present in `outcomes`, and reuse each outcome object unchanged.

```ts
const snapshot: RelayCountOutcomes = {};
for (const url of order) {
  const outcome = outcomes.get(url);
  if (outcome) snapshot[url] = outcome;
}
if (Object.keys(snapshot).length > 0) subscriber.next(snapshot);
```

Do not mutate prior snapshots, freeze values, emit `{}`, or let response timing determine key order. On removal, emit one retraction only when at least one settled active outcome remains. Initially empty/latest-empty completes without emission.

**Per-relay error boundary analog:** `internalSubscription()` at `group.ts:194-197` catches inner errors at attribution time. COUNT should materialize at the individual `defer(() => relay.count(filters, id, opts))` subscription:

```ts
const source = defer(() => relay.count(filters, id, opts));
source.subscribe({
  next: (value) => settle(url, token, { ok: true, value }),
  error: (error) => settle(url, token, { ok: false, error }),
});
```

This captures synchronous projection throws and asynchronous scalar failures while leaving membership-source errors on the outer error channel. Never create `RelayGroupError` in COUNT.

**Current code to replace:** `group.ts:447-460`. The `switchMap + combineLatest` shape is the deliberate mutation baseline, not an implementation analog: it cancels retained work, waits for all sources, and propagates one inner error.

### Replay and sharing boundary in `group.ts`

**Closest analogs:** package uses `shareReplay(1)` for cached state (`group.ts:132-147`, `pool.ts:59-77`), while Phase 23 needs explicit reset semantics.

Wrap the complete state machine once:

```ts
share({
  connector: () => new ReplaySubject(1),
  resetOnComplete: false,
  resetOnError: false,
  resetOnRefCountZero: true,
})
```

This is a deliberate refinement of existing replay-state style: concurrent subscribers share one cohort execution; late subscribers after completion/error receive the cached terminal state; last live unsubscribe cancels active work. Tests must pin these semantics because bare `shareReplay(1)` and bare `share()` do not express the full contract.

Mint `id = nanoid()` in the public `count()` parameter exactly as today at `group.ts:448-451`, outside the shared Observable factory, so replacements and all subscribers reuse one eager call-scoped ID.

### `packages/relay/src/pool.ts` (facade, forwarding)

**Analog:** direct Group delegation at `pool.ts:236-245` and derived signatures used elsewhere in the same class.

Derive all Group COUNT arguments and return the named alias; do not duplicate outcome construction or catch errors:

```ts
count(
  relays: PoolRelayInput,
  filters: Parameters<RelayGroup["count"]>[0],
  id?: Parameters<RelayGroup["count"]>[1],
  opts?: Parameters<RelayGroup["count"]>[2],
): Observable<RelayCountOutcomes> {
  return this.group(relays, false).count(filters, id, opts);
}
```

Pool must preserve Group's progressive snapshots, final replay, membership errors, and exact outcome identities without translation.

### `packages/relay/src/types.ts` and barrels (model/config)

**Analog:** `RelayOutcome<T>` at `types.ts:205-209`.

Add one named type-only alias adjacent to it:

```ts
export type RelayCountOutcomes = Record<string, RelayOutcome<RelayCountResponse>>;
```

Keep `Relay.count(): Observable<RelayCountResponse>` unchanged. `src/index.ts:7` already star-exports `types.ts`, so the alias reaches the package root and `/types` without a runtime export. Do not add it to `Object.keys(exports)`.

## Test Pattern Assignments

### New `packages/relay/src/__tests__/group-count.test.ts`

**Primary analog:** `packages/relay/src/__tests__/group-error.test.ts:19-228`.

Reuse its lightweight fake Relay/Subject construction for deterministic synchronous cohorts, normalized URL identity, membership replacement, removed late errors, projection throws, and exact cause identity. Prefer this focused file over enlarging request/subscription tests.

Required progression oracle:

- fast success emits `{fast: success}` before slow settles;
- slow success emits a second fresh `{fast, slow}` snapshot;
- outcome/value identities persist between snapshots;
- reversed settlement does not change membership key order.

Required isolation oracle:

- success plus failure emits the successful partial snapshot, then the cumulative success/failure snapshot, and completes without outer error;
- all failures emit a cumulative all-failure record and complete;
- synchronous `relay.count()` throw is the URL's failure outcome.

Required dynamic cohort cases follow Phase 21's adversarial tests at `group-error.test.ts:74-171`: duplicate normalized URLs (last instance wins), same-URL replacement, ignored late signals, removed/re-added URL, retained in-flight operation, removal/retraction, and empty latest cohort without `{}`.

Add explicit tests for membership completion while counts remain pending, membership-source error identity/cancellation, last-subscriber cancellation, one call/ID/options per relay, concurrent sharing, and late final replay without new COUNT calls.

### Existing `packages/relay/src/__tests__/group.test.ts`

**Analog:** COUNT auth inheritance at `group.test.ts:436-468`.

Retain this real-wire proof but change its expectation from one bare combined response to cumulative `RelayOutcome` snapshots. It proves Group delegates scalar auth/retry mechanics unchanged rather than reimplementing them.

### `packages/relay/src/__tests__/pool.test.ts`

Use the existing real-wire forwarding style: observe both COUNT frames, assert one logical ID and exact filters/options, settle one relay before the other, and compare Pool snapshots/identity/order/completion with Group. Add late-subscriber replay and mixed success/failure parity; do not only assert final shape.

### Mandatory combineLatest mutation proof

The exact RED implementation is the current `group.ts:453-458` `switchMap + combineLatest` block. Temporarily restore it and run the named fast/slow and success/offline tests:

- fast/slow fails because no first partial snapshot is emitted;
- success/offline fails because the inner error escapes and no final cumulative outcome record completes.

Record commands and exact assertion failures in the implementation summary, restore the progressive accumulator, rerun GREEN, and verify no mutation residue. A final green suite alone is insufficient.

### Type fixture

**Analog:** `packages/relay/type-tests/group-error-types.ts:1-24`.

Use ordinary compiling statements plus `@ts-expect-error`:

```ts
declare const entry: RelayCountOutcomes[string];
if (entry.ok) entry.value.count satisfies number;
else entry.error satisfies unknown;

// @ts-expect-error entries require discriminant narrowing
entry.count;
```

Also prove `Relay.count()` remains scalar, `RelayGroup.count()` returns the alias, and `RelayPool.count()` exactly matches Group. Include the fixture in `tsconfig.type-tests.json` if new.

### Export tests

`RelayCountOutcomes` is type-only, following Phase 21's `RelayOutcome` precedent. `packages/relay/src/__tests__/exports.test.ts:4-39` should remain unchanged unless another runtime symbol is introduced; build/type tests, not runtime snapshot entries, prove root and `/types` reachability.

## Documentation and Provenance

### `apps/docs/loading/relays/pool.md`

Rewrite only the existing Count Method, Integration, and Best Practices sections at lines 183-218. Follow the repository component structure and keep examples under about 20 lines.

```ts
pool.count(relays, filter, "union").subscribe((outcomes) => {
  for (const [url, outcome] of Object.entries(outcomes)) {
    if (outcome.ok) console.log(url, outcome.value.count);
    else console.error(url, outcome.error);
  }
});
```

The HLL integration should collect only `outcome.ok && outcome.value.hll`, guard the empty array, then call `mergeHllRegisters` and `estimateHllCardinality`. State that snapshots are cumulative and provisional until completion; failures and missing sketches reduce coverage. Never recommend summing overlapping `count` values or treating missing HLL as zero.

### Phase 19/21 provenance

Amend stale claims in:

- `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md` (“without another return-type change” wording);
- `19-VERIFICATION.md:58-67` (current `combineLatest`, bare per-relay record, Phase 23 deferred statements);
- `19-03-PLAN.md` / `19-03-SUMMARY.md` and `19-PATTERNS.md` where all-or-nothing behavior is described as the Phase 19 boundary;
- Phase 21 verification/context references saying Phase 23 outcome consumption remains deferred.

Preserve the accurate provenance: Relay scalar COUNT policy/validation/HLL utilities stay unchanged, Observable-of-record topology stays stable, and only Group/Pool record entries become the already-planned `RelayOutcome` representation.

Update `.planning/REQUIREMENTS.md` COUNT-04/05 and `.planning/ROADMAP.md` Phase 23 status/criteria after implementation. Remove Pool docs' stale all-or-nothing/deferred-to-Phase-23 language.

### Changeset

Use `.changeset/relay-count-nip45.md` as the one-package, one-sentence format analog. Add one focused major changeset:

```md
---
"applesauce-relay": major
---

Make Group and Pool COUNT emit progressive per-relay success and failure outcomes.
```

## Shared Patterns

### Latest-cohort identity

**Source:** `group.ts:261-305`  
Normalize URLs, publish the complete membership/order before subscribing new inners, retain exact instances, cancel removed/replaced instances, and ignore stale callbacks with URL plus token identity.

### Error boundary

**Source:** `group.ts:194-197`; Phase 21 `RelayOutcome` at `types.ts:208-209`  
Per-relay failures become outcomes at the inner boundary. Membership and invariant failures remain exact outer errors. All-relay failure is a normal final record, never `RelayGroupError`.

### Fresh immutable snapshots

**Source:** ordered Phase 21 outcome construction at `group.ts:59-70`  
Create a new ordinary object in cohort order for every emission; retain outcome/value/error identity and omit pending entries.

### Shared replayed operation

**Source:** cached-state use of replay in `group.ts:132-147` and `pool.ts:59-77`, refined with explicit `share` reset controls  
One call owns one ID/execution; concurrent subscribers share; late terminal subscribers replay; last active unsubscribe cancels.

### HLL interpretation

**Source:** `nip45.ts:45-68`  
Merge only available successful sketches with register-wise maximum, then estimate; guard empty input and never sum relay counts.

## No Analog Found

None. The progressive COUNT accumulator is new as a dedicated helper, but Phase 21 supplies its cohort mechanics, package replayed state supplies its sharing precedent, and existing scalar COUNT/HLL code supplies the per-relay boundary.

## Metadata

**Analog search scope:** `packages/relay/src`, `packages/relay/type-tests`, Phase 19/21 artifacts, Pool documentation, Roadmap/Requirements, relay changesets  
**Strong implementation analogs:** Phase 21 `settledSubscription`, replayed status streams, scalar `Relay.count`, and NIP-45 utilities  
**Pattern extraction date:** 2026-09-01
