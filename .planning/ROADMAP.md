# Roadmap: Applesauce

## Milestones

- ✅ **v1.0 event-store-supports-rumors** — Phases 1–4 (shipped 2026-07-09)
- ✅ **v1.1 first-fixes** — Phases 5–12.3 (shipped 2026-08-04)
- 📋 **Next milestone** — not yet defined (`/gsd-new-milestone`)

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

### 📋 Next milestone — not yet defined

Run `/gsd-new-milestone` to open it (questioning → research → requirements → roadmap). `REQUIREMENTS.md` was removed at v1.1 close and is recreated there.

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

**Totals:** 16 phases, 98 plans across two shipped milestones.

## Backlog

### Phase 999.2: Concord media epoch key decryption audit (BACKLOG)

**Goal:** [Captured for future planning] Review and check concord's file/media encryption and decryption to confirm that media sent in past epochs is decrypted with the correct keys **from that epoch**, not with the latest keys. Suspected failure mode: the decrypt path resolves keys from current epoch state rather than from the epoch the media was encrypted under, which would make historical media undecryptable after a rotation.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.4: NIP-42 lifecycle debug logging (BACKLOG)

**Goal:** [Captured for future planning] The NIP-42 relay authentication lifecycle needs more debug logging around it — the auth challenge/response/result flow should emit enough diagnostic detail to tell where an auth attempt is in its lifecycle and why it succeeded or failed, so that silent auth stalls or rejections are observable rather than opaque.
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

### Phase 999.5: Operation-Scoped NIP-42 Auth Hooks (BACKLOG)

**Goal:** [Captured for future planning] Move NIP-42 auth handling out of ambient relay/pool status subscriptions and into the specific operation that receives `auth-required:` — request-like operations (`req`/`request`/`subscription`/`count`/`publish`/`event`/`sync`/negentropy) expose an `onAuthRequired` callback plus `authTimeout`/`authRetries` options, keying off concrete `auth-required:` responses instead of the broad cached `authRequiredForRead$`/`authRequiredForPublish$` flags, so consumers (and Concord) no longer hand-roll status/challenge watchers to authenticate. Behavior change for `applesauce-relay` and `applesauce-loaders`; Concord auth cleanup is a follow-up. Full drafted plan: `operation-scoped-nip-42-auth-hooks-plan.md` in this phase directory.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.8: Update to nostr-tools ~2.24 (BACKLOG)

**Goal:** [Captured for future planning] Bump the `nostr-tools` dependency from the currently pinned `2.19` line to `~2.24` across the workspace, then reconcile whatever changed between the two. Pinned today in four manifests: `packages/common/package.json` (`^2.19`), `packages/core/package.json` (`~2.19`), `packages/relay/package.json` (`~2.19`), and `apps/examples/package.json` (`~2.19`) — note `common` uses a caret while the rest use tilde, so the range operators should be made consistent as part of the bump. Scope at promotion should cover: reviewing the nostr-tools changelog across 2.20→2.24 for behavior and type changes, updating the manifests, running the full test suite for fallout, and adding changesets per affected published package (concord is exempt — it is unreleased).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.10: applesauce-core expiration timer overflow (BACKLOG)

**Goal:** [Captured for future planning] `ExpirationManager` schedules a native `setTimeout()` using the full delta to a NIP-40 `expiration` tag, so any event expiring more than ~24.8 days out exceeds Node's 32-bit timer limit — Node clamps the delay to `1ms` and emits `TimeoutOverflowWarning`, which then fires repeatedly. Reported against `applesauce-core@6.2.0` with a one-liner reproduction (add a single event with an expiration 365 days out; no relay, websocket, or reconnect code involved). Explicitly **not** caused by `reconnect: Infinity` in `applesauce-relay` — that setting is documented and should stay.

**Verified against live source 2026-07-29** (the report's claims hold): `packages/core/src/event-store/expiration-manager.ts` has two uncapped `setTimeout(..., timeout * 1000 + 10)` sites, at **line 54** (`track()`) and **line 124** (`emitNotifications()`). The proposed fix — clamp each delay to `MAX_TIMER_DELAY = 2_147_483_647` via a shared private `scheduleNextCheck()`, letting a capped early fire re-derive the next target — is genuinely semantics-preserving: `emitNotifications()` (lines 98-128) recomputes `nextExpiration` as the min over all remaining entries on every fire and expires nothing when nothing is due, so an early wake is a no-op that simply reschedules. Keeping `nextCheck` set to the true target expiration (not the capped wake time) also preserves the `track()` early-exit guard at line 46. A regression test asserting the capped delay belongs in the existing `packages/core/src/event-store/__tests__/expiration-manager.test.ts`.

**Secondary observation for whoever promotes this** (pre-existing, not introduced by the fix, same few lines): when the last tracked expiration is `forget()`-ten before its timer fires, `emitNotifications()` skips the `nextExpiration !== Infinity` branch entirely and leaves `this.timer`/`this.nextCheck` stale from the already-fired timer — worth clearing in the same pass.

Full report with reproduction, observed warnings, patch shape, and reporter's validation run: `expiration-report.md` in this phase directory. Note the reporter's `pnpm --filter applesauce-core test -- <path>` ran the whole core suite rather than the single file (586 tests, all green) — the filter syntax is worth sorting out at promotion.

**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)
