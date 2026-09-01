# Phase 23: Group count() Isolation - Context

**Gathered:** 2026-09-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace Group/Pool COUNT's all-or-nothing `combineLatest` aggregation with a shared, replayed, progressive URL-keyed record of Phase 21 `RelayOutcome` entries, isolating each relay's success/failure while preserving scalar Relay COUNT policy and enabling correct HLL-based union estimates.

</domain>

<decisions>
## Implementation Decisions

### Progressive Outcome Contract
- **D-01:** Group/Pool COUNT returns `Observable<Record<string, RelayOutcome<RelayCountResponse>>>`, keyed by normalized relay URL. Success is `{ ok: true, value }`; failure is `{ ok: false, error }` preserving cause identity. Pending relays are omitted rather than adding a third outcome arm.
- **D-02:** Emit a fresh cumulative snapshot immediately whenever one active relay settles success or failure. The first emission contains one settled URL; later emissions contain every settled outcome in the latest cohort.
- **D-03:** Materialize every individual relay COUNT error—transport exhaustion, timeout, refusal, malformed response, terminal auth failure, synchronous projection throw—as that URL's failure outcome. Never raise `RelayGroupError` because some or all relay counts failed.
- **D-04:** When all current relays settle, emit the complete record, including an all-failure record, then complete. Only membership-source errors and internal normalization/invariant failures use the outer Observable error channel.

### Dynamic Cohort Identity and Removal
- **D-05:** Reuse Phase 21 latest-cohort semantics. Normalize URLs and allow one entry per normalized URL, with the last instance in the latest membership emission winning.
- **D-06:** Same-URL instance replacement immediately unsubscribes/discards the old COUNT, starts one fresh COUNT on the replacement, and ignores late old signals. A removed then re-added relay starts fresh.
- **D-07:** Retained relay instances keep settled outcomes and in-flight work across membership changes. Added relays enter pending and start one COUNT. Removed relays are immediately unsubscribed and omitted from future records.
- **D-08:** If membership removal changes an emitted result and remaining settled outcomes are non-empty, emit a fresh retraction snapshot. If removal makes the latest cohort empty, complete successfully without emitting `{}`. An initially empty cohort also completes without emission.
- **D-09:** Complete when the latest finite cohort is fully settled. Membership-source completion does not cancel active counts; allow the current cohort to settle, emit its final record, then complete.

### Snapshot Identity, Ordering, and Sharing
- **D-10:** Emit a new ordinary object for every snapshot and never mutate an earlier record. Key order follows latest normalized cohort membership order, not response timing, and includes only settled URLs.
- **D-11:** Preserve every `RelayOutcome`, response value, and error by identity. Do not freeze snapshots or change them to null-prototype objects.
- **D-12:** One `group.count()` call mints one ID eagerly unless supplied, forwards it unchanged to every relay and same-URL replacement, and owns one shared cohort execution.
- **D-13:** Replay the latest snapshot to subscribers joining an active operation. After completion, late subscribers receive the final snapshot and completion without issuing new COUNTs. Pool forwards identical behavior. Empty operations replay only completion.

### Per-relay Policy and Cancellation
- **D-14:** Preserve `(filters, id?, opts?)`; forward the same `Filter | Filter[]`, logical ID, and `RelayCountOptions` unchanged to each relay. Do not add function-valued/per-URL filters, option maps, or Group-specific timeout/retry defaults.
- **D-15:** Every `relay.count()` remains an independent high-level operation with its own readiness wait, whole deadline, auth/retry counters, backoff, fresh attempts, and terminal classification. One relay never pauses, resets, cancels, or errors another.
- **D-16:** Subscribe to all active relay COUNT operations concurrently with no new concurrency limit or buffering option. Emit synchronously as settlements occur.
- **D-17:** Outer unsubscribe immediately cancels membership tracking and every active COUNT, including retry timers/auth waits and normal wire teardown. Membership-source errors do the same and propagate with exact cause identity.

### Aggregate Interpretation
- **D-18:** Add no automatic total or new aggregate helper. Callers narrow successful outcomes, collect available `value.hll` sketches, and use existing `mergeHllRegisters` plus `estimateHllCardinality`.
- **D-19:** Partial snapshots are provisional until completion. Failed outcomes and successful responses without HLL reduce coverage and are excluded; documentation must never recommend summing overlapping relay `count` values or treating missing sketches as zero.

### Public Types and Compatibility
- **D-20:** Change only Group/Pool COUNT entry types. Keep `Relay.count(): Observable<RelayCountResponse>` unchanged. Export `RelayOutcome` and a named count-outcome record alias from package root and `applesauce-relay/types`.
- **D-21:** Compile-time tests prove `outcome.ok` narrows value/error, bare `.count` access on an entry fails, Relay scalar return is unchanged, and Pool exactly matches Group.
- **D-22:** A membership-source error is never fabricated as a URL outcome. Synchronous/asynchronous per-relay projection errors are outcomes; normalization/internal invariant errors remain outer errors.

### Documentation, Provenance, and Release
- **D-23:** Rewrite the existing Pool COUNT guide for cumulative partial snapshots, success narrowing, per-URL failures, successful-HLL extraction, and reduced coverage. Keep examples concise and under project block-length rules.
- **D-24:** Remove stale all-or-nothing, bare response-record, and deferred-to-Phase-23 claims. Amend Phase 19's “without another return-type change” wording: Observable/record topology remained stable while entries became the already-planned shared outcome representation.
- **D-25:** Add one focused major `applesauce-relay` changeset with exactly one markdown sentence describing progressive per-relay Group/Pool COUNT outcomes.
- **D-26:** Prove non-vacuity by deliberately replacing the accumulator with `combineLatest`: a fast/slow progression test and success/offline isolation test must fail RED, then pass GREEN after restoration. Record exact commands, failures, and restoration.
- **D-27:** Runtime coverage includes progressive fast/slow, mixed/all failures, duplicate normalized URL, same-URL replacement and late ignored signals, removal/retraction, empty/dynamic cohorts, deterministic order, shared/replayed subscribers, exact ID/options forwarding, Pool parity, membership-source error, outer cancellation, and HLL extraction from successes.

### the agent's Discretion
- Choose names for the exported count-outcome record alias and private progressive cohort helper.
- Choose focused test-file placement and RxJS decomposition consistent with Phase 21's cohort implementation.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract
- `.planning/ROADMAP.md` § Phase 23 — progressive isolation goal and Phase 19/21 dependencies.
- `.planning/REQUIREMENTS.md` § COUNT Family — COUNT-04 and COUNT-05.
- `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md` — scalar COUNT validation/policy/HLL contract and provenance requiring clarification.
- `.planning/phases/21-group-error-surface-request-subscription/21-CONTEXT.md` — `RelayOutcome`, normalized latest-cohort behavior, empty finite semantics, and same-URL replacement precedent.
- `.planning/phases/21-group-error-surface-request-subscription/21-VERIFICATION.md` — adversarial dynamic cohort fixes that COUNT must preserve.

### Public Documentation
- `apps/docs/loading/relays/pool.md` — existing all-or-nothing COUNT example and aggregation guidance to replace.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 21's normalized membership/state/subscription machinery provides the closest replacement, removal, ordering, and error-boundary analog.
- `RelayOutcome`, `RelayCountResponse`, `mergeHllRegisters`, and `estimateHllCardinality` already exist and are exported.
- Each scalar `Relay.count()` already owns the independent high-level timeout/auth/retry policy Group should materialize, not duplicate.

### Established Patterns
- Per-source failures become outcomes only at an aggregation boundary; membership/invariant failures remain outer Observable errors.
- Dynamic finite operations use latest active cohort membership and complete successfully on empty.
- Shared progressive state replays one latest immutable snapshot without duplicating wire work.
- Changesets describe exactly one change in one markdown sentence.

### Integration Points
- `packages/relay/src/group.ts` currently uses `combineLatest` for COUNT and owns dynamic membership.
- `packages/relay/src/pool.ts` transparently forwards Group COUNT.
- `packages/relay/src/types.ts` and package barrels own the named progressive record type.
- Group/Pool tests, type fixtures, export snapshots, docs, Phase 19 provenance, and changesets must move together.

</code_context>

<specifics>
## Specific Ideas

- The user accepted cumulative progressive snapshots rather than deltas, with no pending variant.
- An empty latest cohort completes without `{}` even after prior membership; non-empty membership retractions emit revised snapshots.
- Correct cross-relay totals use HLL union helpers only when sketches are available, never naive count summation.

</specifics>

<deferred>
## Deferred Ideas

- Per-relay query/filter option maps and Group-specific retry/concurrency controls remain out of scope.
- Automatic aggregate total emission remains out of scope; existing explicit HLL utilities are sufficient.

</deferred>

---

*Phase: 23-group-count-isolation*
*Context gathered: 2026-09-01*
