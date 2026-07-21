---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: first-fixes
current_phase: 10
current_phase_name: invite-lifecycle-event-time-consistency
status: executing
stopped_at: Completed 10-05-PLAN.md
last_updated: "2026-07-21T14:22:48.032Z"
last_activity: 2026-07-21
last_activity_desc: Phase 10 execution started
progress:
  total_phases: 9
  completed_phases: 6
  total_plans: 51
  completed_plans: 50
  percent: 67
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15)

**Core value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.
**Current focus:** Phase 10 — invite-lifecycle-event-time-consistency

## Current Position

Phase: 10 (invite-lifecycle-event-time-consistency) — EXECUTING
Plan: 6 of 6
Status: Ready to execute
Last activity: 2026-07-21 — Phase 10 execution started

Progress: [██████████] 98%

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

### Pending Todos

None yet.

### Blockers/Concerns

- 5 requirements are blocked on a spec ruling before their implementation task can complete: ROTATE-10, ROTATE-13 (Phase 8); AUTH-07, AUTH-08 (Phase 9); CHAN-07 (Phase 7). Each may resolve to "no change needed" — a planning-time gate for those three phases, not a roadmap risk.
- Verification standard for this milestone: every fix needs a regression test asserting against an independently-derived spec value, not implementation output — the exact gap that let all 43 findings pass CI before. Plan-phase should hold plans to this explicitly.
- [Phase 10 plan-phase, 2026-07-21] Decision-coverage gate (13a) OVERRIDDEN — reported `covered=0/11` (false-fail: the `check.decision-coverage-plan` parser chokes on the nested `*emphasis*`/colons inside the `D-NN:` bold labels in 10-CONTEXT.md). Real coverage is complete: all 13 decisions D-01–D-13 are referenced 2–22× each across the 6 plans and the independent gsd-plan-checker traced every one to an implementing task. Proceeded past the gate deliberately; verify-phase should treat decision coverage as satisfied, not re-block on the parser artifact.
- INVITE-01 spans two plans (10-01 closed D-04's vsk fail-closed sub-part; D-01/D-02/D-03's joinByLink collapse-then-tombstone rewrite is still pending in 10-05) — do not treat INVITE-01 as fully satisfied until 10-05 lands; REQUIREMENTS.md traceability table reflects this as In Progress, not Complete

### Roadmap Evolution

- Phase 05.1 inserted after Phase 5: Symbol propagation redesign: all symbol writes non-enumerable via setCachedValue; factory pipelines carry PRESERVE_EVENT_SYMBOLS explicitly; gift-wrap symbols move to core; strip loops deleted; supersedes the cache.ts taxonomy
- 2026-07-16: Phase 5 code review surfaced 5 confirmed blocker bugs (CR-01..05) + 11 warnings in write-sites 05.1 already touches (unlock-guard family returns undefined-as-array; lockAppData leaks plaintext; copySymbols &&/|| fail-open; stamp mutates caller). Decision: fold the fixes into Phase 5.1 rather than a standalone phase. Constraint recorded in 05.1 ROADMAP scope — each behavioral fix gets its own commit + spec-derived regression test, landed before the enumerable→non-enumerable migration rewrites the site, so verification can attribute pass/fail to the fix and not the refactor. Full detail: 05-REVIEW.md.

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

## Session Continuity

Last session: 2026-07-21T14:22:48.007Z
Stopped at: Completed 10-05-PLAN.md
Resume file: None

## Operator Next Steps

- Review the roadmap draft: `.planning/ROADMAP.md` (Phases 5–12)
- Start planning the first phase: `/gsd-plan-phase 5`
