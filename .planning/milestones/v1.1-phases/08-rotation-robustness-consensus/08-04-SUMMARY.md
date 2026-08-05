---
phase: 08-rotation-robustness-consensus
plan: 04
subsystem: concord
tags: [refounding, rekey, consensus, majority-gate, relay-publish]

# Dependency graph
requires:
  - phase: 08-01
    provides: the per-epoch down-only rekeyHandled latch and re-read spine that refound() adopts onto
provides:
  - "refound()'s per-wrap strict-majority gate over awaited PublishResponse[], before compaction/snapshot publish or adoption"
  - "A spec-derived test proving a sub-majority root roll aborts refound() and a majority-ok roll completes it"
affects: [09-authority-and-permissions, refounding, relay-publish-mocking]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate a multi-recipient publish sequence on ⌈(n+1)/2⌉ ok:true responses over the CONFIGURED relay set (this.relays().length), not the count of responses received — a non-responding relay counts against the denominator"

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "Denominator for majority is this.relays().length (the configured relay set), never responses.length — matches D-11's locked reading and prevents a relay that silently drops offline from shrinking the bar"
  - "A rejected/failing pool.publish() call is allowed to propagate as a thrown rejection rather than being caught-and-treated-as-not-ok — consistent with the abort-before-further-publish shape and simpler than double-handling rejection vs ok:false"
  - "Test fakePool()/fakePoolWithStatus() default publish changed from `async () => []` to an okAll(relays) helper that acks every relay ok:true, since the new gate makes an empty PublishResponse[] fail majority for any n>=1 relay — this was required to keep all pre-existing refound-calling tests green under the new gating behavior"

requirements-completed: [ROTATE-09]

coverage:
  - id: D1
    description: "refound() computes majorityThreshold = ceil((n+1)/2) over this.relays().length and awaits each root-roll (plan.rekeyWraps) and channel-rekey (plan.channelRekeyWraps) wrap's PublishResponse[], throwing before any compactionWraps/snapshotWraps publish or adoptRefounding when a wrap's ok:true count is below threshold"
    requirement: "ROTATE-09"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#refound() aborts before compaction/adoption when the root-roll wrap misses majority, and succeeds once it clears majority (D-09/D-11, ROTATE-09)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts (full suite, 24 community.test.ts cases including pre-existing refound tests)"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-19
status: complete
---

# Phase 08 Plan 04: Per-Wrap Majority Gate on refound() Summary

**refound() now awaits each root-roll and channel-rekey wrap's PublishResponse[] and throws before compaction/snapshot publish or adoption unless ⌈(n+1)/2⌉ of the configured relay set acked ok:true — closing the self-isolation gap (M04) where a Refounder could roll forward alone onto an undiscoverable epoch.**

## Performance

- **Duration:** 15 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `refound()` replaces its fire-and-forget `.catch()` on `plan.rekeyWraps`/`plan.channelRekeyWraps` publishes with an awaited `PublishResponse[]` capture, per-wrap majority check (`ok:true` count ≥ `⌈(n+1)/2⌉` of `this.relays().length`), and a throw before any `compactionWraps`/`snapshotWraps` publish or `adoptRefounding` when a gated wrap misses the threshold
- Publish order preserved exactly (rekey wraps, then channel-rekey wraps, then compaction, then snapshot, then adopt) — only the gating changed, matching the plan's Pitfall-6 framing
- New spec-derived test hand-derives the threshold (`⌈(n+1)/2⌉` over 3 relays = 2, never read back from `refound()`'s own computation) and proves both directions: a minority-ok (1 of 3, including a `Timeout` not-ok) root-roll wrap aborts before any further publish call and leaves `material.root_epoch`/`community_root`/`onRefounded` untouched, while a majority-ok (2 of 3) wrap lets the same call complete, publish compaction/snapshot, and adopt

## Task Commits

1. **Task 1: Per-wrap strict-majority gate in refound() before adoption** - `5ffab524` (fix)
2. **Task 2: Spec-derived majority-gate test (minority ok ⇒ throws, no adoptRefounding)** - `79f3ace1` (test)

_Note: concord is unreleased (v1.1) — no changesets added, per project convention._

## Files Created/Modified
- `packages/concord/src/client/community.ts` - `refound()` gained `majorityThreshold`/`requireMajority` and awaits per-wrap `PublishResponse[]` before compaction/snapshot/adoption
- `packages/concord/src/client/__tests__/community.test.ts` - new majority-gate test; `fakePool()`/`fakePoolWithStatus()` and two explicit `pool.publish` overrides now ack `ok:true` per relay (`okAll`) instead of returning `[]`

## Decisions Made
- Denominator is `this.relays().length` (configured set), not the number of responses received — a non-responding relay counts as not-ok, per D-11's locked reading
- Let a `pool.publish()` rejection propagate naturally rather than adding a try/catch around the gated calls — a failed publish call is itself a failure to confirm, and this keeps the abort-before-further-publish shape simple
- Updated `fakePool()`/`fakePoolWithStatus()`'s default `publish` mock (and the two `pool.publish` overrides feeding `refound()`) to ack every relay `ok:true` — the pre-existing default (`async () => []`) resolves to zero acks, which fails majority for any relay count ≥ 1 and would have broken every pre-existing `refound()`-calling test under the new gate

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test pool mocks returned zero PublishResponses, which would fail the new majority gate for every pre-existing `refound()`-calling test**
- **Found during:** Task 1 verification (`pnpm --filter applesauce-concord test -- community.test.ts`)
- **Issue:** `fakePool()`/`fakePoolWithStatus()`'s default `publish: async () => []` and two explicit test overrides (in the "refreshes live invite bundles..." and "refound compacts control heads..." tests) always resolved with an empty `PublishResponse[]`. With a single configured relay (`["wss://fake"]`) and the new `⌈(n+1)/2⌉ = 1` threshold, zero `ok:true` responses is below threshold — every one of the ~8 pre-existing tests that call `community.refound(...)` without overriding publish (or that push into `published` and return `[]`) would start throwing, blocking the plan's own acceptance criterion that `community.test.ts` exits 0.
- **Fix:** Added an `okAll(relays)` helper (`relays.map((from) => ({ ok: true, from }))`) and wired it as the default `publish` for both fake pools, and substituted it for the two explicit override return values (`return []` → `return okAll(relays)`), so every relay in the request acks `ok:true` unless a test deliberately overrides it (as the new AUTH-02 outrank test and the new majority-gate test both still do, since their `refound()` calls either never reach a publish or need to control specific ok/not-ok counts).
- **Files modified:** `packages/concord/src/client/__tests__/community.test.ts`
- **Verification:** Full `community.test.ts` suite (24 tests) and full `applesauce-concord` suite (225 tests) green after the fix; `pnpm --filter applesauce-concord build` (tsc) clean.
- **Committed in:** `79f3ace1` (Task 2 commit — bundled with the new test since both address the same test-infrastructure gap)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary consequence of Task 1's behavioral change; no scope creep — only the two fake-pool mock helpers and two explicit override return values were touched, and the one test (AUTH-02 outrank) that legitimately needs a `[]`/no-ack mock was left untouched since its `refound()` call throws before any publish is attempted.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ROTATE-09 satisfied: `refound()` can no longer roll a Refounder forward alone onto an epoch no other relay-connected member can discover
- `packages/concord` remains unreleased; no changeset required
- Ready for 08-05/08-06 (remaining Wave 2+ plans in this phase)

---
*Phase: 08-rotation-robustness-consensus*
*Completed: 2026-07-19*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/community.ts
- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: .planning/phases/08-rotation-robustness-consensus/08-04-SUMMARY.md
- FOUND commit: 5ffab524
- FOUND commit: 79f3ace1
