---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: first-fixes
current_phase: 05
current_phase_name: cache-identity-memo-fix
status: executing
stopped_at: Phase 05.1 context gathered
last_updated: "2026-07-16T14:24:19.762Z"
last_activity: 2026-07-16
last_activity_desc: Phase 05 execution started
progress:
  total_phases: 9
  completed_phases: 1
  total_plans: 14
  completed_plans: 14
  percent: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15)

**Core value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.
**Current focus:** Phase 05 — cache-identity-memo-fix

## Current Position

Phase: 05 (cache-identity-memo-fix) — EXECUTING
Plan: 1 of 14
Status: Ready to execute
Last activity: 2026-07-16 — Phase 05 execution started

Progress: [░░░░░░░░░░] 0%

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

## Accumulated Context

### Decisions

Full v1.0 decision log lives in `.planning/milestones/v1.0-phases/`. Current milestone (v1.1) roadmap decisions:

- [Roadmap]: Phase 5 (cache fix, `applesauce-core`) gets its own small phase ahead of all concord work — it's the root cause of ROTATE-01/02/03 and unmasks ROTATE-04 (H02) the moment it lands
- [Roadmap]: CHAN-05 and ROTATE-03 placed in the same phase (7) — independent root causes of the same bug (H08); either alone leaves a rekeyed channel on its old plane
- [Roadmap]: CHAN-01/02/03 (Accordian-blocking) weighted into Phase 7, immediately after the mandatory cache→refounding-core sequence, ahead of rotation-robustness/authority-fold work
- [Roadmap]: 5 spec-ruling-blocked requirements (ROTATE-10/13, AUTH-07/08, CHAN-07) distributed into their topical phases (7/8/9) rather than one adjudication phase, with the ruling as each phase's first task
- [Roadmap]: REQUIREMENTS.md's stated "52 total" corrected to 53 — a recount of every checklist item found 53 distinct REQ-IDs; no requirement content changed

### Pending Todos

None yet.

### Blockers/Concerns

- 5 requirements are blocked on a spec ruling before their implementation task can complete: ROTATE-10, ROTATE-13 (Phase 8); AUTH-07, AUTH-08 (Phase 9); CHAN-07 (Phase 7). Each may resolve to "no change needed" — a planning-time gate for those three phases, not a roadmap risk.
- Verification standard for this milestone: every fix needs a regression test asserting against an independently-derived spec value, not implementation output — the exact gap that let all 43 findings pass CI before. Plan-phase should hold plans to this explicitly.

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

Last session: 2026-07-16T13:21:44.694Z
Stopped at: Phase 05.1 context gathered
Resume file: .planning/phases/05.1-symbol-propagation-redesign/05.1-CONTEXT.md

## Operator Next Steps

- Review the roadmap draft: `.planning/ROADMAP.md` (Phases 5–12)
- Start planning the first phase: `/gsd-plan-phase 5`
