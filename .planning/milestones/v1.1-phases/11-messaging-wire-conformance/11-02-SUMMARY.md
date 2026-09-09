---
phase: 11-messaging-wire-conformance
plan: 02

# Dependency graph
requires:
  - phase: 11-messaging-wire-conformance
    provides: "plan 01's vendored CORD wire fixtures (unrelated dependency, same wave — no direct code dependency)"
provides:
  - "ChannelMetadata no longer declares a per-channel voice flag — tsc rejects any reintroduced read"
  - "CreateChannelOptions no longer declares a voice option"
  - "The channel-metadata fold no longer privileges a voice flag over any other unknown top-level key"
  - "Both out-of-package consumers (example app, docs) no longer offer, render, or document a per-channel voice flag"
affects: [12]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/11-messaging-wire-conformance/deferred-items.md
  modified:

key-decisions:
  - "Hard-deleted the flag from all four in-package sites plus both out-of-package consumers, per D-06 — no tombstone comment, no routing into `custom` (that would collide with WIRE-10's Phase-12 scope)"
  - "Left a pre-existing, unrelated applesauce-examples build failure (9 files, StoredEvent/NostrEvent sig mismatch) undisturbed and logged to deferred-items.md, per the Scope Boundary rule"

requirements-completed: [WIRE-01]

coverage:
  - id: D1
    description: "ChannelMetadata.voice and CreateChannelOptions.voice deleted; no code writes or folds a per-channel voice flag"
    requirement: WIRE-01
    verification:
      - kind: unit
        status: pass
      - kind: other
        status: pass
    human_judgment: false
  - id: D2
    description: "Out-of-package consumers (example app ChannelsTab, docs channel-creation block) no longer offer/render/document the voice flag"
    requirement: WIRE-01
    verification:
      - kind: other
        ref: "grep -c 'setVoice' admin-management.tsx == 0; grep -c 'checked={isPrivate}' == 1 (sibling intact); grep -c 'channel.deleted' unchanged; docs private example intact"
        status: pass
      - kind: integration
        ref: "pnpm exec turbo build --filter=applesauce-examples --force — admin-management.tsx contributes zero errors (9 pre-existing unrelated errors in other files confirmed via baseline diff)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-29
status: complete
---

# Phase 11 Plan 02: Hard-remove per-channel voice flag Summary


## Performance

- **Duration:** 5 min
- **Started:** 2026-07-29T10:14:35Z
- **Completed:** 2026-07-29T10:20:16Z
- **Tasks:** 2 completed
- **Files modified:** 5 (plus 1 new deferred-items.md)

## Accomplishments
- Removed the per-channel voice flag from `ChannelMetadata` (types.ts), `CreateChannelOptions` (admin.ts), `createChannel`'s edition-content write (admin.ts), and the channel-metadata fold's conditional spread (control.ts) — four in-package deletions, nothing added/renamed/rerouted
- Swept both out-of-package consumers: the example app's `ChannelsTab` (useState pair, `createChannel` options shorthand, the Voice checkbox `<label>` block, and the metadata-line conditional render) and the docs' "Creating a channel" example
- Verified `deleteChannel`'s hand-rolled edition content, the `deleted`/`custom` fold spreads, and the sibling `isPrivate`/`checked={isPrivate}` UI elements are byte-unchanged
- Confirmed via a pre-edit baseline (`turbo build --filter=applesauce-examples`) and a post-edit `--force` (cache-bypass) rerun that `admin-management.tsx` contributes zero build errors — the unfiltered `pnpm build` remains red only for 9 pre-existing, unrelated files (logged to `deferred-items.md`, not fixed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete the flag from the type, the write path, and the fold** - `080df496` (feat)
2. **Task 2: Sweep the two out-of-package consumers and prove the workspace still builds** - `b23b1107` (feat)

**Plan metadata:** (this commit, next)

## Files Created/Modified
- `.planning/phases/11-messaging-wire-conformance/deferred-items.md` - New: logs the pre-existing, unrelated `applesauce-examples` build failure discovered while verifying this plan's build gate

## Decisions Made
- Hard-removal only (D-06): no value is routed into `custom` (that field is WIRE-10's scope, Phase 12) and no tombstone comment names the removed property (a comment would re-introduce the string the acceptance gate greps for)
- The unfiltered `pnpm build`'s failure is attributed to 9 pre-existing files unrelated to WIRE-01 (confirmed by baseline + `--force` rerun, and by `git log` showing each file's most recent unrelated commits); left unfixed per the Scope Boundary rule and logged to `deferred-items.md` rather than silently ignored

## Deviations from Plan

### Acknowledged Gap (not an auto-fix — a scope-boundary exclusion)

**1. [Scope Boundary] Unfiltered `pnpm build` cannot exit 0 due to pre-existing, unrelated `applesauce-examples` errors**
- **Found during:** Task 2's pre-edit baseline build and post-edit verification
- **Fix:** None applied — out of scope per the Scope Boundary rule (pre-existing, unrelated to this task's changes). Confirmed `admin-management.tsx` (this plan's edited file) contributes zero errors, via a cache-bypassed (`--force`) rebuild whose error list is identical to the pre-edit baseline minus nothing added
- **Files modified:** None (documented only)
- **Verification:** `pnpm exec turbo build --filter=applesauce-examples --force 2>&1 | grep -i "admin-management\|error TS"` shows only the 9 pre-existing errors, none referencing `admin-management.tsx`
- **Logged:** `.planning/phases/11-messaging-wire-conformance/deferred-items.md`

---

**Total deviations:** 1 acknowledged gap (scope-boundary exclusion, not an auto-fix)

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WIRE-01 is structurally closed: `tsc` now rejects any reintroduced read of a per-channel voice flag anywhere in `packages/*` or `apps/examples`
- A future plan targeting `apps/examples`'s cache-request call sites should resolve the pre-existing `StoredEvent`/`NostrEvent` mismatch tracked in `deferred-items.md` so the unfiltered `pnpm build` can go green again
- Plans 11-03 through 11-06 (WIRE-02..05/11, D-01/D-07 signature and wrap-option changes) remain to execute in this phase

---
*Phase: 11-messaging-wire-conformance*
*Completed: 2026-07-29*

## Self-Check: PASSED

All 5 modified/created source files and the SUMMARY.md itself confirmed present on disk. All 3 task/summary commit hashes (`080df496`, `b23b1107`, `046079f1`) confirmed present in `git log`.
