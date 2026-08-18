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
    description: "A developer has sent a message into a private channel against a live auth-gating relay and confirmed the message actually landed — retrievable from a second client/session, not merely shown by the sending session's optimistic local echo"
    verification: []
    human_judgment: true
    rationale: "No live auth-gating relay and no browser is available to this autonomous executor — this is the phase's designated blocking human-verify checkpoint. Task 3 has not yet been presented to the user in this session; this SUMMARY is committed now, before the checkpoint resolves, so Tasks 1-2's completed work is never lost across a return."

# Metrics
duration: ~9min (Tasks 1-2 only; Task 3 checkpoint outstanding)
completed: 2026-08-18
status: checkpoint_pending
---

# Phase 15 Plan 14: Publish-Answerability Oracle Widened (WR-06) + Full Gate Run — Checkpoint Pending Summary

**The publish-answerability scenario in `community.test.ts` now drives every `ConcordCommunity` publish site — including all four `refound()` sites and `refreshInviteBundles()` — and asserts a checked lower bound on the number of distinct publishing authors instead of an unchecked comment; all four phase gates pass together in one recorded run covering every gap-closure plan (15-09..15-14); Task 3's blocking live-relay private-channel checkpoint has not yet been resolved.**

## Performance

- **Duration:** ~9 min for Tasks 1-2
- **Started:** 2026-08-18T14:24:33+01:00 (Task 1 commit)
- **Completed (Tasks 1-2):** 2026-08-18T14:32:59+01:00 (Task 2 commit)
- **Tasks:** 2/3 (Task 3 is the blocking checkpoint, not yet presented)
- **Files modified:** 4

## Accomplishments

- Extended the publish-answerability scenario (`community.test.ts`) with `refreshInviteBundles([invite])` (ordered mint -> refresh -> revoke, so the refresh runs against a still-live invite) and `refound({ keep: [pubkey], channelRekeys: [{ channelId, keep: [pubkey] }] })` placed LAST (it rolls the epoch), exercising all four `refound()` publish sites — the root-roll and channel-rekey `requireMajority` publishes, the compaction publish, and the snapshot publish — in one call
- Replaced the loop's unchecked "a tenth publish added later fails this loop automatically" comment with a checked assertion: `new Set(recorded.map((r) => r.event.pubkey)).size` must be `>= 10` — a lower bound on distinct publishing authors, with a comment naming what each of the 10 represents
- Raised the anti-vacuity floor from `>4` to `>10` recorded publishes (actual: 19 recorded publishes, 10 distinct authors)
- Proved the extended scenario non-vacuous: reverted `refound()`'s `plan.channelRekeyKeys` registration to register nothing, reran — RED, naming the unanswered channel-rekey publish; restored (byte-identical `git diff`) and reran — GREEN, 66/66
- Ran all four phase gates from the repo root and recorded their real output verbatim: `pnpm --filter applesauce-concord build` (exit 0), `pnpm --filter applesauce-concord test` (exit 0, 55 files / 594 tests / 0 failures / 0 skipped), `pnpm --filter applesauce-examples build` (exit 0), `pnpm build` (exit 0, repo-wide turbo, 18/18 tasks)
- `npx prettier --check` over every file the gap-closure wave (15-09..15-14) touched initially flagged 2 pre-existing files from wave 1/2 (`auth.ts`, `keys.test.ts`); fixed with `npx prettier --write` (formatting-only diff, confirmed by inspection and a green rebuild/retest), committed separately; a second `--check` pass is clean
- Extended `15-VALIDATION.md`: 9 new Per-Task Verification Map rows for the gap-closure tasks that produced an oracle, a new Wave 0 bullet citing each plan's non-vacuity probe, a new pending Manual-Only Verifications row for the private-channel live-relay checkpoint, and a new dated (2026-08-18) full-gate block recorded below the intact 2026-08-15 block — the four pre-existing Per-Task Verification Map rows are unchanged (verified via `git diff`, additions only)

## Task Commits

Each completed task was committed atomically:

1. **Task 1: Make the publish-answerability scenario cover every publish a community makes** - `61a05514` (test)
2. **Formatting fix (part of Task 2's prettier gate)** - `63e47387` (style)
3. **Task 2: Run every phase gate together and extend the validation contract** - `3750f1c1` (docs)
4. **Task 3: Human verification — a private-channel send against a live auth-gating relay** - BLOCKING CHECKPOINT, not yet presented to the user in this session

**Plan metadata:** not yet issued — the checkpoint has not resolved. This SUMMARY is committed now so Tasks 1-2's completed work is never lost across the return.

## Files Created/Modified

- `packages/concord/src/client/__tests__/community.test.ts` - Extended the publish-answerability scenario with `refreshInviteBundles()`/`refound()`, added the distinct-authors lower-bound assertion, raised the anti-vacuity floor
- `packages/concord/src/client/auth.ts` - Formatting-only: line-wrap fix in `StreamAuthContext.relay`'s type and the `authLog` call (pre-existing from plan 15-10, flagged by this plan's `npx prettier --check`)
- `packages/concord/src/helpers/__tests__/keys.test.ts` - Formatting-only: line-wrap fix in a multi-line `wrapForTarget` call (pre-existing from plan 15-09)
- `.planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md` - 9 new Per-Task Verification Map rows, a gap-closure Wave 0 non-vacuity bullet, an extended Manual-Only Verifications table, and a new dated full-gate run block

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

None beyond the pre-existing formatting issue documented above under Deviations.

## User Setup Required

None for Tasks 1-2. Task 3 requires the user to run the `how-to-verify` steps in `15-14-PLAN.md` against a live auth-gating relay and a browser — see the CHECKPOINT REACHED message returned alongside this SUMMARY.

## Next Phase Readiness

- Tasks 1-2 are complete and committed; Task 3 (the phase's designated blocking human-verify checkpoint) is outstanding
- `REQUIREMENTS.md`'s CAUTH-01 checkbox is intentionally left untouched by this plan (`git diff --stat` confirms) — the Complete-vs-failed discrepancy against `15-VERIFICATION.md`'s 2026-08-18 score is surfaced in `15-VALIDATION.md` for the re-verification pass, not corrected here
- Once Task 3 resolves (approved or a specific failure reported), the phase is ready for a re-verification pass (`re_verification: true`) against `15-VERIFICATION.md`'s two gap entries — per this plan's `<output>` instruction

---
*Phase: 15-concord-stream-auth-cleanup*
*Tasks 1-2 completed: 2026-08-18*
*Task 3 (blocking human checkpoint): outstanding*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: packages/concord/src/client/auth.ts
- FOUND: packages/concord/src/helpers/__tests__/keys.test.ts
- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md
- FOUND commit: 61a05514 (Task 1)
- FOUND commit: 63e47387 (formatting fix)
- FOUND commit: 3750f1c1 (Task 2)
