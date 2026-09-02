# Phase 24: Negentropy & Sync Re-layer - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Make low-level NIP-77 negentropy a correct, non-blocking, multi-round protocol stream and make high-level sync the single owner of authentication, reconnect, transfer scheduling, cancellation, and honest bidirectional outcomes. Close the two reachable Phase 13 residuals, migrate Relay/Group/Pool/loaders/docs to the new contracts, and prove the previously inert protocol and policy paths with deliberate RED→GREEN mutations.

</domain>

<decisions>
## Implementation Decisions

### Low-level Negentropy Protocol Contract
- **D-01:** Export `NegentropyRound` and make `Relay.negentropy(store, filter, opts?)` return a cold Observable that shares one negotiation execution among concurrent subscribers. Each value is one learned round: `{ have: string[]; need: string[] }`. — **Reversibility:** one-way — replacing the callback/Promise surface requires a public API migration.
- **D-02:** For every matching `NEG-MSG`, reconcile the local negentropy state serially, immediately write `['NEG-MSG', id, followUp]` when a follow-up exists, and only then emit the round. Subscriber or transfer work must never delay that write.
- **D-03:** Emit every successfully decoded round, including empty and terminal rounds. When reconciliation returns no follow-up, emit the terminal round, complete normally, and send exactly one `NEG-CLOSE` during teardown. Do not emit a final boolean or a synthetic completion value.
- **D-04:** The low-level interaction waits for shared transport readiness and owns no auth, reconnect, retry, transfer, or lifetime policy. `NEG-ERR auth-required:` becomes `AuthRequiredError`; recognized terminal prefixes remain typed; unknown `NEG-ERR` becomes `NegentropyError`; premature transport termination and client/protocol failures use the Observable error channel.
- **D-05:** Cancellation is deterministic: `AbortSignal` or unsubscribe tears down the socket listener, sends `NEG-CLOSE` if the negotiation opened, emits no fabricated round, and completes/cancels rather than resolving a boolean.
- **D-06:** Replace `NegentropySyncOptions` with raw `NegentropyOptions` containing only `id?`, `frameSizeLimit?`, and `signal?`. Remove `ReconcileFunction` and all auth options from the low-level public surface.
- **D-07:** Remove `RelayGroup.negentropy()` and multi-relay `RelayPool.negentropy()` in this coordinated major. Raw negotiation is selected explicitly with `pool.relay(url).negentropy(...)`; multi-relay event transfer belongs to `sync()`. — **Reversibility:** one-way — restoring these methods would reintroduce a group-level low-level API with no accepted round-attribution contract.

### High-level Sync Policy and Transfer Scheduler
- **D-08:** `sync()` owns one call-scoped auth coordinator: one `AuthPhaseGate`, one global total auth-retry counter, and one handler/wait policy across `NEG-OPEN`, EVENT uploads, and REQ downloads. Unrelated progress never replenishes the budget, overlapping branches cannot multiply it, and terminal auth failure cancels negotiation and all transfers.
- **D-09:** `sync()` has no built-in timeout and `RelaySyncOptions` gains no timeout field. Caller unsubscribe, `AbortSignal`, or composed RxJS duration/inactivity operators own lifetime policy. Planning must amend SYNC-03 and Roadmap criterion 3 from “one operation clock” to this explicit cancellable-lifetime contract.
- **D-10:** Add positive reconnect policy to `RelaySyncOptions`. Only positively identified unclean transport failures reconnect; relay verdicts, malformed protocol input, auth terminal errors, store errors, and programming failures do not.
- **D-11:** Each reconnect starts a completely fresh negotiation: rebuild storage from current state, mint a fresh NEG ID, install fresh listeners, and discard queued-but-not-started transfers from the failed attempt. Completed successful transfers remain reflected through the store and are naturally accounted for by the rebuilt vector.
- **D-12:** Add `concurrency?: number`, accepting a finite positive integer and defaulting to `4`. One unified scheduler enforces that bound across SEND and RECEIVE work, preserves FIFO order within each direction, and schedules fairly between non-empty lanes so a large upload batch cannot starve downloads.
- **D-13:** Negotiation continues at protocol speed while transfers run. Transfer results emit in settlement order, not input order. Once negotiation completes, accept no new work but keep the Observable open until all queued/in-flight transfers settle; only then complete.
- **D-14:** Timeout is intentionally not a scheduler failure mode. Terminal operation errors or unsubscribe cancel negotiation plus queued/in-flight work deterministically; individual event upload failures settle as values and do not cancel sibling transfers.

### Public Sync Results and Store Semantics
- **D-15:** Export `SyncMessage` as exactly:
  - `{ type: "received"; from: string; event: NostrEvent }`
  - `{ type: "sent"; from: string; event: NostrEvent; response: PublishResponse }`
  - `{ type: "send-failed"; from: string; event: NostrEvent; error: unknown; response?: PublishResponse }`
  `from` is the normalized relay URL. Negotiation rounds remain internal to high-level sync. — **Reversibility:** one-way — changing the discriminated union later requires coordinated consumer migrations.
- **D-16:** Emit `sent` only for a genuine `PublishResponse` with `ok: true`. A negative relay verdict and a thrown client/transport failure both emit `send-failed`, preserving the response when present and the original error by identity. Individual send failures never error the sync Observable; completion means every transfer settled, not every transfer succeeded.
- **D-17:** A fetched event emits `received` after a writable store accepts it. Read-only stores and array snapshots still emit the event without claiming persistence. A store write rejection is a terminal local operation error. Sync adds no duplicate-filtering policy beyond existing request/store behavior.
- **D-18:** A RECEIVE request that reaches EOSE with zero events is successful, emits no value, and never rejects with `EmptyError`.
- **D-19:** Export `GroupSyncMessage = SyncMessage | { type: "relay-failed"; from: string; error: unknown }`. RelayGroup converts each relay's terminal sync/support-check failure into one attributed `relay-failed` value while other relays continue; RelayPool forwards the same union unchanged. Empty groups complete, and supplied relays with no NIP-77 support are reported as attributed failures rather than one un-attributed outer error.

### Loader Residual and Consumer Migration
- **D-20:** In `sync-loader`, a non-auth negentropy failure must call `forceCloseAuthPhases()` synchronously before the paginated REQ fallback is constructed/subscribed. Keep the outer `finalize(forceCloseAuthPhases)` for completion, error, and unsubscribe. Auth-family failures still bypass fallback.
- **D-21:** Update `applesauce-loaders`' dependency-free structural sync mirror to the new result shape. Receive-only consumers filter `type === "received"` and map `.event`; Group/Pool consumers may also handle `relay-failed`.
- **D-22:** Migrate docs and examples away from treating sync values as raw events. SEND UI must count/inspect `sent` and `send-failed`; a `complete` callback alone must never be presented as proof that uploads succeeded.
- **D-23:** Replace callback-based low-level examples with Observable round handling and use caller-composed RxJS operators or cancellation for duration/inactivity policy.

### Proof, Provenance, and Release
- **D-24:** Require seven deliberate RED→GREEN mutation proofs:
  1. Delete the follow-up `NEG-MSG` write; the real >32-item fixture must stall/fail.
  2. Move round emission before the follow-up write; a synchronously blocking subscriber must delay the wire and fail the ordering proof.
  3. Await transfer completion inside negotiation; round two must be withheld and fail the non-blocking proof.
  4. Replace the concurrency-4 scheduler with unbounded scheduling; observed active transfers must exceed four.
  5. Keep SEND continuously busy without fair scheduling; RECEIVE must starve and fail the fairness proof.
  6. Restore independent per-verb auth counters; total auth-triggered writes must exceed the one global budget.
  7. Retain failed negotiation state/ID across reconnect; the retry must fail the fresh NEG-OPEN/storage-vector proof.
- **D-25:** The complete behavioral matrix also covers send-before-emit, every/terminal/empty round emission, exact `NEG-CLOSE` cardinality, abort and unsubscribe, typed `NEG-ERR`, premature transport termination, fresh reconnect, queue-drain completion, settlement-order results, successful/negative/thrown SEND outcomes, writable/read-only store behavior, zero-event EOSE, Group isolation/attribution, Pool forwarding, and loader fallback clock re-arming.
- **D-26:** Create separate one-sentence major `applesauce-relay` changesets for the low-level negentropy API replacement and the sync result/policy replacement. Add a focused `applesauce-loaders` patch changeset for force-closing auth before fallback. Reconcile existing pending auth/group-sync changesets so no release note is false or duplicates the new major contract.
- **D-27:** Amend canonical Roadmap/requirements provenance for the accepted absence of a sync timeout, update the Phase 13 residual record when closed, and audit docs/type mirrors/callers for stale Promise, callback, raw-event, silent-failure, and completion-means-success claims.

### the agent's Discretion
- Choose internal scheduler/operator decomposition, private coordinator names, and typed protocol error subclass details consistent with existing relay patterns.
- Choose whether the cold shared negentropy Observable replays the most recent round to a late concurrent subscriber, provided one returned Observable never starts duplicate negotiation executions and post-terminal behavior is tested/documented.
- Choose concise implementation details for fair lane arbitration, provided the global bound, FIFO-per-lane, and no-starvation contracts are observable in tests.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract and Layering
- `.planning/ROADMAP.md` § Phase 24 — phase goal, dependencies, success criteria, and the operation-clock wording that must be amended.
- `.planning/REQUIREMENTS.md` § SYNC Family and Residual Correctness — SYNC-01 through SYNC-04 and RESID-03.
- `.planning/phases/18-event-family-re-layer/18-CONTEXT.md` — readiness-aware low-level EVENT and high-level policy ownership precedent.
- `.planning/phases/22-req-family-re-layer/22-CONTEXT.md` — raw REQ/high-level request-subscription layering, positive reconnect classification, and internal lifecycle composition.

### NIP-77 and Phase 13 Residuals
- `.planning/research/FEATURES.md` § Negentropy — locally recorded canonical NIP-77 parallel-negotiation/transfer requirement and typed sync-result rationale.
- `.planning/research/ARCHITECTURE.md` § Relay method layering and sync — current bypasses, public type blast radius, and loader structural mirror.
- `.planning/research/PITFALLS.md` § Negentropy/sync — multi-round non-vacuity, blocking callback, concurrency, union-exhaustiveness, and relay-controlled error-key hazards.
- `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-REVIEW.md` § WR-04 — open auth phase disarming the paginated fallback clock and the required transition cleanup.
- `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-06-SUMMARY.md` — existing negentropy auth/NEG-CLOSE behavior and sync auth forwarding provenance.

### Existing Public Guidance and Consumers
- `apps/docs/loading/relays/negentropy.md` — callback/Promise and raw-event examples requiring migration.
- `apps/docs/loading/relays/relays.md` § Negentropy and Sync — canonical Relay examples, including completion-only SEND messaging requiring correction.
- `packages/loaders/src/loaders/sync-loader.ts` — structural Relay sync mirror, fallback behavior, auth-phase accounting, and loader lifetime policy.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AuthPhaseGate` and shared auth-retry machinery: basis for one ref-counted operation auth coordinator, with the auth counter changed from per-verb/consecutive behavior to the accepted global sync budget.
- `isReconnectableTransportError` and existing retry normalization: positive reconnect precedent for fresh sync negotiations.
- `Relay.event()`/raw `req()` plus existing parsing and teardown: raw transfer attempts that can be coordinated by sync without nesting independent high-level policy budgets.
- RxJS `share`, `defer`, cancellation, and existing per-attempt send/listen factories: precedent for one cold shared execution and fresh protocol state.
- `mapEventsToStore` and typed `PublishResponse`: reusable receive persistence and send-verdict boundaries.

### Established Patterns
- Low-level methods are readiness-aware single interactions; high-level family members own configurable auth/reconnect/concurrency policy.
- Protocol lifecycle/verdict frames become typed values where promised; transport/client failures use the error channel.
- Fresh unshared send/listen construction prevents synchronous retry from joining a dead chain.
- Public discriminated unions use exhaustive type narrowing; Group/Pool forward attributed values rather than silently translating them.
- Changesets each describe exactly one change in one markdown sentence.

### Integration Points
- `packages/relay/src/negentropy.ts` owns storage-vector construction, negentropy state progression, raw options, round values, and NEG frame teardown.
- `packages/relay/src/relay.ts` owns `Relay.negentropy()`, the high-level sync coordinator/scheduler, sync result types, reconnect, store integration, and cancellation.
- `packages/relay/src/group.ts` and `packages/relay/src/pool.ts` own removal of raw group negentropy plus `GroupSyncMessage` attribution/forwarding.
- `packages/relay/src/types.ts` and root exports own `NegentropyRound`, `NegentropyOptions`, `RelaySyncOptions`, `SyncMessage`, and `GroupSyncMessage` public contracts.
- `packages/loaders/src/loaders/sync-loader.ts` owns the RESID-03 fallback cleanup and structural result migration.
- Relay/Group/Pool/loaders tests, type fixtures, export snapshots, docs, and examples collectively guard the coordinated major migration.

</code_context>

<specifics>
## Specific Ideas

- The decisive wire-order oracle is `reconcile -> send follow-up NEG-MSG -> emit NegentropyRound`.
- Use a genuine dataset above the negentropy frame threshold rather than a mocked state-machine response to prove the second round reaches the socket.
- Default transfer concurrency is exactly four, shared fairly across both directions.
- A sync has intentionally no built-in duration or inactivity clock; callers compose the policy appropriate to their workflow.
- Completion means negotiation ended and the bounded transfer queue drained. Consumers inspect outcome values to determine success quality.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 24 scope.

</deferred>

---

*Phase: 24-negentropy-sync-re-layer*
*Context gathered: 2026-09-02*
