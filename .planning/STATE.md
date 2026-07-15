---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: first-fixes
current_phase: 05
current_phase_name: cache-identity-memo-fix
status: executing
stopped_at: Phase 5 context gathered
last_updated: "2026-07-15T21:56:24.962Z"
last_activity: 2026-07-15
last_activity_desc: Phase 05 execution started
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 5
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15)

**Core value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.
**Current focus:** Phase 05 — cache-identity-memo-fix

## Current Position

Phase: 05 (cache-identity-memo-fix) — EXECUTING
Plan: 1 of 5
Status: Ready to execute
Last activity: 2026-07-15 — Phase 05 execution started

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

## Deferred Items

Items acknowledged and carried forward, not in this roadmap:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Channels | FUT-01: public↔private channel conversion, channel rename (CORD-03 §2) | Deferred | v1.1 requirements definition |
| Voice | FUT-02: CORD-07 §2/§3/§5/§6/§7 broker/media/rendezvous transport | Deferred | v1.1 requirements definition |
| Common | COMMON-F1/F2: genericize remaining `applesauce-common` casts/helpers one-by-one as concrete rumor needs arise | Deferred | v1.0 close |
| Common | Pre-existing unsafe `getHashtagTag` cast; migration release-note for `verifyEvent: undefined` semantics | Deferred | v1.0 close |

## Session Continuity

Last session: 2026-07-15T16:40:43.404Z
Stopped at: Phase 5 context gathered
Resume file: .planning/phases/05-cache-identity-memo-fix/05-CONTEXT.md

## Operator Next Steps

- Review the roadmap draft: `.planning/ROADMAP.md` (Phases 5–12)
- Start planning the first phase: `/gsd-plan-phase 5`
