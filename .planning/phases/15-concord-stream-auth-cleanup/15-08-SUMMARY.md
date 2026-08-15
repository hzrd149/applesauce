---
phase: 15-concord-stream-auth-cleanup
plan: 08
subsystem: auth
tags: [nip-42, concord, relay-auth, requirements, validation]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-07's deletion of ConcordRelayAuth and the no-ambient-auth structural guard — the state this closeout plan verifies and documents"
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-04's CAUTH-02 scoped-AUTH oracle and CAUTH-04 no-suppression assertions in community.test.ts — the probes this plan's validation contract cites"
provides:
  - "CAUTH-03 and Phase 15 success criterion 3 amended to name the user-key autoAuthenticate option and the invite watcher's two flag readers explicitly, matching what plans 15-04/15-06/15-07 actually built"
  - "A recorded, together, all-green run of all four phase gates (concord build, concord test, examples build, repo-wide turbo build)"
  - "15-VALIDATION.md's Per-Task Verification Map, Wave 0 checklist, and Sign-Off completed and substantiated by plan SUMMARY citations"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md

key-decisions:
  - "Task 1's amendment extends CAUTH-03's existing sentence (adds the autoAuthenticate clause and the invite-watcher flag-reader clause) rather than rewriting the requirement, per the plan's explicit instruction to keep the diff reading as a clarification of scope, not a substitution"
  - "The Per-Task Verification Map's four rows are keyed to the plans that actually produced each oracle (15-01 for CAUTH-01's base scoping oracle and CAUTH-04's no-dedupe unit test, 15-04 for the CAUTH-02 isolation oracle and CAUTH-04's no-suppression assertion, 15-07 for the CAUTH-03 structural guard) rather than to this plan, since this plan authored no new test — it only recorded and cross-referenced existing coverage"

requirements-completed: [CAUTH-01, CAUTH-02, CAUTH-03, CAUTH-04]

# Coverage metadata — all three coverage items discharged; Task 3's human-verify checkpoint
# was approved by the user on 2026-08-15 against a live auth-gating relay.
coverage:
  - id: D1
    description: "CAUTH-03 (REQUIREMENTS.md) and Phase 15 success criterion 3 (ROADMAP.md) amended to name the user-key autoAuthenticate option and the invite watcher's two flag readers, with the widening's rationale recorded"
    requirement: CAUTH-03
    verification:
      - kind: other
        ref: "git diff --stat .planning/ROADMAP.md .planning/REQUIREMENTS.md shows 2 files changed, 2 insertions(+), 2 deletions(-) — scoped edits only"
        status: pass
      - kind: other
        ref: "grep -c '^### Phase' .planning/ROADMAP.md unchanged at 13 before and after; grep -n 'Phase 15' .planning/ROADMAP.md still shows all four numbered criteria"
        status: pass
    human_judgment: false
  - id: D2
    description: "All four phase gates (concord build, concord test, examples build, repo-wide turbo build) pass together in one recorded run, and 15-VALIDATION.md's contract is completed and substantiated by plan SUMMARY citations"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (55 files, 584 tests, 0 failures, 0 skipped)"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-concord build; pnpm --filter applesauce-examples build; pnpm build (repo-wide turbo, 18/18 tasks) — all exit 0"
        status: pass
      - kind: other
        ref: "grep -rn 'ConcordRelayAuth' packages apps --include='*.ts' --include='*.tsx' returns exactly one hit — the guard's own regex literal"
        status: pass
    human_judgment: false
  - id: D3
    description: "A developer has exercised all four migrated concord example apps against a live auth-gating relay and confirmed the auth-only-after-refusal property, or reported a specific failure"
    verification:
      - kind: other
        ref: "Human verification approved by the user on 2026-08-15, running steps 1-6 of the checkpoint's how-to-verify against a live auth-gating relay"
        status: pass
    human_judgment: true
    rationale: "No live relay or browser is available to this executor. This is the phase's designated blocking human-verify checkpoint (T-15-18's mitigation) — automation cannot observe wire-level auth timing against a real NIP-42 challenge, only fake in-suite pools which never open a socket. The user ran the checkpoint's steps directly and returned an explicit approval, confirming all six steps behave as expected, including the key observable in step 3: `auth` trace lines appear only after a relay refuses a request, not on connect and not on every status change."

# Metrics
duration: ~25min (Tasks 1-2) + human verification (Task 3, approved same day)
completed: 2026-08-15
status: complete
---

# Phase 15 Plan 08: Requirement Amendment, Full Gate Run, and Validation Contract Summary

**CAUTH-03 and Phase 15's third success criterion now name the user-key `autoAuthenticate` widening explicitly, all four phase gates (concord build/test, examples build, repo-wide turbo build) pass together in one recorded run, `15-VALIDATION.md`'s contract is fully substantiated, and the plan's blocking human-verification checkpoint against a live auth-gating relay was approved by the user — the phase is closed.**

## Performance

- **Duration:** ~25 min for Tasks 1-2; Task 3 approved same day
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments

- Amended `.planning/REQUIREMENTS.md` CAUTH-03: its mechanism list now names the client-wide `autoAuthenticate` user-key option and the invite watcher's two relay-wide auth-required flag readers, alongside the original five stream-key mechanisms, with one added sentence recording why — the same ambient status-driven pattern drove both key classes, and leaving the user half behind would have kept relay-status-driven authentication alive in the package.
- Mirrored the same amendment onto `.planning/ROADMAP.md`'s Phase 15 success criterion 3, with no other content in the Phase 15 block disturbed (goal line, dependency line, requirements line, and criteria 1/2/4 unchanged).
- Ran all four phase gates from the repo root, in order, and recorded their real output: `pnpm --filter applesauce-concord build` (exit 0), `pnpm --filter applesauce-concord test` (exit 0, 55 files / 584 tests / 0 failures / 0 skipped), `pnpm --filter applesauce-examples build` (exit 0), `pnpm build` (exit 0, repo-wide turbo, 18/18 tasks, FULL TURBO).
- Completed `.planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md`: replaced all four placeholder `15-XX-XX` rows in the Per-Task Verification Map with real rows citing plans 15-01/15-04/15-07 and their threat refs (T-15-01, T-15-09, T-15-04, T-15-15, T-15-16); ticked every Wave 0 Requirements checkbox, each citing the plan SUMMARY carrying its probe; ticked the Validation Sign-Off checklist; set frontmatter to `status: complete`, `nyquist_compliant: true`, `wave_0_complete: true`; recorded the full gate output verbatim and the Approval date.
- The user ran the Task 3 human-verification checkpoint (steps 1-6 of `15-08-PLAN.md`'s `how-to-verify`) against a live auth-gating relay and returned an explicit "approved," confirming the key observable: `auth` trace lines appear only after a relay refuses a request — not on connect, not on every status change.

## Task Commits

Each completed task was committed atomically:

1. **Task 1: Amend CAUTH-03 and the phase success criterion to match what shipped** - `26bc60a6` (docs)
2. **Task 2: Run every phase gate together and complete the validation contract** - `83b34b12` (docs)
3. **Task 3: Human verification against a live auth-gating relay** - approved by the user 2026-08-15 (blocking checkpoint; see below); recorded in this SUMMARY's closing commit

**Plan metadata:** the mid-plan SUMMARY (committed at `853973c4`, before the checkpoint was resolved) is superseded by this final version, per the executor's explicit instruction not to lose the completed automated work while the checkpoint was outstanding.

## Files Created/Modified

- `.planning/REQUIREMENTS.md` - CAUTH-03's mechanism list widened to name `autoAuthenticate` and the invite watcher's flag readers, plus the rationale sentence
- `.planning/ROADMAP.md` - Phase 15 success criterion 3 mirrors the same amendment
- `.planning/phases/15-concord-stream-auth-cleanup/15-VALIDATION.md` - Per-Task Verification Map, Wave 0 checklist, and Sign-Off completed; frontmatter flipped to `status: complete`, `nyquist_compliant: true`, `wave_0_complete: true`

## Decisions Made

- **Amendment as extension, not rewrite**: CAUTH-03's existing sentence gained a clause rather than being restated, per the plan's explicit instruction that the diff should read as a clarification of scope. Confirmed scoped via `git diff --stat` (2 lines changed in each file) and an unchanged `### Phase` heading count (13) in `ROADMAP.md`.
- **Per-Task Verification Map rows keyed to originating plans, not to 15-08**: this plan authored no new test of its own — Task 2 is a recording and cross-referencing step, not a test-writing step — so each row cites the plan (15-01, 15-04, or 15-07) whose task actually produced the oracle.

## Deviations from Plan

None - Tasks 1 and 2 executed exactly as written, with all stated acceptance criteria verified before committing.

## Issues Encountered

None for Tasks 1-2. Task 3 cannot be performed by this executor: it requires a live auth-gating relay and a browser, neither of which is available in this environment. This is expected — the plan's own text states the checkpoint "cannot be performed" by an autonomous executor and must stop here.

## Checkpoint: Task 3 — Human Verification Against a Live Auth-Gating Relay

**Status: APPROVED. The phase is closed.**

**What was built:** Concord's client-wide stream-signer registry and its ambient per-relay NIP-42 drivers are gone. Every community and private-channel operation — the epoch-walk syncs, the live subscription, and all twelve publishes — now answers a relay's `auth-required:` refusal on demand, using only the keys that scope holds and only the pubkeys that operation asked about. The user's own publishes and list reads are answered by a separate client-wide user handler. The standing `authenticated` status field is gone from all three status types; an auth failure now shows up in the existing `error` field instead. The four concord example apps were migrated onto the same pattern, and the manual "Authenticate" banner in the admin example was removed because there is nothing to do proactively any more.

Automated coverage is green (this plan's own gate run, above). What automation cannot cover is whether the examples still work against a real auth-gating relay — the fake pools in the suite never open a socket.

**What the human did — verification steps:**

1. Ran `pnpm dev` from the repo root and opened the examples app in a browser.
2. Opened the `concord/rumor-stores` example against a live auth-gating relay and loaded a held community. Confirmed: the epoch walk completed and plane messages rendered.
3. Opened the browser devtools console with `localStorage.debug = "applesauce:concord:*"` set and reloaded. Confirmed the key observable: `auth` trace lines appeared only AFTER a relay refused a request — not on connect, and not on every status change.
4. Opened `concord/crypto-history` and walked two epochs against the same relay. Confirmed: each epoch's plane counts populated.
5. Opened `concord/direct-invites` and accepted an invite. Confirmed: the guestbook Join published without an auth error.
6. Opened `concord/admin-management`. Confirmed: the status bars showed phase and connected badges with no "stream keys authed" badge and no "Inbox authentication required" banner.

**Resume signal received:** "approved" — the user confirmed all six steps behave as expected. No specific numeric or textual observations beyond the step-by-step confirmations above were reported; nothing is fabricated past what the user stated.

**Outcome:** No failure reported. The phase's designated blocking human-verify checkpoint (T-15-18's mitigation) is discharged.

## Next Phase Readiness

- All three tasks are complete. Requirements CAUTH-01 through CAUTH-04 are Complete in `REQUIREMENTS.md` (unchanged by this plan; already Complete from earlier plans, now additionally corroborated by Task 3's live-relay approval).
- Phase 15 (concord-stream-auth-cleanup) is closed: `15-VALIDATION.md`'s contract is fully substantiated and its Manual-Only Verification row is discharged, `ROADMAP.md`'s Phase 15 plan count and Progress table are updated to 8/8 Complete, and `STATE.md`'s position/decisions/session are advanced past 15-08.
- No follow-up plan is required by this closeout; any future concord auth work is a new phase.

---
*Phase: 15-concord-stream-auth-cleanup*
*Tasks 1-2 completed: 2026-08-15*
*Task 3 (blocking human checkpoint): approved 2026-08-15*
