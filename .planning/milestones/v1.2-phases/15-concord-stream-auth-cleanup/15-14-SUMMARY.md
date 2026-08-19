---
phase: 15-concord-stream-auth-cleanup
plan: 14
subsystem: auth
tags: [nip-42, concord, testing, validation, gap-closure]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "plans 15-09..15-13's five gap-closure fixes (CR-01 registration, WR-01..WR-08) — the state this plan's oracle and gate run verify together"
provides:
  - "A publish-answerability oracle that drives every ConcordCommunity publish site (refound()'s four sites, refreshInviteBundles(), the private-channel send) and asserts its own breadth via a distinct-authors lower bound, instead of an unchecked universality comment"
  - "One recorded, all-green run of all four phase gates covering every gap-closure plan (15-09..15-14)"
  - "15-VALIDATION.md extended with 9 new Per-Task Verification Map rows and a gap-closure Wave 0 non-vacuity bullet, without disturbing the four pre-existing rows"
affects: [phase-15-reverification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Checked distinct-author lower bound instead of a hand-maintained 'a tenth publish fails automatically' comment — a scenario that stops driving a publish site now fails the assertion instead of silently narrowing"

key-files:
  created: []
  modified:
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/client/auth.ts
    - packages/concord/src/helpers/__tests__/keys.test.ts
    - .planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md

key-decisions:
  - "Ordered the scenario's new calls mint -> refreshInviteBundles -> revoke -> grantChannelAccess -> rotateChannel -> refound() (last), since refound() rolls the epoch and adopts new key state — anything after it would be operating on a different epoch than the rest of the scenario, per the plan's explicit instruction"
  - "Chose distinct event.pubkey count (not kind+author-class pairs) as the structural derivation for the breadth assertion — simpler to reason about and sufficient to catch a dropped publish site; asserted a concrete lower bound of 10, confirmed against the scenario's actual output (10 distinct authors, 19 recorded publishes) rather than hand-derived alone"
  - "refound() is called with channelRekeys: [{ channelId, keep: [pubkey] }] (not the bare root-only form) so the single call exercises all four refound() publish sites in one shot, per the plan's explicit instruction"
  - "The two prettier --check failures (auth.ts, keys.test.ts) were pre-existing from wave 1/2 plans (15-10, 15-09), not from this plan's own edits — fixed via prettier --write in a separate formatting-only commit, verified by inspection and a green rebuild/retest, and recorded as IN-01's already-flagged issue rather than a new deviation against this plan's own tasks"

requirements-completed: []

coverage:
  - id: D1
    description: "The publish-answerability scenario in community.test.ts drives every ConcordCommunity publish site — refound()'s four sites, refreshInviteBundles(), and the private-channel send — and asserts a checked lower bound (10) on distinct publishing authors, replacing the unchecked universality comment. Proven RED against a broken channel-rekey registration, GREEN restored."
    requirement: null
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > every publish a community makes declares an author its own holder can answer for, and the one NIP-59 grant answers with the user's key"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (55 files, 594 tests, 0 failures, 0 skipped)"
        status: pass
    human_judgment: false
  - id: D2
    description: "All four phase gates (concord build, concord test, examples build, repo-wide turbo build) pass together in one recorded run covering every gap-closure plan (15-09..15-14); npx prettier --check is clean over every file the wave touched; 15-VALIDATION.md's contract is extended without disturbing the four pre-existing Per-Task Verification Map rows"
    requirement: null
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord build; pnpm --filter applesauce-concord test (55 files, 594 tests); pnpm --filter applesauce-examples build; pnpm build (repo-wide turbo, 18/18 tasks) — all exit 0"
        status: pass
      - kind: other
        ref: "npx prettier --check <gap-closure wave file list> reports 'All matched files use Prettier code style!' after a separate formatting-only fix commit"
        status: pass
      - kind: other
        ref: "git diff --stat .planning/REQUIREMENTS.md .planning/ROADMAP.md shows no change from this plan"
        status: pass
    human_judgment: false
  - id: D3
    description: "The developer approved the private-channel live-relay checkpoint with the single word \"approved\" against the seven numbered how-to-verify steps as presented, without volunteering per-step observations"
    verification: []
    human_judgment: true
    rationale: "No live auth-gating relay and no browser is available to this autonomous executor — this is the phase's designated blocking human-verify checkpoint. The developer's response was a bare approval; no per-step detail (step 5's auth trace lines, step 6's second-session retrieval) was reported, so none is recorded here as observed. The approval itself discharges the checkpoint per the plan's Task 3 acceptance criteria (\"On approval, 15-VALIDATION.md's new Manual-Only Verification row is marked discharged with the date\"), but the phase's re-verification pass should weigh that the approval carried no per-step detail."

# Metrics
duration: ~9min (Tasks 1-2) + checkpoint resolution (Task 3)
completed: 2026-08-18
status: complete
---

# Phase 15 Plan 14: Publish-Answerability Oracle Widened (WR-06) + Full Gate Run + Live-Relay Checkpoint Summary

**The publish-answerability scenario in `community.test.ts` now drives every `ConcordCommunity` publish site — including all four `refound()` sites and `refreshInviteBundles()` — and asserts a checked lower bound on the number of distinct publishing authors instead of an unchecked comment; all four phase gates pass together in one recorded run covering every gap-closure plan (15-09..15-14); the blocking live-relay private-channel checkpoint was approved by the developer with a bare "approved," without per-step detail.**

## Performance

- **Duration:** ~9 min for Tasks 1-2, plus Task 3's checkpoint resolution in a continuation session
- **Started:** 2026-08-18T14:24:33+01:00 (Task 1 commit)
- **Completed (Tasks 1-2):** 2026-08-18T14:32:59+01:00 (Task 2 commit)
- **Completed (Task 3, checkpoint discharge):** 2026-08-18 (continuation session)
- **Tasks:** 3/3
- **Files modified:** 5 (4 from Tasks 1-2, plus this SUMMARY)

## Accomplishments

- Extended the publish-answerability scenario (`community.test.ts`) with `refreshInviteBundles([invite])` (ordered mint -> refresh -> revoke, so the refresh runs against a still-live invite) and `refound({ keep: [pubkey], channelRekeys: [{ channelId, keep: [pubkey] }] })` placed LAST (it rolls the epoch), exercising all four `refound()` publish sites — the root-roll and channel-rekey `requireMajority` publishes, the compaction publish, and the snapshot publish — in one call
- Replaced the loop's unchecked "a tenth publish added later fails this loop automatically" comment with a checked assertion: `new Set(recorded.map((r) => r.event.pubkey)).size` must be `>= 10` — a lower bound on distinct publishing authors, with a comment naming what each of the 10 represents
- Raised the anti-vacuity floor from `>4` to `>10` recorded publishes (actual: 19 recorded publishes, 10 distinct authors)
- Proved the extended scenario non-vacuous: reverted `refound()`'s `plan.channelRekeyKeys` registration to register nothing, reran — RED, naming the unanswered channel-rekey publish; restored (byte-identical `git diff`) and reran — GREEN, 66/66
- Ran all four phase gates from the repo root and recorded their real output verbatim: `pnpm --filter applesauce-concord build` (exit 0), `pnpm --filter applesauce-concord test` (exit 0, 55 files / 594 tests / 0 failures / 0 skipped), `pnpm --filter applesauce-examples build` (exit 0), `pnpm build` (exit 0, repo-wide turbo, 18/18 tasks)
- `npx prettier --check` over every file the gap-closure wave (15-09..15-14) touched initially flagged 2 pre-existing files from wave 1/2 (`auth.ts`, `keys.test.ts`); fixed with `npx prettier --write` (formatting-only diff, confirmed by inspection and a green rebuild/retest), committed separately; a second `--check` pass is clean
- Extended `15-VALIDATION.md`: 9 new Per-Task Verification Map rows for the gap-closure tasks that produced an oracle, a new Wave 0 bullet citing each plan's non-vacuity probe, a new Manual-Only Verifications row for the private-channel live-relay checkpoint, and a new dated (2026-08-18) full-gate block recorded below the intact 2026-08-15 block — the four pre-existing Per-Task Verification Map rows are unchanged (verified via `git diff`, additions only)
- **Task 3:** the blocking live-relay checkpoint was presented to the developer verbatim (the `what-built` summary and the seven numbered `how-to-verify` steps from `15-14-PLAN.md`). The developer's complete and verbatim response was the single word "approved," with no separate narration of any individual step's outcome. Per the resume instructions constraining this continuation, nothing about step 5 (the `auth` trace lines, the absence of the zero-answer report) or step 6 (second-session retrieval) is recorded as observed — the developer did not report those details, and attributing them would fabricate verification evidence, exactly the failure mode that let CR-01 ship past a green suite and the 2026-08-15 checkpoint. `15-VALIDATION.md`'s private-channel Manual-Only Verification row is marked discharged, dated 2026-08-18, describing the approval exactly as it was given.

## Task Commits

Each completed task was committed atomically:

1. **Task 1: Make the publish-answerability scenario cover every publish a community makes** - `61a05514` (test)
2. **Formatting fix (part of Task 2's prettier gate)** - `63e47387` (style)
3. **Task 2: Run every phase gate together and extend the validation contract** - `3750f1c1` (docs)
4. **Interim SUMMARY recording Tasks 1-2; Task 3 outstanding** - `474023dc` (docs)
5. **Task 3: Discharge the private-channel live-relay checkpoint in `15-VALIDATION.md`** - `b59655d5` (docs)
6. **This finalized SUMMARY** - committed alongside this file per the required order (write, then commit, before returning)

## Files Created/Modified

- `packages/concord/src/client/__tests__/community.test.ts` - Extended the publish-answerability scenario with `refreshInviteBundles()`/`refound()`, added the distinct-authors lower-bound assertion, raised the anti-vacuity floor
- `packages/concord/src/client/auth.ts` - Formatting-only: line-wrap fix in `StreamAuthContext.relay`'s type and the `authLog` call (pre-existing from plan 15-10, flagged by this plan's `npx prettier --check`)
- `packages/concord/src/helpers/__tests__/keys.test.ts` - Formatting-only: line-wrap fix in a multi-line `wrapForTarget` call (pre-existing from plan 15-09)
- `.planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md` - 9 new Per-Task Verification Map rows, a gap-closure Wave 0 non-vacuity bullet, an extended Manual-Only Verifications table (private-channel row now discharged 2026-08-18), and a new dated full-gate run block
- `.planning/phases/15-concord-stream-auth-cleanup/15-14-SUMMARY.md` - this file, finalized from its interim (checkpoint_pending) state to complete

## Decisions Made

See `key-decisions` in the frontmatter for the four load-bearing decisions (call ordering, the distinct-authors derivation choice, the `refound()` call shape, and the formatting-fix disposition).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - pre-existing formatting] Two files flagged by `npx prettier --check` were not from this plan's own edits**
- **Found during:** Task 2's prettier gate check
- **Issue:** `packages/concord/src/client/auth.ts` and `packages/concord/src/helpers/__tests__/keys.test.ts` failed `npx prettier --check`. Neither file was touched by this plan's Task 1 — both formatting issues predate this plan, introduced by plans 15-10 and 15-09 respectively (IN-01 in `15-REVIEW.md` already recorded that phase-15 lines were flagged once, and there is no CI formatting gate).
- **Fix:** Ran `npx prettier --write` on both files. Diff is formatting-only (line-wrap changes, no logic change) — confirmed by inspection and a green concord build + test rerun (55 files, 594 tests, 0 failures) after the fix.
- **Files modified:** `packages/concord/src/client/auth.ts`, `packages/concord/src/helpers/__tests__/keys.test.ts`
- **Verification:** `npx prettier --check` on the full gap-closure wave file list reports "All matched files use Prettier code style!"; `pnpm --filter applesauce-concord build`/`test` both green after the fix
- **Committed in:** `63e47387` (separate formatting-only commit, per the plan's explicit "or run pnpm format and confirm the resulting diff contains only formatting" instruction)

---

**Total deviations:** 1 auto-fixed (pre-existing formatting from earlier gap-closure plans, Rule 1 disposition — a scope-boundary formatting fix explicitly required by Task 2's own acceptance criteria, not scope creep)
**Impact on plan:** No scope creep. Task 2's own acceptance criterion required the prettier gate to pass over every file the wave touched; fixing it was the task, not a deviation from it.

## Non-Vacuity Probe (Task 1, recorded verbatim per plan instruction)

**Method:** Temporarily reverted `refound()`'s channel-rekey registration in `packages/concord/src/client/community.ts` from `this.signers.register(plan.channelRekeyKeys);` to `this.signers.register([]);` (simulating a regressed/absent registration on the newly-covered channel-rekey publish site), ran `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts -t "every publish a community makes"`, then restored the original line and reran the full file.

**RED result:**

```
FAIL  packages/concord/src/client/__tests__/community.test.ts > ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3) > every publish a community makes declares an author its own holder can answer for, and the one NIP-59 grant answers with the user's key
AssertionError: expected [] to deeply equal [ Array(1) ]

- Expected
+ Received

- [
-   "8eca9cf62267ad9e3de930c43f5c3cb7d68eafec088d580c7640fe48533c4b2f",
- ]
+ []

 ❯ community.test.ts:3752:46
    expect(authCalls.map((c) => c.pubkey)).toEqual([record.event.pubkey]);
```

The structural loop failed naming the unanswered channel-rekey publish's author — exactly the class this widened scenario exists to catch.

**Restore + GREEN:** Restored `this.signers.register(plan.channelRekeyKeys);`; `git diff --stat packages/concord/src/client/community.ts` showed zero diff (byte-identical restore). Reran the full `community.test.ts` suite: `Test Files 1 passed (1)`, `Tests 66 passed (66)`.

**Distinct-authors count (observed, matches hand-derivation):** `distinctAuthors.size = 10`, `recorded.length = 19` — genesis control, genesis guestbook, the private channel's message-plane key, the invite-link key (shared by mint/refresh/revoke), the NIP-59 grant's ephemeral key, `rotateChannel`'s channel-rekey address, `refound()`'s root-roll address, `refound()`'s bundled channel-rekey address, `refound()`'s new-epoch control address (compaction), and `refound()`'s new-epoch guestbook address (snapshot).

## Full-Gate Run (Task 2, recorded verbatim per plan instruction)

1. `pnpm --filter applesauce-concord build` — exit 0 (`rimraf dist && tsc`, no errors).
2. `pnpm --filter applesauce-concord test` — exit 0, `Test Files 55 passed (55)`, `Tests 594 passed (594)`, zero failures, zero skipped.
3. `pnpm --filter applesauce-examples build` — exit 0, `✓ built in 2.44s`–`2.60s` across repeated runs (only pre-existing, unrelated warnings: `dashjs` CJS/ESM interop, chunk-size limit, `@tailwindcss/vite` sourcemap notice).
4. `pnpm build` (repo-wide turbo) — exit 0, `Tasks: 18 successful, 18 total`.
5. `npx prettier --check` over every file `git diff --name-only 9b2b3028..HEAD` (the gap-closure wave's start commit) listed — initially 2 files flagged (see Deviations above), clean after the formatting-only fix.

Full verbatim record also lives in `.planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md`'s new 2026-08-18 dated block.

## Issues Encountered

None beyond the pre-existing formatting issue documented above under Deviations. Task 3's checkpoint was approved without per-step detail — see "Checkpoint Approval Detail" below; this is noted as an item for the re-verification pass to weigh, not treated as a defect in this plan's own execution.

## Checkpoint Approval Detail (Task 3)

The developer's complete and verbatim response to the checkpoint was the single word "approved," given against the seven numbered `how-to-verify` steps as presented in `15-14-PLAN.md`. They did not separately narrate what they observed at step 5 (whether the `auth` trace lines appeared for the private channel's message-plane key, and whether the zero-answer report was absent) or at step 6 (whether the message was retrieved from a second session).

This SUMMARY records only that bare approval. It does NOT state that the `auth` trace lines were seen, that the zero-answer report was absent, or that the message was retrieved from a second session — none of those were reported, and recording them would fabricate verification evidence. That fabrication is precisely the failure mode that let CR-01 ship past a green suite and the approved 2026-08-15 checkpoint (see this plan's `<objective>`). The approval is real and discharges the checkpoint per Task 3's acceptance criteria, but it carries no per-step detail — the re-verification pass should treat that absence as a known limitation of this discharge, not assume the missing detail was favorable.

## User Setup Required

None. Task 3's checkpoint has been presented and resolved (developer approval, "approved," no per-step detail) — see Checkpoint Approval Detail above.

## Next Phase Readiness

- All three tasks are complete and committed. Tasks 1-2 landed in the prior session; Task 3 (the phase's designated blocking human-verify checkpoint) is discharged in this continuation session, recorded per the constraint above.
- `REQUIREMENTS.md`'s CAUTH-01 checkbox is intentionally left untouched by this plan (`git diff --stat` confirms) — `REQUIREMENTS.md` still marks CAUTH-01 `[x]` Complete while `15-VERIFICATION.md` (2026-08-18) scored it `failed` for the private-channel-send gap this wave closes. This discrepancy is carried forward as an item for the re-verification pass to resolve — it is surfaced here again, not corrected.
- The phase is now ready for a re-verification pass (`re_verification: true`) against `15-VERIFICATION.md`'s two gap entries, per this plan's `<output>` instruction. That pass should weigh two open items together: (1) the CAUTH-01 status discrepancy above, and (2) that Task 3's checkpoint approval carried no per-step detail (see Checkpoint Approval Detail) — the re-verification pass is the right place to decide whether either warrants further action before the phase is declared complete.

---
*Phase: 15-concord-stream-auth-cleanup*
*Plan 15-14 completed: 2026-08-18 (Tasks 1-2 in the initial session; Task 3's checkpoint discharge in a continuation session)*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: packages/concord/src/client/auth.ts
- FOUND: packages/concord/src/helpers/__tests__/keys.test.ts
- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md
- FOUND commit: 61a05514 (Task 1)
- FOUND commit: 63e47387 (formatting fix)
- FOUND commit: 3750f1c1 (Task 2)
- FOUND commit: 474023dc (interim SUMMARY)
- FOUND commit: b59655d5 (Task 3 — checkpoint discharge in 15-VALIDATION.md)
