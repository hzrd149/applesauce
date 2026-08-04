---
phase: quick-260804-gzq
plan: exclude-ephemeral-kinds-from-concordobse
subsystem: concord
tags: [concord, nostr, nip-01, rumor-store, roster-fold, voice-presence]

requires:
  - phase: phase-11
    provides: WIRE-02 (kind-23313 voice-presence early-return removed from the receive funnel)
provides:
  - ConcordObservedAuthorsModel excludes NIP-01 ephemeral kinds (20000-29999) from the observed-authors fold
  - A regression test pinning rewireState's observed consumer set to {current-epoch guestbook, channel:*}
affects: [concord-roster-fold, concord-voice-presence, concord-client-community]

tech-stack:
  added: []
  patterns:
    - "Range-based kind exclusion via nostr-tools' isEphemeralKind (re-exported from applesauce-core/helpers/event), never a single-kind special case"

key-files:
  created: []
  modified:
    - packages/concord/src/models/observed.ts
    - packages/concord/src/models/__tests__/index.test.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "Filter placed in ConcordObservedAuthorsModel (models/observed.ts), not in the generic observedAuthors reducer in models/utils.ts — 'observation means durable authorship' is a Concord fold policy, not a generic-reducer concern."
  - "Test kinds sourced from the vendored spec fixture (VOICE_PRESENCE_JOINED_EXAMPLE) and NIP-01 range literals, never from the implementation's own isEphemeralKind or VOICE_PRESENCE_KIND constant, so the tests are an independent check."

requirements-completed: []

coverage:
  - id: D1
    description: "A voice-presence beacon newer than a member's Leave does NOT re-add them to members$"
    verification:
      - kind: unit
        ref: "packages/concord/src/models/__tests__/index.test.ts#a voice-presence beacon does not resurrect a departed member"
        status: pass
    human_judgment: false
  - id: D2
    description: "A voice-presence beacon newer than an authorized Kick does NOT re-add the kicked member to members$"
    verification:
      - kind: unit
        ref: "packages/concord/src/models/__tests__/index.test.ts#a voice-presence beacon does not resurrect a kicked member"
        status: pass
    human_judgment: false
  - id: D3
    description: "A durable chat message newer than a Leave STILL re-adds the author to members$ (fix does not over-narrow)"
    verification:
      - kind: unit
        ref: "packages/concord/src/models/__tests__/index.test.ts#a durable message still re-adds a departed member (mirror of the beacon case)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exclusion is by NIP-01 range (20000-29999), not enumeration: 20000/23313/29999 excluded, 19999/30000 observed"
    verification:
      - kind: unit
        ref: "packages/concord/src/models/__tests__/index.test.ts#excludes the ephemeral kind range (20000-29999) by NIP-01 boundary, not enumeration"
        status: pass
    human_judgment: false
  - id: D5
    description: "ConcordObservedAuthorsModel's consumer set is pinned to {current-epoch guestbook, channel:*} — widening rewireState's observed selection fails a test"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#pins the observed-authors consumer set to {current-epoch guestbook, channel:*}"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-04
status: complete
---

# Quick Task 260804-gzq: exclude ephemeral kinds from the observed-authors fold Summary

**`ConcordObservedAuthorsModel` now filters NIP-01 ephemeral kinds (20000-29999) via `isEphemeralKind` before folding, closing the voice-presence-beacon resurrection hole opened by WIRE-02, with a consumer-set pin preventing future widening.**

## Performance

- **Duration:** ~15 min (execution only; environment already verified clean at 6cd06631)
- **Completed:** 2026-08-04
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `ConcordObservedAuthorsModel` (`packages/concord/src/models/observed.ts`) filters the timeline before folding: rumors whose `kind` satisfies `isEphemeralKind` (NIP-01's `20000 <= kind < 30000`) are dropped, so a voice-presence beacon (kind 23313) can never resurrect a departed or kicked member via the observed-authors path.
- Four regression tests added to `models/__tests__/index.test.ts`: beacon-vs-departed, the durable-message mirror (proves no over-narrowing), beacon-vs-kicked, and a five-kind range boundary table (19999/20000/23313/29999/30000 → true/false/false/false/true).
- One test added to `client/__tests__/community.test.ts` pinning `rewireState`'s observed selection to exactly `{current-epoch guestbook, channel:*}`, built totally over whatever plane stores exist (not an enumerated list), so a future plane addition doesn't silently escape the boundary.
- All three mandatory non-vacuity probes (P1, P2, P3) executed in place, observed RED, then restored to GREEN — see below.

## Task Commits

1. **Task 1: exclude ephemeral kinds + four regression tests** - `188210bc` (fix)
2. **Task 2: pin ConcordObservedAuthorsModel's consumer set** - `b20cde05` (test)

**Plan metadata:** pre-dispatched at `6cd06631` (docs commit already present before execution began; this run added no separate plan-metadata commit — final docs/STATE.md commit is handled by the orchestrator per this run's constraints).

## Files Created/Modified

- `packages/concord/src/models/observed.ts` - Filters ephemeral kinds (20000-29999) out of the timeline before folding into `observedAuthors`; doc comment states the durable-authorship contract and the range-not-enumeration rule.
- `packages/concord/src/models/__tests__/index.test.ts` - Adds `KickFactory` and `VOICE_PRESENCE_JOINED_EXAMPLE` imports plus five fresh test pubkeys (CAROL/DAVE/ERIN/FRANK/GRACE); adds the four regression tests.
- `packages/concord/src/client/__tests__/community.test.ts` - Adds one test pinning the observed consumer set, modeled on the existing "Open Question 1" test's engine setup.

## Decisions Made

- Filter lives in `ConcordObservedAuthorsModel`, not `observedAuthors`/`models/utils.ts` — per plan, `models/community.ts:45` is `observedAuthors`'s only caller and "observation means durable authorship" is fold policy, not a generic-reducer concern.
- Test beacon kind sourced from the vendored spec fixture `VOICE_PRESENCE_JOINED_EXAMPLE` (not the implementation's own `VOICE_PRESENCE_KIND` constant), and `isEphemeralKind` was never imported into either test file — both per plan, to keep the tests an independent check rather than the implementation asserting against itself.
- KICK_KIND rumor for the kicked-member test is signed by OWNER with no `vac` tag, relying on `vacVerifier`'s owner exemption (`rotator === owner ⇒ true`, verified by reading `helpers/permissions.ts:105-106`) — matches the plan's stated rationale exactly.

## Non-Vacuity Probe Results (mandatory, recorded verbatim from observed output)

**P1 — under-narrow** (temporarily reverted `observed.ts` to the unfiltered `store.timeline([{}]).pipe(map(observedAuthors))` form):
- RED: 3 of 7 tests failed — `a voice-presence beacon does not resurrect a departed member`, `a voice-presence beacon does not resurrect a kicked member`, and `excludes the ephemeral kind range...` (failed at its first assertion, `lowerBound` (kind 20000) resurrecting when it should not).
- Restored the fix; re-ran: 7/7 GREEN.

**P2 — over-narrow** (temporarily inverted the predicate to `rumors.filter((r) => isEphemeralKind(r.kind))`, keeping only ephemeral kinds):
- RED: 5 of 7 tests failed. As the plan required: `a durable message still re-adds a departed member (mirror of the beacon case)` and the durable rows of `excludes the ephemeral kind range...` (both `below`/19999 and `above`/30000 assertions) failed. Additionally — beyond the plan's literal prediction, and a stronger confirmation of over-narrowing — `a voice-presence beacon does not resurrect a departed member` and `a voice-presence beacon does not resurrect a kicked member` also failed (with the predicate inverted, the beacon itself now survives the filter and is counted as observed, so it correctly re-resurrects ALICE — exposing that "invert the predicate" is a stronger perturbation than a filter that merely drops everything). The pre-existing test `combines control, guestbook, and observed authors into community state` also failed collaterally (BOB's durable chat-kind message was filtered out under the inverted predicate).
- Restored the fix; re-ran: 7/7 GREEN. Confirmed `git diff` against `observed.ts` was clean before restoring the fix state.

**P3 — widening** (temporarily changed `rewireState`'s observed selection in `client/community.ts` from `[...this.stores.entries()].filter(([key]) => key.startsWith("channel:")).map(([, s]) => s)` to `[...this.stores.entries()].map(([, s]) => s)`):
- RED: the new test failed with `expected true to be false` on a non-observed-plane author (a `control`/`dissolved` store author) unexpectedly appearing in `members` — exactly the widening hazard the test pins.
- Restored `client/community.ts` to the original `channel:`-prefix filter; `git diff` on the file confirmed byte-identical to HEAD before restoring; re-ran: test GREEN.

## Deviations from Plan

None — plan executed exactly as written. One observational note (not a deviation): P2's actual failure set (5 tests) was broader than the plan's literal prediction (2 tests: "Test 2 and both durable rows of test 4"), because inverting the predicate also makes the beacon itself count as observed, which additionally breaks tests 1 and 3. This is a stronger, not weaker, confirmation of over-narrowing and required no plan or code change — documented here per the plan's instruction to record observed (not merely predicted) results.

One incidental cleanup, not a deviation from the plan's scope: `pnpm build`/`pnpm test` invocations triggered unrelated `pnpm-lock.yaml` churn (an unrelated `nostr-tools`/`nostr-editor` peer-resolution drift, pre-existing in the workspace, unrelated to this task's files). This was reverted via `git checkout -- pnpm-lock.yaml` before every commit so no unrelated lockfile change is included in either task commit.

## Issues Encountered

None. Both source and test changes worked on the first implementation pass; full-suite runs were green throughout apart from the deliberate, mandatory, and fully-reverted P1/P2/P3 probes.

## Verification

- `pnpm --filter applesauce-concord build` — exit 0 (`tsc` clean) after Task 1 and after Task 2.
- `pnpm --filter applesauce-concord test` (full suite, not just the touched files) — 54 test files / 558 tests passing after Task 1; 54 test files / 559 tests passing after Task 2.
- `packages/concord/src/__tests__/cord-citations.test.ts` and `packages/concord/src/__tests__/exports.test.ts` are part of that full-suite run and passed — no CORD-citation regressions (only "NIP-01" was cited in the new doc comment, no `CORD-NN §X` string added) and no export-snapshot churn (no new exports).

## Close-out

- `.planning/todos/pending/11-verify-followups.md` moved to `.planning/todos/completed/11-verify-followups.md` with `status: completed`, `completed: 2026-08-04`, `resolved_by: quick-260804-gzq` added to frontmatter. Left uncommitted for the orchestrator's docs commit per this run's constraints.
- `.planning/STATE.md`'s Quick Tasks Completed table updated with a `260804-gzq` row (commits `188210bc, b20cde05`). Left uncommitted for the orchestrator's docs commit per this run's constraints.
- No changeset added — `packages/concord` is unreleased (standing project rule, confirmed via memory and PLAN.md).
- ROADMAP.md not touched (quick tasks are separate from planned phases, per this run's constraints).

## Next Phase Readiness

- The observed-authors fold is now range-safe against any future ephemeral-range kind (not just 23313), and the consumer-set boundary in `rewireState` is regression-pinned.
- Still open (explicitly out of scope, unchanged by this task, both noted in the original todo): `kick()` does not rotate the channel key, so a kicked client's beacons still land in the channel store (harmlessly filtered now, but exposure to `channel:*` continues until an admin rotates); and Open Question 1's known residual (an excluded member's OLD public-channel durable message still counting as observed post-Refounding) remains deferred to Phase 7 channel-keying, pinned by its own existing regression test.

---
*Quick task: 260804-gzq*
*Completed: 2026-08-04*

## Self-Check: PASSED

- FOUND: packages/concord/src/models/observed.ts
- FOUND: packages/concord/src/models/__tests__/index.test.ts
- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: .planning/todos/completed/11-verify-followups.md (and pending copy confirmed removed)
- FOUND: .planning/quick/260804-gzq-exclude-ephemeral-kinds-from-concordobse/260804-gzq-SUMMARY.md
- FOUND commit: 188210bc (fix(concord): exclude ephemeral kinds from the observed-authors fold)
- FOUND commit: b20cde05 (test(concord): pin the observed-authors consumer set to guestbook + channel planes)
