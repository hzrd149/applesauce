# Roadmap: Applesauce

## Milestones

- ✅ **v1.0 event-store-supports-rumors** — Phases 1–4 (shipped 2026-07-09)
- ✅ **v1.1 first-fixes** — Phases 5–12.3 (shipped 2026-08-04)
- ✅ **v1.2 operation-scoped-relay-auth** — Phases 13–15 (shipped 2026-08-19)
- 🚧 **v7.0.0 relay-method-layering** — Phases 16–26 (in progress)

## Phases

<details>
<summary>✅ v1.0 event-store-supports-rumors (Phases 1–4) — SHIPPED 2026-07-09</summary>

Genericized the applesauce event layer over `E extends StoreEvent = NostrEvent` so it can operate on unsigned NIP-59 `Rumor` events, with zero behavior change for signed-`NostrEvent` consumers. Full details: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md).

- [x] Phase 1: Generic store foundation (4/4 plans) — completed 2026-07-09
- [x] Phase 2: Generic models & casts (3/3 plans) — completed 2026-07-09
- [x] Phase 3: RumorStore & verification (3/3 plans, Part A gate) — completed 2026-07-09
- [x] Phase 4: Common package rumor support (1/1 plan) — completed 2026-07-09

</details>

<details>
<summary>✅ v1.1 first-fixes (Phases 5–12.3) — SHIPPED 2026-08-04</summary>

Brought `applesauce-concord` into conformance with the CORD-01..07 protocol specs — all 43 findings from the 2026-07-15 audit closed, plus the shared `applesauce-core` cache defect that caused three of them. 54/54 requirements satisfied; 12/12 phases verified. Full phase details, success criteria, and spec citations: [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md). Requirements: [`milestones/v1.1-REQUIREMENTS.md`](milestones/v1.1-REQUIREMENTS.md). Audit: [`milestones/v1.1-MILESTONE-AUDIT.md`](milestones/v1.1-MILESTONE-AUDIT.md).

- [x] Phase 5: Cache Identity Memo Fix (14/14 plans) — completed 2026-07-29
- [x] Phase 5.1: Symbol Propagation Redesign (INSERTED) (13/13 plans) — completed 2026-07-16
- [x] Phase 6: Refounding Rotation & Authority Correctness (3/3 plans) — completed 2026-07-16
- [x] Phase 7: Private Channel Keying (4/4 plans) — completed 2026-07-17
- [x] Phase 8: Rotation Robustness & Consensus (6/6 plans) — completed 2026-07-19
- [x] Phase 9: Authority & Permission Fold Correctness (5/5 plans) — completed 2026-07-19
- [x] Phase 10: Invite Lifecycle & Event Time Consistency (6/6 plans) — completed 2026-07-21
- [x] Phase 11: Messaging Wire Conformance (6/6 plans) — completed 2026-07-29
- [x] Phase 12: Document & Caps Conformance (11/11 plans) — completed 2026-08-01
- [x] Phase 12.1: Concord Sync Skips Ephemeral Kind 21059 (INSERTED) (1/1 plan) — completed 2026-07-22
- [x] Phase 12.2: Concord Sync Debug Logging (INSERTED) (4/4 plans) — completed 2026-07-22
- [x] Phase 12.3: Transport-Only Extra Relays (INSERTED) (14/14 plans) — completed 2026-07-25

**Breaking changes shipped:** `ChannelMetadata.voice` removed (CORD-03 §2 and CORD-07 §1 both state no per-channel voice flag exists); `ChannelMetadata.key`/`.epoch` removed (client-tracked keying must not ride folded edition metadata).

**Carried forward as debt:** three Nyquist validation gaps (Phases 10 and 12.2 partial, 12.1 missing); five accepted overrides; one `low` follow-ups todo. Detail in STATE.md → Deferred Items.

</details>

<details>
<summary>✅ v1.2 operation-scoped-relay-auth (Phases 13–15) — SHIPPED 2026-08-19</summary>

Moved NIP-42 authentication out of ambient, relay-wide cached state and into the operation that actually receives `auth-required:`, made a single auth attempt's lifecycle legible in debug output, and migrated Concord's stream auth off its client-wide registry driver onto per-operation handlers owned by each community and private-channel engine. 16/16 requirements satisfied; 3/3 phases verified; all three Nyquist-compliant. Full phase details, success criteria and decisions: [`milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md). Requirements: [`milestones/v1.2-REQUIREMENTS.md`](milestones/v1.2-REQUIREMENTS.md). Audit: [`milestones/v1.2-MILESTONE-AUDIT.md`](milestones/v1.2-MILESTONE-AUDIT.md).

- [x] Phase 13: Operation-Scoped NIP-42 Auth Hooks (14/14 plans, 3 verification rounds) — completed 2026-08-07
- [x] Phase 14: Auth Lifecycle Debug Logging (9/9 plans) — completed 2026-08-11
- [x] Phase 15: Concord Stream-Auth Cleanup (14/14 plans, gap closure 15-09..15-14) — completed 2026-08-18

**Breaking changes shipped:** none published — v1.2 ships no npm release. Its `applesauce-relay` and `applesauce-loaders` changesets are held for **v7.0.0**, which also carries the relay/auth re-layering cluster (999.23–999.28).

**Carried forward as debt:** 23 open review residuals, all filed — Phase 13's in 999.18, Phase 14's in 999.16, Phase 15's in 999.19. Phase 14's WR-06 (the auth-exhausted `PublishResponse` omitting `.error` while a shipped changeset claims otherwise) is absorbed into 999.24 and corrected before anything publishes. Detail in [`milestones/v1.2-MILESTONE-AUDIT.md`](milestones/v1.2-MILESTONE-AUDIT.md).

</details>

### 🚧 v7.0.0 relay-method-layering (Phases 16–26) (In Progress)

**Milestone Goal:** Make every relay method family honour one rule — a low-level method (`event()`, `req()`, `negentropy()`) is a single interaction with the relay; a high-level method (`publish()`, `request()`, `subscription()`, `count()`, `sync()`, `authenticate()`) owns the configurable policy: retries, reconnects, auth retries, resubscribes, timeouts, and concurrency — then ship the result, plus v1.2's held changesets, as the coordinated `applesauce-*@7.0.0` major.

**Origin:** assembled from backlog entries 999.12, 999.14, 999.15, 999.16 (WR-06 folded into Phase 18), 999.18 (residual re-verification folded throughout the re-layer phases), 999.19, 999.20–999.28, plus three ecosystem seeds (SEED-002/003/004). Continues phase numbering from v1.2's Phase 15 — real phases run 1–15; the `999.x` directories under `.planning/phases/` are backlog placeholders, not completed phases. Full requirements: [`REQUIREMENTS.md`](REQUIREMENTS.md). Full research: [`research/SUMMARY.md`](research/SUMMARY.md), [`research/ARCHITECTURE.md`](research/ARCHITECTURE.md).

**Hard sequencing.** Phase 16 (the amended D-01) gates every other phase — four requirement clusters cite it directly. Phase 18 (EVENT) lands before Phase 22 (REQ) so the pattern proves on the smaller surface first. Phase 19 (COUNT high-level) lands before Phase 23 (COUNT isolation), which consumes its re-shaped response type. Phase 21 (GROUP) lands before Phase 22 (REQ) — both touch `group.ts`'s `request()`/`subscription()` bodies and the same suspendable clock. Two dependencies came from research rather than the original backlog: Phase 24 (SYNC) needs both Phase 18 and Phase 22, since `Relay.sync()` calls `event()`/`req()` directly, bypassing their high-level siblings; and Phase 20 (AUTH) must close any new terminal auth error class in the same phase that adds it, since `applesauce-loaders`' duck-typed `RELAY_AUTH_ERROR_NAMES` breaks silently rather than at compile time.

- [x] **Phase 16: Method Layering Foundation & TypeScript 7** - Amend D-01's throw-as-signal rule everywhere it's cited and land the workspace on TypeScript 7 before anything else builds under it
- [x] **Phase 17: Correctness Fixes & Concord Residuals** - Independent relay/sqlite/NIP-29 bug fixes plus two Concord auth/publish-honesty gaps, none gated by the re-layering (completed 2026-08-20)
- [x] **Phase 18: EVENT Family Re-layer** - `event()` sends once and throws; `publish()` becomes sole owner of the auth retry loop (completed 2026-08-20)
- [x] **Phase 19: COUNT Becomes the High-Level Member** - `count()` gains `reconnect`/`retries`/`timeout` and a validated NIP-45 response shape with an HLL merge helper (completed 2026-08-21)
- [x] **Phase 20: AUTH Family Re-layer** - `authenticate()` acquires and re-verifies a challenge instead of racing a stale one under a slow signer (completed 2026-08-31)
- [x] **Phase 21: Group Error Surface — request()/subscription()** - Total group failure raises a real aggregate error instead of completing empty or hanging forever (completed 2026-09-01)
- [x] **Phase 22: REQ Family Re-layer** - `req()` sheds reconnect/resubscribe/auth retry; `request()`/`subscription()` own them, including subscription's own re-establish loop (completed 2026-09-01)
- [x] **Phase 23: Group count() Isolation** - One dead relay costs its own count, not every relay's, and counts accumulate progressively (completed 2026-09-02)
- [x] **Phase 24: Negentropy & Sync Re-layer** - Multi-round reconciliation reaches the wire; `sync()` owns one coherent auth/clock/concurrency policy across both directions (completed 2026-09-02)
- [ ] **Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2** - `applesauce-react`'s first rendering tests, and `apps/examples` on worker-relay v2, both independent of the relay work
- [ ] **Phase 26: Release Coordination — v7.0.0** - Every intended package reaches 7.0.0, verified by a changeset dry run, with Concord's first stable release

## Phase Details

### Phase 16: Method Layering Foundation & TypeScript 7

**Goal**: The relay package's low/high layering rule is stated correctly everywhere D-01 is cited, and the whole workspace builds and tests clean under TypeScript 7 before any behavior change lands on top of it.
**Depends on**: Nothing (first phase of v7.0.0)
**Requirements**: LAYER-01, LAYER-02, ECO-01
**Success Criteria** (what must be TRUE):

  1. Reading D-01 at its source of record states the actual rule: throw-as-signal is acceptable at a one-hop aggregator or retry boundary, and still a smell across a multi-hop chain — not the old blanket ban.
  2. Every one of the 14 shipped-source citations of D-01 (`relay.ts` ×10, `operators/auth-retry.ts` ×3, `__tests__/relay.test.ts` ×1) reads consistently with the amended rule.
  3. `pnpm run build` and the full test suite pass with `typescript@^7` as the workspace compiler, with no package needing a TS7-specific code change.

**Plans**: 7/8 plans executed

Plans:

- [x] 16-01-PLAN.md — Amend D-01 and all 14 shipped citations without runtime changes
- [x] 16-02-PLAN.md — Pin the root, apps, and first package batch to TypeScript 7
- [x] 16-03-PLAN.md — Pin the remaining package manifests to TypeScript 7
- [x] 16-04-PLAN.md — Remove the retired compiler option from accounts through content
- [x] 16-05-PLAN.md — Remove the retired compiler option from core through relay
- [x] 16-06-PLAN.md — Remove the retired compiler option from signers through wallet
- [x] 16-07-PLAN.md — Resolve the compiler graph and run full workspace acceptance gates

### Phase 17: Correctness Fixes & Concord Residuals

**Goal**: Five independent, low-risk defects — a relay-controlled prototype-chain lookup, an all-or-nothing SQLite peer dependency, a lossy NIP-29 address round-trip, and two Concord auth/publish-honesty gaps — are fixed without waiting on any of the re-layering work.
**Depends on**: Nothing (independent of the layering work; can run any time)
**Requirements**: FIX-01, FIX-02, FIX-03, RESID-01, RESID-02
**Success Criteria** (what must be TRUE):

  1. A relay sending a CLOSED reason like `"constructor: ..."` or `"__proto__: ..."` cannot make `parseClosedError` resolve to an inherited `Object.prototype` value — D-07's retry-skip behavior is unaffected by an attacker-chosen prefix.
  2. A consumer of `applesauce-sqlite` who installs only the backend they use (e.g. `better-sqlite3` alone) is not asked to install the other three drivers.
  3. A NIP-29 group pointer on `ws://localhost:4869` round-trips through encode→decode with its port and scheme intact.
  4. One relay's rejected or thrown AUTH attempt never enters community or private-channel `error$`/`status.error`; those surfaces remain reserved for fatal lifecycle/sync failures, which is the accepted prevention-based restatement of RESID-01's earlier clear-on-recovery wording.
  5. `revoke()`/`revokeBundle()` report a failed publish to the caller instead of unconditionally returning `revoked: true`.

**Plans**: 6/6 plans executed

Plans:

- [x] 17-01-PLAN.md — Make CLOSED-prefix classification prototype-safe through public retry behavior
- [x] 17-02-PLAN.md — Mark all SQLite backend peers optional and prove the packed consumer boundary
- [x] 17-03-PLAN.md — Preserve complete normalized group-pointer relay endpoints
- [x] 17-04-PLAN.md — Prevent transient AUTH diagnostics from entering fatal Concord UI state
- [x] 17-05-PLAN.md — Enforce honest, ordered invite-revocation publication results
- [x] 17-06-PLAN.md — Fail closed when required admin publication is not configured

### Phase 18: EVENT Family Re-layer

**Goal**: `event()` becomes exactly one EVENT write and one reply; `publish()` becomes the sole owner of the retry, auth, and timeout policy around it.
**Depends on**: Phase 16 (amended D-01 is what makes `event()` throwing to `publish()` correct rather than a smell)
**Requirements**: EVT-01, EVT-02, EVT-03, EVT-04, EVT-05, EVT-06, RESID-04
**Success Criteria** (what must be TRUE):

  1. A relay auth refusal reaches a caller of `event()` as a thrown `AuthRequiredError`, not as `{ok:false, message}` for the caller to inspect.
  2. `publish({retries: N})` retries a publish that timed out — today the synthetic timeout value sails past the retry operator untouched.
  3. A `PublishResponse.error` field is present exactly when the relay itself supplied a verdict, never when `publish()` gave up client-side — a caller can trust the discriminator without inspecting the message string.
  4. `RelayGroup.event()`'s and `Relay.sync()`'s SEND path's auth-retry behavior after this change is a recorded, deliberate decision, not a silent loss.
  5. The `event`/`publish` progress-predicate comment and RAUTH-07's `onAuthRequired`/`authTimeout`/`authRetries` claim on `event` both describe what the code actually does, with the restatement's provenance recorded.

**Plans**: 5/5 plans executed

Plans:

- [x] 18-01-PLAN.md — Establish the one-attempt raw EVENT/AUTH wire contract
- [x] 18-02-PLAN.md — Move bounded auth, retry, reconnect, and timeout policy into publish()
- [x] 18-03-PLAN.md — Propagate the raw/high split through Group, Pool, auth(), and sync()
- [x] 18-04-PLAN.md — Align D-01, D-07, RAUTH-07, and shipped source comments
- [x] 18-05-PLAN.md — Correct release metadata and run the complete static acceptance audit

### Phase 19: COUNT Becomes the High-Level Member

**Goal**: `count()` gains the same configurable policy every other high-level method has, and its response models what NIP-45 actually defines instead of one field reached by an unchecked cast.
**Depends on**: Phase 16
**Requirements**: COUNT-01, COUNT-02, COUNT-03
**Success Criteria** (what must be TRUE):

  1. A caller can pass `reconnect`, `retries`, and `timeout` to `count()` the same way they can to `publish()` — the hardcoded 10s clock with no override is gone.
  2. A COUNT failure (timeout, refusal, malformed reply) reaches the caller through the Observable error channel instead of as a value to inspect; Phase 19 discussion explicitly preserved the existing Observable API, superseding the roadmap-derived Promise proposal while retaining COUNT-01's canonical error-surface requirement.
  3. `RelayCountResponse` carries validated `approximate`/`hll` fields when a relay sends them; a malformed payload rejects instead of becoming a typed lie via cast.
  4. Merging two relays' `hll` registers with the shipped register-wise max-merge helper against an independently hand-computed union cardinality produces the correct total.

**Plans**: 3/3 plans executed

Plans:

- [x] 19-01-PLAN.md — Validate forward-compatible NIP-45 COUNT responses and independently prove HLL merge/estimation
- [x] 19-02-PLAN.md — Apply D-01 whole-request policy with transport-only retry and preserve Group/Pool forwarding
- [x] 19-03-PLAN.md — Publish root exports, focused docs, source audit, and the sole COUNT changeset

### Phase 20: AUTH Family Re-layer

**Goal**: `authenticate()` becomes the high-level owner of challenge acquisition and freshness, so a challenge that moves under a slow signer produces a retried auth instead of a misreported relay refusal — and any new terminal auth error class this introduces is recognized by `applesauce-loaders` in the same change.
**Depends on**: Phase 16
**Requirements**: AUTHF-01, AUTHF-02, AUTHF-03, AUTHF-04, AUTHF-05
**Success Criteria** (what must be TRUE):

  1. Calling `authenticate()` before a challenge has arrived waits, bounded, instead of throwing synchronously — a relay that never sends a challenge fails on a clock, not a hang.
  2. A challenge that changes mid-sign produces a re-sign and resend within a small explicit bound, instead of writing an AUTH against a stale challenge and reporting the relay's rejection as a refusal.
  3. Every failure `authenticate()` can produce reaches both `.catch()` and `try`/`await` callers identically.
  4. `auth()` sends exactly one fixed AUTH frame through the same private one-frame/one-reply primitive as `event()`, never `publish()`, so it cannot recurse into the EVENT family's retry loop.
  5. If this phase adds a new terminal auth error class, `applesauce-loaders`' `RELAY_AUTH_ERROR_NAMES` recognizes it in the same change — a dedicated test proves the loader classifies it as an auth failure, not a generic one.

**Plans**: 4/4 plans executed

Plans:

- [x] 20-01-PLAN.md — Fix EVENT/AUTH routing over one private raw exchange and add the compile-time bypass guard
- [x] 20-02-PLAN.md — Add bounded challenge acquisition, freshness retries, cancellation, and lifecycle proof
- [x] 20-03-PLAN.md — Close terminal-error classifiers and downstream consumer compatibility
- [x] 20-04-PLAN.md — Align docs/provenance/release metadata and run the complete phase gate

### Phase 21: Group Error Surface — request()/subscription()

**Goal**: A `RelayGroup.request()` or `subscription()` that loses every relay reports that as a real error, and the aggregate's per-relay causes settle the "one representation" question the group count-isolation work will reuse.
**Depends on**: Phase 16
**Requirements**: GROUP-01, GROUP-02, GROUP-03, GROUP-04, GROUP-05
**Success Criteria** (what must be TRUE):

  1. `RelayGroup.request()` against every-relay-failed raises an error by default instead of completing with zero events.
  2. `RelayGroup.subscription()` against every-relay-failed raises an error immediately instead of hanging forever; subscriptions have no built-in duration or inactivity clock (Phase 22 D-23/D-24 amendment).
  3. The raised aggregate exposes each relay's own failure cause keyed by URL, and that per-source-outcome shape is the one shape Phase 23's progressive count record reuses rather than inventing its own.
  4. One public `timeout` bounds finite request — 30 seconds by default — while subscriptions are consumer-owned lifetimes with no built-in clock (Phase 22 D-23/D-24 amendment to GROUP-04).
  5. The request clock pauses with its remaining budget across overlapping relay auth phases; subscription duration limits are caller-composed RxJS policy (Phase 22 D-23/D-24 amendment to GROUP-05).

**Plans**: 4/4 plans executed

Plans:

- [x] 21-01-PLAN.md — Typed aggregate and unified latest-cohort settlement
- [x] 21-02-PLAN.md — Auth-suspendable whole-returned-Observable lifetime
- [x] 21-03-PLAN.md — Pool propagation and public export/type proofs
- [x] 21-04-PLAN.md — Documentation, provenance, major changeset, and final gates

### Phase 22: REQ Family Re-layer

**Goal**: `req()` becomes a single REQ interaction; `request()` and `subscription()` become owners of reconnect, resubscribe, and the auth retry — with `subscription()` gaining its own re-establish loop for the first time.
**Depends on**: Phase 18 (EVENT proves the pattern on the smaller surface first), Phase 21 (shared `group.ts` request/subscription surface and clock shape)
**Requirements**: REQ-01, REQ-02, REQ-03, REQ-04, REQ-05
**Success Criteria** (what must be TRUE):

  1. Passing `reconnect` or `resubscribe` to `req()` is a compile-time type error; passing either to `request()`/`subscription()` still works.
  2. A `subscription()` that loses its connection re-establishes automatically, and what a consumer observes across the reconnect — REQ id reuse vs. fresh, a second `OPEN` or not, whether duplicate-event filtering still holds — is specified and tested, not incidental.
  3. `request()` and `subscription()` each own reconnect, resubscribe, and the auth retry; `req()` owns none of the three.
  4. The reentrancy/retry-counting regression tests closed by plans 13-08..13-14 (the per-attempt `defer` factory, `resubscribeHolder`, `isReqProgress`'s synthetic-`OPEN` exclusion) fail RED against a deliberate revert and pass GREEN against the re-layered code.

**Plans**: 9/9 plans complete

Plans:

- [x] 22-01-PLAN.md — Raw readiness-aware single REQ interaction and exact teardown
- [x] 22-02-PLAN.md — Private lifecycle compositor and Relay request/subscription policy
- [x] 22-03-PLAN.md — Group/Pool re-establishment, dedupe, settlement, and no-timeout runtime
- [x] 22-04-PLAN.md — Sync RECEIVE preservation and four mutation proofs
- [x] 22-05-PLAN.md — Exact positive Relay/Group/Pool option type proofs
- [x] 22-06-PLAN.md — Complete Phase 21 artifact supersession and stale-claim audit
- [x] 22-07-PLAN.md — Canonical docs and exact two-changeset validation
- [x] 22-08-PLAN.md — Full phase gate and Nyquist evidence reconciliation
- [x] 22-09-PLAN.md — Gap closure: reproducible RED→GREEN evidence for three REQ-04 mutations

### Phase 23: Group count() Isolation

**Goal**: One failing or offline relay in a group count costs the caller that relay's number, not every relay's, and results arrive as each relay answers instead of all at once.
**Depends on**: Phase 19 (consumes `count()`'s re-shaped high-level response), Phase 21 (reuses its per-source-outcome representation for GROUP-03)
**Requirements**: COUNT-04, COUNT-05
**Success Criteria** (what must be TRUE):

  1. `RelayGroup.count()` across 5 relays where 1 is offline returns the other 4 relays' counts instead of failing the whole call.
  2. `RelayGroup.count()` emits a partial record as each relay answers, rather than withholding every count until the slowest relay replies.
  3. A failed relay's entry in the count record uses the same per-source-outcome shape Phase 21 defined for the group aggregate error, not a second, independently invented shape.

**Plans**: 8/8 plans complete

Plans:

- [x] 23-01-PLAN.md — Static progressive outcome accumulator and scalar forwarding
- [x] 23-02-PLAN.md — Dynamic cohort replacement, retraction, replay, and cancellation
- [x] 23-03-PLAN.md — Pool parity and real-wire scalar policy preservation
- [x] 23-04-PLAN.md — Exact public types and combineLatest RED→GREEN proof
- [x] 23-05-PLAN.md — Progressive/HLL outcome documentation
- [x] 23-06-PLAN.md — Exhaustive Phase 19/21/canonical provenance amendments and stale-claim audit
- [x] 23-07-PLAN.md — Major changeset, full gates, provenance audit, and Nyquist reconciliation
- [x] 23-08-PLAN.md — Gap closure: consistent COUNT docs and reconciled validation evidence

### Phase 24: Negentropy & Sync Re-layer

**Goal**: Multi-round negentropy reconciliation reaches the wire at protocol speed, while `sync()` owns coherent auth, reconnect, and bounded-transfer policy with caller-owned cancellation and no built-in timeout.
**Depends on**: Phase 18 (EVENT), Phase 22 (REQ) — `Relay.sync()` calls `event()`/`req()` directly today and must be rewired onto their re-layered high-level siblings
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, RESID-03
**Success Criteria** (what must be TRUE):

  1. A sync between two stores whose difference exceeds one negentropy frame completes correctly — proven by a fixture that deliberately exceeds the ~32-item frame-size threshold to force a second round.
  2. `negentropy()` emits what it learns per round without waiting on the caller's transfers to finish first.
  3. `sync()` runs one auth budget and bounded transfer concurrency; lifetime is caller-owned through cancellation or composed RxJS operators, with no built-in timeout.
  4. A SEND direction where every upload was rejected does not print "Upload complete" — the caller can observe send failures as values, not just received events.
  5. The non-auth negentropy fallback force-closes any open auth phase, and a zero-event EOSE on `sync()`'s RECEIVE branch no longer rejects the whole sync with an `EmptyError`.

**Plans**: 11/11 plans complete

Plans:

- [x] 24-01-PLAN.md — Raw multi-round negentropy Observable, errors, and teardown
- [x] 24-02-PLAN.md — Call-scoped sync authentication, reconnect, and caller-owned lifetime
- [x] 24-03-PLAN.md — Fair bounded scheduler and explicit transfer/store outcomes
- [x] 24-04-PLAN.md — Group/Pool sync isolation and raw multi-relay negentropy removal
- [x] 24-05-PLAN.md — Loader fallback auth cleanup and structural result migration
- [x] 24-06-PLAN.md — Protocol ordering/non-blocking mutation proofs 1–3
- [x] 24-07-PLAN.md — Scheduler/auth/reconnect mutation proofs 4–7
- [x] 24-08-PLAN.md — Public types/exports and documentation migration
- [x] 24-09-PLAN.md — Stale-contract inventory and canonical/historical provenance
- [x] 24-10-PLAN.md — Changeset reconciliation, exact parsers, and full gates
- [x] 24-11-PLAN.md — Canonical requirement-status and verification reconciliation

### Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2

**Goal**: `applesauce-react`'s already-declared React 19 support is backed by real tests, and `apps/examples` runs on the current `@snort/worker-relay` major — both fully independent of the relay re-layering.
**Depends on**: Nothing (independent of every other phase in this milestone)
**Requirements**: ECO-02, ECO-03
**Success Criteria** (what must be TRUE):

  1. `packages/react` has rendering tests for `use$`/`useObservableState` and its providers, and they pass against both React 18 and React 19.
  2. `apps/examples` runs correctly on `@snort/worker-relay@2`, with the removed `insertBatchSize` option and the now-synchronous `setEventMetadata` handled at every call site.

**Plans**: 1/4 plans executed
**UI hint**: yes

Plans:
**Wave 1**

- [ ] 25-01-PLAN.md — React 19 rendering-test tracer and approved test infrastructure
- [x] 25-04-PLAN.md — Three folded Phase 05.1 regressions and changesets

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 25-02-PLAN.md — Complete hook/provider lifecycle suite and React 18/19 CI matrix
- [ ] 25-03-PLAN.md — Worker-relay v2 migration with UI/runtime contract preservation

### Phase 26: Release Coordination — v7.0.0

**Goal**: The v7.0.0 major publishes exactly what it is supposed to — all fourteen packages, v1.2's held changesets, and Concord's first official stable release — verified by a dry run rather than assumed from the `linked` config.
**Depends on**: Phases 16–25 (every package's intended v7.0.0 change must be finalized before the release can be verified and cut)
**Requirements**: REL-01, REL-02, REL-03, REL-04
**Success Criteria** (what must be TRUE):

  1. A `changeset status --verbose --since=master` dry run shows all fourteen packages bumping to 7.0.0, checked off an explicit per-package checklist — including packages with no code changes of their own — rather than assumed from one major changeset.
  2. `applesauce-concord` publishes to the `latest` npm dist-tag as `7.0.0`, with a changelog that starts from a stable baseline rather than explaining removals from `next` snapshots.
  3. v1.2's held `applesauce-relay` and `applesauce-loaders` changesets are present in the release and describe behavior the shipped code actually has.
  4. Every `.changeset/*.md` file included in the release describes exactly one change in a single sentence, per the repo's changeset convention.

**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Generic store foundation | v1.0 | 4/4 | Complete | 2026-07-09 |
| 2. Generic models & casts | v1.0 | 3/3 | Complete | 2026-07-09 |
| 3. RumorStore & verification | v1.0 | 3/3 | Complete | 2026-07-09 |
| 4. Common package rumor support | v1.0 | 1/1 | Complete | 2026-07-09 |
| 5. Cache Identity Memo Fix | v1.1 | 14/14 | Complete | 2026-07-29 |
| 5.1 Symbol Propagation Redesign (INSERTED) | v1.1 | 13/13 | Complete | 2026-07-16 |
| 6. Refounding Rotation & Authority Correctness | v1.1 | 3/3 | Complete | 2026-07-16 |
| 7. Private Channel Keying | v1.1 | 4/4 | Complete | 2026-07-17 |
| 8. Rotation Robustness & Consensus | v1.1 | 6/6 | Complete | 2026-07-19 |
| 9. Authority & Permission Fold Correctness | v1.1 | 5/5 | Complete | 2026-07-19 |
| 10. Invite Lifecycle & Event Time Consistency | v1.1 | 6/6 | Complete | 2026-07-21 |
| 11. Messaging Wire Conformance | v1.1 | 6/6 | Complete | 2026-07-29 |
| 12. Document & Caps Conformance | v1.1 | 11/11 | Complete | 2026-08-01 |
| 12.1 Concord Sync Skips Ephemeral Kind 21059 (INSERTED) | v1.1 | 1/1 | Complete | 2026-07-22 |
| 12.2 Concord Sync Debug Logging (INSERTED) | v1.1 | 4/4 | Complete | 2026-07-22 |
| 12.3 Transport-Only Extra Relays (INSERTED) | v1.1 | 14/14 | Complete | 2026-07-25 |
| 13. Operation-Scoped NIP-42 Auth Hooks | v1.2 | 14/14 | Complete    | 2026-08-06 |
| 14. Auth Lifecycle Debug Logging | v1.2 | 9/9 | Complete    | 2026-08-11 |
| 15. Concord Stream-Auth Cleanup | v1.2 | 14/14 | Complete    | 2026-08-18 |

| 16. Method Layering Foundation & TypeScript 7 | v7.0.0 | 7/7 | Complete | 2026-08-20 |
| 17. Correctness Fixes & Concord Residuals | v7.0.0 | 6/6 | In Progress | - |
| 18. EVENT Family Re-layer | v7.0.0 | 0/TBD | Not started | - |
| 19. COUNT Becomes the High-Level Member | v7.0.0 | 3/3 | Complete | 2026-08-21 |
| 20. AUTH Family Re-layer | v7.0.0 | 4/4 | Complete | 2026-08-31 |
| 21. Group Error Surface — request()/subscription() | v7.0.0 | 0/TBD | Not started | - |
| 22. REQ Family Re-layer | v7.0.0 | 0/TBD | Not started | - |
| 23. Group count() Isolation | v7.0.0 | 0/TBD | Not started | - |
| 24. Negentropy & Sync Re-layer | v7.0.0 | 0/TBD | Not started | - |
| 25. Ecosystem Riders — React 19 & @snort/worker-relay v2 | v7.0.0 | 0/TBD | Not started | - |
| 26. Release Coordination — v7.0.0 | v7.0.0 | 0/TBD | Not started | - |

**Totals:** 19 phases across three shipped milestones; 135 plans shipped (98 across v1.0/v1.1, 37 across v1.2). v7.0.0 adds 11 more phases (Phases 16–26), not yet started; 46/46 requirements mapped, 0 executed.

## Backlog

## v7 release coordination

**Recorded 2026-08-19.** The relay re-layering cluster below is breaking, so it ships as **applesauce v7.0.0**. Everything is on 6.x today (`applesauce-relay` 6.2.1, most of the suite 6.2.0, `applesauce-react`/`applesauce-sqlite` 6.0.0).

| Entry | Breaking? | Why |
|-------|-----------|-----|
| 999.23 amend D-01 + layering rule | no | comments and docs only — but **gates every entry below** |
| 999.24 EVENT re-layer | **yes** | `event()` stops erroring for auth, starts erroring for refusals |
| 999.25 REQ re-layer | **yes** | `reconnect`/`resubscribe` move between public option types |
| 999.26 AUTH re-layer | mostly additive | one breaking edge: the missing-challenge behavior |
| 999.27 `count()` high-level | **yes** | return type changes, options widen |
| 999.28 negentropy re-layer | **yes** | `negentropy()` signature, `sync()` emission type |
| 999.20 group error conditions | **yes** if on by default | `request()` goes from completing empty to erroring |
| 999.21 group `count()` isolation | **yes** | record value shape changes |
| 999.18 / 999.19 residuals | no | non-breaking fixes; can ship on 6.x |

**RESOLVED — v7 is a coordinated suite-wide major (user, 2026-08-19).** A major version bumps **every** applesauce package, whether or not its own surface changed. This is an intentional property of the release process, not an accident of tooling: a consumer can tell at a glance that `applesauce-*@7.x` packages work together, without cross-checking a compatibility matrix. Minor and patch versions remain per-package, which is why the suite sits at 6.0.0 / 6.2.0 / 6.2.1 / 6.2.2 today — all on 6.x, drifting only below the major.

Two consequences for planning v7:

- **The tooling already enforces this — do not hand-write eleven changesets.** `.changeset/config.json` puts all fourteen packages in a single `linked` group, so one `major` changeset on any member bumps every member to the same major. Write the changeset against the package that actually changed and let changesets carry the rest. (Worth confirming the intended behavior on a dry run before cutting, since `linked` groups and `updateInternalDependencies: "minor"` interact.)
- **The dependency-cascade analysis stops being the deciding factor.** Only `applesauce-wallet` depends on `applesauce-relay` (`^6.0.3`); `applesauce-loaders` deliberately carries **no** relay dependency (D-06 — it mirrors the types structurally). Under lockstep majors that narrowness no longer limits the release, though it does still mean very few packages need *code* changes.

**Corollary — non-breaking work can ride along.** Since every package is being republished anyway, v7 is the cheapest moment to land ecosystem bumps that would otherwise justify their own major: SEED-002 (TypeScript 7), SEED-003 (React 19 while keeping 18), SEED-004 (`@snort/worker-relay` v2). Flagged at the v1.2 close as v7 candidates; this makes the case stronger, not weaker.

**`applesauce-concord` has never had an official release — the changeset exemption is correct.** It publishes only as **snapshot** versions: `scripts/snapshot-release.mjs` runs `pnpm publish --tag next`, entirely separate from the `release` script's `changeset publish`. So concord exists on npm only under the `next` dist-tag, never as a stable `latest`. Its `version: 6.2.0` and its membership in the changesets `linked` group describe what *would* happen at an official release, not what has happened. (Confirmed by hzrd149, 2026-08-19.)

This means v1.2's convention — concord is unreleased and needs no changesets — holds, and Phase 15's removals (`authenticateStreamKeys`, `version$`, `ensureAuth()`, `autoAuthenticate`, the deleted `relay-auth.ts`) need no changelog entry: no stable consumer ever had them, and anyone on a `next` snapshot is tracking unstable by definition.

**Open — is v7 concord's first official release?** This is the decision to make, not the changeset one. Concord sits in the `linked` group and is absent from `ignore`, so a `changeset version` run bumps it to 7.0.0 and `changeset publish` pushes it to `latest` alongside everything else. Either that is intended — v7 is when concord goes stable — or concord must be held back deliberately (adding it to `ignore`, or keeping it out of the release run). Decide before cutting, because the default behaviour publishes it. If v7 *is* its first stable release, its changelog starts from zero rather than needing to explain removals from snapshots.

### Phase 999.2: Concord media epoch key decryption audit (BACKLOG)

**Goal:** [Captured for future planning] Review and check concord's file/media encryption and decryption to confirm that media sent in past epochs is decrypted with the correct keys **from that epoch**, not with the latest keys. Suspected failure mode: the decrypt path resolves keys from current epoch state rather than from the epoch the media was encrypted under, which would make historical media undecryptable after a rotation.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.7: Phase 8 rotation-robustness code-review residuals (BACKLOG)

**Goal:** [Captured for future planning] Five advisory findings from the Phase 8 code review (`.planning/phases/08-rotation-robustness-consensus/08-REVIEW.md`) that describe real residual risk but did not defeat a Phase 8 requirement (CR-01, the one requirement-defeating finding, was fixed in-phase). **WR-01:** a multi-chunk rekey (>120 recipients, so the wraps span multiple chunks) gates each chunk-wrap's majority independently, so per-chunk majorities can land on disjoint relay subsets — the gate passes yet no single relay holds a *complete* rotation, and the rotator adopts an epoch peers can't fully discover (`community.ts:1276-1286`). **WR-02:** the live `checkRekey` path can only consider `newEpoch === heldEpoch+1`, so the down-only latch's heal-down branch is unreachable once an epoch is adopted — racing rotations can leave two nodes split until the next full `syncEpochs` (run only in `start()`), i.e. convergence is eventual-on-resync, not live. **WR-03:** `refound()` publishes/gates rekey wraps sequentially and can throw mid-loop, scattering incomplete rotation state across relays on abort (no rollback). **IN-01:** compaction/snapshot publishes still swallow all errors (`.catch(() => {})`). **IN-02:** `groupRotations` captures the `vac` citation from the first-arriving chunk only (safe today; worth a pinning test). Each can be split into its own plan at promotion.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.9: Concord invite-bundle rule-table hardening — round-5 residuals (BACKLOG)

**Goal:** [Captured for future planning] Five findings from the Phase 12.3 round-5 code review (`.planning/phases/12.3-transport-only-extra-relays-in-applesauce-concord/12.3-REVIEW.md`). **None is a live defect** — all 26 shipped rules across the four tables were audited against their declared field types at close of 12.3 and found correct; these harden the *guardrail*, not the behavior. **CR5-01** (review labelled BLOCKER, downgraded on audit): `ExhaustiveBundleRules<T> = { [K in keyof Required<T>]: BundleFieldRule }` binds WHICH fields a rule table must name but never consults `T[K]`, so a rule's `kind` is unbound to the field's type — reproduced by giving `HeldKeyEntry.refounder` (a `string`) `kind: "safe-integer"`, which builds at exit 0 with 471/471 green. The same mutation on the top-level `refounder` IS caught, but only by 2 incidental behavioral tests, so detection is field-dependent — the exact property D-17 exists to remove. Fix shape: a `RuleFor<V>` conditional binding the rule union to the field type, which SUBSUMES `RULE_TABLE_SUBJECT_PROOF` rather than adding a sixth check. **WR5-01:** the hand-enumerated-mirror shape survives in `joinFromBundle`'s bundle→`JoinMaterial` projection and `buildInviteBundle`'s two literals — a new *optional* field is forced into the rule table by `tsc` but silently not carried; complete today, unenforced. **WR5-02:** 12.3-14's new `HeldKeyEntry` doc comment claims a channel's retained keys never carry `refounder`, but the shared table accepts and copies it at `channels[].held[]`. **WR5-03:** the proof tuple is hand-enumerated at five positions and the source meta-test's regex misses non-exported or differently-named tables; its alias check is a substring test that comments satisfy. **WR5-04:** `invite-manager.ts` — unguarded `hexToBytes(invite.signer_sk)` in `fromInviteListInvite` on the `emit()` path; data is self-authored (`authors: [this.pubkey]`), so this is robustness (a corrupt own-list wedges `create()`/`revoke()` and makes `dispose()` skip `extras.dispose()`), not a vulnerability.

**Context — why this was deferred rather than fixed in 12.3:** phase 12.3's goal is transport-only extra relays (D-01…D-16). The invite-bundle validator entered scope through review rounds, not through the phase's own acceptance criteria, and rounds 3/4/5 each closed a defect only for the next round to find the same class one meta-level up (fields → table subjects → rule kinds). Deferred by explicit user decision on 2026-07-27 to stop that regress at a natural boundary. Promote as ONE hardening plan; the tables are 26 lines in a single file and the phase is done touching them.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.10: applesauce-core expiration timer overflow (RESOLVED 2026-08-05)

**Status: FIXED — shipped via PR [#89](https://github.com/hzrd149/applesauce/pull/89), merged to `master` as `5ca390ec` and merged into `concord`.** Never promoted to a full phase; fixed as quick task `260805-ds0` after a second, independent report arrived from a production incident. Full record: `.planning/quick/260805-ds0-clamp-expirationmanager-settimeout-delay/`.

**Original goal:** `ExpirationManager` schedules a native `setTimeout()` using the full delta to a NIP-40 `expiration` tag, so any event expiring more than ~24.8 days out exceeds Node's 32-bit timer limit — Node clamps the delay to `1ms` and emits `TimeoutOverflowWarning`, which then fires repeatedly. Reported against `applesauce-core@6.2.0` with a one-liner reproduction (add a single event with an expiration 365 days out; no relay, websocket, or reconnect code involved). Explicitly **not** caused by `reconnect: Infinity` in `applesauce-relay` — that setting is documented and stays.

**What shipped** (all three landed together):

- **D1 — the reported overflow.** Both uncapped `setTimeout(..., timeout * 1000 + 10)` sites now route through one private `scheduleNextCheck()` that clamps to `MAX_TIMER_DELAY = 2_147_483_647`. Consolidating to a single owner — rather than clamping at each site — is what stops the defect recurring at one site only. `nextCheck` still stores the true target expiration, not the capped wake time, preserving `track()`'s early-exit guard.
- **D2 — the secondary observation below, confirmed real.** `scheduleNextCheck()` is now sole owner of the `timer`/`nextCheck` pair and clears before arming, so a fired timer always clears its own bookkeeping. Has its own regression test.
- **D3 — same defect class, found while auditing every timer call site.** `applesauce-wallet-connect`'s `waitForPaid()` passed `Infinity` to `simpleTimeout` for invoices with no expiry (clamping to ~1ms, so "never time out" became "time out immediately"); it now skips the operator entirely. Its expiry `setTimeout` is clamped too.

**Verification.** 6 regression tests added; core + wallet-connect suites green. Because unit tests use fake timers — where Node's clamping never happens and the bug cannot be witnessed — the original field reproduction was also run against the real built `dist`: **0** warnings post-fix vs **1180** in 1.5s with only the clamp removed (~143 KB, matching the ~107 KB/s measured on the affected host).

**Original secondary observation** (now fixed as D2, kept for the record): when the last tracked expiration is `forget()`-ten before its timer fires, `emitNotifications()` skips the `nextExpiration !== Infinity` branch entirely and leaves `this.timer`/`this.nextCheck` stale from the already-fired timer.

**Open item resolved.** The capture note flagged that the reporter's `pnpm --filter applesauce-core test -- <path>` ran the whole core suite instead of the named file. Cause: a single root `vitest.config.ts` with no workspace projects, so positional path filters only bind when vitest runs from the repo root. Use `pnpm vitest run <path>` from the root; the `--filter … -- <path>` form silently ignores the path.

**Downstream:** unblocks hzrd149/nsite-gateway#28 on the next `applesauce-core` patch release.

Original report retained at `expiration-report.md` in this phase directory.

**Requirements:** n/a (fixed as a quick task)
**Plans:** 0 plans

Plans:

- [x] Fixed as quick task `260805-ds0` — no phase promotion needed

### Phase 999.12: applesauce-sqlite optional peer dependencies (BACKLOG)

**Goal:** [Captured for future planning] `packages/sqlite/package.json` declares all four SQLite drivers as hard `peerDependencies` (`@libsql/client`, `@tursodatabase/database`, `@tursodatabase/database-wasm`, `better-sqlite3`) with **no `peerDependenciesMeta`**, so every consumer is asked to install all four regardless of which backend it actually uses. The backends are mutually exclusive by construction — each has its own subpath export (`./better-sqlite3`, `./native`/`./deno`, `./bun`, `./libsql`, `./turso`, `./turso-wasm`) and no consumer needs more than one. The reported symptom is Deno: it only needs the `./deno` → `dist/native/` path (`node:sqlite`, built in) yet still pulls the other three, including `better-sqlite3`'s native compile step. Fix is additive metadata, no code change:

```json
"peerDependenciesMeta": {
  "@libsql/client": { "optional": true },
  "@tursodatabase/database": { "optional": true },
  "@tursodatabase/database-wasm": { "optional": true },
  "better-sqlite3": { "optional": true }
}
```

**Worth checking at promotion:** all four stay in `devDependencies` so the repo's own tests still exercise every backend; whether any other package in the monorepo declares backend-specific peers with the same all-or-nothing shape (same defect class, not just this instance); and that a `patch` changeset for `applesauce-sqlite` ships with it.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.13: negentropy multi-round reconciliation never sends its follow-up message (BACKLOG)

**Goal:** [Historical discovery, superseded by Phase 24] `negentropySync` dropped its computed follow-up message, so sufficiently diverged sets stalled after NEG-OPEN. Phase 24 replaced that loop with Observable rounds and caller-owned cancellation.

**Why the suite misses it:** `relay.test.ts:2748` deliberately keeps both sides under 32 items so the reconciliation completes in a single round trip — its own comment says so. Any regression test must exceed the frame-size threshold to force a second round.

**Provenance — this is NOT a Phase 13 regression.** `git log -L 144,148` traces the loop to `f649d6dd` ("Fix abort signal being ignored in `negentropySync`"), dated **2025-10-27**, ten months before Phase 13 opened. Phase 13 touched this file for auth threading only. Surfaced by the Phase 13 code review (`phases/13-operation-scoped-nip-42-auth-hooks/13-REVIEW.md`, finding CR-01) and deferred by explicit user decision on 2026-08-06 as out of that phase's scope.

**Phase 24 disposition:** sync intentionally has no built-in timeout; callers own duration through cancellation or composed RxJS operators.

**ABSORBED BY 999.28 (2026-08-19).** That phase restructures this exact loop from a blocking callback into a non-blocking per-round emission, so fixing the dropped follow-up here first would mean writing the multi-round regression test twice against two different shapes. Plan them as one. This entry stays for its provenance and its "must exceed the frame-size threshold" testing note, which 999.28 depends on.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.14: CLOSED reason prefix lookup walks the prototype chain (BACKLOG)

**Goal:** [Captured for future planning] `parseClosedError` (`packages/relay/src/relay.ts:180-184`) indexes a plain object literal with a relay-controlled string: `CLOSED_ERROR_PREFIXES[reason.split(":")[0] as keyof typeof CLOSED_ERROR_PREFIXES]`. The `as` cast silences the compiler, but at runtime the lookup resolves inherited `Object.prototype` keys. A relay sending `CLOSED <id> "constructor: ..."` resolves to the `Object` constructor — truthy **and** constructible — so `new ErrorClass(reason)` returns a **`String` object**, not a `RelayClosedError`; D-07's `error instanceof RelayClosedError` retry-skip then never fires and the REQ is resent (2 frames observed with `reconnect: 2`). A relay sending `"__proto__: ..."` resolves to `Object.prototype`, which is truthy but not constructible, throwing `TypeError: ErrorClass is not a constructor`.

**Fix shape:** make the lookup incapable of reaching the prototype chain rather than filtering the known-bad keys — a `null`-prototype map (`Object.create(null)` / `new Map`) or an `Object.hasOwn` guard. Filtering `constructor`/`__proto__` by name is the enumerated fix and leaves the next inherited key open.

**Provenance — this is NOT a Phase 13 regression.** `6c806776` ("Fix auth-required handling in relay req()"), confirmed an ancestor of Phase 13's first merge. Surfaced by the Phase 13 code review (`phases/13-operation-scoped-nip-42-auth-hooks/13-REVIEW.md`, finding CR-03) and deferred by explicit user decision on 2026-08-06 as out of that phase's scope.

**Worth checking at promotion:** whether any other relay-controlled string in the package indexes an object literal the same way (same defect class, not just this instance).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.15: NIP-29 group address parsing must support ports and ws:// / wss:// protocols (BACKLOG)

**Goal:** [Captured for future planning] NIP-29 group identifiers (`<host>'<group-id>`) round-trip lossily through `packages/common/src/helpers/groups.ts`, dropping both the port and a non-default protocol.

`encodeGroupPointer` (`groups.ts:52-56`) builds the identifier from `new URL(pointer.relay).hostname`. `URL.hostname` excludes the port by definition, so `wss://relay.example.com:7777` encodes to `relay.example.com'<id>` — the port is silently gone. The protocol is dropped unconditionally, so a `ws://` relay loses its scheme too.

`decodeGroupPointer` (`groups.ts:38-49`) then re-hydrates with `if (!relay.match(/^wss?:/)) relay = \`wss://${relay}\``, defaulting to `wss://`. Net effect on a `ws://localhost:4869` pointer: encode → `localhost'<id>` → decode → `wss://localhost`. Wrong port **and** wrong scheme — which breaks exactly the local/self-hosted and non-standard-port relays where `ws://` and explicit ports are normal.

**Fix shape:** preserve what the URL already carries rather than re-deriving a default. `URL.host` (not `.hostname`) includes the port; the scheme needs to survive encoding whenever it is not the implied `wss://`. Decode's `wss://`-default is fine as a fallback for bare hosts — the bug is that encode discards information decode then has to guess at. Worth deciding at promotion whether the encoded form should carry `ws://` explicitly or whether a `localhost`/loopback rule is preferable, since the identifier is user-facing.

**Worth checking at promotion:** the same `.hostname`-vs-`.host` truncation in any other pointer encoder in the repo (same defect class, not just this instance), and whether `groups.test.ts` has round-trip coverage for ported/`ws://` relays — the current lossy behavior suggests it does not.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.16: Phase 14 code-review residuals (BACKLOG)

**Goal:** [Captured for future planning] Three warnings and five info findings from Phase 14's code review (`phases/14-auth-lifecycle-debug-logging/14-REVIEW.md`), deliberately deferred on 2026-08-11 by user decision after the CR-01 blocker and the requirement-affecting warnings were closed in gap plans 14-08 and 14-09. Full analysis and suggested fixes live in that REVIEW.md — this entry records what was left and why it matters.

**WR-06 — the publish `error` discriminator is not total, and a shipped changeset claims otherwise.** `relay.ts:1263-1267` manufactures a `PublishResponse` locally when the auth retry budget is exhausted — a client-side give-up by definition — but omits the `error` field. `relay.ts:1180` and `:1218` state that the *absence* of `error` means "received from the relay's own OK frame", so a consumer applying the documented rule misclassifies this as a relay rejection. `group.ts`'s `errorToPublishResponse` gets this right for every other locally-manufactured response. **This is the highest-priority item here**: `.changeset/relay-publish-timeout-marks-itself.md` ships the claim that a caller can distinguish the two "without inspecting the message", which is not true while this path exists. Either set the field or correct the changeset and the two comments — the release note and the code must agree before publish.

**WR-05 — the test capture harness clobbers the process-wide `DEBUG` filter.** `__tests__/debug-capture.ts:24-41` restores the sink but not the namespace filter. `debugFactory.enable()` replaces the entire enabled list and `disable()` clears everything, so pre-existing `DEBUG` namespaces are wiped for the rest of the worker process. `debug`'s `disable()` returns the string it cleared, which is the round-trip primitive the harness needs. Test-infrastructure only, but it silently degrades any debugging session run alongside the suite.

**WR-08 — `negentropySync` logs an unbounded filter and local-set fingerprint.** `negentropy.ts:81` dumps the caller's whole `Filter` (its `authors`/`ids` arrays verbatim — user pubkeys and event ids) plus a hex fingerprint over the caller's *local* event set. Pre-existing, but Phase 14 established both the bounding tooling (`summarizeFilter`, `truncateForLog`) and the standard, and `describeWireRequest`'s `NEG-OPEN` arm three lines away in `relay.ts` already routes through `summarizeFilters` precisely to avoid this. The inconsistency is now the odd one out.

**IN-01..IN-05:** two unbounded log interpolations; a throwaway `applesauce:Relay:auth` Debugger constructed per `Relay` instantiation; `RELAY_AUTH_ERROR_NAMES` duplicated with each copy's comment pointing at the other; the D-12 oracles asserting on a bare digit; and the auth-required tap also running for `verb === "AUTH"`.

**Worth checking at promotion:** whether WR-06 should instead be folded into the next release prep, since it gates changeset accuracy rather than behavior alone.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.17: Replace the `debug` dependency with something simpler (BACKLOG)

**Goal:** [Captured for future planning] Drop the npm `debug` package (`4.4.3`, one transitive dep `ms@2.1.3`, CJS with a `browser` field swap) in favor of either [`@grammyjs/debug`](https://jsr.io/@grammyjs/debug) or a hand-rolled module vendored from its source (MIT, ~4 KB across 5 files, zero dependencies, declares `browser`/`deno`/`node`/`bun`/`workerd` compat).

**Current footprint.** `debug` is a runtime dependency of five published packages — `core`, `relay`, `signers`, `wallet`, `concord` — with `@types/debug` in those plus `actions`, `wallet-connect`, and `common`. The only construction site is `packages/core/src/logger.ts` (a 4-line module exporting `logger = debug("applesauce")`); everything else derives from it. Across `packages/*/src` there are **109 `.extend()` call sites**, **52 references to the `Debugger` type**, and ~125 string literals carrying printf-style formatters (`%s`/`%o`/`%O`/`%d`/`%j`).

**The API gap is the whole cost of this change.** `@grammyjs/debug` exports exactly one function, `createDebug(namespace) -> DebugFn` with a single mutable `enabled` boolean. It does **not** provide:

- **`.extend()`** — the 109 call sites are the dominant blocker. Trivially reimplementable as `createDebug(parent + ":" + child)`, but it must be added, and per the repo convention the extended Debugger is hoisted once rather than re-derived per log call.
- **printf formatters** — `debug` runs `util.format`-style substitution over `%s/%d/%o/%O/%j` plus custom `%` formatters; grammy just forwards rest args to `console.debug`. Browsers coincidentally handle `%s`/`%d`/`%o`, but Node's `console.debug` also does — worth confirming rather than assuming the ~125 sites are unaffected, especially `%j`, which no console implements.
- **`enable()` / `disable()` / `enabled(ns)` / a settable `.log` sink** — used by the two test capture harnesses, `packages/relay/src/__tests__/debug-capture.ts` and `packages/concord/src/helpers/__tests__/relays.test.ts:237-255`, both of which snapshot `debugFactory.log`, force-enable a namespace, and restore. Grammy reads `DEBUG` **once at module load** into a `const` and exposes no runtime toggle, so both harnesses need a replacement mechanism designed alongside the shim. This interacts with 999.16's WR-05 (the harness already leaks the process-wide `DEBUG` filter) — fixing that on top of `debug` may be wasted work if this lands.
- **`Debugger`** as a type name — grammy calls it `DebugFn`, so a re-export alias avoids touching 52 sites.

**Vendor-vs-depend.** `@grammyjs/debug` is JSR-only and Deno-flavored (`.ts` extension imports); consuming it from npm packages means the `@jsr/grammyjs__debug` shim and a JSR registry entry in consumers' `.npmrc`, which is a real cost to push onto downstream users of five published packages. Vendoring the ~4 KB of MIT source into `applesauce-core` and extending it with `.extend()`, a namespace/`Debugger` type alias, and a testable sink is likely the better shape — it also lets the sink be a first-class export instead of a monkey-patched global, which is what both test harnesses actually want.

**Worth checking at promotion:** whether `logger.ts` should expose a factory (so the sink and enable-state are injectable) rather than a single pre-built root Debugger; whether any consumer imports `debug` types transitively through applesauce's published `.d.ts` (the `dist/**/*.d.ts` files currently do `import type { Debugger } from "debug"`, so removing the dep is a **public type surface change** and needs a changeset per affected package with the right bump); and whether `DEBUG=` env parsing needs to keep `debug`'s `-` negation and `*` wildcard semantics that grammy's `Namespaces` may or may not match.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.18: Phase 13 code-review residuals (BACKLOG)

**Goal:** [Captured for future planning] The Warning- and Info-tier findings from Phase 13's code review (`phases/13-operation-scoped-nip-42-auth-hooks/13-REVIEW.md`) that gap-closure plan 13-14 did not cover — its scope was the CR-02 regression only. 13-VERIFICATION.md dispositioned all eleven as non-blocking against RAUTH-01..09 and listed them for follow-up, but no backlog entry was ever filed; the v1.2 milestone audit (2026-08-18) caught the omission. **Every item below was re-verified against source on 2026-08-19** — two of the original eleven have since been closed and are recorded here as closed so a future promoter does not chase them.

**Also folded in:** the phase's one `deferred-items.md` entry, whose own note asked for a backlog entry "once Phase 14's auth lifecycle logging work gives it a place to land." Phase 14 has landed.

**WR-01 (Warning) — a synchronous auth retry can wipe `req()`'s public `reqs$` tracking.** `relay.ts:1017` adds via `this.reqs$.next({ ...this.reqs$.value, [id]: filters })` and `:1025-1026` removes via a destructure of `this.reqs$.value` — both read-modify-write against the same `BehaviorSubject`, so a synchronous resend interleaving an add and a remove is last-writer-wins. Affects only the `reqs$` diagnostic subject, not message send/resend or retry bounding, and nothing in-package consumes `reqs$` today. Still live.

**WR-03 (Warning) — `event()`/`publish()`'s progress predicate carries a false comment.** `relay.ts:1275` passes `() => true` annotated "PublishResponse carries no bookkeeping value", which is untrue for the synthetic timeout response manufactured at `:1244`. The review's own analysis notes the synthetic value also terminates the stream, so no unbounded retry loop results — the invariant is violated in the documentation sense only. Still live (mirrored at `:1610`).

**WR-04 (Warning) — the negentropy non-auth fallback does not force-close open auth phases.** `sync-loader.ts:646-655` returns `concat(status(...), request$())` for a non-auth negentropy failure without calling `forceCloseAuthPhases()`; only the terminal `finalize` at `:684` ("WR-04 leak path 3") covers it. Narrow: manifests only when a non-auth negentropy failure lands while an auth phase is still open. Does not weaken D-16's "auth-required must not trigger fallback" guarantee, which is enforced separately at `:636` via `RELAY_AUTH_ERROR_NAMES`. Still live.

**WR-05 (Warning) — `Relay.sync()`'s RECEIVE branch rejects with `EmptyError` on a zero-event EOSE.** `relay.ts:1677-1694` wraps the fetch in `lastValueFrom(...)` with no `defaultValue`, guarded only by `need.length > 0`; if the relay EOSEs having sent nothing, the pipe completes empty and the promise rejects. Orthogonal to auth — a pre-existing sync-correctness edge case in a call site Phase 13 threaded `authOptions` through, not a defect in the auth behavior. Still live.

**WR-06 (Warning) — `RelayGroup.request()`'s timeout has no documented wall-clock ceiling across N auth-gated relays.** `group.ts:295` arms `suspendableTimeout(opts?.timeout ?? 30_000, gate, ...)`; the clock suspends per auth phase, so the real ceiling across a group of auth-gating relays is not the 30s a caller reads. Still bounded, not infinite — a documentation gap, not a hang. Still live.

**WR-07 (Info) — `isReqProgress` is barrel-exported**, contradicting the package's stated "not barrel-exported" convention for internal predicates; pinned in the export snapshot at `__tests__/exports.test.ts:24`. API-surface hygiene only. Still live.

**WR-08 (Info) — `suspendableTimeout`'s `arm()` does not clear a previously-armed timer.** `operators/auth-retry.ts`: `arm()` calls `setTimeout` without a preceding `clearTimer()`, so a double-arm would leak the earlier timer. Currently unreachable — `gate.active$` is `distinctUntilChanged` and both `arm`/`disarm` early-return on `settled || firstEmitted`. Still live but latent.

**WR-09 (Info) — stale doc on `RelayRequestOptions.timeout`.** `types.ts:182-184` reads "Total timeout ... Passed to rjxs timeout() operator" (sic), which no longer describes the behavior: the option now feeds the suspendable clock, and `timeout: 0` silently disables it rather than firing immediately. Still live.

**WR-10 (resolved by Phase 21) — two near-duplicate suspendable-clock implementations had diverged undocumented:** `operators/auth-retry.ts`'s `suspendableTimeout` and `sync-loader.ts`'s `withTimeout`. Phase 21 deliberately kept the existing helper for its consumers and added a separate Group whole-lifetime operator whose activity never resets the budget. The loaders clock remains a silence timer by design; the distinct names and Group documentation now make the semantic difference explicit.

**Deferred item — a connection can drop mid-auth-wait at very low `keepAlive`.** While a REQ's auth phase waits on `authSatisfied$`, nothing keeps `Relay.watchTower` subscribed for that operation, so if `keepAlive` elapses with zero other subscribers the socket closes and `authentications$`/`challenge$` are wiped mid-retry. **Verified pre-existing, not a Phase 13 regression** — reproduced identically against `c3be26c2`'s pre-13-02 `req()`. With the real-world 30s default this only bites a genuinely slow out-of-band `authTimeout: false` wait with no other operation keeping the connection warm. Full analysis in `phases/13-operation-scoped-nip-42-auth-hooks/deferred-items.md`. The fix needs a design decision the phase's D-01..D-20 never took: whether `authRetry`'s wait phase should accept an optional keepalive observable to merge in, or whether `Relay`-level call sites should wrap the wait in `mergeWith(this.watchTower)`.

**Closed since the review — do not re-scope:**

- **WR-02** (no test pinned the `AuthRequiredError`/`AuthHandlerError`/`AuthTimeoutError` `.name` strings that `RELAY_AUTH_ERROR_NAMES` duck-types against) is **closed** — `loaders/__tests__/sync-loader.test.ts:787` and `:1072` now assert those exact names, with the intent recorded at `:1014`.
- **WR-11** (`.extend()` called inline at log call sites in `sync-loader.ts`) is **closed** by Phase 14's ALOG-03 derive-once sweep — the remaining `.extend()` calls are hoisted (`:336`, `:399`) or per-call correlation loggers with a generated suffix (`:349`, `:408`), which ALOG-03's D-17/D-18 restatement explicitly permits.

**Worth checking at promotion:** whether WR-03 and WR-09 should be folded into whichever phase next touches those comments rather than run as their own plan — both are single-comment corrections. WR-04 and WR-05 are the only two with a reachable behavioral consequence and are the natural core of a scoped plan; WR-01 becomes worth fixing the moment anything starts consuming `reqs$`.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.19: Phase 15 code-review residuals (BACKLOG)

**Goal:** [Captured for future planning] The four Warning-tier findings surfaced by Phase 15's round-2 code review and independently re-derived by 15-VERIFICATION.md's re-verification pass (2026-08-18), which recommended a backlog follow-up that was never filed; the v1.2 milestone audit caught the omission. None invalidates CAUTH-01..04. **All four re-verified against source on 2026-08-19 and still live.**

**WR-10 — a single relay's AUTH rejection can latch a permanent error on a healthy community. This is the one to fix first.** `community.ts:361` wires `onAuthFailure: (message) => this.error$.next(message)`, which fires on every relay AUTH rejection. The only clear-to-`null` is `:539`, and it sits *after* `start()`'s `if (this.started || this.disposed) return; this.started = true;` guard at `:536-537` — and `this.started` is never reset anywhere, including `dispose()` (it is only ever read, at `:608` and `:640`). So a second `start()` returns early and never clears. One transport relay out of several rejecting AUTH leaves a permanent `error$` on an otherwise-working community. **This wave's own WR-02 fix made it more reachable**: routing auth failures to `error$` immediately was correct, but no recovery edge was added alongside it. Needs a clear-on-recovery path, not just a reset of `started`.

**WR-09 — `heldChannelKeys()` is dead code for its stated purpose, and its doc comment says otherwise.** `community.ts:743`, called at `:780` and `:807`; the doc at `:719` points readers to it as the mechanism closing CR-01/CAUTH-01, which it structurally cannot be — the churn guard returns before it fires on the relevant path. 15-VERIFICATION.md proved this with a mutation test: reverting both call sites to `publicChannelKeys()` leaves the CR-01 regression test passing, because the real fix lives in `publishToPlane`'s per-publish registration. Two costs: misleading documentation at exactly the call site a future reader would trust, and an unnecessary widening of the community's own key holder (it eagerly loads every held private-channel secret at first `openLive()`, contrary to the phase's own per-operation-scoping principle). Removing it is the likely right answer, but confirm the mutation result still holds first.

**WR-11 — a worked example models the holder-scope violation the phase exists to prevent.** `apps/examples/src/examples/concord/direct-invites.tsx:170` does `useMemo(() => new StreamSigners(), [])` in a component that is a long-lived invite inbox, never remounted per community, so a second accepted invite for a different community accumulates both communities' guestbook keys in one holder (`:255-277`). Not exploitable — `waitForAuth` still narrows every AUTH to one key at a time — but this file is documentation as much as code, and 15-11's per-scope-holder sweep did not fully reach it.

**WR-12 — `revoke()`/`revokeBundle()` swallow publish failures and report success anyway.** `invite-manager.ts:288-296`, mirrored at `community.ts:1380-1385`: a `.catch()` absorbs the publish failure (an AUTH rejection included) and the method unconditionally returns `revoked: true`. **Pre-existing** — predates `9b2b3028`, so not a CAUTH-migration regression — and outside CAUTH-01..04's literal scope, but security-adjacent: a link the UI reports dead may still resolve against a relay that never accepted the revocation.

**Worth checking at promotion:** whether WR-10 and WR-12 belong together as an "auth/publish failures must surface honestly" plan — both are cases where a failure is absorbed into a wrong-but-plausible state — leaving WR-09 and WR-11 as a smaller documentation-and-example cleanup. Note `applesauce-concord` is unreleased, so none of these need a changeset (see [[concord-unreleased-no-changesets]] convention recorded in REQUIREMENTS.md's Out of Scope table).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.20: Group error conditions for `request()` and `subscription()` (BACKLOG)

**Goal:** [Captured for future planning] Give `RelayGroup.request()` and `RelayGroup.subscription()` an **error condition** — a caller-supplied operator, symmetric with the existing completion condition, that decides *when* the observable errors and *what* error it raises. Default it to "every relay in the group has failed." Surfaced by the 2026-08-19 error-surface audit of all public relay/group/pool methods; **targeted for the v1.2 release rather than deferred**, since both methods currently report total failure as a non-event.

**What each method does today.** Both drop per-relay failures on the floor: `internalSubscription` demotes a relay's throw to a `{type:"ERROR", from, error}` message (`group.ts:177`), and both methods then filter for `type === "EVENT"` (`:296`, `:314`), removing exactly those messages. What differs is what the consumer observes when *every* relay fails:

- **`subscription()` hangs silently, forever.** No error, no value, no completion, and no clock — it has neither a completion condition nor a timeout. A subscription to five dead relays is indistinguishable from a subscription to five quiet ones.
- **`request()` completes empty, successfully.** Its default completion condition includes `completeOnAllEose()`, which scans `OPEN`/`EOSE`/`ERROR` per relay and fires once no relay is still `OPEN` (`:406-412`) — so all-relays-errored satisfies it. The consumer cannot distinguish "every relay refused" from "no events matched the filter." (Note for planning: this is *not* a 30s timeout hang; an earlier draft of the audit said so and was corrected against source.)

**Proposed shape — mirror the completion condition.** The existing machinery is `GroupRequestCompleteOperator = OperatorFunction<GroupReqMessage, any>` consumed by `completeWhen` (`operators/complete-when.ts`), with static builders (`completeAfterFirstRelay`, `completeOnAllEose`, `completeOnAny`, `completeOnAll`). The error side should read the same way:

- `GroupRequestErrorOperator = OperatorFunction<GroupReqMessage, unknown>` — **the emitted value *is* the error to raise**, and the first non-nullish emission wins. This is the one deliberate asymmetry with the complete side (which only needs a truthy signal): the user's ask was an operator that decides both *when* and *how* the observable errors, and returning the error object carries both.
- `errorWhen(operator)` in `operators/error-when.ts`, mirroring `complete-when.ts`'s `connect(shared$ => …)` structure so the condition observes the same shared upstream the values flow through, without a second subscription.
- `RelayGroup.errorOnAllRelaysFailed()` as the default builder — the same `scan` over `OPEN`/`EOSE`/`ERROR` that `completeOnAllEose()` uses, emitting when every known relay is `ERROR` and at least one relay exists.
- `RelayGroup.errorOnAny(...)` for composition. An `errorOnAll` analogue is probably not worth adding until something wants it.

**The error object is part of the design, not an afterthought.** `errorOnAllRelaysFailed()` should raise an aggregate carrying every relay's cause — e.g. a `GroupAllRelaysFailedError` with `errors: Record<string, unknown>` keyed by relay url — so the consumer gets the per-relay reasons the ERROR messages were carrying all along. Raising a bare `Error("All relays failed")` would trade one information loss for another.

**Extension — a timeout is an error condition.** Once the group has a mechanism that decides *when and how* a stream errors, the lifetime clock stops needing to be a separate bolted-on operator and becomes just another condition. `errorOnAny(errorOnAllRelaysFailed(), errorAfterSilence(60_000))` reads as one policy: give up early when every relay has failed, or at 60 s if nothing is arriving. Three things fall out of that:

- **`subscription()` gets a clock at all.** It has none today, which is the direct cause of its silent-hang trap — conditions give it one without inventing a second mechanism.
- **The error becomes specific.** The current group clock raises a bare `Error("Timeout has occurred")` from `suspendableTimeout`. As a condition it can raise a typed timeout carrying which relays were still outstanding, matching what `errorOnAllRelaysFailed()` does for the failure case.
- **Callers can express their own policy** — "error if fewer than two relays answered within 10 s" is a condition, not a feature request.

**Resolved design ruling (Phase 21 D-06–D-10).** The former Group clock ended after accepted progress, so one early EVENT could leave the returned request unbounded. Phase 21 selected one whole-returned-Observable lifetime rather than a silence-reset policy: activity never disarms or resets it, subscriptions opt in, and every enabled clock pauses across the shared auth gate. The loaders clock remains a separate silence timer.

**Hard constraint — a time-based condition must stay suspendable across auth phases.** The current clock is not a bare rxjs `timeout()`; it is `suspendableTimeout` driven by an `AuthPhaseGate`, and the call site carries an explicit "do NOT simplify this back to a bare rxjs `timeout()`, which cannot pause" warning. A 60 s condition that keeps counting through a 30 s auth wait re-introduces exactly the clock-race Phase 13 was built to remove. But an error condition is typed `OperatorFunction<GroupReqMessage, unknown>` — it observes the *message* stream, and the gate is a separate object created inside `request()`, invisible to it. Three ways out, and this is the load-bearing decision for the extension:

1. **Give time-based builders the gate.** Change the condition type from an operator to a factory the method invokes with context — `(ctx: { gate: AuthPhaseGate }) => OperatorFunction<GroupReqMessage, unknown>`. Event-driven conditions ignore `ctx`; only time-based ones use it. Keeps the gate private and costs one level of indirection in the public type.
2. **Put auth phases on the message stream** as a new `GroupReqMessage` arm. A condition could then see them with no extra plumbing — but it widens a public union, and 13-14 deliberately made `isGroupReqProgress` *total* over that union so a new arm is a compile error rather than a silent default. That guardrail firing is a feature; paying its cost here needs to be a choice.
3. **Leave the clock where it is** and let conditions own failure detection only. No regression risk, but the timeout stays a second mechanism and `subscription()` still has none — which forfeits most of what this extension is for.

Option 1 looks right. Whichever is chosen, the suspendability requirement is not negotiable — a plan that reaches for a plain `timeout()` here is reintroducing a closed defect.

**Open decision — complete and error race on the same event.** `completeOnAllEose()` already treats `ERROR` as terminal, so under the current default, all-relays-errored satisfies the *completion* condition. Adding an error condition means both fire on the same message and the error must win. Two candidate resolutions, and the planner should pick deliberately rather than discover it in review:

1. Order `errorWhen` before `completeWhen` in the pipe so the error propagates first. Cheap, but relies on operator ordering for correctness — the kind of implicit invariant that decays.
2. Narrow `completeOnAllEose()` to only count `EOSE` as terminal, letting the error condition own the all-`ERROR` case outright. Cleaner separation, but it changes a public static's semantics and any caller composing it by hand.

**Open decision — is the default a breaking change?** `applesauce-relay` is published. Turning "completes empty" into "throws" for `request()` is a real behavior change for any consumer treating an empty result as normal, and turning a silent hang into a throw for `subscription()` is one too (though nobody can be depending on the hang deliberately). Needs a changeset either way; the question is whether the aggregate-error default ships on by default in this release or whether the option lands first with the default arriving in a follow-up. Recommend on-by-default — the current behavior is not a contract anyone chose — but it is the user's call.

**Scope notes.** `subscription()` currently accepts no completion condition at all, so this adds the first condition-style option to it. `req()` is deliberately excluded — it already surfaces `{type:"ERROR"}` to the consumer and is the honest member of the family; it is the escape hatch for anyone who wants the raw per-relay signal. `RelayGroup.count()` (no per-relay isolation at all — `combineLatest`) and `RelayGroup.sync()` / `negentropy()` (per-relay failure dropped to `EMPTY`, and a hardcoded `return true` respectively) have the same underlying disease and are tracked separately.

**Reference:** the full audit of which methods use the error channel and for what is at [Relay Error Surface](https://claude.ai/code/artifact/56499ac7-bad6-4ce1-9806-e1fa9c373c3e).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.21: Per-relay isolation and an error condition for `RelayGroup.count()` (BACKLOG)

**Goal:** [Captured for future planning] Stop a single failing relay from destroying a whole group count, and give `count()` the same caller-supplied error condition 999.20 defines for `request()`/`subscription()`. Same release target as 999.20 — a dead or offline relay in a pool should cost you that relay's number, not every relay's number.

**Why it breaks today.** `count()` is the one group read with no per-relay isolation at all (`group.ts:330-336`):

```
combineLatest(Object.fromEntries(relays.map((relay) => [relay.url, relay.count(filters, id, opts)])))
```

`combineLatest` propagates the first error from any input, so one relay's failure ends the stream for every relay. Concrete trace for the offline case: `RelayPool.count()` builds its group with `ignoreOffline` hardcoded `false` (`pool.ts:248`), so an offline relay is *always* included rather than being waited out the way `ignoreOffline: true` would; `Relay.count()` then defers the send behind `waitForReady`, its hardcoded 10s fuse fires `Error("COUNT timeout")`, and `combineLatest` tears down the healthy relays' counts along with it. Every other group read method isolates; this one does not.

**Second, quieter defect in the same operator.** `combineLatest` does not emit until *every* input has emitted at least once, so even when nothing errors, the consumer gets no record at all until the slowest relay answers. One sluggish relay delays every count by up to its full 10s budget. Isolation alone does not fix this — a `catchError` per relay still leaves the all-or-nothing gate in place. Worth deciding in the same pass whether the record should instead accumulate (a `scan` emitting a partial record as each relay answers), which turns `count()` from all-or-nothing into progressive and is probably the larger practical win.

**Open decision — how a failed relay appears in the record.** The return type is `Observable<Record<string, RelayCountResponse>>` and has nowhere to put a failure. Three candidates, each a public type change:

1. **Omit the relay** — the consumer sees fewer keys than relays and cannot tell "failed" from "not answered yet."
2. **Widen the value** to `RelayCountResponse | { error: unknown }` — honest and self-describing, but every existing consumer's narrowing breaks. Most likely correct.
3. **A parallel errors map** alongside the counts — non-breaking for the value type, but splits one relay's outcome across two places.

**Depends on 999.27's re-shaping of `Relay.count()`.** Once the single-relay `count()` is the high-level method (owning retry, reconnect and a configurable timeout, and throwing on failure), the group's isolation becomes the same `catchError`-per-relay wrap that `internalPublish` already applies — decide this phase's mechanics against that shape, not today's.

**NIP-45 makes this bigger than isolation: the group cannot produce a correct aggregate.** NIP-45 defines the COUNT response as `{"count": <int>, "approximate"?: <bool>, "hll"?: "<512-char hex>"}`, and its HyperLogLog section exists precisely so counts from several relays can be **merged** rather than summed — summing double-counts every event present on more than one relay. `RelayCountResponse` models only `{ count }` (populated by an unchecked `m[2] as RelayCountResponse`), so the `hll` registers never reach the consumer and a correct cross-relay total is not currently constructible. Returning `Record<url, …>` and leaving the arithmetic to the caller is therefore not a neutral choice — it hands them a job the current types make impossible. Decide whether this phase surfaces `hll` and offers a merge helper, or explicitly documents that the record must not be summed. 999.27 covers widening the response type.

**Open decision — what the condition operator observes.** 999.20's `GroupRequestErrorOperator` is typed over `GroupReqMessage` because `request()`/`subscription()` flow through `internalSubscription`, which already manufactures `{type:"ERROR", from, error}`. **`count()` does not use `internalSubscription` and has no status-message stream at all** — so a condition operator has nothing to observe until one exists. Either give `count()` an internal per-relay status stream analogous to `internalSubscription`'s, or define a narrower count-specific condition type over the record itself. The first is more work and more consistent; the second is cheaper and risks a second, divergent vocabulary for the same idea.

**Default behavior** should match 999.20: error only once every relay has failed, raising the same aggregate error carrying per-relay causes. Anything less than total failure is a partial result, not an error.

**Inherits 999.20's timeout-as-condition extension.** `count()` is the sharpest case for it: `Relay.count()`'s hardcoded 10 s fuse is currently the *only* thing bounding a group count, and it bounds each relay separately rather than the operation. A group-level idle or overall condition would give the caller one budget over the whole fan-out instead of N uncoordinated ones — and, combined with the progressive-record change above, lets a slow relay be dropped from the result rather than deciding it.

**Worth folding in at promotion.** `Relay.count()`'s 10s timeout is hardcoded with no option to change it (`relay.ts:1175`) — the only lifetime clock in the package that a caller cannot configure. It is the fuse that makes this defect fire, so exposing it belongs in the same conversation.

**Sequencing.** Depends on 999.20 for the `errorWhen` operator, the `errorOnAllRelaysFailed` builder, and the aggregate error type — reuse that vocabulary rather than inventing a parallel one. The two could reasonably be promoted as a single phase; keep them separate only if 999.20's shape needs to settle first. `RelayGroup.sync()` and `RelayGroup.negentropy()` have the same disease (per-relay failure dropped to `EMPTY`; a hardcoded `return true`) and are still untracked.

**Reference:** [Relay Error Surface](https://claude.ai/code/artifact/56499ac7-bad6-4ce1-9806-e1fa9c373c3e).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.22: `Relay.authenticate()` throws synchronously instead of rejecting (BACKLOG)

**Goal:** [Captured for future planning] Move `authenticate()`'s missing-challenge guard inside the observable pipeline so the failure reaches the caller through the error channel — as a promise rejection — rather than as a synchronous throw from a `Promise`-returning method. Same release target as 999.20/999.21; surfaced by the 2026-08-19 error-surface audit.

**The defect.** `relay.ts:1429-1430`:

```
authenticate(signer: AuthSigner): Promise<PublishResponse> {
  if (!this.challenge) throw new Error("Have not received authentication challenge");
```

The method is **not** `async` — it returns a promise by way of `lastValueFrom(...)` at the end. So this guard throws *before any promise exists*, and the idiomatic caller never sees it:

```
relay.authenticate(signer).catch(handleAuthFailure);   // handleAuthFailure never runs; the throw escapes
```

`try { await relay.authenticate(signer) } catch {}` does catch it, which is why this has survived — the two call styles disagree, and only one of them works. Every other failure this method can produce (a signer rejection, the relay's own verdict, a connection error) arrives as a rejection, so the missing-challenge case is the lone exception to the method's own contract.

**The guard must stay.** Failing when no challenge has been received is correct and should keep failing — the issue is purely *how* it surfaces.

**Fix shape.** Wrap the body in `defer()` so the guard runs at subscribe time and its throw travels the observable error channel into the returned promise:

```
authenticate(signer: AuthSigner): Promise<PublishResponse> {
  return lastValueFrom(
    defer(() => {
      if (!this.challenge) throw new Error("Have not received authentication challenge");
      this.authLog(`Signing AUTH event for challenge ${truncateForLog(this.challenge)}, waiting on signer`);
      const p = signer.signEvent(makeAuthEvent(this.url, this.challenge));
      return p instanceof Promise ? from(p) : of(p);
    }).pipe(switchMap((event) => this.auth(event))),
  );
}
```

Moving the `authLog` line and the `this.challenge` read inside the `defer` keeps them consistent with the guard — the challenge is then read once, at subscribe time, rather than split across call time and subscribe time.

**Worth deciding at promotion — should this be a typed error?** It is currently a bare `Error`, so a consumer can only match on the message string. The package already exports an error family (`RelayClosedError` and its three auth subclasses) precisely so callers can branch structurally, and 999.20 proposes adding an aggregate group error. A `MissingChallengeError` would fit that vocabulary, but it widens the public surface — decide alongside 999.20's error type rather than separately.

**Structural note.** `authenticate()` is the **only** live instance of this shape. `Relay.negentropy()` and `RelayGroup.negentropy()` both declare `async`, so their guards already become rejections, and `RelayGroup`'s `relays` getter (`group.ts:98-101`) throws synchronously by design, which is idiomatic for a getter. What permits the bug is the shape "non-`async` method returning `Promise`" — there are four (`Relay.auth`, `Relay.authenticate`, `Relay.publish`, `RelayGroup.publish`), and only `authenticate` does work before reaching `lastValueFrom`. Marking the other three as unaffected here so a future reader does not re-derive it; if a guard is ever added to one of them, it belongs inside the pipeline.

**Release impact.** Low risk and not breaking: callers using `try`/`await` are unaffected, and callers using `.catch()` go from a crash to a handled rejection. Needs a single-sentence patch changeset for `applesauce-relay`.

**Superseded in scope by 999.26.** That phase re-layers `authenticate()` so challenge acquisition becomes a bounded wait rather than a synchronous read — which removes this throw instead of relocating it. Plan them together; shipping this fix first means rewriting it.

**Reference:** [Relay Error Surface](https://claude.ai/code/artifact/56499ac7-bad6-4ce1-9806-e1fa9c373c3e).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.23: Amend D-01 and record the low/high method layering rule (BACKLOG)

**Goal:** [Captured for future planning] Narrow Phase 13's D-01 from a blanket ban on throw-as-internal-signal to the rule that actually holds, and write down the layering principle its correction depends on. This entry is small and carries no code beyond comments — but 999.24 and 999.25 both cite it, so it lands first.

**The rule today.** D-01 (`phases/13-.../13-CONTEXT.md`) states that auth-required is signalled as a value, never by throwing, and that `AuthRequiredError`/`AuthTimeoutError`/`AuthHandlerError` are constructed **only at the caller boundary**. It is the direct application of the standing principle recorded in the same document: *"any time an internal method throws and the wrapper method is using it as a signal or expected state, that is a bad thing and code smell."*

**The amendment (user, 2026-08-19).** Throwing as an internal signal stays a smell **except where the immediate consumer is an aggregator over upstream calls, or a retry layer over upstream calls** — in those cases catching is the consumer's whole purpose, and the throw is being handled deliberately rather than filtered out of somebody else's channel.

**Why the original was over-broad.** D-01 justified itself with four costs, and every one of them is the same complaint — *the signal travelled through intermediaries that did not care about it*:

1. `customConnectionRetryOperator` special-casing `RelayClosedError`;
2. `AuthRequiredError extends RelayClosedError` encoding routing rather than describing the error;
3. `count()` catching and re-throwing only because someone else's signal passed through it;
4. a stream teardown per signal forcing `retry()` + resubscribe where a value could drive a resend.

Costs 1–3 do not arise when there is one hop and the consumer is the intended handler. Cost 4 inverts outright at a retry boundary: teardown-and-resubscribe *is* the resend. So D-01 is correct for `req()`, where the signal must survive `request()`, `subscription()`, and the group operators — and over-broad for `event()` → `publish()`, where exactly one consumer exists and its job is to catch.

**The carve-out already describes accepted code.** `internalSubscription` and `internalPublish` (`group.ts:177`, `:78`) intentionally `catchError` upstream throws to aggregate them per relay, and nobody reads that as a smell. `customRetryOperator` and `customConnectionRetryOperator` deliberately catch `RelayClosedError` to decide what not to retry. The amendment is descriptive of the codebase's own practice, not a new licence.

**The companion layering rule.** The reason the carve-out is safe is that the boundaries are principled:

> **Low-level methods (`event()`, `req()`) are a single interaction with the relay.** They send one frame, wait for its reply, and report the outcome — throwing on failure.
>
> **High-level methods (`publish()`, `request()`, `subscription()`) are many interactions.** They own the configurable policy: retries, reconnects, auth retries, resubscribes, and the lifetime clock.

**Where the rule needs a decision rather than an application.** Four method families exist and only two of them pair cleanly:

| Low | High | Fits? |
|---|---|---|
| `req()` | `request()`, `subscription()` | yes — 999.25 |
| `event()` | `publish()` | yes — 999.24 |
| `negentropy()` | `sync()` | yes — untracked; `negentropy()` owns the auth retry today |
| `count()` | *(none — see below)* | **resolved 2026-08-19** |

**Resolved for `count()` (user, 2026-08-19): the count family has only a high-level member.** Rather than pairing a low-level COUNT method with a wrapper, `count()` itself becomes the high-level method — it gains the policy vocabulary (`reconnect`, `retries`, a configurable `timeout`, the auth options) and no low-level counterpart is introduced. Rationale: the raw form has exactly one consumer in the repo (`RelayGroup.count()`), and the group can wrap the high-level method per relay exactly as `group.publish()` already wraps `relay.publish()`. Extract a low-level form later only if real demand appears. Tracked as 999.27. The rule therefore reads: a family has a low member only where something actually needs raw single-interaction access.

**Propagation is the real work.** Phase 13's D-01 is cited **14 times in shipped source** — `relay.ts` ×10, `operators/auth-retry.ts` ×3, `__tests__/relay.test.ts` ×1 — plus its definition in `13-CONTEXT.md`. An amendment that does not reach those leaves comments asserting a rule the code no longer follows, which is the same failure mode as 999.16's WR-06. Treat updating them as in-scope, not cleanup. (Note: `D-01` also appears in v1.1 phase docs under a different phase's numbering and is unrelated — match by phase before editing.)

**Two deferred ideas need re-evaluation under the amendment.** `13-CONTEXT.md` defers (a) *"value-signal the remaining `CLOSED` prefixes so no relay reply anywhere is signalled by a throw"* — partly unnecessary if the consumer is a retry layer; and (b) *"a lint rule enforcing no-throw-as-an-internal-signal"* — a naive rule would now flag correct code, so it would have to understand the boundary or not exist.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.24: Re-layer the EVENT family — `event()` is one attempt, `publish()` owns policy (BACKLOG)

**Goal:** [Captured for future planning] Move the auth retry loop out of `Relay.event()` and into `Relay.publish()`, so `event()` is exactly one EVENT write and one reply, and `publish()` owns every retry dimension. Depends on 999.23's amended D-01, which is what makes `event()` throwing to `publish()` correct rather than a smell.

**`authRetries` in `event()` is a resend loop — confirmed against source.** `control` (`relay.ts:1207-1221`) is an **unshared** `defer` whose body is `this.socket.next([verb, event])`, deliberately unshared so it "always re-sends on every subscription." The operator drives it at `operators/auth-retry.ts:366-371`:

```
expand((value) => isAuthRequiredSignal(value) ? concat(runPhase(value), source) : EMPTY)
```

Re-subscribing `source` re-runs `control` and writes the EVENT frame again. With the default `authRetries: 1`, `event()` writes the same event to the socket **twice**. `publish()`'s own comment concedes it: *"max EVENT sends is authRetries + 1, independent of `retries`."*

**Target shape.** `event()` sends once, waits for the OK, and **throws `AuthRequiredError`** when the relay refuses. `publish()` — a retry layer, and therefore permitted to catch under 999.23 — catches it, runs the handler, waits for auth, and resubscribes `event()` to resend. What that removes:

- **The string round-trip.** Today `event()` flattens its own `AuthRequiredError` into `{ok:false, message: err.reason}` and `publish()` reconstructs it via `result.message?.startsWith(AUTH_REQUIRED_PREFIX)` (`relay.ts:1607`). Of the five uses of that constant, four are genuine wire parsing; this is the only one re-parsing a string the same file already parsed. The error object would pass directly instead, losing nothing.
- **A discriminator the relay controls.** `message` is remote-supplied text carrying an internal signal between two of this class's own methods. Under `waitForAuth: false` the raw relay response passes straight through (`:1257`), so "I declined to try" and "I tried twice and gave up" currently reach `publish()` as byte-identical values.
- **The `AUTH_PHASE_GATE` module-private symbol**, which exists only so `publish()` can thread its gate into `event()` to suspend the publish clock. With the auth loop inside `publish()`, the gate is local and the option disappears.

**A live bug this fixes.** `event()`'s 10 s clock manufactures a **value** (`{ok:false, message:"Timeout", error}`) rather than throwing, and `customRetryOperator` only ever sees errors — so **`publish({retries: 3})` does not retry a timed-out publish today.** The timeout sails past the retry operator and is returned to the caller. Once `event()` throws on failure, a timeout becomes retryable by the layer that owns retry policy; decide explicitly whether it should be (it probably should).

**Also closes 999.16's WR-06 structurally.** Once every client-side failure leaves `event()` as an error and only genuine relay verdicts leave as values, the `.error` contract the comments at `relay.ts:1180`/`:1218`/`:1238-1242` already assert becomes *true* rather than aspirational. Fold the WR-06 item out of 999.16 into this phase rather than fixing it there as a comment edit.

**`waitForReady()` moves up too.** It is not a retry — it `take(1)`s — but it silently waits out an entire reconnect backoff, **unbounded**, because `timeout({first: eventTimeout})` is applied *inside* the observable `waitForReady` wraps, so the 10 s clock does not start until the gate opens. "Keep waiting for the relay to come back" is policy. `merge(this.watchTower, control)` stays in `event()` — that is connection lifecycle, and one attempt legitimately needs the socket alive.

**Consequences to decide before planning:**

1. **`Relay.sync()`'s SEND path calls `event()` directly** (`:1670`), not `publish()`, and gets auth retries for free today. It would silently lose them. Rewire to `publish()`, or have `sync()` own the retry.
2. **`RelayGroup.event()` also calls `relay.event()` directly** and would become a raw per-relay single attempt while `group.publish()` keeps full policy. Defensible and arguably clarifying, but a behavior change.
3. **This re-opens RAUTH-07**, which explicitly lists `event` among the eight operations exposing `onAuthRequired`/`authTimeout`/`authRetries`. Needs a recorded restatement with provenance, in the manner of ALOG-03 and CAUTH-03 — not a silent edit, and not before v1.2 closes.
4. **D-07's hot-loop guard needs re-deriving.** `customRetryOperator` skips `RelayClosedError` precisely so publish's reconnect retries cannot multiply against event()'s auth retries. With both loops inside `publish()`, their ordering and interaction must be made explicit rather than inherited. This is where the bug risk concentrates.

**Release impact.** Behavior change on a published package: `event()` stops erroring for auth reasons and starts erroring for relay refusals. No in-repo consumers outside `packages/relay` (checked `concord` and `loaders`: zero call sites), so the blast radius is external users. Minor changeset.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.25: Re-layer the REQ family — move `reconnect` and `resubscribe` up to `request()` and `subscription()` (BACKLOG)

**Goal:** [Captured for future planning] Make `Relay.req()` a single REQ interaction and move every multi-interaction mechanism — `reconnect`, `resubscribe`, and the auth retry — up into **both** `Relay.request()` and `Relay.subscription()`. Depends on 999.23 for the principle and follows 999.24 so the pattern is proven on the smaller surface first. The largest and highest-risk of the three.

**The current layering is inverted.** `req()` — nominally the low-level method — owns three multi-interaction mechanisms plus the ready gate (`relay.ts:1062-1070`):

```
this.authRetryOperator(...)                          // auth retries
this.customConnectionRetryOperator(opts?.reconnect)  // reconnect retries
this.customRepeatOperator(opts?.resubscribe, ...)    // resubscribe after a clean CLOSED
```

`request()` and `subscription()` own **none** of them. They are pure shaping wrappers — completion condition, lifetime clock, `filter`/`map` — that forward `reconnect` downward.

**The policy choice already lives at the right layer; only the mechanism does not.** `request()` and `subscription()` each supply their own default before delegating (`reconnect: opts?.reconnect ?? this.requestReconnect` / `?? this.subscriptionReconnect`), and `RelayGroup` mirrors that at `group.ts:284` and `:311`. Per-method reconnect *defaults* are already a wrapper concern. This phase moves the machinery to join them.

**Public type changes.** `RelayReqOptions` currently carries `id`, `resubscribe`, `reconnect`, intersected with `RelayAuthOptions`; `RelayRequestOptions = RelayReqOptions & { timeout, complete }` and `RelaySubscriptionOptions = RelayReqOptions` both inherit them. After the move, `RelayReqOptions` sheds `reconnect` and `resubscribe` — and, under 999.24's principle, the auth options too — reducing toward `{ id }`, while `RelayRequestOptions` and `RelaySubscriptionOptions` declare them explicitly. A consumer passing `reconnect` to `req()` becomes a type error, which is the desired signal but is breaking.

**Central design decision — `subscription()` is long-lived.** A strict single-interaction `req()` cannot survive a reconnect at all, so `subscription()` becomes the owner of the re-establish loop rather than a filter over a self-healing `req()`. That is coherent and arguably where it always belonged, but it is a rewrite of the most-used read path in the package, not a refactor. Settle it before any plan is written:

- Does a reconnect mid-subscription re-send the same REQ id, or mint a new one?
- Does `resubscribe`-after-clean-CLOSED remain distinct from `reconnect`-after-socket-error once both live in the same layer, or do they collapse into one policy?
- What does a re-established subscription emit — does the consumer see a second `OPEN`, and does `filterDuplicateEvents` still hold across the boundary?

**Interaction with 999.20.** That phase adds error conditions and a suspendable idle clock to `RelayGroup.request()`/`subscription()`. Both phases touch the same two methods and the same clock. Sequence them deliberately — most likely 999.20 first (additive, release-targeted) and this one after, rather than in parallel.

**Watch the closed defects.** `req()`'s per-attempt `defer` factory, the `resubscribeHolder` call-scoped object, and `isReqProgress`'s exclusion of the synthetic `OPEN` all exist because plans 13-08..13-14 closed specific reentrancy and retry-counting defects (CR-01/CR-02/CR-03, WR-01). Any re-layering must carry those invariants forward, with their regression tests still discriminating — re-verify them RED/GREEN rather than assuming a passing suite means they survived.

**Release impact.** Breaking on a published package: option types move between interfaces and `req()` loses behavior callers may rely on. Major changeset, and it wants a migration note.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.26: Re-layer the AUTH family — `authenticate()` owns challenge freshness and retry (BACKLOG)

**Goal:** [Captured for future planning] Apply 999.23's layering rule to `Relay.auth()` / `Relay.authenticate()`: `auth()` stays a single AUTH frame and its one reply, while `authenticate()` becomes the high-level method that acquires a challenge, signs against it, and owns the retry policy — including re-signing when the challenge moves under a slow signer. **Subsumes 999.22**; do not plan them separately.

**`auth(event)` already fits the low half.** It takes an already-signed AUTH event, sends it once via `event(event, "AUTH")`, and returns the relay's verdict. Its `{ok:false, message}` return is *correct* under 999.24's rule — an `OK false` on an AUTH is a genuine relay verdict, not a client-side failure, so a value is the right shape and should stay one. The only standing constraint is that `auth()` must keep calling `event()` and never `publish()`, or it would recurse into the auth loop 999.24 installs there. Its per-attempt bookkeeping (`authentications$`, and the deprecated `authentication$` / `authenticationResponse$` mirrors) is per-interaction state and belongs where it is.

**`authenticate(signer)` owns no policy today** — it reads `this.challenge`, signs, and delegates. That is the whole method, and it is where the following defect lives.

**The defect: a stale challenge is signed, sent, and rejected as if the relay refused.** `authenticate()` reads `this.challenge` **synchronously at call time** (twice — once for the log line, once for `makeAuthEvent`), then awaits `signer.signEvent(...)`. That signer may be a NIP-46 bunker or a browser-extension dialog with a human in the loop, so the window is seconds to minutes. If the socket cycles inside it:

1. `resetState()` nulls `challenge$` (`relay.ts:464`) and drops all auth state;
2. the reconnect brings a new challenge, written at `:638`;
3. the signer resolves, and `switchMap → auth(event) → event(event, "AUTH") → waitForReady(...)`;
4. `waitForReady`'s gate is now open, so **the AUTH event signed against the superseded challenge is written to the wire**;
5. the relay rejects it as invalid.

Nothing recovers, and the report is misleading. `authenticate()` returns `{ok:false}`; concord's handlers (`packages/concord/src/client/auth.ts:186` and `:232`) log "relay rejected the AUTH" and call `fail(...)`; and because `authRetries` defaults to `1`, the shared operator runs `onAuthRequired` **exactly once**, so no second phase exists to recover. **No layer retries authentication today** — not `authenticate()`, not concord, not the operation. The user is told their auth was refused when it was never validly attempted.

This is the signing-path sibling of 999.18's deferred item (a connection dropping mid-auth-*wait* at low `keepAlive`); same root, different half of the flow.

**What `authenticate()` should take on:**

1. **Acquire a challenge rather than read one.** Wait for `challenge$` to emit non-null instead of throwing when it happens to be null — "no challenge yet" is a transient state on a fresh connection, and callers should not have to poll.
2. **Keep the signed challenge fresh.** Capture what was signed against, verify it still matches before the frame goes out, and re-sign + resend when it has moved. This is the retry policy, and it is what makes the method high-level.
3. **Retry / reconnect options** sharing `publish()`'s vocabulary, per 999.23.

**Open decision — does the missing-challenge throw survive?** 999.22 exists to move that throw inside the pipeline so `.catch()` sees it. If acquisition becomes a wait, the throw disappears instead of moving, and 999.22's fix is moot. But a relay that never sends a challenge (no NIP-42 support) would then hang, so it is wait-with-timeout, or keep a relocated throw, or both — a bounded wait that throws on expiry. Pick one here; **fold 999.22 into this phase rather than shipping its fix first and rewriting it.**

**Open decision — how many resigns, and does the outer budget already cover it?** A challenge that keeps moving means a reconnect loop, and re-signing forever would re-prompt a human signer forever. The bound must be small and explicit. Note it interacts with the operation-level `authRetries` one layer out: two nested budgets over the same failure need a deliberate relationship, the same hazard 999.24 flags for D-07.

**Open decision — bookkeeping across a retry.** `auth()` writes `authentications$` keyed by pubkey, re-inserting on each attempt. A resign-and-resend would record two attempts for the same pubkey, the second overwriting the first. Probably fine, but confirm nothing reads it as a history.

**Consumers to check.** `packages/concord/src/client/auth.ts` ×2 (the Phase 15 `StreamSigners.onAuthRequired` and `createUserAuthHandler` paths) plus four example apps. None retry today, so all of them inherit the fix rather than needing changes — but concord's two handlers differ in how they read the response (`isOkResponse(res) && res.ok` vs a bare `res.ok`), which is worth reconciling while in there.

**Release impact.** Mostly additive: callers that pass no options keep working, and the stale-challenge path changes from a misleading rejection to a successful auth. The missing-challenge behavior change is the one breaking edge, depending on the decision above. Minor changeset for `applesauce-relay`; `applesauce-concord` is unreleased and needs none.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.27: Make `Relay.count()` the high-level member of its family (BACKLOG)

**Goal:** [Captured for future planning] Give `count()` the policy vocabulary the other high-level methods have — `reconnect`, `retries`, a configurable `timeout`, the auth options — and widen its response to what NIP-45 actually defines. Per 999.23's resolution the count family has **only** a high-level member: no low-level COUNT method is introduced.

**Why count is the odd family.** For every other pair the wire verb and the intent are different words (EVENT/`publish`, REQ/`request`, negentropy/`sync`), so both members get a natural name. COUNT's wire verb *is* its intent. Rather than manufacture a second name for a method nobody needs, `count()` simply becomes the high-level member. The raw form has exactly one consumer in the repo — `RelayGroup.count()` — and the group can wrap the high-level method per relay the way `group.publish()` wraps `relay.publish()` today.

**Where count sits now.** It is a low-level method with policy accidentally attached, the same shape `event()` is in (999.24): named for the wire verb, takes an explicit wire `id`, returns the wire reply type, `take(1)` on one frame and one reply — but carrying an auth retry loop that resends COUNT, a **hardcoded 10 s clock with no option to change it** (`relay.ts:1175`, the only lifetime clock in the package a caller cannot configure), and `waitForReady`. `RelayCountOptions = RelayAuthOptions`, so it has none of the policy vocabulary despite owning the policy.

**Work:**

1. `RelayCountOptions` gains `reconnect`, `retries`, and `timeout` alongside the auth options, matching `PublishOptions`.
2. The 10 s fuse becomes `opts.timeout`, defaulting to a named field on `Relay` in the manner of `publishTimeout` / `eventTimeout`.
3. Keep the auth retry where it is — under 999.23 it belongs to the high-level member, and `count()` now *is* that member.
4. Failure surfaces as an error, consistent with the rest of the high-level layer.
5. The wire `id` parameter stays, since `RelayGroup.count()` needs one id across the fan-out. A wire concern on a high-level method is a known, accepted impurity here.

**Widen the response type — NIP-45 defines three fields and we model one.** The spec returns `{"count": <integer>}`, optionally with `"approximate": <bool>` when the relay counted probabilistically, and optionally with `"hll": "<512-char hex>"` (256 single-byte registers) so clients can merge counts across relays. Today:

```
export type RelayCountResponse = { count: number };
...
if (m[0] === "COUNT") return m[2] as RelayCountResponse;   // unchecked cast
```

Both optional fields are silently discarded, and the cast means a malformed payload becomes a typed lie rather than an error. Widen to `{ count: number; approximate?: boolean; hll?: string }` and validate rather than cast. **Do not unwrap the return to a bare `number`** — a caller handed `93412452` with no `approximate` flag cannot tell an exact count from an estimate, and dropping `hll` is what makes a correct group aggregate impossible (see 999.21). Return `Promise<RelayCountResponse>`.

**Open decision — `Promise` or `Observable`?** `count()` is `take(1)`, so one question and one answer; `publish()` is the precedent for returning a `Promise` in that situation, and it reads better at a call site. But it is a breaking return-type change on a published package, and `RelayGroup.count()` currently composes the per-relay observables with `combineLatest` — 999.21 is rewriting that anyway, so the two should agree. Decide across both phases, not in one.

**Open decision — does anything want the raw form after all?** This phase deliberately ships no low-level COUNT. If 999.21 finds the group genuinely needs raw per-relay wire access rather than a caught high-level call, that is the signal to extract one — and it should be named for the wire verb, consistent with `event`/`req`.

**Release impact.** Breaking on a published package: the return type changes and the options widen. Major or minor depending on the `Promise` decision above. Sequence with 999.21, which consumes it.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.28: Re-layer the negentropy family — `negentropy()` negotiates, `sync()` owns policy (BACKLOG)

**Goal:** [Promoted to Phase 24] Apply 999.23's layering rule to `Relay.negentropy()` / `Relay.sync()`: `negentropy()` runs one NEG-OPEN..NEG-CLOSE negotiation and emits what it learns per round **without blocking on the caller**, while `sync()` owns auth, reconnect, direction, and transfer concurrency with caller-owned lifetime. **Absorbs 999.13**, whose dropped-follow-up bug lives in the same loop this phase restructures.

**The protocol question was investigated before the design, not assumed.** Two things were checked:

1. **NIP-77 explicitly endorses transferring during the negotiation.** *"Given these IDs, the client can upload events it has with `EVENT`, and/or download events it needs with `REQ`. This can be performed over the same websocket connection **in parallel with subsequent `NEG-MSG` messages**."* The spec also notes a client may skip transfer entirely (counting unique events), treating negotiation and transfer as separate concerns — which is the layering this phase implements.
2. **The per-round sets are increments, not cumulative.** `lib/negentropy.ts:314-316` re-initializes `haveIds`/`needIds` on every `reconcile()` call and pushes only ids from ranges resolved in *that* message (`:386`, `:399`). With the spec's guarantee that ranges never overlap and resolved ranges become `Skip`, **each id is reported in exactly one round.** Acting per round therefore transfers each id exactly once, with no dedupe.

**Conclusion: reconciling during the sync is both expected and the performant choice.** Deferring to the end is viable but strictly worse — the caller must accumulate across rounds and no byte moves until the last round completes.

**The defect is not "during" — it is the `await`.** `negentropy.ts:146` does `await reconcile(have, need)` inside the round loop, so the negotiation does not request the next NEG-MSG until the caller's transfers finish. That is exactly the serialization the spec's "in parallel" language rules out, and nothing in the protocol asks for it — it fell out of typing the hook as a `Promise`-returning callback.

**Target shape.**

```
negentropy(store, filter, opts): Observable<{ have: string[]; need: string[] }>
```

The negotiation emits per round and runs to completion at protocol speed. `sync()` subscribes, performs the transfer per emission, and completes when the negotiation completes *and* the transfers settle. Control flow points the right way: the low-level method reports, the high-level one decides and acts — instead of a caller-supplied callback reaching back in to stall the protocol.

**Dropping the `await` is not free — it is currently accidental backpressure.** `sync()`'s SEND already does `Promise.allSettled(events.map(...))` with no cap *within* a round; remove the `await` and it is uncapped *across* rounds too, so a large diff could open thousands of concurrent publishes. This is not a reason to keep the `await` — it is the reason **transfer concurrency must become explicit policy on `sync()`** (a bounded `mergeMap`, configurable) rather than serialization inherited from a callback's shape.

**`sync()`'s emission widens to cover both directions.** `Observable<NostrEvent>` is a RECEIVE-shaped type on a bidirectional operation — the SEND direction has literally nothing to emit, which is why the docs example (`apps/docs/loading/relays/relays.md:366`) can only subscribe to `complete`, and why its `"Upload complete"` log is currently a falsehood: completion means the negotiation finished and `Promise.allSettled` returned, not that a single event landed. A SEND whose every upload is rejected prints "Upload complete".

```
type SyncMessage =
  | { type: "received";    event: NostrEvent }
  | { type: "sent";        event: NostrEvent }
  | { type: "send-failed"; event: NostrEvent; error: unknown }
```

This is the same mechanism as three other open items, which is the argument for doing it here:

- **The SEND-direction swallow** — failures become values, and SEND gains any output at all.
- **`RelayGroup.sync()`'s per-relay drop.** D-19's own comment states the constraint: *"sync() has no error channel (Observable<NostrEvent>), so the dropped relay is visible in debug output only — a status channel for it remains out of scope."* A union **is** that channel; add `{ type: "relay-failed"; from: string; error: unknown }` and the group stops swallowing.
- **`RelayGroup.negentropy()`'s literal `true`** gains somewhere to report.

**On the layering rule:** high-level methods unwrap to the domain value, so a union looks like a low-level shape. Two reasons it is right here — `subscription()` already returns `Observable<NostrEvent | "EOSE">`, so a union at the high level has precedent; and `sync()`'s domain value is not "events" but *the outcome of a bidirectional reconciliation*, which the union is.

**Migration is cheap and well-timed.** Six consumers, every one of them RECEIVE (`sync-loader.ts:307` and concord by way of it, plus five example apps); each needs one `filter`. The only SEND callers in the repo are one test and one docs example. Since this phase is already making a breaking signature change to the same method, it is one migration rather than two.

**Open — emit `sent` on success?** Recommended yes: it is the only output the SEND direction would ever produce, and it is what makes the docs example honest. **Open — should a sync ever error outright** (e.g. every send failed), or only report failures as values? 999.20's caller-supplied error condition is the natural vocabulary if so.

**What moves up to `sync()`:**

1. **The auth retry.** `negentropy()` owns it today (`relay.ts:1419`). Note what that currently costs: one `sync()` threads `authOptions` into **three** sites — the negotiation, each `event()`, and the `req()` — so a single sync can burn three independent auth budgets. One operation should have one budget.
2. **Caller-owned lifetime**, through AbortSignal or composed RxJS operators; Phase 24 intentionally exposes no built-in sync timeout.
3. **`waitForReady` / reconnect handling**, as in the other families.
4. **Transfer concurrency**, per above.

**Absorbed from 999.13.** `negentropySync` computes the next client message and drops it — `msg = newMsg`, and `socket.next` is never called anywhere in the file, so only the initial NEG-OPEN reaches the wire. **Multi-round sync has therefore never worked**, which means this phase has no working behavior to preserve and can restructure freely. It also means the existing suite proves nothing here: `relay.test.ts:2748` deliberately keeps both sides under 32 items so reconciliation completes in one round (its own comment says so). **Any test for this phase must exceed the frame-size threshold to force a second round** — no current test does. Provenance for the bug is in 999.13: it traces to `f649d6dd` (2025-10-27), ten months before Phase 13, and is not a Phase 13 regression.

**A non-consequence, recorded so it is not re-derived.** `SyncLoader` calls `pool.relay(relay).sync(eventStore, filter, undefined, opts)` (`sync-loader.ts:307`) — the **high-level** method, already receiving the auth options. Moving auth from `negentropy()` up to `sync()` therefore leaves `SyncLoader` and RAUTH-08 untouched. Unlike 999.24, this phase does not re-open a shipped requirement.

**Open — the group forms are not resolved here.** `RelayGroup.negentropy()` discards every per-relay result via `Promise.allSettled` and returns a literal `true`; `RelayGroup.sync()` drops a failed relay to `EMPTY` plus a debug line (D-19). Both are real, both are in this family, and neither is designed yet. Deliberately left open — decide whether they fold into this phase or follow it, once the relay-level shape settles. Note `RelayGroup.negentropy()` is a group-level *low*-level method, which does not fit the layering rule at all and may simply not deserve to exist.

**Release impact.** Breaking on a published package: `negentropy()`'s signature changes from a callback plus `Promise<boolean>` to an `Observable`, and `sync()` gains options. Major changeset with a migration note. `negentropy()` has no consumers in this repo outside `relay.sync()` and `RelayGroup.negentropy()`.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)
