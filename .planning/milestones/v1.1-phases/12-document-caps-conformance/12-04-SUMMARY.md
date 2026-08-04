---
phase: 12-document-caps-conformance
plan: 04
subsystem: concord
tags: [concord, cord-02, byte-caps, utf-8, community-metadata, channels, editMetadata]

requires:
  - phase: 12-document-caps-conformance
    provides: "12-01's cord-wire-fixtures.ts spec substrate (CORD_METADATA_CAPS, MULTIBYTE_ASTRAL_CHAR, utf8Bytes, multiByteStringOfBytes/OverBytes)"
provides:
  - "helpers/caps.ts: the one shared UTF-8 byte-cap check (NAME_MAX_BYTES=64, DESCRIPTION_MAX_BYTES=10000, utf8ByteLength, assertByteCap), exported from the helpers barrel"
  - "createCommunity, createChannel, and editMetadata all reject over-cap name/description before any side effect, closing audit findings M17 and L09"
  - "editMetadata asserts the MERGED document (next), not the patch, closing the setCommunityImage/removeCommunityImage icon-only-patch bypass"
  - "D-04's read-path non-guarantee pinned by a regression test — an over-cap name still folds into channel state verbatim"
affects: [12-05, 12-06, 12-09]

tech-stack:
  added: []
  patterns:
    - "Shared cap-check module with zero imports, sitting at the bottom of the dependency graph so both helpers/ and client/ can reach it without crossing the one-way helpers->client boundary"
    - "Write-side-only enforcement with an explicit test pinning the deliberate absence of a read-side guard (D-04), so a future 'completion' attempt fails loudly"

key-files:
  created:
    - packages/concord/src/helpers/caps.ts
  modified:
    - packages/concord/src/helpers/index.ts
    - packages/concord/src/helpers/community.ts
    - packages/concord/src/client/admin.ts
    - packages/concord/src/helpers/__tests__/community.test.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/client/__tests__/client.test.ts

key-decisions:
  - "helpers/caps.ts has zero imports so it sits at the bottom of the dependency graph, reachable from both helpers/community.ts and client/admin.ts without crossing the one-way import boundary"
  - "editMetadata asserts against the merged `next`, never `patch` — proven necessary by a seeded-legacy-document test plus a mutation probe"
  - "Two pre-existing client.test.ts fixtures (12.3-12/12.3-13) that padded an oversized Community List entry via an over-cap `name` were repointed to pad via the unbounded `relays` field instead, since the new write-side cap now rejects an over-cap name before either fixture's own target code path is reached"
  - "createRole's 64-byte name cap left deliberately unimplemented (Deferred Idea, no requirement covers it); no read-side guard added to helpers/control.ts (D-04)"

requirements-completed: [WIRE-06, WIRE-07]

coverage:
  - id: D1
    description: "createCommunity throws on a community name/description exceeding the CORD-02 §6 byte cap, measured via UTF-8 TextEncoder, with an exact-boundary (64/10000 bytes accepted, one byte more rejected) and a UTF-16-vs-UTF-8 divergence guard"
    requirement: "WIRE-07"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/community.test.ts#createCommunity byte caps (WIRE-06/WIRE-07, D-02/D-03/D-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "createChannel rejects an over-cap channel name before minting a key or publishing an edition"
    requirement: "WIRE-06"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#createChannel rejects an over-cap multi-byte name before minting a key or publishing an edition (WIRE-06/D-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "editMetadata rejects an icon-only patch when the current folded name is already over cap (the {...current, ...patch} merge bypass)"
    requirement: "WIRE-07"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#editMetadata rejects an icon-only patch when the current (pre-existing) name is already over cap — the merge bypass D-03 names"
        status: pass
    human_judgment: false
  - id: D4
    description: "The read path is provably unguarded per D-04: an authorized over-cap channel edition still folds into channel state verbatim, and the channel is not dropped"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#an over-cap channel name arriving via an authorized edition still folds into channel state verbatim — D-04's deliberate read-path non-guarantee"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-30
status: complete
---

# Phase 12 Plan 04: Metadata/Channel Byte-Cap Enforcement Summary

**One shared `assertByteCap` UTF-8 byte-cap check (64-byte name / 10000-byte description, CORD-02 §6) wired into `createCommunity`, `createChannel`, and `editMetadata`'s post-merge document, closing audit findings M17 and L09 write-side only, per D-04.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-30T11:42:41+01:00
- **Tasks:** 3/3 completed
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- Added `packages/concord/src/helpers/caps.ts` — a dependency-free module exporting `NAME_MAX_BYTES` (64), `DESCRIPTION_MAX_BYTES` (10000), `utf8ByteLength`, and `assertByteCap`, transcribed verbatim from CORD-02 §6 and exported from the helpers barrel.
- Wired the cap into all three write paths that can reach a published document: `createCommunity` (helpers/community.ts, unconditional name + optional description, asserted before any secret is minted), `createChannel` (client/admin.ts, asserted before `mintChannelKey`'s side effect), and `editMetadata` (client/admin.ts, asserted against the merged `next` document, not `patch`, closing the `setCommunityImage`/`removeCommunityImage` icon-only-patch bypass D-03 names).
- Added eight spec-anchored tests across the two established test homes (`helpers/__tests__/community.test.ts` for the exported helper; `client/__tests__/community.test.ts` for the admin API and the fold), every cap number sourced from `CORD_METADATA_CAPS` (never `caps.ts`'s own constants), including the M17 regression proper (a 17-repeat astral name is over the 64-byte cap while strictly under it in UTF-16 `.length`) and a test pinning D-04's deliberate read-path non-guarantee.
- Fixed two pre-existing `client.test.ts` fixtures that broke as a direct consequence of Task 2's change (Rule 1 auto-fix, see Deviations).

## Task Commits

1. **Task 1: Create helpers/caps.ts** — `844ed20b` (feat)
2. **Task 2: Wire the cap into createCommunity, createChannel, and editMetadata** — `dd1dd5a5` (feat, includes the Rule 1 auto-fix to `client.test.ts`)
3. **Task 3: Spec-anchored cap tests** — `a88a56ed` (test)

_No plan-metadata commit shown yet — created below, after this SUMMARY._

## Files Created/Modified

- `packages/concord/src/helpers/caps.ts` — NEW. The shared UTF-8 byte-cap check: `NAME_MAX_BYTES`, `DESCRIPTION_MAX_BYTES`, `utf8ByteLength`, `assertByteCap`. Zero imports.
- `packages/concord/src/helpers/index.ts` — added `export * from "./caps.js"` to the barrel.
- `packages/concord/src/helpers/community.ts` — `createCommunity` asserts `opts.name` (unconditional) and `opts.description` (if present) before any secret is minted or edition built.
- `packages/concord/src/client/admin.ts` — `createChannel` asserts `name` before `mintChannelKey`; `editMetadata` asserts the merged `next.name`/`next.description` before `publishEdition`.
- `packages/concord/src/helpers/__tests__/community.test.ts` — 6 new tests: exact-cap/over-cap name, UTF-16-vs-UTF-8 divergence self-guard, the M17 regression proper, exact-cap/over-cap description, no-description-at-all.
- `packages/concord/src/client/__tests__/community.test.ts` — 3 new tests: `createChannel` over-cap rejection (no key minted, no edition published), `editMetadata` icon-only-patch bypass rejection (seeded via a legacy METADATA edition), and the D-04 read-path non-guarantee (an over-cap channel edition still folds).
- `packages/concord/src/client/__tests__/client.test.ts` — two pre-existing oversized-entry fixtures (12.3-12's CR-02 recoverability test, 12.3-13's per-entry-ceiling test) repointed to pad via the unbounded `relays` field instead of `name`, since the new write-side cap now rejects their over-cap `name` before either fixture's own target code path (the Community List byte-size ceiling) is reached.

## Decisions Made

- `helpers/caps.ts` has zero imports by design, so it sits at the bottom of the dependency graph and is reachable from both `helpers/community.ts` and `client/admin.ts` without crossing the existing one-way helpers→client import boundary.
- `editMetadata`'s assertion runs against the merged `next`, never `patch` — proven necessary both by Test 7 (a seeded legacy over-cap name plus an icon-only patch) and by the mandatory non-vacuity mutation (moving the assertion to `patch` turns Test 7 red).
- No cap added to `createRole` (explicitly Deferred, no requirement covers it) and no read-side guard added to `helpers/control.ts` (D-04) — both are documented boundaries in the plan and left untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two pre-existing client.test.ts fixtures broke as a direct consequence of Task 2's new write-side name cap**
- **Found during:** Task 2 (wiring the cap into createCommunity/createChannel/editMetadata) — running the full `applesauce-concord` suite after the change surfaced two failures.
- **Issue:** `client.test.ts`'s CR-02 recoverability test (12.3-12) and its per-entry-ceiling test (12.3-13) both constructed an intentionally oversized Community List entry by padding the community `name` field with tens of thousands of repeated characters. `createCommunity` now asserts the name cap (64 bytes) before either fixture's own target code path (the Community List's aggregate/per-entry byte-size ceiling, an entirely different and pre-existing cap) is ever reached, so both fixtures failed with the new "community name is too large" error instead of exercising the ceiling they were written to test.
- **Fix:** Repointed both fixtures to pad the oversized entry via the `relays` array (an unbounded field with no cap in this phase) instead of `name`, keeping `name` short (`"x"`). Both fixtures still serialize the padded field twice per entry (seed + current), preserving their original arithmetic and their original assertions about the Community List's own ceiling.
- **Files modified:** `packages/concord/src/client/__tests__/client.test.ts`
- **Commit:** `dd1dd5a5` (same commit as Task 2's implementation, since the tests were red as a direct result of that change)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug/regression fix, directly caused by this plan's own change)
**Impact on plan:** No scope creep — the fix repairs two pre-existing tests broken by this plan's own Task 2 change; their original behavioral intent (the Community List's byte-size ceiling) is fully preserved.

## Issues Encountered

None beyond the deviation above.

## Non-Vacuity Mutation Observations (mandatory, per Task 3)

1. **UTF-16-vs-UTF-8 measurement mutation:** Temporarily changed `assertByteCap`'s measurement in `helpers/caps.ts` from `utf8ByteLength(value)` to `value.length` (raw UTF-16 code-unit count). Ran `helpers/__tests__/community.test.ts` — 3 of 7 tests went RED, including "rejects a name over cap in bytes while strictly UNDER cap in UTF-16 code units (the M17 regression proper)" — confirming the test genuinely distinguishes a byte-measuring implementation from a `.length`-measuring one. Reverted; full suite (516 tests) confirmed green afterward.
2. **`patch`-instead-of-`next` mutation:** Temporarily changed `editMetadata` in `client/admin.ts` to assert `patch.name`/`patch.description` (guarded by `!== undefined`) instead of the merged `next.name`/`next.description`. Ran `client/__tests__/community.test.ts` — "editMetadata rejects an icon-only patch when the current (pre-existing) name is already over cap — the merge bypass D-03 names" went RED (the icon-only patch has no `name` field, so the mutated assertion never fires). Reverted; full suite confirmed green afterward, and `git diff` confirmed no residual change to `admin.ts` or `caps.ts`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `helpers/caps.ts`'s `assertByteCap`/`NAME_MAX_BYTES`/`DESCRIPTION_MAX_BYTES` are exported from the helpers barrel and available for plan 12-05 (Community List membership cap, a distinct 50-membership count cap — this plan deliberately does not touch `community-list.ts`).
- `helpers/control.ts` and `createRole` are both untouched, exactly as this plan's boundaries require (D-04, Deferred Idea).
- `pnpm --filter applesauce-concord test` is green (516/516) and `npx tsc --noEmit` is clean; no blockers for plans 12-05/12-06/12-09.

## Self-Check: PASSED

All created/modified files verified present on disk; all 3 task commit hashes (844ed20b, dd1dd5a5, a88a56ed) verified present in git log.
