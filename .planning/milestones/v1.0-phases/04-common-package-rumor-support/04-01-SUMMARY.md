---
phase: 04-common-package-rumor-support
plan: 01
subsystem: common
tags: [typescript, generics, nostr-tools, nip-10, nip-36, rumor]

# Dependency graph
requires:
  - phase: 01-generic-store-foundation
    provides: "StoreEvent structural type and the E extends StoreEvent = NostrEvent signature-only genericization pattern"
  - phase: 02-generic-models-casts
    provides: "EventCast<E>/CastRefEventStore<E> generic cast infrastructure with NostrEvent defaults"
  - phase: 03-rumor-store-verification
    provides: "RumorStore, verifyRumor, sig-gated castEvent proving the generic pattern end-to-end"
provides:
  - "getNip10References, getReactionEmoji, getHashtagTag, getContentWarning generic over a structural event type defaulting to NostrEvent"
  - "COMMON-02 audit note documenting the targeted-cast set is empty (no applesauce-common cast/model/factory touched)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Narrow { tags: string[][] } inline bound (not the full StoreEvent shape) for tag-only helpers, reserving StoreEvent for helpers that also read .content"

key-files:
  created:
    - .changeset/genericize-common-helpers.md
    - .planning/phases/04-common-package-rumor-support/04-COMMON-02-AUDIT.md
  modified:
    - packages/common/src/helpers/threading.ts
    - packages/common/src/helpers/emoji.ts
    - packages/common/src/helpers/hashtag.ts
    - packages/common/src/helpers/content.ts

key-decisions:
  - "Used the narrow { tags: string[][] } inline bound for getNip10References/getHashtagTag/getContentWarning (tag-only reads) and the full StoreEvent bound for getReactionEmoji (reads both content and tags), exactly as scoped in RESEARCH/PLAN"
  - "COMMON-02 targeted-cast set is empty this phase — no applesauce-common cast/model/factory needed touching; documented in 04-COMMON-02-AUDIT.md with a re-runnable grep"

patterns-established:
  - "Signature-only genericization of applesauce-common's small structural-only helper set, mirroring Phase 1's core pattern, while explicitly leaving every KnownEvent<K>-guarded kind-specific helper (isValidXxx) untouched"

requirements-completed: [COMMON-01, COMMON-02, COMMON-03]

coverage:
  - id: D1
    description: "getNip10References, getReactionEmoji, getHashtagTag, and getContentWarning are generic over a structural event type with a NostrEvent default"
    requirement: "COMMON-01"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common build (tsc type-checks all four genericized signatures)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-common test emoji content exports"
        status: pass
    human_judgment: false
  - id: D2
    description: "COMMON-02 targeted-cast set audited and documented as empty; no applesauce-common cast/model/factory changed"
    requirement: "COMMON-02"
    verification:
      - kind: unit
        ref: "grep -rln \"Rumor\" packages/common/src/casts (empty result)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing applesauce-common tests and all four export/helper snapshots pass byte-for-byte unchanged"
    requirement: "COMMON-03"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test (62 test files, 500 tests)"
        status: pass
      - kind: unit
        ref: "git diff --exit-code -- packages/common/src/{helpers,casts,operations}/__tests__/exports.test.ts packages/common/src/__tests__/exports.test.ts"
        status: pass
  - id: D4
    description: "Full-workspace pnpm run build exits 0 (downstream-inference gate)"
    requirement: "COMMON-03"
    verification:
      - kind: unit
        ref: "pnpm run build (full turbo pipeline, exit code 0)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-09
status: complete
---

# Phase 4 Plan 1: Common Package Rumor Support Summary

**Genericized four structural-only `applesauce-common` helpers (`getNip10References`, `getReactionEmoji`, `getHashtagTag`, `getContentWarning`) over a defaulted `NostrEvent` type parameter, and audited the COMMON-02 targeted-cast set as empty with zero cast/model/factory changes.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-09T05:36Z
- **Completed:** 2026-07-09T05:44Z
- **Tasks:** 2 completed
- **Files modified:** 6 (4 helper files, 1 new changeset, 1 new audit doc)

## Accomplishments
- `getNip10References` and `getHashtagTag` genericized to `<E extends { tags: string[][] } = NostrEvent>`, preserving their pre-existing `EventTemplate` callers via the narrow tag-only bound
- `getReactionEmoji` genericized to `<E extends StoreEvent = NostrEvent>` (it reads both `.content` and `.tags`)
- `getContentWarning` genericized to `<E extends { tags: string[][] } = NostrEvent>`
- Orphaned `EventTemplate` imports removed from `threading.ts` and `hashtag.ts` after the union collapsed into a single generic parameter
- COMMON-02 audited and documented empty: no `applesauce-common` cast, model, or factory references a rumor; concord's `ConcordDirectInvite` and actions' `wrapped-messages.ts` both bypass common casts entirely (confirmed by grep)
- Full `applesauce-common` test suite (500 tests, 62 files) and the full-workspace `pnpm run build` both green, with zero diff in any of the four `exports.test.ts` inline snapshots

## Task Commits

Each task was committed atomically:

1. **Task 1: Genericize the four structural-only common helpers + changeset** - `943e16db` (refactor)
2. **Task 2: COMMON-02 audit note + full-workspace build/test phase gate** - `d287d5ed` (docs)

_Plan-metadata commit created after this summary._

## Files Created/Modified
- `packages/common/src/helpers/threading.ts` - `getNip10References<E extends { tags: string[][] } = NostrEvent>`; removed orphaned `EventTemplate` import
- `packages/common/src/helpers/emoji.ts` - `getReactionEmoji<E extends StoreEvent = NostrEvent>`; added `StoreEvent` to the existing `NostrEvent` import
- `packages/common/src/helpers/hashtag.ts` - `getHashtagTag<E extends { tags: string[][] } = NostrEvent>`; removed orphaned `EventTemplate` import
- `packages/common/src/helpers/content.ts` - `getContentWarning<E extends { tags: string[][] } = NostrEvent>`
- `.changeset/genericize-common-helpers.md` - single-sentence changeset bumping `applesauce-common` minor
- `.planning/phases/04-common-package-rumor-support/04-COMMON-02-AUDIT.md` - documents the empty targeted-cast finding with a re-runnable grep and the COMMON-F1/F2 deferral rationale

## Decisions Made
- Used the narrow `{ tags: string[][] }` inline bound (not the full `StoreEvent` shape) for the three tag-only helpers, and `StoreEvent` only for `getReactionEmoji` which also reads `.content` — matches the plan's explicit per-function bound choice exactly
- Declared the COMMON-02 targeted-cast set empty rather than adding a speculative `EventCast<Rumor>` subclass, per CONTEXT.md's "high churn, low value" anti-pattern warning and the research audit's concrete-consumer evidence

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their specified `<action>` and all acceptance criteria passed on first attempt with no auto-fixes needed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- This is the final plan of the final milestone phase (04-common-package-rumor-support); COMMON-01/02/03 are all satisfied
- `applesauce-common`'s four genericized helpers are ready for any downstream rumor-typed consumer (e.g. a future `applesauce-concord` NIP-10/NIP-36 rumor use case) with zero further common-package changes required
- No blockers; milestone v1.0 (event-store-supports-rumors) is functionally complete pending `/gsd-verify-work` and milestone closeout

---
*Phase: 04-common-package-rumor-support*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 7 created/modified files verified present on disk; both task commit hashes (943e16db, d287d5ed) verified present in git log.
