---
phase: quick
plan: 261013-i0r
subsystem: applesauce-common
tags: [nip-5d, napplet, helpers, casts, operations, factories, examples]
status: complete
requires: []
provides:
  - packages/common/src/helpers/napplet.ts
  - packages/common/src/casts/napplet.ts (Napplet cast + User.napplets$/napplet$/nappletSnapshots$)
  - packages/common/src/operations/napplet.ts (Operations.Napplet)
  - packages/common/src/factories/napplet.ts (NappletFactory)
  - apps/examples/src/examples/napplet/browser.tsx
affects: [applesauce-common exports, applesauce-examples]
tech-stack:
  added: []
  patterns: [getOrComputeCachedValue symbol caches, $$ref relationships, User.prototype augmentation, EventFactory chain]
key-files:
  created:
    - packages/common/src/helpers/napplet.ts
    - packages/common/src/helpers/__tests__/napplet.test.ts
    - packages/common/src/casts/napplet.ts
    - packages/common/src/casts/__tests__/napplet.test.ts
    - packages/common/src/operations/napplet.ts
    - packages/common/src/operations/__tests__/napplet.test.ts
    - packages/common/src/factories/napplet.ts
    - packages/common/src/factories/__tests__/napplet.test.ts
    - apps/examples/src/examples/napplet/browser.tsx
    - .changeset/napplet-helpers.md
    - .changeset/napplet-cast.md
    - .changeset/napplet-operations.md
    - .changeset/napplet-factory.md
    - .changeset/user-napplet-getters.md
  modified:
    - packages/common/src/helpers/index.ts
    - packages/common/src/casts/index.ts
    - packages/common/src/operations/index.ts
    - packages/common/src/factories/index.ts
    - packages/common/src/helpers/__tests__/exports.test.ts
    - packages/common/src/casts/__tests__/exports.test.ts
    - packages/common/src/operations/__tests__/exports.test.ts
decisions:
  - Reuse the existing `isSha256` helper (blossom.ts) for lowercase-hex validation instead of adding a napplet-specific one
  - Snapshotting a snapshot copies its source a/A lineage, since a 5129 event cannot be addressed by an `a` tag
  - Snapshot pointers are event pointers, so `address`/`address$` encode an nevent through `encodePointer`
  - The example stores the selection as a pointer and resolves it from the store, so it follows replaceable revisions (apps/examples/CLAUDE.md)
metrics:
  completed: 2026-10-13
  tasks: 6
  commits: 7
---

# Quick Task 261013-i0r: NIP-5D Napplet Support Summary

This task adds full NIP-5D napplet support to `applesauce-common`: validated manifest helpers for kinds 5129, 15129 and 35129, a `Napplet` cast with reactive comment, reaction, zap, share, snapshot, lineage and parent/root relationships, `User` getters, tag operations, a `NappletFactory` with snapshot lineage, and a napplet browser example.

## Commits

| Hash | Message |
|------|---------|
| 79834f71 | feat(261013-i0r): add NIP-5D napplet helpers |
| 860b0f6b | feat(261013-i0r): add Napplet cast and User napplet getters |
| a125312e | feat(261013-i0r): add NIP-5D napplet operations |
| 6c287da4 | fix(261013-i0r): keep x tag position when replacing napplet artifact hash |
| 32debe66 | feat(261013-i0r): add NappletFactory |
| 816d2bd3 | feat(261013-i0r): add napplet browser example |
| 217f5597 | chore(261013-i0r): add changesets for NIP-5D napplet support |

## What Was Built

- **Helpers** (`helpers/napplet.ts`)
  - Kind constants, `NAPPLET_KINDS`, `NAPPLET_ICON_TYPES`, and the `NappletEvent`, `NappletIntent` and `NappletIcon` types
  - `isValidNapplet` checks four things: the kind, exactly one lowercase-hex `x` tag, non-blank content, and the `d` tag rules (exactly one non-empty `d` on 35129, none on the other kinds)
  - Kind guards and getters for every manifest field
  - `a`/`A` lineage is read only on 5129 events
  - Parsed arrays are cached with `Symbol.for` keys
- **Cast** (`casts/napplet.ts`)
  - `Napplet` has getters for every manifest field, plus `pointer`/`pointer$`/`address`/`address$` (naddr for root and named napplets, nevent for snapshots)
  - Relationships: `comments$`, `reactions$`, `zaps$`, `shares$`, `snapshots$` (`#a`), `lineage$` (`#A`), `parent$`/`upstream$` and `root$`
  - `User.prototype` gains `napplets$`, `napplet$` and `nappletSnapshots$`, with `declare module "applesauce-core/casts"` typings
- **Operations** (`Operations.Napplet`)
  - Setters and removers for every field
  - The artifact hash and icon are validated, and both throw on bad input
  - `setNappletArtifactHash` drops duplicate `x` tags and keeps the first one in place
  - Lineage tags carry a normalized relay hint
- **Factory** (`NappletFactory`): `create`, `createRoot`, `snapshot`, `modify`, plus fluent setters and removers for every operation
- **Example** (`apps/examples/src/examples/napplet/browser.tsx`)
  - Relay picker and a list of 15129/35129 manifests showing title, description, archetypes, R/O domains, author, and reaction and zap counts
  - The detail view streams comments, reactions, zaps and snapshots/lineage. For snapshots it shows parent and root links.
  - Styling uses borders only, with no cards, shadows or `.form-control`. The example is auto-discovered by `examples.ts` through `import.meta.glob`.
- **Changesets**: five files, one per change, each with `"applesauce-common": minor` and a single-sentence body

## Verification

- `pnpm --filter applesauce-common test`: **69 files, 582 tests passed**
- `pnpm --filter applesauce-common build` (tsc): **passed**, exit 0
- `pnpm --filter applesauce-examples exec tsc -b`: **passed**, exit 0
- `pnpm --filter applesauce-examples build` (`tsc -b && vite build`): **passed**. "✓ built in 3.13s", with only the existing chunk-size and sourcemap warnings.
- Export snapshots were updated with `vitest -u` after checking that the diffs contained only the new napplet exports. That covers helpers, casts and operations. `src/__tests__/exports.test.ts` lists only namespaces and needed no change, and there is no factories exports test.
- **Not done:** the plan's manual check (dev server against a live relay with 35129/15129 events) was not run, because this agent has no browser.

## Deviations from Plan

1. **[Rule 1 - Bug] Duplicate `x` tags were not fully replaced** (Task 3, fix commit 6c287da4)
   - `setSingletonTag` replaces only the first matching tag, so a draft with duplicate `x` tags stayed invalid.
   - First fix: remove all `x` tags, then set one. That moved `x` to the end of the tag list.
   - Final fix: a local `keepFirstTag("x")` tag operation, followed by `setSingletonTag`.
2. **[Design] `NappletFactory.snapshot` of a snapshot**
   - The plan sets `a` to the source's coordinate, but 5129 snapshots have no coordinate.
   - When the source is a snapshot, the factory now copies the source's `a` and `A` tags. The plan only specified copying `A`.
   - Test: "keeps the root when snapshotting a snapshot".
3. **[Reuse] `isSha256`**: the existing `isSha256` helper from `helpers/blossom.ts` is used instead of a new `isNappletHash` export. The plan didn't name the hex check, so this only avoids a duplicate API.
4. **[Addition] `getNappletIdentifier` and `isNappletIconType` helpers**: added to support the cast's `identifier` and the icon validation shared by the helpers and operations.
5. **[Example conventions] Example state handling**
   - Followed `apps/examples/CLAUDE.md`: component-local `BehaviorSubject`s via `useMemo` instead of `useState`.
   - The selection is held as a pointer and resolved from the store, instead of the torrent template's module-level `BehaviorSubject<Torrent>`.
   - The detail view fetches comments with `#a`/`#e`, matching the direct-parent filters in `CommentsModel`.
6. **Formatting**: the helper test was prettier-formatted inside the operations commit (a125312e).
7. **Build setup**: workspace dependencies had no `dist`, so `pnpm --filter "applesauce-common^..." build` and `pnpm --filter "applesauce-examples^..." build` were run before testing. These are build artifacts only and nothing was committed.

## Known Stubs

None.

## Threat Flags

None. The example renders the manifest `source` URL as an external link with `rel="noreferrer"`. It never fetches or renders artifact or icon blobs, so the NIP-5D verify-before-render rules don't apply.

## Self-Check: PASSED

- All created files exist on disk (helpers, cast, operations, factory, four test files, example, five changesets).
- All 7 commit hashes are present in `git log` on `worktree-nip-5d-napplets`.
- STATE.md and PLAN.md were not modified or committed by this executor; the orchestrator owns those.
