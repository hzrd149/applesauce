---
gsd_state_version: 1.0
milestone: v7.0.0
milestone_name: relay-method-layering
current_phase: 17
current_phase_name: correctness-fixes-concord-residuals
status: executing
stopped_at: Completed 17-02-PLAN.md
last_updated: "2026-08-20T11:57:25.453Z"
last_activity: 2026-08-20
last_activity_desc: Phase 17 execution started
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 12
  completed_plans: 9
  percent: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-19)

**Core value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.
**Current focus:** Phase 17 — correctness-fixes-concord-residuals

## Current Position

Phase: 17 (correctness-fixes-concord-residuals) — EXECUTING
Plan: 3 of 5
Status: Ready to execute
Last activity: 2026-08-20 — Phase 17 execution started

Progress: [████████░░] 75%

## Performance Metrics

**Velocity (v1.0, for reference):** 11 plans, ~15min avg/plan, ~2.6 hours total.
v1.1 metrics begin populating after Phase 5's first plan completes.

**By Phase (v1.0):**

| Phase | Plans | Avg/Plan |
|-------|-------|----------|
| 1. Generic store foundation | 4 | 11min |
| 2. Generic models & casts | 3 | 21min |
| 3. RumorStore & verification | 3 | 16min |
| 4. Common package rumor support | 1 | 10min |
| Phase 06 P01 | 5min | 2 tasks | 1 files |
| Phase 06 P02 | 22min | 2 tasks | 6 files |
| Phase 06 P03 | 10min | 2 tasks | 8 files |
| Phase 07 P01 | 14min | 3 tasks | 7 files |
| Phase 07 P02 | 5min | 3 tasks | 2 files |
| Phase 07 P03 | 12min | 3 tasks | 3 files |
| Phase 07 P04 | 8min | 2 tasks | 2 files |
| Phase 08 P01 | 18min | 3 tasks | 8 files |
| Phase 08 P02 | 5min | 2 tasks | 2 files |
| Phase 08 P03 | 21min | 2 tasks | 2 files |
| Phase 08 P04 | 15min | 2 tasks | 2 files |
| Phase 08 P05 | 35min | 3 tasks | 11 files |
| Phase 08 P06 | 17min | 3 tasks | 5 files |
| Phase 09 P01 | 25min | 3 tasks | 2 files |
| Phase 09 P03 | 15min | 3 tasks | 5 files |
| Phase 09 P04 | 9min | 2 tasks | 3 files |
| Phase 09 P02 | 7min | 2 tasks | 2 files |
| Phase 09 P05 | 20min | 3 tasks | 3 files |
| Phase 10 P01 | 15min | 3 tasks | 2 files |
| Phase 10 P02 | 12min | 2 tasks | 4 files |
| Phase 10 P03 | 6min | 2 tasks | 4 files |
| Phase 10 P04 | 6min | 2 tasks | 2 files |
| Phase 10 P05 | 15min | 2 tasks | 2 files |
| Phase 10 P06 | 20min | 3 tasks | 8 files |
| Phase 12.1 P01 | 12min | 2 tasks | 4 files |
| Phase 12.2 P01 | 35min | 3 tasks | 10 files |
| Phase 12.2 P02 | ~25min | 3 tasks | 6 files |
| Phase 12.2 P03 | 4min | 2 tasks | 3 files |
| Phase 12.2 P04 | 13min | 3 tasks | 4 files |
| Phase 12.3 P01 | 6min | 2 tasks | 3 files |
| Phase 12.3 P02 | 9min | 1 tasks | 1 files |
| Phase 12.3 P03 | 9min | 2 tasks | 3 files |
| Phase 12.3 P04 | 15min | 3 tasks | 1 files |
| Phase 12.3 P05 | 10min | 2 tasks | 1 files |
| Phase 12.3 P06 | 13min | 2 tasks | 1 files |
| Phase 12.3 P07 | 13min | 2 tasks | 3 files |
| Phase 12.3 P08 | 25min | 3 tasks | 3 files |
| Phase 12.3 P09 | 20min | 2 tasks | 5 files |
| Phase 12.3 P10 | 30min | 3 tasks | 9 files |
| Phase 12.3 P11 | 26min | 3 tasks | 4 files |
| Phase 12.3 P12 | 65min | 3 tasks | 6 files |
| Phase 12.3 P13 | ~4h | 5 tasks | 11 files |
| Phase 12.3 P14 | 35min | 4 tasks | 4 files |
| Phase 11 P01 | 4min | 2 tasks | 2 files |
| Phase 11 P02 | 5min | 2 tasks | 5 files |
| Phase 11 P03 | 4min | 2 tasks | 4 files |
| Phase 11 P04 | 10min | 2 tasks | 2 files |
| Phase 11 P05 | 16min | 3 tasks | 1 files |
| Phase 11 P06 | 15min | 3 tasks | 6 files |
| Phase 12 P01 | 15min | 2 tasks | 2 files |
| Phase 12 P02 | 5min | 2 tasks | 5 files |
| Phase 12 P03 | 10min | 3 tasks | 7 files |
| Phase 12 P04 | 20min | 3 tasks | 7 files |
| Phase 12 P05 | 24min | 3 tasks | 4 files |
| Phase 12 P06 | 20min | 2 tasks | 6 files |
| Phase 12 P07 | 15min | 3 tasks | 12 files |
| Phase 12 P08 | 21min | 3 tasks | 5 files |
| Phase 12 P09 | 151min | 3 tasks | 3 files |
| Phase 12 P11 | 45min | 2 tasks | 1 files |
| Phase 13 P04 | 17min | 2 tasks | 2 files |
| Phase 13 P05 | 24min | 3 tasks | 2 files |
| Phase 13 P06 | 22min | 3 tasks | 2 files |
| Phase 13 P07 | 21min | 3 tasks | 6 files |
| Phase 13 P08 | 20min | 3 tasks | 3 files |
| Phase 13 P09 | 25min | 3 tasks | 2 files |
| Phase 13-13 P13-13 | 25min | 3 tasks | 2 files |
| Phase 13 P10 | 35min | 3 tasks | 3 files |
| Phase 13 P11 | 10min | 3 tasks | 2 files |
| Phase 13 P12 | ~20min | 3 tasks | 10 files |
| Phase 13 P14 | ~10min | 3 tasks | 3 files |
| Phase 15 P08 | ~25min | 3 tasks | 3 files |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 16 P01 | 3m | 2 tasks | 4 files |
| Phase 16 P02 | 1m | 2 tasks | 9 files |
| Phase 16 P03 | 1m | 2 tasks | 9 files |
| Phase 16 P04 | 1m | 1 tasks | 5 files |
| Phase 16 P05 | 1m | 1 tasks | 5 files |
| Phase 16 P06 | 1m | 1 tasks | 4 files |
| Phase 16 P07 | 12m | 2 tasks | 8 files |
| Phase 17 P01 | 2m | 2 tasks | 3 files |
| Phase 17 P02 | 4m | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Full v1.0 decision log lives in `.planning/milestones/v1.0-phases/`. Current milestone (v1.1) roadmap decisions:

- [Roadmap]: Phase 5 (cache fix, `applesauce-core`) gets its own small phase ahead of all concord work — it's the root cause of ROTATE-01/02/03 and unmasks ROTATE-04 (H02) the moment it lands
- [Roadmap]: CHAN-05 and ROTATE-03 placed in the same phase (7) — independent root causes of the same bug (H08); either alone leaves a rekeyed channel on its old plane
- [Roadmap]: CHAN-01/02/03 (Accordian-blocking) weighted into Phase 7, immediately after the mandatory cache→refounding-core sequence, ahead of rotation-robustness/authority-fold work
- [Roadmap]: 5 spec-ruling-blocked requirements (ROTATE-10/13, AUTH-07/08, CHAN-07) distributed into their topical phases (7/8/9) rather than one adjudication phase, with the ruling as each phase's first task
- [Roadmap]: REQUIREMENTS.md's stated "52 total" corrected to 53 — a recount of every checklist item found 53 distinct REQ-IDs; no requirement content changed
- [Phase 06]: Both ROTATE-01/ROTATE-02 guestbook + base-rekey addresses now have crypto.ts-only spec-derived oracles with memo-armed spread guards, mirroring the existing control-address probe
- [Phase ?]: Phase 06-02: epoch-scoped the Guestbook plane store (guestbook@<epoch>) and scoped the live observed set to current-epoch guestbook + channel stores only, resolving ROTATE-04's memberlist resurrection defect without touching foldMembers — CORD-02 §5: the Guestbook rides the epoch — matches the spec's structural model rather than a timestamp heuristic
- [Phase ?]: Phase 06-02: added a D-03 retention trim disposing stale-epoch guestbook stores once their epoch leaves held_roots, proven via a test that manually simulates the (currently nonexistent) compaction precondition — Keys and stores share one retention horizon; the trim must be ready before a future compaction step ages entries out of held_roots
- [Phase ?]: Phase 06-02: Open Question 1 (public-channel observed residual) deliberately left unfixed and pinned by a regression test with an explicit Phase-7 deferral comment — Channel epoch-keying is out of Phase 6's scope; fixing it here would cross into Phase 7 territory
- [Phase 06]: Phase 06-03: AUTH-02 - refound() gained a per-target BAN outrank loop mirroring rotateChannel's, throwing before buildRefounding/any publish so a failed outrank check aborts the whole Refounding atomically
- [Phase 06]: Phase 06-03: AUTH-01 - readRekeyScoped's removal branch is now fail-closed (held.canRemoveSelf?.(rotator) === true); readRekey supplies canRemoveSelf at both call sites (checkRekey, syncEpoch) via hasPerm/canActOn over PERM.BAN
- [Phase 06]: Phase 06-03: Rule 1 auto-fix - the shared fail-closed guard also gated the channel scope; channel-sync.ts's sync-walk path never threaded canRemoveSelf (only the live checkRekey path did), fixed by threading the already-existing predicate through ChannelSyncContext, no new rank logic
- [Phase ?]: 07-01: ChannelMetadata.key/.epoch removed entirely (breaking, concord unreleased); material.channels is now the sole source of channel key material, closing H06/H07/H08 as one refactor
- [Phase ?]: 07-01: channelSecret/channelKeyFor/voiceKeysFor/deriveKeys made total (return null for a keyless private channel) rather than throwing — routine expected state during a whole-community fold pass
- [Phase ?]: 07-01: foldControl's sticky-deleted fold rule pins heads to the terminal deleting edition (not the ordinary version-chain head) so compaction cannot resurrect a deleted channel for a fresh joiner (CHAN-07)
- [Phase ?]: 07-02: sameChannelViews compares length + per-entry channel_id/accessible (mirrors members$'s sameSet) — a mapped array needs a content comparator, not reference identity
- [Phase ?]: 07-02: materialChanged$.next() placed at all four material.channels mutation sites (receiveChannelKeys, persistChannelKey, dropChannelKey, mintChannelKey callback) rather than one centralized setter
- [Phase ?]: 07-03: MissingChannelKeyError is a minimal standalone class (no base error class exists anywhere in packages/concord), mirroring RelayManagementError's convention
- [Phase ?]: 07-03: requireChannelKey is a private helper shared identically by sendMessage and sendEvent rather than duplicating the guard inline
- [Phase ?]: 07-03: TEST-02 case 5 reuses the single-engine case-4 setup shape (mint, leaveChannel, receiveChannelKeys) rather than extending the cross-engine Direct Invite test, since that test's memberEngine never syncs control-plane data
- [Phase ?]: 07-04: Prepended this.requireChannelKey(channelId) directly per-method (minimal, mirrors sendMessage/sendEvent) rather than re-plumbing the five methods' distinct factory bodies through a shared helper
- [Phase 08]: 08-01: isStrictlyLowerKey centralized in rekey.ts so the live checkRekey latch and both the root/channel re-sync cascades provably use the identical down-only ordering — the plan's key_links requires all revisit points to agree on strictly-lower-only; a shared function guarantees that by construction
- [Phase 08]: 08-01: the known-epoch re-read (root) and held-epoch backward pass (channel) only surface/act on an adopt outcome, never reconsidering a removed outcome for a historical epoch — out of this plan's scope (ROTATE-06/07 racing-rotation convergence only), not a removal-reconsideration feature
- [Phase 08]: 08-01: cascade rebuild is a pure forward-walk regeneration from the corrected root/key, never a retroactive mutation of persisted material/held_roots — matches Pitfall 3's Open Question 2 resolution and the in-memory-only latch decision (A3) — a fresh walk always re-derives correctly from whatever material is passed in
- [Phase 08]: 08-02: Correlation key stays rotator:scopeIdHex:newEpoch:prevCommit unchanged (D-02); groupRotations gained a consistent flag via per-bucket Set<chunkCount>/Set<prevEpoch> agreement check, closing the first-arrival-wins defect that let a resumed rotation's stale generation complete a set
- [Phase 08]: 08-03: readRekeyScoped restructured around a decryptable-vs-opaque candidate partition — decrypt-throw and genuine no-blob exclusion tracked as two separate internal signals (opaqueCompetitor ambiguity flag vs noBlobRotators removal-eligible list) so D-06's decrypt-failure-never-contributes-to-removal holds even when both kinds of opaque set coexist; external ScopedRekeyOutcome/RekeyOutcome/ChannelRekeyOutcome unchanged
- [Phase 08]: 08-04: refound() gated on per-wrap majority (D-11) -- ceil((n+1)/2) of this.relays().length must ack ok:true per rekey/channel-rekey wrap before compaction/snapshot publish or adoptRefounding; a non-responding relay counts against the denominator
- [Phase 08]: 08-04: test fakePool()/fakePoolWithStatus() default publish mock changed from returning [] to acking ok:true for every relay (okAll), since the new majority gate fails an empty PublishResponse[] for any relay count -- required to keep pre-existing refound() tests green
- [Phase ?]: 08-05: vac lives on RekeyRotation descriptor (rotation.vac) rather than a separate includeRekeyChunk parameter -- buildRekeyRumors already forwards the whole rotation object
- [Phase ?]: 08-05: centralized vacVerifier(state, requiredPerm) in helpers/permissions.ts next to refoundAuthority, shared by root (PERM.BAN) and channel (PERM.MANAGE_CHANNELS) scopes rather than duplicating the owner-exempt/grantLocator/hasPerm logic
- [Phase ?]: 08-05: Rule 2 auto-fix -- extended vac emission to rotateChannel/buildChannelRekey (plan's Task 1 text covered only refound/buildRefounding) since Task 2 wires verifyVac into both root and channel scopes, and omitting channel emission would have regressed every non-owner channel rotation
- [Phase ?]: 08-05: Rule 1 auto-fix -- extended verifyVac wiring to the live checkRekey() paths in community.ts/private-channel.ts (plan's Task 2 text covered only the sync-walk paths sync.ts/channel-sync.ts), mirroring Phase 06-03's precedent where canRemoveSelf had the same walk-vs-live gap
- [Phase 08-06]: buildRefounding throws (not continue/swallow) on any unfoldable Control head — awaited pre-publish in refound(), so the throw aborts the whole Refounding atomically
- [Phase 08-06]: held_roots.refounder and buildChain's per-epoch refounder are only ever set when they have a value (never explicit undefined) — applesauce-core's EventStore.model() caches by a value-based hash (hash_sum(args)), and an explicit undefined key changes that hash even though the JSON form is unchanged
- [Phase 09]: 09-01: cidBytes hoisted to a single declaration above the fixpoint loop; AUTH-04's shape guard placed as an unconditional continue before authorized (not folded into the authorized chain, so owner-signed malformed grants are also caught); AUTH-07's target-rank clause ANDs into the existing roles-outrank .every() rather than replacing it
- [Phase 09]: 09-01: fixed a pre-existing control.test.ts case that published its Grant at eid=roleId instead of the derived grantLocator coordinate — it only passed before AUTH-03 existed to enforce coordinate binding
- [Phase 09]: 09-03: verifyVac threaded as optional trailing positional param on foldMembers (matching its existing shape), not an options object
- [Phase 09]: 09-03: client/sync.ts passes vacVerifier(state0, PERM.KICK) inline (not a named local) to avoid colliding with the existing verifyVac local declared later for the root PERM.BAN rekey scope
- [Phase 09]: 09-03: Kick vac-gate tests isolate the new check from the pre-existing rank-vs-victim check by feeding foldMembers an OLD roster (resolveStanding param) while vacVerifier reads a separate CURRENT/demoted roster
- [Phase ?]: 09-04: kick()'s guard lands in community.ts, ban()'s in admin.ts's own ban() body — each uses its own class's canDo/standingOf, per PATTERNS' never-hand-roll rule
- [Phase ?]: 09-04: both rejection tests hand-derive the read-path canActOn decision independently of the guard and assert equality, satisfying TEST-01's topological-match requirement
- [Phase 09]: 09-02: AUTH-06 guard inserted before both existing role.position <= checks (NaN/1.5/undefined slip past <=); test values chosen to be JSON-wire-representable since a JS NaN cannot survive JSON.stringify/parse round-trip
- [Phase 09]: 09-02: D-14 banlist fix is a per-pk conditional added inside the existing loop (s.isOwner || s.position < standing(pk).position), additive to the author-BAN-bit check, mirroring AUTH-07's Grant target-rank clause applied to a different entity in the same file
- [Phase 09]: 09-05: D-03 filed as an in-repo note (packages/concord/UPSTREAM-NOTES.md), not a GitHub issue -- mechanism was executor's discretion; no changeset since concord is unreleased
- [Phase 09]: 09-05: D-14 tracked under a new requirement AUTH-09 and a new concord-audit.md finding D14, kept distinct from the AUTH-03..08 set per D-13->D-14's explicit no-silent-absorb instruction
- [Phase 10]: getInviteBundleVsk's malformed-vsk branch returns INVITE_BUNDLE_VSK_REVOKED directly (executor's discretion per D-04), reusing isInviteBundleRevoked's existing === REVOKED predicate with no downstream changes
- [Phase 10]: 10-01: sequenced Task 2's decodeFragment edit and Task 3's getInviteBundleVsk edit each after the prior task's commit (temporary revert/reapply) so all three tasks land as isolated, git-diff-clean commits despite sharing one source file
- [Phase ?]: 10-02: parseMs is the single 0..999 canonical-string validator (String(n) === tag round-trip); rumorMs and hasMalformedMs both route through it so ordering and fold-drop can never disagree
- [Phase ?]: 10-02: includeMs's single splitTime(ms) call overrides both draft.created_at and the ms tag, closing the dual-clock-read / round-vs-floor +1000ms skew; keeps its Date.now()-default signature so bindToChannel and Kick/JoinLeave inherit the fix with no other call-site edits
- [Phase ?]: 10-04: the per-link try wraps the entire build/sign/store/publish body, reusing the loop's existing console.warn best-effort idiom
- [Phase ?]: 10-04: regression test triggers the failure via community.leaveChannel (the real CORD-05 voluntary-leave scenario) rather than a hand-constructed malformed link
- [Phase 10]: 10-05: newestAtCoordinate is a module-local unexported function in client.ts, replicating event-store.ts's NIP-01 winner rule verbatim (no different tie-break) since no store exists pre-join
- [Phase 10]: 10-05: D-02 covered by two tests -- a filter-spy plus a new filteringAsyncServingPool stand-in that genuinely honors tag filters, since newestAtCoordinate itself has no client-side d-tag check (the request-level #d scope is the sole enforcement point per 10-RESEARCH.md A1)
- [Phase 10]: 10-05: lagging-relay test's non-vacuity verified empirically (restored pre-fix client.ts via git show HEAD~1, confirmed the new test fails, then restored the fix via git checkout -- <file>) rather than asserted only in a comment
- [Phase 10]: 10-06: D-05 locked as SECONDS end-to-end for expires_at; the §1/§4 contradiction is recorded in UPSTREAM-NOTES.md rather than re-litigated
- [Phase 10]: 10-06: reworded client.ts's inline D-05 comment to avoid literal 'unix ms'/'milliseconds' substrings so the production-source grep stays clean; dual-citation text lives only in the test file
- [Phase 10]: 10-06: community.ts's pass-through expires_at write sites needed no code change -- unit correctness flows from the two comparison sites (client.ts join check, direct-invite.ts expired()) and updated doc-comments
- [Phase ?]: 12.1-01: BACKFILL_KINDS kept as working name; syncAuthors backfill filter routed through it, live sites (community.ts/private-channel.ts) left unchanged per D-02 asymmetry
- [Phase ?]: 12.1-01: Non-vacuity probe (D-04/TEST-01) confirmed empirically via temporary in-place revert/restore of sync.ts -- RED against pre-fix two-kind filter, GREEN after restoring the fix
- [Phase 12.2]: 12.2-01: debug/@types/debug added as concord's own direct dependencies (RESEARCH-verified correction to CONTEXT.md D-01's transitive assumption)
- [Phase 12.2]: 12.2-01: SyncContext.logger/ChannelSyncContext.logger made required (not optional) since syncContext() always constructs a real value
- [Phase 12.2]: 12.2-02: SyncContext/ChannelSyncContext gained a required decodeLogger: Debugger field derived once per syncContext() build (community.ts/private-channel.ts each add a private readonly decodeLog constructor field); decode-loop and onWrap call sites now call the pre-derived logger instead of ctx.logger.extend("decode")/this.log.extend("sync").extend("decode") inline per wrap, per a wave-1 code-review course-correction
- [Phase 12.2]: 12.2-02: epoch for every new sync/decode log line is sourced from the enclosing scope's known value (epochMaterial.root_epoch, channel.epoch, channelEpochOf(...)/this.keys.material.root_epoch, this.channelKey.epoch), never info.epoch (RESEARCH Pitfall 3: control/dissolved lack info.epoch, the base-rekey plane's info.epoch is the NEXT epoch not the one being synced)
- [Phase ?]: 12.2-03: relay-auth.ts's constructor stays unchanged; auth tracing derives from a single module-level const log = logger.extend("auth") (RESEARCH Open Question 1), never re-extended at any call site
- [Phase ?]: 12.2-03: all 8 pre-existing console.warn sites across relay-auth.ts/invite-manager.ts/invite-watcher.ts now dual-emit via this.log/module-level log immediately before the unchanged console call (D-09); no console call removed or downgraded
- [Phase 12.2-04]: Hoisted client.ts's two repeated this.log.extend("invite") derivations (constructor + ensureInviteWatcher) into a single this.inviteLog field, per the mandatory-convention's additional-cleanup instruction
- [Phase 12.2-04]: sync-logging.test.ts's spy fixture supplies SyncContext.logger/decodeLogger as two independent spies rather than one spy exposing .extend("decode"), matching the actual current interface after 12.2-02's course-correction rather than the plan's superseded literal text
- [Phase 12.2-04]: Deliberately-undecryptable test wraps are sealed under the control plane's real convKey but wrapped under a WRONG convKey, so the outer wrap decrypt fails while the plane pubkey/kind stay correct — matching VALIDATION.md's Wave-0 note
- [Phase 12.3]: 12.3-01: sameRelaySet mirrors client/community.ts's sameSet/sameChannelViews content-comparator convention rather than inventing a new comparison style
- [Phase 12.3]: 12.3-01: toRelaysObservable's JSDoc paraphrases take(1)/unwrap as prose (never the literal substrings) so the module's own no-take(1)/no-unwrap grep acceptance checks pass against its comments as well as its code
- [Phase 12.3]: 12.3-02: extras-driven openLive() re-invocation guarded with if (this.liveSub) rather than unconditional -- ExtraRelays's BehaviorSubject always emits once synchronously at construction, so an unguarded subscribe would open the live socket before start()/walk() ever runs — D-14 requires timing parity, not just relay-set content parity, when no extras are configured
- [Phase 12.3]: 12.3-02: connected$/authenticated$ route their merge through this.transport() inside the switchMap rather than calling mergeRelaySets directly, keeping transport() the class's single literal merge point (D-04)
- [Phase ?]: 12.3-03: ConcordInviteManager has no genuine dispose/teardown path (stop() is a restartable soft-stop), so the extras holder is left for GC rather than inventing a lifecycle hook
- [Phase ?]: 12.3-03: InviteWatcher.stop() disposes the extras holder and unsubscribes extrasSub per the plan's explicit instruction, unlike invite-manager
- [Phase ?]: 12.3-03: needsAuth$ recomputes over the merged transport set via extras.relays$ as a trigger, but reads this.extras.current inside transport() rather than the combineLatest's emitted value, keeping transport() the one literal merge point
- [Phase ?]: 12.3-04: PublishResponse's relay-URL field is `from`, not `origin` as the plan's read_first stated (packages/relay/src/types.ts:78); the refound() ack-attribution filter reads r.from
- [Phase ?]: 12.3-04: extrasSub guarded with if (this.liveSub), mirroring plan 02/03's precedent, so ExtraRelays's synchronous construction-time emission cannot prematurely open the community's live socket before start()
- [Phase ?]: 12.3-04: connected$/authenticated$ route their merge through this.transport() inside the switchMap rather than the switchMap's own emitted value, keeping transport() the one literal merge point (D-04)
- [Phase 12.3]: 12.3-05: ConcordClient.extras is not disposed in stop() since stop() is a restartable soft-stop and extras is a constructor-scoped readonly field with no re-construction path on restart, mirroring plan 03's identical decision for ConcordInviteManager
- [Phase ?]: 12.3-06: the invite-link fragment is a custom byte-packed, base64url-encoded format -- artifact assertions must decode via parseInviteLink before inspecting, never substring-match the raw URL; discovered via the mandated non-vacuity revert-and-observe step
- [Phase ?]: 12.3-06: fake pool serves request() from its own growing publish log (kind/authors/#d matching) rather than a static event list, so a second client instance can genuinely fetch the first client's invite bundle through one shared pool
- [Phase ?]: 12.3-07: refounding quorum tests reuse the pre-existing D-09/D-11 majority-gate test's exact arithmetic shape (3 relays, threshold = ceil((n+1)/2) = 2), on a distinct fixture, to isolate extras' effect from the no-extras control
- [Phase ?]: 12.3-07: private-channel's no-extras baseline test expects trailing-slash-normalized relay literals since transport()/mergeRelaySets has unconditionally normalized both inputs since plan 02 — pins pre-existing behavior, not a regression
- [Phase 12.3]: 12.3-08: took VERIFICATION.md's option (a) for D-14 — ExtraRelays.merge gets a genuine identity fast path (return base unchanged when extras are empty) rather than relaxing the roadmap's Success Criteria wording — smaller blast radius, restores the criterion as written verbatim, and is exactly pre-phase behavior
- [Phase 12.3]: 12.3-08: WR-09 (thread ConcordClient.extras.relays$ into sub-engines) deliberately deferred as a follow-up candidate, not a gap — it is a D-13 threading change and pure optimization rather than a correctness fix, and its cold-source-re-execution risk is already mitigated by Task 1's fail-soft behavior
- [Phase 12.3]: 12.3-09: refound() derives protocolRelays once via mergeRelaySets(this.relays()); both majorityThreshold and protocolRelaySet read only that value, closing the D-06 threshold/attribution split and the crash-on-malformed-entry defect
- [Phase 12.3]: 12.3-09: ack-origin tolerance implemented as a local normalizeAckOrigin closure (returns undefined on absent/unparseable from) rather than reusing relay-auth.ts's lookupStatus directly, since the shapes differ
- [Phase 12.3]: 12.3-09: validateInviteBundle filters relays to typeof string + isSafeRelayURL after the existing cap slice (cap-then-filter), never normalizing survivors (D-01); an entirely-junk relays array still validates with an empty array rather than rejecting the bundle
- [Phase 12.3]: 12.3-09: two pre-existing test fixtures (invite-bundle.test.ts's wss://ok, direct-invite.test.ts's wss://1..wss://7) used non-dotted toy hostnames that fail isSafeRelayURL's regex; fixed to realistic dotted hostnames as an in-scope knock-on regression fix, discovered via the full-suite run
- [Phase 12.3]: 12.3-10: authDrivers replaced with a per-URL Map<string, Subscription> registry in community.ts/private-channel.ts; ensureAuth() now prunes on transport narrowing and registers a fresh driver on re-add, closing WR-04
- [Phase 12.3]: 12.3-10: all five Concord engines now share one stop()-is-pause/dispose()-releases lifecycle rule; InviteWatcher's reactive extras subscription is extracted into subscribeExtras() so a restart re-establishes it without ever rebuilding the ExtraRelays holder object, closing WR-05/WR-06
- [Phase 12.3]: 12.3-10: WR-09 (thread ConcordClient.extras.relays$ into sub-engines) remains deferred per plan 08's rationale, restated in the 12.3-10-SUMMARY — a D-13 threading/optimization change, not a correctness gap, and now further bounded by every holder being releasable
- [Phase ?]: 12.3-11: WR-01 loopback carve-out checked independently of isSafeRelayURL (not gated behind it) — its hostname regex rejects bracketed IPv6 [::1], which the carve-out must admit
- [Phase ?]: 12.3-11: a malformed channels[] entry (or its held keys) is dropped per-entry; a malformed held_roots entry rejects the whole bundle since buildInviteBundle never emits that field
- [Phase ?]: 12.3-11: recordJoin constructs the engine before mutating this.list (confirmed addCommunity construction never reads this.list); reconcileCommunities skips+logs an unconstructable entry rather than pruning it
- [Phase ?]: 12.3-12: held_roots/channels[].held count-capped at 64 on the raw array before per-entry validation, mirroring the existing channels cap ordering (CR-01)
- [Phase ?]: 12.3-12: text-length cap (256) added for name/label/creator_npub/channels[].name; top-level name rejects the whole bundle (required field), label/creator_npub/expires_at drop to undefined, channels[].name drops the entry (CR-02)
- [Phase ?]: 12.3-12: joinByBundle now runs validateInviteBundle itself (WR-02); the untrusted-relay gate relocated from joinFromBundle's fallback to joinByLink's bootstrap selection so the app's own configured relays are never filtered (WR-03 folded in)
- [Phase ?]: 12.3-12: leave() prunes the entry from this.list after tombstoning it, recovering a Community List already wedged past LIST_MAX_BYTES (CR-02 half two)
- [Phase ?]: 12.3-12: ConcordCommunity's constructor wraps everything after ExtraRelays construction in try/catch (disposes the holder, rethrows); reconcileCommunities fingerprints failed material via canonicalJson so an identical failure is skipped but a corrected entry is retried (WR-01)
- [Phase ?]: 12.3-13: validateInviteBundle rewritten as four exhaustive mapped-type rule tables (INVITE_BUNDLE_FIELD_RULES, CHANNEL_KEY_FIELD_RULES, HELD_KEY_FIELD_RULES, BLOB_POINTER_FIELD_RULES) + a generic rebuildByRules walker that builds (never spreads) -- a field with no rule fails tsc, demonstrated by hand (D-17)
- [Phase ?]: 12.3-13: held_roots[i].refounder implemented literally per the rule table (drop/omit, entry survives with refounder stripped) rather than the plan's behavior prose (which separately implied whole-bundle rejection) -- documented as a deviation, flagged for next review
- [Phase ?]: 12.3-13: COMMUNITY_LIST_MAX_ENTRY_BYTES = floor(LIST_MAX_BYTES / 2) enforced at recordJoin before engine construction or this.list mutation, closing CR-01's structural (aggregate) half
- [Phase ?]: 12.3-13: pruneDeadEntries() makes the dead-membership byte-prune a property of derived-dead state (never marks dirty, never publishes), called from leave()/handleRemoved/reconcileCommunities; leave()'s guard moved from the engine map to the document, closing CR-02 both halves
- [Phase ?]: 12.3-13: ExtraRelays.merge's WR-05 fix diverges from the review's own suggested code, which was mathematically dead code -- implemented per-entry parseability checking instead
- [Phase ?]: 12.3-13: WR-08 (handleRemoved routes through pruneDeadEntries) verified only by grep + adjacent coverage -- a genuine behavioral test needs two-instance live-refound infrastructure that doesn't exist in this suite; flagged for a future plan or explicit acceptance
- [Phase 12.3]: 12.3-14: rule-table subjects become indexed-access paths rooted at InviteBundle (ExhaustiveBundleRules<T>), not the review's named fix of exporting the two element types alone — Closes CR4-01 as a CLASS rather than the two named instances — a hand-written shape cannot be substituted for a path
- [Phase 12.3]: 12.3-14: RULE_TABLE_SUBJECT_PROOF pins held_roots[] and channels[].held[] independently (entries 3 and 4), and a source-level meta-test (2e) is a third, independent tripwire beside the two type-level mechanisms — Probe 5/6a demonstrated the two held positions can diverge from each other even when each table's own single-subject annotation is satisfied; probe 6b demonstrated the type system alone can be defeated by a key-set-identical hand-declared shape
- [Phase 12.3]: 12.3-14: WR4-01's handleRemoved behavioral test drives the real private handleRemoved() method via the suite's established as-unknown-as convention; only the trigger is synthetic, not any downstream effect (pruneDeadEntries/saveMirror ordering) — Reachability was verified against source (client.ts:843, community.ts:1003-1009, and both real callers at community.ts:553/968) before writing the test, per the plan's explicit instruction
- [Phase ?]: 11-01: Cited CORD repo branch main (RESEARCH.md's GitHub-API-verified default branch), not master as CONTEXT.md's canonical-refs section states
- [Phase ?]: 11-01: cord-wire-fixtures.ts is dependency-free (no vitest import, no concord source import) so it stays importable from any test file without cycles; missingFixtureTags is deliberately order- and extras-independent since bindToChannel appends binding tags after the factory's own tags
- [Phase 11]: 11-02: Hard-deleted ChannelMetadata.voice/CreateChannelOptions.voice from all four in-package sites plus both out-of-package consumers (example app, docs), per D-06 — no tombstone comment, no routing into custom (WIRE-10's Phase-12 scope)
- [Phase 11]: 11-02: No changeset created, per D-09 (concord unreleased)
- [Phase 11]: 11-02: Left a pre-existing, unrelated applesauce-examples build failure (9 files, StoredEvent/NostrEvent sig mismatch) undisturbed and logged to deferred-items.md, per the Scope Boundary rule — confirmed admin-management.tsx contributes zero build errors
- [Phase ?]: 11-03: GiftWrapOptions/rewrapSeal deliberately untouched (D-07) — ephemeralSk only reaches the app-level entry point sendEvent, not giftWrap's public signature or compaction re-wraps
- [Phase ?]: 11-03: getPublicKey from nostr-tools already returns a hex string — test's expected-value computation uses getPublicKey(sk) directly, no bytesToHex wrapping (wrapping throws a type error at runtime)
- [Phase ?]: 11-04: D-02's stated deleteMessage mechanism corrected — a Concord Rumor has no sig, so DeleteFactory.fromEvents([target]) would silently skip k; fix passes target.id and applies ensureKTag explicitly on the awaited template (D-02's zero-upstream-edits conclusion still holds)
- [Phase ?]: 11-04: react/replyToThread/deleteMessage now take the full target Rumor, deleting the hand-built identity object / pointer entirely, so the hardcoded-kind wrong path is unrepresentable — no upstream factory in packages/core or packages/common touched, no changeset per D-09
- [Phase ?]: 11-05: setupWireConformance's pool.publish mock captures published wraps so WIRE-05's delete cases can decode a kind-5 rumor that EventStore.add() routes into DeleteManager instead of the queryable store, rather than reading it back via getTimeline
- [Phase ?]: 11-05: Task 3 probe 2 (whole target object into DeleteFactory.fromEvents) throws inside wrapForTarget's getEventHash rather than producing the plan-predicted stringified-object e tag; both cases still observably RED, non-vacuity requirement satisfied via a harder crash than anticipated
- [Phase ?]: 11-06: Both engines' now-unused VOICE_PRESENCE_KIND imports removed while the constant and its helpers/index.ts re-export were deliberately left intact — public surface a consumer needs to filter for presence
- [Phase ?]: 11-06: Task 3's private-channel test uses a fresh ChannelKey at epoch 0 (not epoch 1) so the fixture's literal 'epoch' tag value ('0') matches verbatim without needing a non-placeholder substitution mechanism
- [Phase 12]: 12-01: citation scanner's character class excludes trailing punctuation by construction, and multi-word named sections (Appendix B, Removing Participants) match via an optional uppercase-initial-word continuation
- [Phase 12]: 12-01: non-vacuity test reads the 4 files the plan explicitly names (client/private-channel.ts, client/channel-sync.ts, client/community.ts, helpers/keys.ts) over the plan's inconsistent 'six files' prose
- [Phase ?]: All three manifests moved to identical ^2.24 in one commit so pnpm dedupes to a single installed nostr-tools instance
- [Phase ?]: NIP-44 ceiling test placed in packages/core (not concord) since concord has no direct nostr-tools dependency and reaches nip44 only through core's re-export
- [Phase ?]: D-25 correction applied: the maxPlaintextSize fix landed in nostr-tools 2.23.4, not 2.24.0; the ^2.24 target range is unchanged
- [Phase 12-03]: Rewrote community-list.ts's COMMUNITY_LIST_MAX_ENTRY_BYTES doc comment (outside 12-03's declared files_modified) to drop its dangling citation of the deleted INVITE_BUNDLE_MAX_TOTAL_BYTES, per D-10 and this plan's own verification requiring zero surviving occurrences of the removed symbol name outside the structural test guard; the constant and its enforcement are untouched, still plan 12-05's scope
- [Phase ?]: 12-04: helpers/caps.ts has zero imports so it sits at the bottom of the dependency graph, reachable from both helpers/community.ts and client/admin.ts without crossing the one-way helpers->client import boundary
- [Phase ?]: 12-04: editMetadata asserts against the merged next, never patch -- proven necessary by a seeded-legacy-document test plus a mutation probe
- [Phase ?]: 12-04: two pre-existing client.test.ts fixtures (12.3-12/12.3-13) repointed to pad an oversized Community List entry via the unbounded relays field instead of name, since the new write-side cap now rejects an over-cap name before either fixture's own target code path is reached
- [Phase 12]: 12-05: LIST_MAX_BYTES reworded to a diagnostic-only reference figure (D-08) rather than deleted, carrying the D-21 warning that NIP-44's max_plaintext_size is now 4294967295
- [Phase 12]: 12-05: Test F (D-06 live-only counting) needed duplicate raw entries alongside tombstones to be non-vacuous, since mergeCommunities' dedup plus pruneDeadEntries on every death transition makes this.list.length and liveCommunities(...).length structurally equal in every publicly-reachable state; added a white-box test writing the private list field directly to pin the implementation choice
- [Phase 12]: 12-05: rewrote (not deleted) the pre-existing CR-02 recoverability test whose 'an already-wedged list cannot publish' premise was falsified by this plan's D-07/D-08 change
- [Phase 12]: 12-06: Fixed a citationsOutsideRegistry over-matching bug in cord-wire-fixtures.ts (owned by 12-01) blocking a clean RED -- numeric section citations followed by capitalized prose (e.g. CORD-05 section 6 Direct Invites) were being swept into the token; split the pattern into a numeric-no-continuation alternative and a letter-led named-section-with-continuation alternative
- [Phase 12]: 12-06: Deleted (not inverted) 12-01's reciprocal invalid-set-non-empty test in cord-wire-fixtures.test.ts -- an inverted now-clean assertion would merely duplicate a subset of the new package-wide cord-citations.test.ts guard
- [Phase 12]: 12-06: Excluded cord-wire-fixtures.test.ts from the new citation guard's file walk -- its own unit tests embed deliberately-invalid citation strings as literals, textually indistinguishable from real citations to a whole-file scan
- [Phase 12]: 12-07: Task 2 also re-pointed casts/__tests__/community-list.test.ts and casts/__tests__/invite-list.test.ts (not in the plan's declared files_modified) since their .unlock() resolves.toEqual assertions compare against the renamed field shape and the compiler's structural typing couldn't flag them -- required for a green suite (Rule 3)
- [Phase 12-08]: channel fold's key-material denylist destructures key/epoch out by name and spreads the rest, spread-first field ordering, per D-22
- [Phase 12-08]: deleteChannel destructures out channel_id and spreads the rest with deleted:true, matching deleteRole's preserve-plus-terminal-flag idiom
- [Phase 12-08]: Test E chains a v2 metadata edition onto genesis's own v1 via computeEditionHash/prevHash (mirroring the CHAN-07 test's linking pattern) so the fold's contiguous-chain walk actually adopts it, proving D-24 with zero source change to the metadata fold
- [Phase ?]: 12-09: documentExtras snapshots the whole last-read document (including entries/tombstones), not a stripped extras-only object — the only design under which spread-first/assign-after ordering at the write sites is a real, testable shadow-protection rather than a no-op
- [Phase 12]: 12-11: both downstream reachability tests drive the real `client/community.ts` gates (`publicChannelKeys()`, `currentAuthors()`, `channels$`, private sub-engine retention) end-to-end rather than asserting on the fold's output shape — CR-01 was a live defect precisely because the shape flowed downstream, so the proof has to follow it there
- [Phase 12]: 12-10: the channel fold's strip set is DERIVED from a total `CHANNEL_KEY_FOLD_DISPOSITION` classification over every `ChannelKey` field, not restated by hand — so `id` joins the stripped set structurally (nobody added it), closing WR-01's `held` omission as a class rather than by enumeration
- [Phase 12]: 12-10: `isCustomRecord` rejects arrays (`!Array.isArray`), not merely non-objects — a bare `typeof === "object"` accepts an array, the identical type-lie CR-01 named for a string `custom`
- [Phase 12]: 12-10: P2's index-signature probe needed the FACTORED-ALIAS form (`type X = keyof Required<ChannelMetadata>; type Rules = {[K in X]: ...}`) to reproduce the degenerate case — the plan's literal inline form is *homomorphic*, and TS 5.9.3 preserves literal members there regardless of the index signature, so it exits 2 not 0; `DeclaredKeysOf` is load-bearing against the factored form only
- [Phase ?]: 12-09: documentExtras excluded from both publishedListFingerprint and publishedFingerprint dirty checks — a value captured there was just read off the document the fingerprint believes is already on the relay, so its presence alone never forces an extra publish
- [Phase 12]: The three loose-truthiness deleted gates in client/community.ts (publicChannelKeys, reconcileLive's publicIds, reconcilePrivateChannels) are deliberately NOT tightened to strict === true equality — the fold-level invariant from 12-10 already makes deleted boolean-or-absent, so duplicating the guarantee into three call sites would reintroduce the enumerated-patch drift CR-01/WR-01 already exposed.
- [Phase 13]: 13-04: count() take(1) moved outside authRetryOperator (after, not before) so the operator's expand/concat retry can see every auth-required signal as a value on its source stream
- [Phase 13]: 13-04: D-15's count() clock-suspension test proven via a real setTimeout spy (two >9s arm calls bracketing the auth phase) instead of a literal >10s wait, since count()'s 10s budget has no user-configurable knob
- [Phase 13]: 13-04: RAUTH-02/03/04/07/09 left Pending in REQUIREMENTS.md — each spans all eight auth sites; count() closes 1 of the remaining 5, matching 13-02's precedent for the same requirement IDs
- [Phase ?]: 13-05: fixed a pre-existing reentrancy bug in event()'s send/listen structure exposed by this plan's own internal-retry behavior (synchronous onAuthRequired handlers silently dropped the resend); split into an unshared control defer + shared listen-only messages mirroring count()'s existing pattern
- [Phase ?]: 13-05: event()'s catchError intercepts only AuthRequiredError (exhausted retries) and converts it back to a value response, preserving its pre-existing never-throws-for-auth-required contract for auth()/negentropy()/sync() callers; AuthHandlerError/AuthTimeoutError propagate as genuine errors per D-17
- [Phase ?]: 13-05: customTimeoutOperator deleted outright (sole caller was publish()) rather than left dead, replaced by customSuspendableTimeoutOperator; RAUTH-02/03/04/06/07/09 remain Pending in REQUIREMENTS.md until 13-06 (negentropy/sync) lands, per 13-02/13-04 precedent
- [Phase 13]: 13-06: negentropy() converted to shared auth operator; Relay.sync retyped RelaySyncOptions and threads auth options into its internal event()/req() calls (RAUTH-08); dead pre-gate waitForAuth() helper deleted
- [Phase 13]: 13-06: negentropySync's per-attempt cleanup sends NEG-CLOSE before an async AUTH round trip completes, and negentropy() never subscribes watchTower, so its auth-required flag update is not synchronous with server.send() the way req/count/event are
- [Phase 13]: 13-07: RelayGroup.sync/RelayPool.sync derived via Parameters<> (D-05's last 2 of 5 literals); RelayGroup.sync gained per-relay catchError isolation (D-19) and errorToPublishResponse gained the error field (D-18); RAUTH-01..09 marked Complete in REQUIREMENTS.md once the pool/group leg closed
- [Phase 13]: 13-07: the plan's non-vacuity probe premise for the pool sync pass-through test does not empirically hold (opts was always forwarded wholesale regardless of type); verified empirically and documented rather than silently worked around, while the genuinely-behavioral D-19 catch WAS verified RED->GREEN
- [Phase 13]: 13-08: closed CR-01/WR-01 by making ProgressPredicate<T> a required (never defaulted) parameter at authRetry's D-08 reset and suspendableTimeout's first-emission gate, plus CR-04's synchronous-throw-to-AuthHandlerError mapping in runPhase's defer factory — Structural fix per the plan's explicit directive — omitting the answer is a compile error, not a runtime surprise, so a future call site cannot silently reintroduce the bookkeeping-value defect class
- [Phase 13]: 13-08's frontmatter lists requirements RAUTH-03/07/08, but 13-08 only closes CR-01/CR-04/WR-01 — a subset of the gaps 13-VERIFICATION.md found blocking those requirements — CR-02/CR-03 (req()/count() reentrancy under a synchronous handler) and WR-02 (RelayGroup.request() gate threading) remain open and are plans 13-09/13-10/13-11's scope; REQUIREMENTS.md left as In Progress, not Complete, mirroring the INVITE-01/WIRE-06..12 precedent — mark RAUTH-03/07/08 Complete only when the closing plan lands
- [Phase 13]: 13-09: req()'s messages/control/observable moved from call-scoped constants (shared across every internal auth-retry attempt) into a single per-attempt defer factory, closing CR-02 — the REQ-side analog of 13-05's event() reentrancy bug where a synchronous onAuthRequired handler's resubscribe silently rejoined a still-connected share and never wrote a second REQ frame
- [Phase 13]: 13-09: shouldResubscribe replaced by a call-scoped resubscribeHolder object each attempt writes into, since customRepeatOperator's condition callback is read after the auth retry boundary — no attempt-scoped local survives to that point
- [Phase 13]: 13-09: REQUIREMENTS.md left unchanged (RAUTH-03/RAUTH-07 remain In Progress) per the 13-08 precedent — both span all eight auth sites and count()'s CR-03 gap (plan 13-10's scope) is still open
- [Phase ?]: 13-13: relayOnAuthRequired declared non-optionally-typed and constructed unconditionally (no ternary), closing WR-03 structurally rather than by special-casing a caller's absent handler
- [Phase ?]: 13-13: WR-04 closed on all three exit paths -- retained/cleared timer handle in close(), scheduleClose() no-ops for an already-closed phase, and a new finalize(forceCloseAuthPhases) on buildRelayStream's terminal pipeline (placed outside withTimeout since it returns its source unwrapped when the stall guard is disabled)
- [Phase ?]: 13-13: Test 4's mock defers its emission via a microtask rather than emitting synchronously, avoiding mapEventsToStore's documented share()/mergeWith double-subscription gotcha
- [Phase ?]: 13-10: count()'s messages/relayClosedSub moved from call-scoped constants into the same per-attempt defer shape 13-09 gave req(), closing CR-03 -- event()'s messages never needed this fix since it has no terminating condition of its own
- [Phase ?]: 13-10: send/listen invariant stated once as a comment above the shared authRetryOperator adapter (relay.ts); Task 3's eight-operation + RelayGroup/RelayPool audit found no further violation beyond the already-known, already-scoped WR-02 gap (RelayGroup.request()'s missing gate threading, owned by 13-11)
- [Phase ?]: 13-10: REQUIREMENTS.md left unchanged (RAUTH-03/RAUTH-07 remain In Progress) per the 13-08/13-09 precedent -- plan 13-12 is the designated closing plan that flips RAUTH-03/07/08 to Complete once every gap-closure plan in this wave sequence has landed
- [Phase ?]: 13-11: RelayGroup.request() gate threading wraps isReqProgress (message: GroupReqMessage) => isReqProgress(message as RelayReqMessage) rather than redeclaring it, since GroupReqMessage is a strict superset RelayReqMessage's parameter type does not admit
- [Phase ?]: 13-11: D-15 clock-suspension and clock-fires tests build a single-relay RelayGroup([relay1]) rather than reusing the shared two-relay group, so relay2's independent EOSE lifecycle cannot entangle the clock assertions
- [Phase 13]: 13-12: req()'s CR-02 fix and count()'s CR-03 fix share one changeset ('resends the REQ and the COUNT'), not two -- same user-visible behavior class landing on two call sites across two plans
- [Phase 13]: 13-12: all eight new changesets are patch, not minor -- each restores a contract already documented and shipped as minor by plans 13-01..13-07, none adds a new option or changes a default
- [Phase 13]: 13-12: RAUTH-03/07/08 flipped to Complete in REQUIREMENTS.md only after every phase-touched suite ran green and each requirement was mapped to a named test with its recorded RED symptom, closing the gap-closure wave 13-VERIFICATION.md opened
- [Phase 13]: 13-14: isGroupReqProgress narrows GroupReqMessage (ERROR -> not progress, early return) then delegates to isReqProgress with no cast, closing CR-02 at group.ts's suspendableTimeout firstWhen — a future GroupReqMessage arm is now a compile error at this call site, not a silent default to progress
- [Phase 13]: 13-14: CR-02 regression tests pass reconnect: false explicitly — without it, relay.req()'s own connection-retry backoff delays relay1's manufactured ERROR value past the test's clock budget, so neither the buggy nor fixed predicate is exercised by the ERROR value at all (discovered when the defect test unexpectedly passed against the reverted pre-fix predicate)
- [Phase 15]: Phase 15 closed: plan 15-08's Task 3 human-verify checkpoint (live auth-gating relay) approved 2026-08-15, confirming auth trace lines appear only after a relay refusal, not on connect or every status change
- [Phase ?]: Phase 16: Throws may signal failure to an immediate retry or aggregation consumer; multi-hop expected state remains value-shaped.
- [Phase ?]: Phase 16: Keep the llms AST scanner on @typescript/typescript6 while CLI compilation uses TypeScript 7.
- [Phase ?]: Keep CLOSED prefix extension private while using a mutable Map for exact-key classification.
- [Phase ?]: 17-02: Keep all four SQLite backends as range-preserving optional peers and verify the published tarball in an isolated npm consumer.

### Pending Todos

None yet.

### Blockers/Concerns

- 5 requirements are blocked on a spec ruling before their implementation task can complete: ROTATE-10, ROTATE-13 (Phase 8); AUTH-07, AUTH-08 (Phase 9); CHAN-07 (Phase 7). Each may resolve to "no change needed" — a planning-time gate for those three phases, not a roadmap risk.
- Verification standard for this milestone: every fix needs a regression test asserting against an independently-derived spec value, not implementation output — the exact gap that let all 43 findings pass CI before. Plan-phase should hold plans to this explicitly.
- [Phase 10 plan-phase, 2026-07-21] Decision-coverage gate (13a) OVERRIDDEN — reported `covered=0/11` (false-fail: the `check.decision-coverage-plan` parser chokes on the nested `*emphasis*`/colons inside the `D-NN:` bold labels in 10-CONTEXT.md). Real coverage is complete: all 13 decisions D-01–D-13 are referenced 2–22× each across the 6 plans and the independent gsd-plan-checker traced every one to an implementing task. Proceeded past the gate deliberately; verify-phase should treat decision coverage as satisfied, not re-block on the parser artifact.
- INVITE-01 spans two plans (10-01 closed D-04's vsk fail-closed sub-part; D-01/D-02/D-03's joinByLink collapse-then-tombstone rewrite is still pending in 10-05) — do not treat INVITE-01 as fully satisfied until 10-05 lands; REQUIREMENTS.md traceability table reflects this as In Progress, not Complete
- [Phase 12.3 CLOSED, 2026-07-27] CR5-01 — D-17's exhaustiveness mechanism binds WHICH fields a rule table must name, but not WHETHER a rule's `kind` matches the type of the field it names: `ExhaustiveBundleRules<T> = { [K in keyof Required<T>]: BundleFieldRule }` never consults `T[K]`. Reproduced at `HELD_KEY_FIELD_RULES.refounder` (a `string`) given `kind: "safe-integer"` — build exit 0, 471/471 green. Review labelled it BLOCKER; DOWNGRADED on audit: all 26 shipped rules across the four tables were checked against their declared field types and are correct, so there is NO live defect — this is a latent guardrail gap only. Deferred to backlog 999.9 by explicit user decision. Rationale: rounds 3/4/5 each closed a defect and the next round found the same class one META-LEVEL up (missing fields → fake table subjects → unbound rule kinds), and the invite-bundle validator entered 12.3's scope via review rounds, not via its own D-01…D-16 acceptance criteria. Stopping the regress at a natural boundary was the call; the fix when promoted is `RuleFor<V>` (subsumes the key-set proof), not another enumerated patch. Reinforces [[prefer-structural-over-enumerated-fixes]].
- [Phase 12.3] LESSON: 12.3-14's executor flipped the PHASE checkbox to `[x]` before verification ran, leaving a self-contradictory ROADMAP line reading both "in gap closure — BLOCKER" and "(completed)". Phase completion belongs to `phase.complete` after the verifier passes — a plan executor may only mark its OWN plan. Watch for this in future phase runs.
- [RESOLVED 2026-07-29] WIRE-02/03/04/05 spanned plans 11-01/04/05/06 (11-01 closed only the vendored-fixture sub-part) — 11-06 landed the last of these (WIRE-02); REQUIREMENTS.md traceability now reflects all four as Complete
- 11-02: applesauce-examples unfiltered pnpm build is red due to 9 pre-existing, unrelated StoredEvent/NostrEvent sig-mismatch files (not concord/voice-flag related) — see deferred-items.md; a future plan should fix these cache-request call sites
- Plan 12-01's frontmatter lists requirements WIRE-06/07/08/12, but 12-01 only builds the spec-anchored test substrate (cap literals, section registry, citation scanner) those plans' tests will assert against — the actual behavior (cap enforcement in helpers/caps.ts/admin.ts/client.ts for WIRE-06/07/08, the citation sweep for WIRE-12) lands in plans 12-04/12-05/12-06. Left REQUIREMENTS.md unchanged (still Pending) to avoid a false-complete claim, mirroring the INVITE-01 precedent; mark these Complete only when their respective implementing plans land.
- Plan 12-02's frontmatter lists requirement WIRE-08, but 12-02 only supplies the runtime evidence that the byte-cap ceiling moved upstream (nostr-tools bump + round-trip test). WIRE-08's own requirement text (the 50-membership enforcement alongside the already-enforced byte cap) is delivered by plan 12-05. Left REQUIREMENTS.md unchanged (still Pending) to avoid a false-complete claim, mirroring the 12-01 precedent; mark WIRE-08 Complete only when 12-05 lands.
- Plan 12-03's frontmatter lists requirement WIRE-08, but 12-03 only retires the invite-side half of the byte-cap removal (INVITE_LIST_MAX_BYTES/inviteListWithinByteCap, INVITE_BUNDLE_MAX_TOTAL_BYTES) per D-07. WIRE-08's own requirement text (the 50-membership enforcement alongside the already-enforced byte cap) is delivered by plan 12-05, which handles the Community List half. Left REQUIREMENTS.md unchanged (still Pending) to avoid a false-complete claim, mirroring the 12-01/12-02 precedent; mark WIRE-08 Complete only when 12-05 lands.
- [RESOLVED 2026-07-30] Plans 12-07/12-08 both deferred WIRE-09's completion, noting the client-publish-tier closure (saveCommunityList/invite-manager.save() hand-rolling the document from reduced arrays) was plan 12-09's scope per D-23 -- 12-09 landed a `documentExtras` snapshot in both ConcordClient and ConcordInviteManager (spread-first, assign-after at every write site), proven via a six-test cross-cutting suite (document-caps-conformance.test.ts) with three mandatory non-vacuity mutations observed RED at the exact pre-phase defect sites. WIRE-09 marked Complete in REQUIREMENTS.md.
- Phase 13 deferred-items.md: a connection can drop mid-auth-wait at very low keepAlive (verified pre-existing, not a regression) — worth a backlog entry once Phase 14's auth lifecycle logging work gives it a place to land
- 13-13 closed WR-03/WR-04 in sync-loader.ts (RAUTH-08's stall-guard suspension and timer-lifetime gaps), but REQUIREMENTS.md leaves RAUTH-08 In Progress -- plan 13-12 (which depends on 13-13) is the designated closing plan that flips RAUTH-03/07/08 to Complete once every gap-closure plan in this wave sequence has landed
- [Roadmap, 2026-08-19] v7.0.0's changesets config uses `linked`, not `fixed` — a package bumps only via its own changeset or a real dependency cascade. Phase 26 (Release Coordination) owns an explicit per-package changeset checklist and a `changeset status --verbose --since=master` dry run before cutting, or `applesauce-concord`/`applesauce-react`/`applesauce-sqlite` can silently stay on 6.x while the other 11 packages jump to 7.0.0.
- [Roadmap, 2026-08-19] v7.0.0 Phase 24 (SYNC) and Phase 20 (AUTH) each carry a dependency confirmed by architecture research rather than the original backlog text — see the Roadmap Evolution entry above for both. Plan-phase for Phase 24 should re-verify `Relay.sync()`'s SEND/RECEIVE call sites have actually been rewired onto Phase 18/22's high-level methods before assuming the rewrite is complete.
- [RESOLVED 2026-08-20] Phase 16 verification: the developer selected option 1 and accepted an explicit verification override for the five runtime-neutral TS7 compatibility edits in ba8a3da6. Four are type-only `Debugger` annotations and one is a NodeNext `.js` side-effect-import extension; all required build, test, and declaration gates pass. Review fix 79c08103 also moved `@types/debug` into the published dependencies of signers and wallet-connect so emitted declarations remain consumable.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260804-g0c | Return undefined instead of throwing in getHiddenTags and getWalletNotification | 2026-08-04 | a587410b, 06904f4a | [260804-g0c-undefined-over-throw](./quick/260804-g0c-undefined-over-throw/) |
| 260804-g7f | Return undefined instead of throwing in wallet token, history and nutzap helpers | 2026-08-04 | fa828090, 535c47f3, b1e89b55 | [260804-g7f-wallet-undefined-over-throw](./quick/260804-g7f-wallet-undefined-over-throw/) |
| 260804-gzq | Exclude ephemeral kinds (20000-29999) from ConcordObservedAuthorsModel's fold | 2026-08-04 | 188210bc, b20cde05 | [260804-gzq-exclude-ephemeral-kinds-from-concordobse](./quick/260804-gzq-exclude-ephemeral-kinds-from-concordobse/) |
| 260804-hmw | Gate verifiedSymbol/EncryptedContentSymbol on source.id === dest.id in copySymbolsToDuplicateEvent (WR-01) | 2026-08-04 | 200d9a85, 4efd074f, 55546e6b | [260804-hmw-gate-verifiedsymbol-and-encryptedcontent](./quick/260804-hmw-gate-verifiedsymbol-and-encryptedcontent/) |
| 260804-hmw-b | Remove unused EventFactory.kind() method (WR-04) | 2026-08-04 | e829d0a3 | inline (no plan dir) |
| 260805-ds0 | Clamp setTimeout delays to the 32-bit max in ExpirationManager and WalletConnect.waitForPaid (resolves backlog 999.10) | 2026-08-05 | 187930b9, 3f6f4bd3, 1b6b2976, 594bf1de | [260805-ds0-clamp-expirationmanager-settimeout-delay](./quick/260805-ds0-clamp-expirationmanager-settimeout-delay/) |

### Roadmap Evolution

- Phase 05.1 inserted after Phase 5: Symbol propagation redesign: all symbol writes non-enumerable via setCachedValue; factory pipelines carry PRESERVE_EVENT_SYMBOLS explicitly; gift-wrap symbols move to core; strip loops deleted; supersedes the cache.ts taxonomy
- 2026-07-16: Phase 5 code review surfaced 5 confirmed blocker bugs (CR-01..05) + 11 warnings in write-sites 05.1 already touches (unlock-guard family returns undefined-as-array; lockAppData leaks plaintext; copySymbols &&/|| fail-open; stamp mutates caller). Decision: fold the fixes into Phase 5.1 rather than a standalone phase. Constraint recorded in 05.1 ROADMAP scope — each behavioral fix gets its own commit + spec-derived regression test, landed before the enumerable→non-enumerable migration rewrites the site, so verification can attribute pass/fail to the fix and not the refactor. Full detail: 05-REVIEW.md.
- Phase 12.1 inserted after Phase 12: Promoted from backlog 999.3: Concord sync skips ephemeral kind 21059
- Phase 12.2 inserted after Phase 12: Promoted from backlog 999.1: Concord sync debug logging
- Phase 12.3 inserted after Phase 12: Promoted from backlog 999.6: Transport-only extra relays in applesauce-concord
- v7.0.0 roadmap created 2026-08-19: 11 phases (16–26, continuing from v1.2's Phase 15) derived from the 46 v1 requirements (LAYER/EVT/REQ/AUTHF/COUNT/SYNC/GROUP/FIX/RESID/REL/ECO). Sequencing: 999.23 (Phase 16, LAYER) gates every other phase; 999.24 (Phase 18, EVENT) before 999.25 (Phase 22, REQ); 999.27 (Phase 19, COUNT high-level) before 999.21 (Phase 23, COUNT isolation); 999.20 (Phase 21, GROUP) before 999.25 (Phase 22, REQ). Two dependencies came from architecture research rather than the original backlog, not previously recorded in ROADMAP.md: Phase 24 (SYNC/999.28) needs both Phase 18 and Phase 22 to land first, since `Relay.sync()` calls `event()`/`req()` directly at relay.ts:1677/:1689, bypassing their high-level siblings; and AUTHF-05 (the applesauce-loaders duck-typed `RELAY_AUTH_ERROR_NAMES` gap) is mapped into Phase 20 (AUTH) rather than its own phase, so any new terminal auth error class is recognized by the loader in the same change that introduces it. GROUP-03 (one shared per-relay-outcome representation) is mapped to Phase 21, where it is first defined; Phase 23 consumes it rather than inventing a second shape. Ecosystem riders split: ECO-01 (TypeScript 7) folded into Phase 16 since both are zero-behavior-risk foundation work; ECO-02/ECO-03 merged into one Phase 25 since both are independent single-requirement riders with no other natural neighbor. Release (REL-01..04) is its own final Phase 26, depending on all 10 prior phases, per the explicit instruction that it needs a real per-package changeset checklist and a `changeset status --verbose --since=master` dry run, not a closeout formality.

## Deferred Items

Items acknowledged and carried forward, not in this roadmap:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Channels | FUT-01: public↔private channel conversion, channel rename (CORD-03 §2) | Deferred | v1.1 requirements definition |
| Voice | FUT-02: CORD-07 §2/§3/§5/§6/§7 broker/media/rendezvous transport | Deferred | v1.1 requirements definition |
| Common | COMMON-F1/F2: genericize remaining `applesauce-common` casts/helpers one-by-one as concrete rumor needs arise | Deferred | v1.0 close |
| Common | Pre-existing unsafe `getHashtagTag` cast; migration release-note for `verifyEvent: undefined` semantics | Deferred | v1.0 close |
| Common | `getHiddenGroups` (`common/helpers/groups.ts`) permanently memoizes `undefined` via `getOrComputeCachedValue` when hidden tags are locked (`Reflect.has`-gated, not value-gated); the poisoned memo satisfies `isHiddenGroupsUnlocked`'s presence check, so `unlockHiddenGroups` returns `undefined` against its `Promise<GroupPointer[]>` signature, bypassing its own `if (!groups) throw` guard — routed to the symbol-propagation redesign phase, where the site is fixed en route during the `setCachedValue` write-site migration | Deferred | Phase 5 (comment-only scope) |
| Process | Finding-ID collision: `05-11-SUMMARY.md`'s Deferral Register marks `WR-07` closed against `gift-wrap.ts`'s `RumorSymbol` sentinel under an earlier review's numbering, but `05-REVIEW.md`'s own `WR-07` names a different, then-still-open finding (`encrypted-content-cache.ts`'s unparseable fragment, closed by 05-13) — finding IDs are not stable across review rounds; match a "closed" entry to its originating review before trusting it | Noted | Phase 5 |
| Core | CACHE-02's full taxonomy reconciliation (`cache.ts`'s worked-example/category-3 rework) superseded by the symbol-propagation redesign decision — the taxonomy documents a memo-vs-carry-forward distinction the redesign eliminates (all symbol writes non-enumerable via `setCachedValue`; carry-forward via explicit pipeline whitelist copy; gift-wrap symbols moved to core); `cache.ts` retains only a minimal falsehood-neutralization plus a supersession note (05-12) — score CACHE-02 against this reduced scope, not the original gap list | Superseded | Phase 5 round 3 |
| Core | Truth 6 / D-13 non-vacuity probe (migrate `modifyHiddenTags`'s write to non-enumerable, watch the shipped `cache.test.ts` carry-forward suite go RED, revert) never completed under trusted conditions — a transcript asserted during round-3 planning was rejected for resting on a false working-tree premise; now moot, since the symbol-propagation redesign makes that exact migration correct behavior and `cache.test.ts`'s carry-forward suite will be rewritten against the pipeline's explicit whitelist copy | Superseded | Phase 5 round 3 |

### Acknowledged at v1.1 milestone close (2026-08-04)

The open-artifact audit surfaced these; all were acknowledged and deferred rather than resolved,
making this an `override_closeout`. None blocks a v1.1 requirement — all 54 are satisfied.

| Category | Item | Status |
|----------|------|--------|
| todo | `05.1-review-followups.md` — three cosmetic remainders (`low`): stale `stamp` comment, `lockWallet` leaves `WalletRelaysSymbol` cached, `getAppDataContent` truthy checks mishandle falsy parsed values. Dropped from `high` once CR-01/WR-01/WR-03/WR-04 and the INFO item were fixed | Deferred |
| seed | SEED-001 avoid inline `debug.extend()` — create logger instances at class or module level | Dormant |
| seed | SEED-002 update to TypeScript 7 | Dormant |
| seed | SEED-003 update to React 19 while maintaining React 18 support | Dormant |
| seed | SEED-004 update to `@snort/worker-relay` v2 | Dormant |
| seed | SEED-005 legacy direct messages need a Client class + Manager | Dormant |
| seed | SEED-006 wrapped messages need Client + Conversation classes | Dormant |
| seed | SEED-007 gift wrap ingestion service | Dormant |
| seed | SEED-008 evaluate first-class `nostr-double-ratchet` support | Dormant |
| seed | SEED-009 first-class support for profile themes | Dormant |
| override | Phase 10 — `inviteBundleKey` has no hand-derived spec-value test; round-trip coverage only. Standing TEST-01 candidate for any future phase touching it (hzrd149, 2026-07-21) | Accepted |
| override | Phase 12 D-04 — read path deliberately accepts an over-cap channel name/description verbatim; rejecting would convert a caps bug into a channel-availability bug (user, 2026-07-29) | Accepted |
| override | Phase 12 D-14 — `deleteChannel` destructure-and-spread, safe because `ChannelMetadata` no longer carries key/epoch (user, 2026-07-29) | Accepted |
| override | Phase 12.3 WR-08 — `handleRemoved` prune proven behaviorally, but the live two-instance Refounding trigger remains unproven; separable test-harness effort (user, 2026-07-27) | Accepted |
| override | Phase 12.3 CR5-01 — rule `kind` not type-bound to field type; zero live defect across all 26 rules, backlogged as Phase 999.9 (user, 2026-07-27) | Accepted |
| nyquist | Phases 10 and 12.2 `nyquist_compliant: false`, both still `status: draft` — `/gsd-validate-phase 10`, `/gsd-validate-phase 12.2` | Partial |
| nyquist | Phase 12.1 has no VALIDATION.md — `/gsd-validate-phase 12.1` | Missing |

### Acknowledged at v1.2 milestone close (2026-08-19)

The pre-close artifact audit surfaced 9 open items, all carried forward from the v1.1 close and none
related to v1.2's relay-auth work. All acknowledged and deferred, making this an `override_closeout`.
None blocks a v1.2 requirement — all 16 are satisfied.

**Seed files are not removed by acknowledgement.** Verified at this close: every `SEED-*.md` deferred
at v1.1 is still on disk, and `SEED-001` left the audit list only because its frontmatter now reads
`status: resolved` / `resolved_in: phase-14`. Resolution is a status change, never a deletion, and
`complete-milestone` never touches `.planning/seeds/`.

| Category | Item | Status |
|----------|------|--------|
| todo | `05.1-review-followups.md` — three cosmetic remainders from the Phase 05.1 review | Deferred (low) |
| seed | SEED-002 update to TypeScript 7 | Dormant |
| seed | SEED-003 update to React 19 while maintaining React 18 support | Dormant |
| seed | SEED-004 update to `@snort/worker-relay` v2 | Dormant |
| seed | SEED-005 legacy direct messages need a Client class + Manager | Dormant |
| seed | SEED-006 wrapped messages need Client + Conversation classes | Dormant |
| seed | SEED-007 gift wrap ingestion service | Dormant |
| seed | SEED-008 evaluate first-class `nostr-double-ratchet` support | Dormant |
| seed | SEED-009 first-class support for profile themes | Dormant |

**v7 candidates — reconsider at next-milestone scoping rather than deferring again.** SEED-002
(TypeScript 7), SEED-003 (React 19 + 18) and SEED-004 (`@snort/worker-relay` v2) are ecosystem bumps
that pair naturally with the v7 major already being cut for the relay re-layering. Doing them inside
a major that is happening anyway is cheaper than cutting a second one later.

**Still carried from v1.1:** three Nyquist validation gaps (`/gsd-validate-phase` on Phases 10, 12.1,
12.2) and five accepted overrides. v1.2's own three phases are all `nyquist_compliant: true`.

## Session Continuity

Last session: 2026-08-20T11:57:25.432Z
Stopped at: Completed 17-02-PLAN.md
Resume file: None

Stale Phase 13 pause artifacts (`.planning/HANDOFF.json`, `13-.../.continue-here.md`, both from the
2026-08-05 wave-1 pause) were removed on resume — superseded by Phase 13's completion at 14/14 plans.
Recoverable from commit `c3be26c2` if ever needed.

## Operator Next Steps

- Run /gsd-plan-phase 16 to begin the first phase of v7.0.0
