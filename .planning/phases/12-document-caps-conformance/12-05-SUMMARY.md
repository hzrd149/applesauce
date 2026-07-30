---
phase: 12-document-caps-conformance
plan: 05
subsystem: concord
tags: [concord, community-list, nip44, cord-02, wire-08, d-06, d-07, d-08]

# Dependency graph
requires:
  - phase: 12-document-caps-conformance
    provides: "12-01's vendored CORD-02 §8 fixtures (CORD_COMMUNITY_LIST_MEMBERSHIP_CAP, CORD_COMMUNITY_LIST_CAP_SENTENCE); 12-02's nostr-tools ^2.24 bump lifting the NIP-44 plaintext ceiling; 12-03's invite-side byte-cap removal precedent; 12-04's caps.ts/editMetadata write-side name cap that repointed two client.test.ts fixtures away from padding via name"
provides:
  - "COMMUNITY_LIST_MAX_MEMBERSHIPS (50), transcribed from CORD-02 §8, as the Community List's ONLY remaining bound"
  - "recordJoin as the sole enforcement point for the 50-membership cap, counting live memberships only via liveCommunities"
  - "saveCommunityList publishing unconditionally with an honest, unconditional size trace instead of a byte-cap refusal"
affects: ["12-07 (opens the Community List document root, edits helpers/community-list.ts and client/client.ts)", "12-09 (adds documentExtras to client.ts)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Membership-count enforcement lives at the single join-time write path (recordJoin), never on the merge paths (loadMirror/watchLists), mirroring the pre-existing byte-ceiling asymmetry documented in the same doc comment"
    - "A structural export-key-set guard (Object.keys over a namespace import) pins a symbol's permanent removal, distinct from a behavioral test"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/community-list.ts
    - packages/concord/src/client/client.ts
    - packages/concord/src/helpers/__tests__/community-list.test.ts
    - packages/concord/src/client/__tests__/client.test.ts

key-decisions:
  - "Reworded LIST_MAX_BYTES's doc comment to record why its premise moved (NIP-44 max_plaintext_size now 4294967295) and to carry the D-21 warning, rather than deleting the constant — D-08's diagnostic still needs it"
  - "Test F (D-06 live-only counting) needed BOTH tombstoned entries and duplicate raw entries for live communities to be non-vacuous, since mergeCommunities' Map-based dedup plus pruneDeadEntries running on every death transition (leave/handleRemoved/reconcileCommunities) makes this.list.length and liveCommunities(...).length structurally equal in every state reachable through the public API alone"
  - "Added a dedicated white-box test that writes ConcordClient's private list field directly to prove recordJoin's guard reads the derived live count rather than a raw array length that happens to coincide with it in every normal integration path — this is the test the mutation-1 non-vacuity check actually falls through"
  - "Rewrote the pre-existing CR-02 recoverability test (12.3-12 era) whose premise (\"an already-wedged list cannot publish\") became false under D-07/D-08 — it now asserts the oversized entry publishes immediately and a second publish after leave() proves the bytes are still pruned"

requirements-completed: [WIRE-08]

coverage:
  - id: D1
    description: "recordJoin refuses a local join that would be the 51st live membership, naming the live count and the cap"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#refuses the 51st live membership, naming the live count and the cap, and communities$ still holds 50"
        status: pass
    human_judgment: false
  - id: D2
    description: "recordJoin admits the join that would be exactly the 50th live membership (the boundary one past the refusal)"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#admits the membership that would be the cap-th (the 50th), the boundary the refusal above sits one past"
        status: pass
    human_judgment: false
  - id: D3
    description: "The cap counts LIVE memberships only — tombstoned entries and duplicate raw entries for an already-live community do not consume the budget"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#D-06: the cap counts LIVE memberships only"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#recordJoin's guard reads the DERIVED live count, not this.list's raw array length"
        status: pass
    human_judgment: false
  - id: D4
    description: "Merged overflow from another device (loadMirror merging a document already past the cap) is tolerated — neither throws nor discards entries"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#D-06: merged overflow from another device is TOLERATED"
        status: pass
    human_judgment: false
  - id: D5
    description: "An oversized Community List (past the historical LIST_MAX_BYTES reference figure) publishes rather than being withheld, and the size trace is still emitted"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#a document whose serialized size exceeds the historical reference figure still publishes, with the size trace still emitted"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#IN-01: the size trace includes the tombstone byte total and omits the largest-entry clause when the entry list is empty"
        status: pass
    human_judgment: false
  - id: D6
    description: "The per-entry byte ceiling (COMMUNITY_LIST_MAX_ENTRY_BYTES) and its predicate (communityListWithinByteCap) are permanently removed, and no comment in either source file cites a deleted constant"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/community-list.test.ts#the module's exports no longer include a within-cap predicate or a per-entry ceiling, but still expose the diagnostic-only measurement helpers"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-07-30
status: complete
---

# Phase 12 Plan 05: Community List 50-Membership Cap Summary

**Swapped the Community List's serialized-byte ceiling for the CORD-02 §8 50-membership protocol constant, enforced solely at `recordJoin` over live memberships, with `saveCommunityList` now publishing unconditionally.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-30T11:51:05+01:00
- **Completed:** 2026-07-30T12:14:42+01:00
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Deleted `COMMUNITY_LIST_MAX_ENTRY_BYTES` (with its derivation doc block) and `communityListWithinByteCap` outright (D-07), leaving no tombstone comment naming either symbol (D-10)
- Added `COMMUNITY_LIST_MAX_MEMBERSHIPS = 50`, transcribed verbatim from CORD-02 §8, as the Community List's only remaining bound
- `recordJoin` now refuses a local join that would be the 51st live membership (derived via `liveCommunities`, never `this.list.length`), admits the 50th, and leaves `loadMirror`/`watchLists` refusal-free so merged overflow from another device is tolerated (D-06's documented asymmetry)
- `saveCommunityList` dropped its byte-cap refusal entirely — it now always publishes and always emits an unconditional, honest size trace (bytes, entry count, tombstone bytes, largest entry) with no cap framing, no fraction, and no withheld-publish clause; the refusal-era `console.warn` is gone
- Rewrote the byte-cap test suites into D-06/D-07/D-08 behavior tests: a structural export-key guard makes the removal permanent, the arithmetic-derivation test became a fixture-anchored 50-membership assertion, the over-cap-rejects test inverted to record-and-publish, and four new tests plus one white-box test cover the 51st-refused/50th-admitted boundary, live-only counting, tolerated merged overflow, and oversized-list publication
- Marked `WIRE-08` complete in REQUIREMENTS.md, rewording its text to drop the now-false "alongside the already-enforced byte cap" clause per D-07

## Task Commits

1. **Task 1: Delete the per-entry ceiling and the within-cap predicate; add COMMUNITY_LIST_MAX_MEMBERSHIPS; reword LIST_MAX_BYTES to diagnostic-only** - `5e3b1b34` (feat)
2. **Task 2: Swap recordJoin's guard from bytes to live memberships; drop saveCommunityList's refusal while keeping its diagnostic** - `8d01d669` (feat)
3. **Task 3: Rewrite the byte-cap tests into D-07/D-08 behavior tests and add the spec-anchored 50-membership suite** - `a9569254` (test)

**Plan metadata:** (final commit follows this SUMMARY)

_Note: Task 1's `tsc` acceptance criterion allowed one expected error at `client.ts`'s import site, cleared by Task 2 as designed._

## Files Created/Modified
- `packages/concord/src/helpers/community-list.ts` - Deleted `COMMUNITY_LIST_MAX_ENTRY_BYTES`/`communityListWithinByteCap`; added `COMMUNITY_LIST_MAX_MEMBERSHIPS`; reworded `LIST_MAX_BYTES` and `communityListByteSize`/`communityListEntryByteSize` doc comments to diagnostic-only framing with the D-21 warning
- `packages/concord/src/client/client.ts` - `recordJoin`'s guard now counts live memberships via `liveCommunities` before an engine is constructed or `this.list` is touched; `saveCommunityList`'s byte-cap gate and its `console.warn` are gone, replaced by an unconditional size-trace log; `pruneDeadEntries`'s doc comment reworded to cite the live-count guard instead of a deleted byte ceiling
- `packages/concord/src/helpers/__tests__/community-list.test.ts` - Structural export-key guard replaces the deleted predicate's boundary test; new fixture-anchored `COMMUNITY_LIST_MAX_MEMBERSHIPS` test; fixed a dangling `communityListWithinByteCap` call in the pre-existing liveness test
- `packages/concord/src/client/__tests__/client.test.ts` - Rewrote the over-cap-rejects and IN-01 diagnostic tests to record-and-publish; rewrote the pre-existing CR-02 recoverability test whose "cannot publish" premise became false; added five new tests (51st refused, 50th admitted, live-only counting, merged overflow tolerated, oversized list publishes) plus one white-box test proving `recordJoin` reads the derived live count

## Decisions Made
- Reworded `LIST_MAX_BYTES`'s doc comment rather than deleting it (D-08's diagnostic still needs it), recording that NIP-44's `max_plaintext_size` is now 4294967295 and carrying the D-21 warning against anchoring any assertion to 65535 as a live NIP-44 value
- Test F needed both tombstoned entries AND duplicate raw entries for already-live communities to be non-vacuous, since `mergeCommunities`' Map-based dedup plus `pruneDeadEntries` running on every death transition makes `this.list.length` and `liveCommunities(...).length` structurally equal in every state reachable through the public API alone — a genuinely reachable divergence requires a dedicated white-box test that writes the private `list` field directly
- Rewrote (rather than deleted) the pre-existing CR-02 recoverability test whose "an already-wedged list cannot publish" premise directly contradicted D-07/D-08; it now asserts the oversized entry publishes immediately and that `leave()` still prunes its bytes afterward as a hygiene property, not a stuck-publish recovery

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a dangling `communityListWithinByteCap` call left in `community-list.test.ts`'s pre-existing "liveness: leave kills, later re-join resurrects" test**
- **Found during:** Task 3, after deleting the predicate in Task 1
- **Issue:** This test (outside the plan's four named rewrites) called the now-deleted `communityListWithinByteCap`, which would fail to compile
- **Fix:** Replaced with an inline `communityListByteSize(...) <= LIST_MAX_BYTES` check, preserving the same coverage without the removed predicate
- **Files modified:** `packages/concord/src/helpers/__tests__/community-list.test.ts`
- **Verification:** `npx tsc --noEmit` clean; test passes
- **Committed in:** `a9569254` (Task 3 commit)

**2. [Rule 1 - Bug] Rewrote a pre-existing test (`client.test.ts`, 12.3-12 era) whose premise was falsified by this plan's own Task 2 change**
- **Found during:** Task 3, running the full suite before writing new tests
- **Issue:** "CR-02 recoverability: an already-wedged Community List cannot publish..." asserted `listPublishes(published).length` was `0` after an oversized save — directly contradicted by D-07/D-08's intentional new behavior (the document now always publishes)
- **Fix:** Rewrote the test to assert the oversized entry publishes immediately (with the size trace naming it), and that `leave()` still produces a second publish that prunes the entry's bytes — preserving the test's genuine remaining value (byte-pruning hygiene) while dropping its falsified premise
- **Files modified:** `packages/concord/src/client/__tests__/client.test.ts`
- **Verification:** Full `pnpm --filter applesauce-concord test` green (522 tests)
- **Committed in:** `a9569254` (Task 3 commit)

**3. [Rule 3 - Blocking] Corrected two acceptance-criteria-adjacent grep counts by removing literal symbol-name mentions from comments in `client.test.ts`**
- **Found during:** Task 3, verifying the plan's `grep -rn` acceptance criteria
- **Issue:** Two explanatory comments quoted `COMMUNITY_LIST_MAX_ENTRY_BYTES` and `COMMUNITY_LIST_MAX_MEMBERSHIPS` by name, which the plan's acceptance criteria require to be absent from `packages/concord/src/client` (the deleted constant) and from the whole test file (the implementation's own membership constant, per the anchoring discipline)
- **Fix:** Reworded both comments to describe the same point without the literal symbol names
- **Files modified:** `packages/concord/src/client/__tests__/client.test.ts`
- **Verification:** `grep -rn` acceptance criteria re-run and confirmed clean
- **Committed in:** `a9569254` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bug fixes, 1 Rule 3 blocking fix)
**Impact on plan:** All three were necessary to keep the modified test files compiling, passing, and honoring the plan's own acceptance criteria. No scope creep — no files outside the plan's declared `files_modified` were touched.

## Non-Vacuity Mutations (mandatory, recorded per plan instruction)

All three performed on `packages/concord/src/client/client.ts`, observed, then reverted (confirmed via `git diff` showing no residual diff against the Task 2 commit):

1. **`liveCommunities(this.list, this.tombstones).length` → `this.list.length`.** The originally-planned test F (tombstones only) did NOT go red under this mutation — investigation showed `mergeCommunities`' Map-based dedup plus `pruneDeadEntries` running on every death transition (`leave`/`handleRemoved`/`reconcileCommunities`) makes `this.list.length` and the derived live count structurally equal in every state reachable through the public API alone. A dedicated white-box test ("recordJoin's guard reads the DERIVED live count...") that writes `(client as any).list` directly (bypassing those invariants) DID go red: `AssertionError: promise rejected "Error: community list join refused (98 live memberships...)" instead of resolving`. Reverted; confirmed green.
2. **Guard comparison shifted from `liveCount + 1 > CAP` to `liveCount + 1 >= CAP`** (refuses at 50 rather than 51). The "admits the membership that would be the cap-th (the 50th)" test went red: `Error: community list join refused (49 live memberships, would exceed the 50-membership cap)`. Reverted; confirmed green.
3. **Reinstated `saveCommunityList`'s early `return` on `serializedBytes > 65_535`.** Both the rewritten CR-02 heritage test and the new "oversized Community List publishes" test went red on `expect(listPublishes(published).length).toBe(1)` (received `0`). Reverted; confirmed green.

After each mutation-and-revert, `npx tsc --noEmit -p packages/concord/tsconfig.json` was re-confirmed clean and `git diff packages/concord/src/client/client.ts` showed zero residual diff against the Task 2 commit.

## Issues Encountered
- `client.communities$.value` is `CommunityState[]` (each with `.material.community_id`), not the class's `.communityId` getter — several new test assertions initially used the wrong accessor and were corrected to `.material.community_id`, matching the existing convention already used elsewhere in the file (line 674 pre-plan).
- Building 50+ real communities per new test via `createCommunity()` (crypto-only, no network) kept the added tests fast (full new suite runs in well under a second beyond the pre-existing baseline); no test timeout adjustments beyond a defensive `30_000ms` were needed given the default 5s budget was comfortably cleared in practice, but the explicit timeout was kept as a safety margin.

## Next Phase Readiness
- `WIRE-08` is now fully Complete in REQUIREMENTS.md (Community List half; the invite-side half closed in 12-03).
- Plan 12-07 (wave 3) will open the Community List document root and touch `helpers/community-list.ts`/`client/client.ts` again — this plan's `COMMUNITY_LIST_MAX_MEMBERSHIPS`, `recordJoin` guard, and `saveCommunityList` diagnostic are all now stable surface for that plan to build on without re-deriving.
- No blockers.

---
*Phase: 12-document-caps-conformance*
*Completed: 2026-07-30*

## Self-Check: PASSED

All modified files exist on disk (`packages/concord/src/helpers/community-list.ts`, `packages/concord/src/client/client.ts`, `packages/concord/src/helpers/__tests__/community-list.test.ts`, `packages/concord/src/client/__tests__/client.test.ts`) and all four commit hashes (`5e3b1b34`, `8d01d669`, `a9569254`, `792d26c1`) are present in `git log`.
