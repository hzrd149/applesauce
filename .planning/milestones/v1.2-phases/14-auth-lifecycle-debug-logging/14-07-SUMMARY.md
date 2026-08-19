---
phase: 14-auth-lifecycle-debug-logging
plan: 07
subsystem: auth
tags: [nip-42, rxjs, typescript, applesauce-relay, changesets]

# Dependency graph
requires:
  - phase: 14-auth-lifecycle-debug-logging
    provides: "RelayAuthWireRequest wire-verb union, describeWireRequest formatter (14-01)"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "Relay.authLog :auth sub-namespace, NIP-42 connection-track logging (14-04)"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "operators/auth-retry.ts's per-operation retry track and outcome-line inventory (14-05)"
provides:
  - "event()'s manufactured publish timeout sets PublishResponse.error, structurally distinguishable from a relay rejection (which never sets it)"
  - "the discriminator inherited automatically by auth()'s authentications$/authenticationResponse$ writes, with no relay.ts change needed at that consumer"
  - "the pending applesauce-relay changeset set aligned with what waves 1-3 of phase 14 actually ship (4 files touched/created)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural discriminator via presence/absence of an optional response field, rather than message-string comparison, at the single construction site of a locally-manufactured response"

key-files:
  created:
    - .changeset/relay-auth-wire-request-context.md
    - .changeset/relay-publish-timeout-marks-itself.md
    - .changeset/relay-auth-lifecycle-debug-logging.md
  modified:
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/relay.test.ts
    - .changeset/relay-operation-scoped-auth-callbacks.md

key-decisions:
  - "The `error` field is set only inside event()'s timeout `with` factory; the relay-rejection `map` immediately above it is left untouched, with a comment recording that the absence of `error` there is load-bearing, not an oversight"
  - "No downstream code changed: auth()'s tap already writes whichever response event() returns into authentications$/authenticationResponse$ verbatim, RelayGroup's aggregation collects each relay's already-shaped response, and errorToPublishResponse already sets the same field for genuinely thrown errors — all three confirmed by reading, not by editing"
  - "A pre-existing relay.test.ts assertion (`should error if no OK received within 10s`) deep-equal-asserted the old error-less timeout shape; updated to assert the new shape plus `error instanceof Error`, as a direct Rule-1 consequence of this plan's own change (same pattern as 14-01's precedent)"
  - "relay-operation-scoped-auth-callbacks.md was edited in place (not superseded) per D-01 — applesauce-relay is still unreleased (6.2.1, re-verified before editing), so the entry never shipped and correcting its wording is the right operation"
  - "No changeset created for applesauce-loaders: 14-02's D-18 hoist changed only derivation timing/count in an unexercised-path scenario, not the emitted log text, so there is no user-visible behavior to describe. No changeset created for applesauce-concord: it remains unreleased for this whole auth surface"

requirements-completed: [ALOG-01]

coverage:
  - id: D1
    description: "event()'s manufactured timeout sets PublishResponse.error; the relay-rejection branch never does"
    requirement: ALOG-01
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts — 'D-11: publish-timeout structural discriminator' (3 tests) plus the updated 'should error if no OK received within 10s'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probes on both halves of the discriminator (see below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The discriminator reaches the shared consumer — Relay.authentications$'s recorded response — not just event()'s returned promise"
    requirement: ALOG-01
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts — 'the discriminator reaches the response recorded in authentications$' (drives authenticate() for a timed-out user and a rejected user)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The pending applesauce-relay changeset set describes this phase's shipped behavior with one change per file and a single-sentence body each"
    requirement: ALOG-01
    verification:
      - kind: other
        ref: "manual inspection of all 4 touched/created changeset files against CLAUDE.md's one-change/one-sentence rule (see Verification below)"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-08-11
status: complete
---

# Phase 14 Plan 07: Publish-Timeout Discriminator and Release-Window Changesets Summary

**`event()`'s locally-manufactured publish timeout now sets `PublishResponse.error`, structurally distinguishable from a relay rejection at both the returned promise and the recorded `authentications$` state, and the pending `applesauce-relay` changeset set now describes what phase 14 actually ships.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-11
- **Tasks:** 3/3
- **Files modified:** 6 (3 changesets created, 1 changeset edited, 2 source/test files modified)

## Accomplishments

- Added an `error: Error` field to `event()`'s `timeout({ ... })` operator's manufactured `PublishResponse`, describing the client-side give-up, while leaving the relay-rejection `map` immediately above it completely untouched — the discriminator is the presence/absence pair itself.
- Confirmed by reading (no edit needed) that `auth()`'s existing `tap` writes whichever response `event()` returns into `authentications$` and the deprecated `authenticationResponse$` mirror automatically, that `RelayGroup`'s aggregate publish needs no group-level change (`git diff packages/relay/src/group.ts` is empty), and that `errorToPublishResponse` in `group.ts` already sets the same field for genuinely thrown errors — the two producers now agree.
- Added a `D-11: publish-timeout structural discriminator` describe block (3 tests) to `relay.test.ts`: a relay rejection carries no `error` property (asserted via explicit absence, not falsiness), a local timeout carries an `error` holding a real `Error`, and the discriminator reaches the response recorded in `Relay.authentications$` for both a timed-out and a rejected `authenticate()` call against two different users.
- Edited `.changeset/relay-operation-scoped-auth-callbacks.md` in place so its context sentence names "the exact NIP-01/NIP-77 request that was refused" instead of the retired three-value operation category, keeping its `minor` bump.
- Created three new single-sentence changesets: `relay-auth-wire-request-context.md` (minor), `relay-publish-timeout-marks-itself.md` (patch), `relay-auth-lifecycle-debug-logging.md` (patch).
- Re-verified `.changeset/relay-publish-response-error-field.md`'s existing sentence still reads correctly now that D-11 gives the field a populated case — no edit needed.

## Task Commits

Each task was committed atomically:

1. **Task 1: event()'s manufactured timeout marks itself with the structural discriminator** - `181eac2d` (feat)
2. **Task 2: Regression test proving both halves of the discriminator** - `5425364e` (test)
3. **Task 3: Changeset set for the release window** - `c5dc2e5f` (docs)

_Plan metadata commit deferred: this is a worktree-isolated parallel executor; STATE.md/ROADMAP.md updates are owned by the orchestrator after the wave completes._

## Files Created/Modified

- `packages/relay/src/relay.ts` - `event()`'s timeout `with` factory now constructs `{ ok: false, from, message: "Timeout", error: new Error(...) }`; the relay-rejection `map` gained a comment recording its absence of `error` as load-bearing
- `packages/relay/src/__tests__/relay.test.ts` - new `D-11: publish-timeout structural discriminator` describe block (3 tests); updated the pre-existing `should error if no OK received within 10s` test to assert the new shape (Rule 1, direct consequence of Task 1)
- `.changeset/relay-operation-scoped-auth-callbacks.md` - body edited in place, bump unchanged (`minor`)
- `.changeset/relay-auth-wire-request-context.md` - new, `minor`
- `.changeset/relay-publish-timeout-marks-itself.md` - new, `patch`
- `.changeset/relay-auth-lifecycle-debug-logging.md` - new, `patch`

## Decisions Made

See `key-decisions` in frontmatter. In summary:
- The `error` field is set at exactly one construction site (`event()`'s timeout branch); every other `PublishResponse` construction in `event()`, `group.ts`'s rejection map, and the shared `errorToPublishResponse` were left alone or confirmed to already agree.
- No message-string comparison was introduced anywhere as a way of recognizing the manufactured timeout — the discriminator is purely structural, per the plan's explicit prohibition.
- `relay-operation-scoped-auth-callbacks.md` was edited, not superseded, because D-01's premise (unreleased `applesauce-relay`, still `6.2.1`) held at the time of editing.
- `applesauce-loaders` and `applesauce-concord` were deliberately given no new changeset — the reasoning (D-18 hoist is derivation-timing-only; concord is wholly unreleased) is recorded rather than left implicit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated a pre-existing `relay.test.ts` assertion broken by Task 1's own shape change**
- **Found during:** Task 1 verification (`pnpm vitest run ... relay.test.ts`)
- **Issue:** `should error if no OK received within 10s` (not declared in this plan's `files_modified`, but exercising the exact code path Task 1 changed) used `toEqual` against the old error-less timeout shape `{ ok: false, from: "wss://test", message: "Timeout" }`. Adding the `error` field made this assertion fail — a direct, in-scope consequence of Task 1's own change, matching 14-01's documented precedent for the same class of fallout.
- **Fix:** Changed the assertion to `toMatchObject` on the stable fields plus `expect(lastValue?.error).toBeInstanceOf(Error)`.
- **Files modified:** `packages/relay/src/__tests__/relay.test.ts`
- **Verification:** `pnpm exec vitest run packages/relay/src/__tests__/relay.test.ts` — 218/218 passed at Task 1's commit point.
- **Committed in:** `181eac2d` (part of Task 1's commit, since it is a direct consequence of that task's own edit, not Task 2's new tests)

---

**Total deviations:** 1 auto-fixed (Rule 1). No scope creep — only the one assertion Task 1's own change directly broke was touched.

## RED→GREEN Non-Vacuity Probes (Task 2, mandated by the plan)

All probes performed via the `Edit` tool directly on `relay.ts`, never via `git stash` (a concurrent agent, 14-06, is running in a sibling worktree right now).

**Probe 1 — timeout branch's `error` field (tests 2 and 3):**
- **RED:** Temporarily removed the `error: new Error(...)` field from the timeout `with` factory. Ran `pnpm exec vitest run packages/relay/src/__tests__/relay.test.ts -t "D-11"` — both "a local timeout carries an error field holding a real Error" and "the discriminator reaches the response recorded in authentications$" failed: `AssertionError: expected undefined to be an instance of Error`.
- **GREEN:** Restored the field. Re-ran the same filter — 3/3 passed.

**Probe 2 — relay-rejection branch wrongly gaining the field (test 1, and incidentally test 3's rejection half):**
- **RED:** Temporarily added `error: new Error("probe")` to the relay-rejection `map`. Ran the same `-t "D-11"` filter — "a relay rejection carries no error field" failed (`expected true to be false` on the absence check), and "the discriminator reaches the response recorded in authentications$" also failed on its rejection-half assertion, since that test independently exercises the same rejection code path via a rejected `authenticate()` call.
- **GREEN:** Reverted the probe edit. Re-ran — 3/3 passed. `git diff packages/relay/src/relay.ts` confirmed empty (no probe residue) before the Task 2 commit.

## Issues Encountered

None beyond the one auto-fixed deviation above.

## Verification

- `pnpm --filter applesauce-relay build` exits 0.
- `pnpm --filter applesauce-relay test` — 286/286 passed (10 files), run three times consecutively for stability (all three green, including `D-15: publish's timeout is suspended across the auth phase` — the known pre-existing flake documented in `deferred-items.md` did not reproduce in any of the three runs).
- `pnpm --filter applesauce-loaders build` exits 0; `pnpm --filter applesauce-loaders test` — 126/126 passed (non-regression check).
- `pnpm --filter applesauce-concord build` exits 0 (after building `applesauce-common` first in this fresh worktree); `pnpm --filter applesauce-concord test` — 559/559 passed (non-regression check).
- `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` (14-06's oracle file) was **not runnable from this worktree** — 14-06 is a concurrent sibling-worktree agent and its file has not yet merged into this branch's history. This verification is deferred to the orchestrator's post-merge check; nothing in this plan's tasks added a new `authLog`/`config.log` emission (Task 1 explicitly avoided adding a log line on the timeout branch, per the plan's prohibition, and `grep -c "this.authLog(" packages/relay/src/relay.ts` stayed at 9, unchanged from 14-04's count), so no perturbation to 14-06's captured-line inventory is expected.
- Acceptance-criteria greps: `awk '/^  event\(/,/^  \/\*\* Send an AUTH message/' packages/relay/src/relay.ts | grep -c "error:"` → 1; `grep -c '=== "Timeout"' packages/relay/src/relay.ts` → 0; `grep -c 'message === ' packages/relay/src/relay.ts` → 0; `git diff packages/relay/src/group.ts` → empty; `grep -c "this.authLog(" packages/relay/src/relay.ts` → 9 (unchanged).
- Changeset inspection (Task 3, all 4 files): each has valid frontmatter naming `applesauce-relay` with `minor` or `patch`; each body is exactly one non-empty paragraph with no line starting with `-`/`*` (the frontmatter `---` delimiters are not body content) and no triple-backtick fence; `relay-publish-timeout-marks-itself.md` and `relay-auth-lifecycle-debug-logging.md` both declare `patch`; no new `applesauce-loaders` or `applesauce-concord` changeset was created (`grep -rlc "applesauce-concord" .changeset/` only matches the pre-existing `.changeset/config.json`); `packages/relay/package.json` version confirmed `6.2.1` immediately before editing.

## Phase Closeout Item (recorded per plan's `<verification>` section, not implemented here)

Phase 13's `deferred-items.md` flagged a connection-drop-mid-auth-wait scenario at very low `keepAlive` as "worth a backlog entry once Phase 14's auth lifecycle logging work gives it a place to land." Phase 14's `:auth` sub-namespace (14-04) and operation-track lines (14-05) now exist, so this scenario is ready to be filed as a backlog entry — it has a concrete log surface to describe the drop against. No ALOG requirement covers it, so it remains out of scope for every plan in this phase; this is a pointer for whoever closes out the phase, not a new task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three `<must_haves>` truths for this plan are satisfied: the discriminator is structural (not message-text-based) at the single construction site, it reaches `authentications$`, and the changeset set describes what this phase's waves 1-3 actually shipped.
- No blockers for 14-06 (concurrent) or phase closeout. This plan touched only `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/relay.test.ts`, and four `.changeset/*.md` files, per its declared `files_modified` scope — it did not touch `14-VALIDATION.md` or `auth-lifecycle-logging.test.ts`, both owned by the concurrent 14-06 agent.

## Self-Check: PASSED

- FOUND: `packages/relay/src/relay.ts` (timeout `error` field, relay-rejection comment)
- FOUND: `packages/relay/src/__tests__/relay.test.ts` (`D-11: publish-timeout structural discriminator` describe block, updated pre-existing test)
- FOUND: `.changeset/relay-operation-scoped-auth-callbacks.md` (edited)
- FOUND: `.changeset/relay-auth-wire-request-context.md`
- FOUND: `.changeset/relay-publish-timeout-marks-itself.md`
- FOUND: `.changeset/relay-auth-lifecycle-debug-logging.md`
- FOUND: commit `181eac2d` (Task 1)
- FOUND: commit `5425364e` (Task 2)
- FOUND: commit `c5dc2e5f` (Task 3)

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-11*
