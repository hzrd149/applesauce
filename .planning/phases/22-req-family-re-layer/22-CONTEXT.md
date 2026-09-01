# Phase 22: REQ Family Re-layer - Context

**Gathered:** 2026-09-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Make `req()` a readiness-aware raw REQ interaction with no auth/reconnect/repeat policy, move those policies into finite `request()` and persistent `subscription()`, and preserve all lifecycle, retry-budget, Group/Pool, sync-auth, and Phase 13 regression guarantees. Persistent subscriptions have no built-in duration/inactivity timeout at any layer.

</domain>

<decisions>
## Implementation Decisions

### Raw `req()` Contract
- **D-01:** Preserve the full `FilterInput` surface and only `id?: string` as raw options. Dynamic filter values update filters within the same live REQ interaction. Remove reconnect, resubscribe, auth, and timeout policy from `RelayReqOptions`.
- **D-02:** One `req()` call mints one call-scoped ID unless supplied. Its shared cold-on-first-subscription Observable waits for readiness, then owns one live interaction; concurrent subscribers share its ID/write/listener. A later subscription after terminal share reset may start a fresh interaction with that same call-scoped ID.
- **D-03:** Emit synthetic `OPEN` plus matching `EVENT`, `EOSE`, and ordinary unprefixed `CLOSED` as values. Emit ordinary CLOSED inclusively and then complete. Translate `auth-required:` to `AuthRequiredError`, recognized terminal prefixes to typed `RelayClosedError` subclasses, and socket/client failures to Observable errors. Raw `req()` never authenticates, reconnects, repeats, or resends.
- **D-04:** Send exactly one client CLOSE on local unsubscribe, filter-input completion, or client/error teardown while the REQ remains open. Send no redundant CLOSE after matching relay CLOSED. EOSE is non-terminal for raw `req()`; high-level finite request owns EOSE completion and teardown.

### Finite `request()` Policy
- **D-05:** `request()` owns one call-scoped auth gate/counter and one logical REQ ID. Every auth resend, reconnect retry, or clean-CLOSED resubscribe creates a fresh unshared raw send/listen attempt while reusing that logical ID.
- **D-06:** Reconnect only positively identified unclean transport failures, using the existing `requestReconnect` default of three retries. Repeat only after ordinary clean relay CLOSED and only when caller resubscribe policy enables it. Auth-required enters only the bounded auth branch.
- **D-07:** Typed CLOSED refusals, auth exhaustion/handler/timeout errors, whole-operation timeout, arbitrary errors, and programming errors terminate immediately and never enter generic reconnect/repeat.
- **D-08:** Preserve a 30-second default whole returned-Observable lifetime from subscription through readiness, retry/reconnect/resubscribe delays, and every wire attempt. Activity never resets or disarms it. The shared auth gate pauses it with remaining budget preserved; expiry is terminal and not reconnectable.
- **D-09:** Default request emits only `NostrEvent`; first matching EOSE completes successfully without emission and tears down the active REQ. Preserve custom completion operators over lifecycle messages. A custom completion signal finishes successfully without reconnect/repeat, while an error from the same terminal notification wins.

### Persistent `subscription()` Policy
- **D-10:** `subscription()` exclusively owns three bounded branches: auth-required → auth handler/wait/resend; identified unclean transport loss → reconnect using `subscriptionReconnect`; ordinary clean CLOSED → repeat only when resubscribe is enabled. Typed refusal, terminal auth errors, arbitrary errors, and local unsubscribe terminate.
- **D-11:** Reuse one call-scoped REQ ID across re-established attempts. Each fresh attempt internally emits synthetic OPEN, but the public `Observable<NostrEvent | "EOSE">` hides OPEN and emits EOSE for every attempt, including after reconnection or resubscription.
- **D-12:** Direct Relay subscription remains non-deduplicating. Group/Pool retain one call-scoped event store outside re-establish attempts, so default deduplication spans reconnect/resubscribe; `eventStore: null` disables it.
- **D-13:** Long-running subscriptions have no timeout option on Relay, Group, or Pool. They run until the consumer unsubscribes or a terminal failure occurs. Duration and inactivity limits are caller-composed RxJS concerns; total relay failure at Group/Pool still errors immediately and requires no clock.

### Positive Option Surfaces
- **D-14:** Define `RelayReqOptions` positively with ID only. Define `RelayRequestOptions` independently with ID, auth, reconnect, resubscribe, timeout, and complete. Define `RelaySubscriptionOptions` independently with ID, auth, reconnect, and resubscribe only.
- **D-15:** `GroupReqOptions` remains raw ID-only. `GroupRequestOptions` adds group completion/deduplication to request policy. `GroupSubscriptionOptions` adds only eventStore to subscription policy. Pool continues deriving Group method parameters so `subscription`, `subscriptionMap`, and `outboxSubscription` reject timeout automatically.
- **D-16:** Do not use broad `Omit`-based public types or handwritten Pool duplicates; positive declarations prevent future policy leakage and derived Pool signatures prevent drift.

### Shared Lifecycle Composition and Internal Consumers
- **D-17:** Build one private lifecycle-level compositor around fresh raw req attempts, retaining OPEN/EOSE/CLOSED metadata for high-level Relay and Group composition. Do not duplicate auth/reconnect/repeat loops per consumer or reconstruct lost metadata from mapped public streams.
- **D-18:** Rewire sync RECEIVE away from public raw req to the finite high-level/private compositor in this phase so removing policy from raw req cannot silently remove its existing operation-scoped auth behavior. Keep Group raw req as raw fan-out. Phase 24 may later consolidate sync policy ownership.

### Regression and Mutation Proof
- **D-19:** Re-prove the Phase 13 per-attempt defer invariant by deliberate revert: removing fresh attempt construction must make a synchronous auth handler lose the resent REQ/listener, then pass GREEN restored.
- **D-20:** Re-prove call-scoped clean-CLOSED repeat state: moving the resubscribe holder into attempt scope must prevent the next enabled repeat, then pass GREEN restored.
- **D-21:** Re-prove progress classification: counting synthetic OPEN as progress must break exact auth retry bounds; counting manufactured Group ERROR as progress must break request settlement/timeout evidence. Do not trust a merely green relocated suite.
- **D-22:** Add exact wire/listener/CLOSE counts, positive reconnect allowlist, terminal single-attempt proof, independent concurrent gates/counters, stable ID, hidden OPEN, repeated EOSE, and Group/Pool dedupe across re-establishment.

### Phase 21 Reversal, Documentation, and Release
- **D-23:** Explicitly amend Phase 21 provenance, requirements, Roadmap, docs, tests, and release metadata: remove the newly added Group/Pool subscription timeout and `authSuspendableLifetime` wrapper while preserving request whole-timeout/auth suspension and immediate Group/Pool total-failure settlement.
- **D-24:** Replace Phase 21 subscription-timeout runtime/type assertions with compile-time rejection and immediate-total-failure proofs. Revise the pending Phase 21 major changeset in place so the unreleased v7 changesets never contradict each other.
- **D-25:** Update existing docs to state that Relay/Group/Pool subscriptions have no duration or inactivity option and show concise caller composition with RxJS `timeout`, `takeUntil(timer(...))`, or equivalent. Keep examples focused and under project code-block limits.
- **D-26:** Add one focused major `applesauce-relay` Phase 22 changeset for REQ policy relocation and public option removal, with an exactly one-sentence body.

### the agent's Discretion
- Choose private compositor/helper names and RxJS decomposition consistent with existing EVENT/AUTH family patterns.
- Choose exact type-fixture/test-file placement and concise documentation examples.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract
- `.planning/ROADMAP.md` § Phase 22 and § Phase 999.25 — REQ family goal, re-layering rationale, and required Phase 13 regression proof.
- `.planning/REQUIREMENTS.md` § REQ Family — REQ-01 through REQ-05.
- `.planning/phases/18-event-family-re-layer/18-CONTEXT.md` — established raw/high family boundary, readiness, positive retry allowlist, and fresh attempt rules.
- `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md` — call-scoped whole-operation deadline and positive retry precedent.
- `.planning/phases/21-group-error-surface-request-subscription/21-CONTEXT.md` — Group settlement/deduplication contract and subscription-timeout claims explicitly superseded here.

### Historical Regression Sources
- `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/` — original auth retry/reentrancy decisions, summaries, and regression provenance.
- `.changeset/relay-auth-retry-bound-not-reset-by-req-open.md` — synthetic OPEN must never count as auth progress.
- `apps/docs/migration/v5-v6.md` — public lifecycle/custom completion guidance.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Current `req()` contains the per-attempt defer, call-scoped resubscribe holder, lifecycle parsing, readiness gate, and exact CLOSE logic to separate rather than rewrite blindly.
- `AuthPhaseGate`, auth retry helpers, positive transport classifier, and suspendable whole timeout already implement the required high-level policy pieces.
- Group/Pool call-scoped event-store placement already preserves deduplication above per-relay attempt loops.

### Established Patterns
- Low-level operations own readiness and one protocol interaction; high-level members own configurable auth/reconnect/repeat/timeout policy.
- Protocol lifecycle is value-shaped, while typed terminal/client failures use the Observable error channel.
- Each real resend uses a fresh unshared listener/write factory; logical IDs and retry budgets remain call-scoped.
- Persistent subscriptions are consumer-owned lifetimes and have no built-in duration/inactivity clock.

### Integration Points
- `packages/relay/src/relay.ts` and `types.ts` contain raw req, high-level request/subscription, sync RECEIVE, policy helpers, and public option types.
- `packages/relay/src/group.ts` requires full lifecycle metadata for dynamic cohort settlement and dedupe.
- `packages/relay/src/pool.ts` derives Group signatures for request/subscription forwarding families.
- Relay/Group/Pool tests, type fixtures, Phase 13 regressions, docs, requirements, Roadmap, and pending changesets must move together.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly stated that subscriptions exist to run until the consumer no longer needs them; built-in timeout policy is therefore inappropriate at every subscription layer.
- Finite request timeout remains one whole-operation convenience; subscription duration/inactivity uses caller-composed RxJS operators.

</specifics>

<deferred>
## Deferred Ideas

- Phase 24 may consolidate sync-owned auth/retry policy after Phase 22 preserves current RECEIVE behavior.
- Direct Relay subscription deduplication remains out of scope; Group/Pool own that stateful convenience.

</deferred>

---

*Phase: 22-req-family-re-layer*
*Context gathered: 2026-09-01*
