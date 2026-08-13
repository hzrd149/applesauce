# Roadmap: Applesauce

## Milestones

- ✅ **v1.0 event-store-supports-rumors** — Phases 1–4 (shipped 2026-07-09)
- ✅ **v1.1 first-fixes** — Phases 5–12.3 (shipped 2026-08-04)
- 🚧 **v1.2 operation-scoped-relay-auth** — Phases 13–15 (in progress)

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

### 🚧 v1.2 operation-scoped-relay-auth (In Progress)

**Milestone Goal:** Move NIP-42 authentication out of ambient, relay-wide cached state and into the operation that actually receives `auth-required:`, then migrate Concord's stream auth onto that hook instead of its own client-wide registry driver.

**Origin:** three backlog items promoted 2026-08-05 via `/gsd-review-backlog` — 999.5 (drafted plan on disk), 999.4, and 999.11 — plus SEED-001's `packages/loaders/` sweep. Full requirements: [`REQUIREMENTS.md`](REQUIREMENTS.md).

**Hard sequencing:** Phase 15 is hard-blocked on Phase 13 — CAUTH-01..04 need `onAuthRequired`/`authTimeout`/`authRetries` to exist on both the paginated REQ path and the negentropy sync path before Concord's stream-auth engines can migrate off the client-wide registry. Phase 14 depends on Phase 13 only softly (13 restructures the auth surface that 14 instruments with logging).

- [x] **Phase 13: Operation-Scoped NIP-42 Auth Hooks** - `onAuthRequired`/`authTimeout`/`authRetries` land across every request-like operation in `applesauce-relay` and thread through `applesauce-loaders`' `SyncLoader` (waves 1-6 complete 2026-08-06; reopened by verification — gap closure in waves 7-9; reopened again 2026-08-06 by code review CR-02, a WR-01-class regression introduced at group.ts:275 by plan 13-11 — closing in plan 13-14) (completed 2026-08-07)
- [x] **Phase 14: Auth Lifecycle Debug Logging** - A NIP-42 auth attempt's lifecycle and outcome become observable in debug output, and every `packages/loaders/` logger is derived once instead of `.extend()`-ed inline (completed 2026-08-11)
- [ ] **Phase 15: Concord Stream-Auth Cleanup** - Concord's client-wide stream-signer registry and relay drivers are retired in favor of per-operation `onAuthRequired` handlers owned by each community/private-channel engine

## Phase Details

### Phase 13: Operation-Scoped NIP-42 Auth Hooks

**Goal**: NIP-42 authentication moves out of ambient, relay-wide cached flags (`authRequiredForRead$`/`authRequiredForPublish$` as pre-blocking gates) and into the specific operation that receives `auth-required:` — `req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, and negentropy each expose `onAuthRequired`/`authTimeout`/`authRetries`, passed through `RelayPool`/`RelayGroup` and threaded into `applesauce-loaders`' `SyncLoader` on both its negentropy and paginated paths.
**Depends on**: Nothing new (first phase of v1.2)
**Requirements**: RAUTH-01, RAUTH-02, RAUTH-03, RAUTH-04, RAUTH-05, RAUTH-06, RAUTH-07, RAUTH-08, RAUTH-09
**Success Criteria** (what must be TRUE):

  1. A consumer can pass `onAuthRequired` to `req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, or negentropy and have it invoked with operation-local context (`relay`, `url`, `challenge`, `operation`, `requirement`, `missingPubkeys`, `reason`) exactly when that operation itself receives `auth-required:` — not when an unrelated earlier operation did. (RAUTH-01, RAUTH-02, RAUTH-07)
  2. After the handler resolves, the operation waits for `waitForAuth` to be satisfied and retries, bounded by `authRetries` (default `1`) and `authTimeout` (default `30_000`ms, or `false` to wait indefinitely for external auth state). (RAUTH-03, RAUTH-04)
  3. Two concurrent operations against the same relay each invoke their own handler independently — a rejection or timeout on one resolves only its own operation, with no relay-internal dedupe. (RAUTH-05)
  4. `waitForAuth: false` rejects immediately with `AuthRequiredError` without ever calling the handler, and `event(…, "AUTH")` never invokes it. (RAUTH-06)
  5. `SyncLoader` threads `onAuthRequired`/`authTimeout`/`authRetries` into both its negentropy sync path and its paginated request path identically, the behavior passes through `RelayPool`/`RelayGroup`, and `authRequiredForRead$`/`authRequiredForPublish$` keep updating as informational status only. (RAUTH-08, RAUTH-09; pool/group leg of RAUTH-07)

**Reference**: Full drafted implementation plan on disk at [`phases/999.5-operation-scoped-nip-42-auth-hooks/operation-scoped-nip-42-auth-hooks-plan.md`](phases/999.5-operation-scoped-nip-42-auth-hooks/operation-scoped-nip-42-auth-hooks-plan.md) — `/gsd-plan-phase 13` should read it as primary input.
**Plans**: 14/14 plans complete

Plans:
**Wave 1**

- [x] 13-01-PLAN.md — Auth option/context types, `AuthHandlerError`/`AuthTimeoutError`, and the shared auth-retry operator (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 13-02-PLAN.md — `req`/`request`/`subscription`: value-signal conversion, pre-block removal, suspended request clock (wave 2)
- [x] 13-03-PLAN.md — `SyncLoader` threading, auth-aware stall guard, and the gated negentropy fallback (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 13-04-PLAN.md — `count`: value-signal conversion and suspendable 10s clock (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 13-05-PLAN.md — `event`/`publish`: shared operator, `customRetryOperator` `RelayClosedError` skip, suspended publish clock (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 13-06-PLAN.md — `negentropy`/`sync`: value-signal conversion, internal call threading, pre-gate helper removal (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 13-07-PLAN.md — `RelayGroup`/`RelayPool` pass-through, per-relay sync isolation, `PublishResponse.error`, changesets (wave 6)

**Wave 7** *(gap closure — blocked on Wave 6 completion)*

- [x] 13-08-PLAN.md — shared operator surface: required progress and first-emission predicates, synchronous handler-throw mapping (CR-01/CR-04/WR-01, wave 7)

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 13-09-PLAN.md — `req`/`request`/`subscription`: per-attempt send/listen shape and REQ-side non-vacuity tests (CR-02, wave 8)

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 13-10-PLAN.md — `count`: per-attempt send/listen shape, COUNT-side tests, and the all-sites invariant audit (CR-03, wave 9)

**Wave 10** *(blocked on Wave 9 completion)*

- [x] 13-11-PLAN.md — `RelayGroup.request()`: auth-phase gate threading, suspendable clock, hoisted logger (WR-02/WR-06, wave 10)

**Wave 11** *(blocked on Wave 10 completion)*

- [x] 13-13-PLAN.md — `SyncLoader` auth-phase suspension independent of the caller's handler, and auth-phase timer lifetime (WR-03/WR-04, wave 11)

**Wave 12** *(blocked on Wave 11 completion)*

- [x] 13-12-PLAN.md — `SyncLoader` contract tests, changesets, and RAUTH-03/07/08 closure (wave 12)

**Wave 13** *(blocked on Wave 12 completion)*

- [x] 13-14-PLAN.md — Make the group progress predicate total over `GroupReqMessage` so the WR-01 class cannot re-enter behind a cast (CR-02, wave 13)

### Phase 14: Auth Lifecycle Debug Logging

**Goal**: An operator can tell from debug output where a NIP-42 auth attempt sits in its lifecycle — challenge received, AUTH sent, result — and why it succeeded or failed, with outcomes attributable to the specific operation that triggered them; every `Debugger` in `packages/loaders/` is derived once at class/module/context construction rather than `.extend()`-ed at a log call site.
**Depends on**: Phase 13 (soft — Phase 13 restructures the auth surface this phase instruments; logging the pre-Phase-13 pre-block gate would need rework the moment Phase 13 lands)
**Requirements**: ALOG-01, ALOG-02, ALOG-03
**Success Criteria** (what must be TRUE):

  1. With debug logging enabled, an operator can trace a single NIP-42 auth attempt's position in its lifecycle — challenge received, AUTH sent, result — and read why it succeeded or failed from the log output alone. (ALOG-01)
  2. Retry, timeout, and rejection log lines identify the specific operation that triggered them, so two concurrent operations' auth attempts stay distinguishable in a shared log stream. (ALOG-02)
  3. Every `Debugger` in `packages/loaders/` is derived once per module load, per class construction, per context construction, or per function/operator invocation — never on a path a reactive pipeline can re-enter, such as inside a `switchMap`/`mergeMap` projector or a per-item loop body (a correlation logger derived once per call with a generated suffix remains compliant; restated from the original zero-hits-grep wording per D-17/D-18). (ALOG-03)

**Plans**: 9/9 plans complete

Plans:

- [x] 14-08-PLAN.md
- [x] 14-09-PLAN.md

**Wave 1**

- [x] 14-01-PLAN.md — Wire-verb auth context, the shared request-summary formatter, and negentropy id ownership (wave 1)
- [x] 14-02-PLAN.md — ALOG-03 restatement, the `packages/loaders/` derive-once sweep, and SEED-001 closure (wave 1)
- [x] 14-03-PLAN.md — Shared debug-output capture harness and `RelayGroup.sync`'s dropped-relay prose (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 14-04-PLAN.md — The `:auth` namespace and the NIP-42 connection track (challenge, signing, sent, result, invalidation) (wave 2)
- [x] 14-05-PLAN.md — The per-operation track in the shared auth-retry operator (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 14-06-PLAN.md — ALOG-01/ALOG-02 lifecycle oracle over captured debug output (wave 3)
- [x] 14-07-PLAN.md — Publish-timeout discriminator and the release-window changeset set (wave 3)

### Phase 15: Concord Stream-Auth Cleanup

**Goal**: Concord's client-wide, append-only stream-signer registry and ambient relay challenge/authentication drivers are replaced with operation-scoped `onAuthRequired` handlers owned by each community and private-channel engine — each operation authenticates only the pubkeys its own scope is missing, using keys held by that scope, and the client-wide driver machinery (`authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, relay-status-driven stream authentication) is removed or narrowed once callers migrate.
**Depends on**: Phase 13 (hard-blocked — CAUTH-01..04 require `onAuthRequired`/`authTimeout`/`authRetries` to exist on both the paginated REQ path and the negentropy sync path before Concord's engines can migrate off the client-wide registry)
**Requirements**: CAUTH-01, CAUTH-02, CAUTH-03, CAUTH-04
**Success Criteria** (what must be TRUE):

  1. A community or private-channel engine's operation authenticates only the `waitForAuth` pubkeys its own scope is missing, drawn from keys held by that scope, never the full client-wide registry. (CAUTH-01)
  2. A relay observed during a scoped operation receives AUTH only for the k pubkeys that scope's own operations require — not every key in the client-wide registry — and a reconnect re-authenticates exactly that same scoped set. Assessed against this design, since no "before" recording of the prior churn behavior was ever committed. (CAUTH-02)
  3. `authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, and relay-status-driven stream authentication are removed or narrowed to zero remaining call sites once every caller migrates to operation-scoped handlers. (CAUTH-03)
  4. A stream operation that fails auth still retries per-operation after the migration, matching the pre-migration per-operation retry behavior. (CAUTH-04)

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
| 15. Concord Stream-Auth Cleanup | v1.2 | 0/TBD | Not started | - |

**Totals:** 19 phases across three milestones (16 shipped, 3 in progress); 98 plans shipped across v1.0/v1.1 — v1.2 plan count TBD until phases are planned.

## Backlog

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

**Goal:** [Captured for future planning] `negentropySync` (`packages/relay/src/negentropy.ts:144-148`) computes the next client message and drops it: `const [newMsg, have, need] = await ne.reconcile(...)` is followed by `msg = newMsg` and nothing else. The `socket` parameter is typed `MultiplexWebSocket & { next: (msg: any) => void }` precisely so the loop can write follow-ups, and **`socket.next` is never called anywhere in the file** — the only `.next(` call sites are the abort observer. Only the initial NEG-OPEN ever reaches the wire. Two sufficiently diverged sets need more than one round trip, so the loop then blocks forever awaiting a NEG-MSG the client never asked for, and there is **no operation clock on that path** — `relay.sync()` / `pool.sync()` hang indefinitely rather than timing out.

**Why the suite misses it:** `relay.test.ts:2748` deliberately keeps both sides under 32 items so the reconciliation completes in a single round trip — its own comment says so. Any regression test must exceed the frame-size threshold to force a second round.

**Provenance — this is NOT a Phase 13 regression.** `git log -L 144,148` traces the loop to `f649d6dd` ("Fix abort signal being ignored in `negentropySync`"), dated **2025-10-27**, ten months before Phase 13 opened. Phase 13 touched this file for auth threading only. Surfaced by the Phase 13 code review (`phases/13-operation-scoped-nip-42-auth-hooks/13-REVIEW.md`, finding CR-01) and deferred by explicit user decision on 2026-08-06 as out of that phase's scope.

**Worth checking at promotion:** whether the negentropy path should also carry an operation clock (every other operation in the phase got `suspendableTimeout`; this one has none, which is why the symptom is a hang rather than a timeout).
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
