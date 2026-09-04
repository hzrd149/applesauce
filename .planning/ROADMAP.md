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
- [x] **Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2** - `applesauce-react`'s first rendering tests, and `apps/examples` on worker-relay v2, both independent of the relay work (completed 2026-09-03)
- [x] **Phase 25.1: Concord Media Epoch-Key Decryption Audit** - Verify historical media uses epoch-correct key material across rotations (completed 2026-09-04)
- [ ] **Phase 25.2: Concord Rotation Robustness Residuals** - Close remaining multi-chunk publication, convergence, error, and citation risks
- [ ] **Phase 25.3: Concord Invite-Bundle Rule-Table Hardening** - Make validation and projection guardrails structural and fail safely on corrupt own-list data
- [ ] **Phase 25.4: Replace the `debug` Dependency** - Replace the cross-package logger dependency before republishing the suite
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

**Plans**: 5/5 plans executed
**UI hint**: yes

Plans:

- [x] 25-05-PLAN.md

**Wave 1**

- [x] 25-01-PLAN.md — React 19 rendering-test tracer and approved test infrastructure
- [x] 25-04-PLAN.md — Three folded Phase 05.1 regressions and changesets

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 25-02-PLAN.md — Complete hook/provider lifecycle suite and React 18/19 CI matrix
- [x] 25-03-PLAN.md — Worker-relay v2 migration with UI/runtime contract preservation

### Phase 25.4: Replace the debug Dependency (INSERTED)

**Goal:** Replace the cross-package `debug` dependency with a simpler compatible implementation before the coordinated v7 publish.
**Requirements**: TBD
**Depends on:** Phase 25.3
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 25.4 to break down)

### Phase 25.3: Concord Invite-Bundle Rule-Table Hardening (INSERTED)

**Goal:** Strengthen Concord's invite-bundle rule tables and projections so field types and optional-field carry-forward are enforced structurally, and corrupt self-authored invite data fails safely.
**Requirements**: TBD
**Depends on:** Phase 25.2
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 25.3 to break down)

### Phase 25.2: Concord Rotation Robustness Residuals (INSERTED)

**Goal:** Resolve Concord's remaining rotation robustness risks around multi-chunk relay coverage, live convergence, partial publication, swallowed errors, and rotation citation pinning.
**Requirements**: TBD
**Depends on:** Phase 25.1
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 25.2 to break down)

### Phase 25.1: Concord Media Epoch-Key Decryption Audit (INSERTED)

**Goal:** Audit Concord media encryption and decryption across epoch rotations, confirming historical media resolves the correct key material and fixing any verified defect.
**Requirements**: TBD
**Depends on:** Phase 25
**Plans:** 3/3 plans complete

Plans:
**Wave 1**

- [x] 25.1-01-PLAN.md — Lossless attachment diagnostics and exact wire compatibility tracer

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 25.1-02-PLAN.md — Real AES-GCM historical media proofs across refounding and rekeying

**Wave 3** *(gap closure; blocked on Waves 1-2 completion)*

- [x] 25.1-03-PLAN.md — Enforce the documented 16-byte attachment nonce and prove parser boundaries

### Phase 26: Release Coordination — v7.0.0

**Goal**: The v7.0.0 major publishes exactly what it is supposed to — all fourteen packages, v1.2's held changesets, and Concord's first official stable release — verified by a dry run rather than assumed from the `linked` config.
**Depends on**: Phases 16–25.4 (every package's intended v7.0.0 change must be finalized before the release can be verified and cut)
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
| 25.1 Concord Media Epoch-Key Decryption Audit | v7.0.0 | 0/TBD | Not started | - |
| 25.2 Concord Rotation Robustness Residuals | v7.0.0 | 0/TBD | Not started | - |
| 25.3 Concord Invite-Bundle Rule-Table Hardening | v7.0.0 | 0/TBD | Not started | - |
| 25.4 Replace the `debug` Dependency | v7.0.0 | 0/TBD | Not started | - |
| 26. Release Coordination — v7.0.0 | v7.0.0 | 0/TBD | Not started | - |

**Totals:** 19 phases across three shipped milestones; 135 plans shipped (98 across v1.0/v1.1, 37 across v1.2). v7.0.0 contains 15 phases (Phases 16–26, including 25.1–25.4); release coordination remains last.

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
