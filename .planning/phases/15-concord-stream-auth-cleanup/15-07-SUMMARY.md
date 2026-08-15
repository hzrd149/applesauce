---
phase: 15-concord-stream-auth-cleanup
plan: 07
subsystem: auth
tags: [nip-42, concord, relay-auth, rxjs, vitest, structural-guard]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-06's zero-remaining-consumer state — ConcordRelayAuth's only production consumer was itself, so this plan is a pure removal, not a migration"
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-01's StreamSigners/createUserAuthHandler/connectedRelays$/lookupRelayStatus primitives, which are what the public export surface now carries instead of ConcordRelayAuth"
provides:
  - "ConcordRelayAuth, its file, its test, and its public export are gone — zero call sites and zero definitions repo-wide"
  - "A source-tree-walk guard (no-ambient-auth.test.ts) that fails CI on any reintroduction of the five removed mechanisms, any new ambient-auth trigger, any retry-budget override, or any second missing-pubkeys handler, across both packages/concord/src and apps/examples/src/examples/concord"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-root structural guard: cord-citations.test.ts's single-root source-walk-and-assert shape extended to walk both the package source tree and the concord example apps from one test file, each root resolved from import.meta.url with an explicit anti-vacuity floor"

key-files:
  created:
    - packages/concord/src/__tests__/no-ambient-auth.test.ts
  modified:
    - packages/concord/src/client/index.ts
    - packages/concord/src/index.ts
    - packages/concord/src/__tests__/exports.test.ts
    - packages/concord/src/client/auth.ts
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/sync.ts

key-decisions:
  - "The plan's own read_first text claimed the confirming grep 'must show hits only in' four sites, but the actual pre-task grep also matched packages/concord/src/index.ts (a header comment the plan's own <action> separately instructs updating) and two prose citations in community.ts naming 'relay-auth.ts' as a precedent file. Treated as the same same-outcome literal-mismatch class 15-05/15-06 already documented, not a blocking finding — no production consumer was found, only doc-comment prose."
  - "Task 1's acceptance criteria ('grep -rn ConcordRelayAuth ... returns nothing at all' and 'grep -rn relay-auth packages/concord/src returns nothing') are stricter than the plan's files_modified list — satisfying them required also editing auth.ts's doc comment (dropping its 'Replaces ConcordRelayAuth's registry half' citation) and two community.ts doc comments (repointing 'relay-auth.ts' citations to 'auth.ts'), none of which were in the declared files_modified. Applied as Rule 3 (blocking issue: acceptance criteria cannot pass otherwise)."
  - "Task 2's assertion 5 (only client/auth.ts may mention missingPubkeys) initially failed against sync.ts's own doc comment, which quoted the literal identifier while describing the mechanism it forwards. Reworded to paraphrase ('the relay-reported still-needed pubkeys') rather than widen the guard's allowlist, mirroring 15-01's established precedent of paraphrasing forbidden literals in prose rather than special-casing them into a structural guard."

requirements-completed: [CAUTH-03, CAUTH-04]

coverage:
  - id: D1
    description: "ConcordRelayAuth's file, its test, and its export are deleted; the class and every one of its removed mechanisms (Driver, version$, authenticateStreamKeys, registerStreamKeys, streamPubkeys, streamSigners, autoAuthenticate, connected$, authenticated$, lookupStatus) have zero call sites and zero definitions left in packages or apps"
    requirement: CAUTH-03
    verification:
      - kind: other
        ref: "grep -rn 'ConcordRelayAuth\\|authenticateStreamKeys\\|registerStreamKeys\\|autoAuthenticate\\|ensureAuth' packages apps --include='*.ts' --include='*.tsx' matches only the guard's own regex literal (packages/concord/src/__tests__/no-ambient-auth.test.ts:54)"
        status: pass
      - kind: other
        ref: "test ! -f packages/concord/src/client/relay-auth.ts && test ! -f packages/concord/src/client/__tests__/relay-auth.test.ts (both true)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/__tests__/exports.test.ts#should export the expected symbols (StreamSigners present, ConcordRelayAuth absent)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A source-tree-walk guard fails CI automatically on reintroduction of any of the five removed mechanisms, any new ambient-auth trigger (challenge$/authRequiredForRead/authRequiredForPublish), any retry-budget override (authRetries/authTimeout), or any second missing-pubkeys handler outside client/auth.ts — across both packages/concord/src and apps/examples/src/examples/concord"
    requirement: CAUTH-03
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/no-ambient-auth.test.ts (5/5 pass, from repo root and from packages/concord)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Per-operation auth retries/timeouts stay on the upstream defaults with zero concord-side override — the concord half of CAUTH-04's parity claim, now enforced structurally rather than only by convention"
    requirement: CAUTH-04
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/no-ambient-auth.test.ts#no non-test file under packages/concord/src overrides the auth retry count or the auth timeout"
        status: pass
    human_judgment: false
  - id: D4
    description: "The whole applesauce-concord suite and the examples app both build/pass with the class removed and the guard added"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (584/584 pass, 55 files)"
        status: pass
      - kind: other
        ref: "pnpm exec turbo build --filter=applesauce-concord and --filter=applesauce-examples (both exit 0)"
        status: pass
    human_judgment: false

# Metrics
duration: ~10min
completed: 2026-08-15
status: complete
---

# Phase 15 Plan 07: Delete ConcordRelayAuth and Guard Against Its Return Summary

**Deleted `packages/concord/src/client/relay-auth.ts` and its test outright — every consumer had already migrated in plans 15-02 through 15-06 — and added `no-ambient-auth.test.ts`, a two-root source-tree-walk guard (mirroring `cord-citations.test.ts`) that fails CI on any reintroduction of the five removed mechanisms, any new ambient-auth trigger, any retry-budget override, or any second missing-pubkeys handler, closing CAUTH-03.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-08-15
- **Tasks:** 2/2
- **Files modified:** 7 (1 created, 2 deleted, 4 modified)

## Accomplishments

- Deleted `packages/concord/src/client/relay-auth.ts` (the `ConcordRelayAuth` class, its `Driver` interface, `version$` counter, `authenticateStreamKeys`, `registerStreamKeys`, `streamPubkeys`, `streamSigners`, `autoAuthenticate`, `connected$`, `authenticated$`, `lookupStatus`) and its four-suite test file `client/__tests__/relay-auth.test.ts` in full.
- Removed `export * from "./relay-auth.js"` from `client/index.ts` and `"ConcordRelayAuth"` from the inline export snapshot in `__tests__/exports.test.ts` — the public surface now carries `StreamSigners` and not the deleted class.
- Updated three header/doc comments that referenced the deleted file by name or the deleted class by name (`packages/concord/src/index.ts`'s package header, `client/auth.ts`'s module doc comment, and two citation comments in `client/community.ts`) so no dangling reference to a nonexistent file or a removed class survives — required to satisfy the task's own `grep -rn 'ConcordRelayAuth'`/`grep -rn 'relay-auth'` acceptance criteria, not merely the declared `files_modified` list.
- Created `packages/concord/src/__tests__/no-ambient-auth.test.ts`: a 5-assertion source-tree walk over both `packages/concord/src` (54 `.ts` files) and `apps/examples/src/examples/concord` (6 `.ts`/`.tsx` files), each root resolved from `import.meta.url` (not `process.cwd()`), each with an anti-vacuity file-count floor, asserting: (1) both root file counts exceed their floors, (2) neither root names any of the five removed mechanisms (test files included — a reconstructed fixture is exactly the regression this guard exists to catch), (3) no non-test package file subscribes to the relay challenge stream or reads either relay-wide auth-required flag, (4) no non-test package file overrides the auth retry count or timeout, (5) only `client/auth.ts` mentions the relay-supplied missing-pubkeys field outside test files.
- Reworded `sync.ts`'s doc comment (originally quoting `missingPubkeys` literally) to paraphrase the mechanism instead, so assertion 5 passes against prose as well as code — the same paraphrasing convention plan 15-01 established for `auth.ts`'s own doc comments.
- Ran and recorded both RED→GREEN non-vacuity probes required by the task: a throwaway file naming `autoAuthenticate` tripped assertion 2 and named itself in the failure output; a throwaway file naming `missingPubkeys` outside `client/auth.ts`/`__tests__` tripped assertion 5 and named itself in the failure output. Both probes were deleted after confirming RED, and the suite returned to green (`git status --short` clean of probe residue).

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete the class, its test, and its export** - `554d84a3` (feat)
2. **Task 2: Add the source-walk guard against reintroduction** - `d92d239a` (test)

**Plan metadata:** committed separately after this summary (docs)

## Files Created/Modified

- `packages/concord/src/__tests__/no-ambient-auth.test.ts` - new two-root structural guard (5 assertions) proving the five removed mechanisms, ambient-auth triggers, retry-budget overrides, and hand-rolled missing-pubkeys handlers stay absent
- `packages/concord/src/client/relay-auth.ts` - deleted
- `packages/concord/src/client/__tests__/relay-auth.test.ts` - deleted
- `packages/concord/src/client/index.ts` - removed the `relay-auth.js` re-export and its header-comment mention
- `packages/concord/src/index.ts` - package header comment updated ("relay-auth" -> "auth")
- `packages/concord/src/__tests__/exports.test.ts` - removed `"ConcordRelayAuth"` from the inline export snapshot
- `packages/concord/src/client/auth.ts` - dropped the module doc comment's `ConcordRelayAuth` citation; reworded two `relay-auth.ts:NN-NN` line citations to prose (no file/line reference to a deleted file)
- `packages/concord/src/client/community.ts` - repointed two doc-comment citations from `relay-auth.ts` to `auth.ts`
- `packages/concord/src/client/sync.ts` - paraphrased a doc comment that quoted `missingPubkeys` literally, to satisfy the new guard's one-handler assertion

## Decisions Made

- **Grep-scope corrections applied as Rule 3, not held for user review**: the plan's stated four-site grep boundary and its own acceptance criteria disagreed (the acceptance criteria's blanket `grep -rn 'relay-auth' packages/concord/src` and `grep -rn 'ConcordRelayAuth' packages apps` are strictly broader than "only four sites"). Fixed every remaining textual reference — none were live code, all were doc-comment prose — since the acceptance criteria cannot pass otherwise. No production behavior changed.
- **Doc-comment paraphrasing over allowlist widening (sync.ts)**: when the new guard's assertion 5 caught a prose mention of `missingPubkeys` in `sync.ts`, the fix was to reword the comment (matching 15-01's precedent) rather than add `sync.ts` to the guard's exclusion list — keeps the guard's allowlist at exactly one file (`client/auth.ts`), preserving its literal reading as "one handler implementation."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed three dangling doc-comment citations of the deleted `relay-auth.ts`/`ConcordRelayAuth`**
- **Found during:** Task 1, running the acceptance-criteria greps after the declared edits
- **Issue:** `packages/concord/src/index.ts`'s header comment and `client/auth.ts`'s module doc comment both cited the class/file being deleted; `client/community.ts` carried two prose citations of `relay-auth.ts`'s tolerance shape as a precedent. All three would leave `grep -rn 'ConcordRelayAuth'`/`grep -rn 'relay-auth'` non-empty, failing Task 1's stated acceptance criteria.
- **Fix:** Updated `index.ts`'s header word ("relay-auth" → "auth"), dropped `auth.ts`'s `ConcordRelayAuth`-citing sentence and its two `relay-auth.ts:NN-NN` line citations (reworded to prose with no dangling file/line reference), and repointed `community.ts`'s two citations to `auth.ts`'s `lookupRelayStatus`.
- **Files modified:** `packages/concord/src/index.ts`, `packages/concord/src/client/auth.ts`, `packages/concord/src/client/community.ts`
- **Verification:** `grep -rn 'ConcordRelayAuth' packages apps --include='*.ts' --include='*.tsx'` and `grep -rn 'relay-auth' packages/concord/src` both empty; `pnpm exec turbo build --filter=applesauce-concord` exit 0.
- **Committed in:** `554d84a3` (Task 1 commit)

**2. [Rule 3 - Blocking] Reworded `sync.ts`'s doc comment to satisfy the new guard's one-handler assertion**
- **Found during:** Task 2, first run of the new guard test (RED against real source, not the intentional probe)
- **Issue:** `sync.ts`'s doc comment for `syncAuthors` quoted `missingPubkeys` literally while describing how `ctx.onAuthRequired` receives it — assertion 5 flagged it as a second mention of the relay-supplied field outside `client/auth.ts`.
- **Fix:** Reworded the sentence to paraphrase ("the relay-reported still-needed pubkeys") rather than quote the identifier, per 15-01's established precedent for this exact class of guard-vs-documentation tension.
- **Files modified:** `packages/concord/src/client/sync.ts`
- **Verification:** `pnpm vitest run packages/concord/src/__tests__/no-ambient-auth.test.ts` (5/5 pass); `pnpm --filter applesauce-concord test` (584/584 pass).
- **Committed in:** `d92d239a` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3, both confined to doc-comment prose; no production behavior changed)
**Impact on plan:** Both fixes were required for the plan's own stated acceptance criteria to pass. No scope creep beyond doc-comment text.

## Issues Encountered

None beyond the two deviations above. No environment precondition issues this plan — `pnpm exec turbo build --filter=applesauce-concord`/`--filter=applesauce-examples` both succeeded on first try (cache hits for the five upstream packages, cache miss + rebuild for `applesauce-concord` itself, matching prior plans' documented pattern).

## RED->GREEN Non-Vacuity Probes (Task 2, Wave-0 requirement)

**Probe 1 — assertion 2 (the five removed mechanisms).** Added a throwaway file `packages/concord/src/__tests__/throwaway-probe.ts`:

```ts
// TEMPORARY PROBE FILE — asserts the no-ambient-auth guard fires on reintroduction.
export function fakeAutoAuthenticate() {
  return "autoAuthenticate";
}
```

Running `pnpm vitest run packages/concord/src/__tests__/no-ambient-auth.test.ts` against that file produced:

```
FAIL  … > no ambient auth guard (CAUTH-03/D-06) > no file in either root names any of the five removed mechanisms (tests included)
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "/…/packages/concord/src/__tests__/throwaway-probe.ts",
+ ]

Tests  1 failed | 4 passed (5)
```

The failure named exactly the offending file, and only the targeted assertion failed (the other four stayed green). The probe file was deleted; the suite returned to 5/5 green and `git status --short` showed no residue.

**Probe 2 — assertion 5 (one missing-pubkeys handler).** Added a throwaway file `packages/concord/src/throwaway-probe2.ts` (deliberately placed outside `__tests__` and outside `client/auth.ts`, since assertion 5's own exclusion list would otherwise mask it):

```ts
// TEMPORARY PROBE FILE — asserts the no-ambient-auth guard fires on a second
// hand-rolled handler over the relay-supplied missing-pubkeys field.
export function fakeHandler(missingPubkeys: string[] | null) {
  return missingPubkeys;
}
```

Running the same command against that file produced:

```
FAIL  … > no ambient auth guard (CAUTH-03/D-06) > only client/auth.ts implements a handler over the relay-supplied missing-pubkeys field — one handler, not a family of hand-rolled copies
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "/…/packages/concord/src/throwaway-probe2.ts",
+ ]

Tests  1 failed | 4 passed (5)
```

Again the failure named exactly the offending file and only the targeted assertion failed. The probe file was deleted; the suite returned to 5/5 green and `git status --short` showed no residue.

## Next Phase Readiness

- CAUTH-03 marked Complete in REQUIREMENTS.md — `.planning/REQUIREMENTS.md` diff confirms both the checklist item and the traceability table row flipped from Pending to Complete. CAUTH-04 was already Complete (closed by plan 15-01) and is unchanged here.
- `packages/concord/src` now contains zero references to `ConcordRelayAuth` or `relay-auth` (confirmed via the same greps the plan's acceptance criteria specify), and the new guard makes that a property CI enforces going forward, not a one-time cleanup.
- `pnpm --filter applesauce-concord test`: 55 files, 584 tests passing (579 after Task 1's deletion, +5 from the new guard in Task 2).
- `pnpm exec turbo build --filter=applesauce-concord` and `--filter=applesauce-examples` both exit 0 (6/6 and 15/15 tasks).
- This is the last plan in the phase's wave sequence per the frontmatter (`wave: 6`, `depends_on: ["15-06", "15-03"]`); no further consumers of `ConcordRelayAuth` remain to migrate.

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: packages/concord/src/__tests__/no-ambient-auth.test.ts
- FOUND: .planning/phases/15-concord-stream-auth-cleanup/15-07-SUMMARY.md
- FOUND: packages/concord/src/client/relay-auth.ts absent (correctly deleted)
- FOUND: packages/concord/src/client/__tests__/relay-auth.test.ts absent (correctly deleted)
- FOUND: 554d84a3 (Task 1 commit)
- FOUND: d92d239a (Task 2 commit)
