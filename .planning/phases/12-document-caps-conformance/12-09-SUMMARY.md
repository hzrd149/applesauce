---
phase: 12-document-caps-conformance
plan: 09
subsystem: api
tags: [concord, nostr, nip-44, wire-conformance, round-trip]

# Dependency graph
requires:
  - phase: 12-document-caps-conformance
    provides: "12-07 opened ParsedCommunityList/ParsedInviteList at the parse layer with [k: string] unknown index signatures and stopped renaming the wire's entries key; 12-05 owns recordJoin's 50-membership guard and saveCommunityList's byte-cap diagnostic, both left untouched here"
provides:
  - "ConcordClient carries a documentExtras field: a snapshot of the last-read Community List document (all top-level keys, including its own entries/tombstones at read time), captured in watchLists/loadMirror and spread FIRST (assign-after) in saveCommunityList/saveMirror"
  - "ConcordInviteManager carries the identical documentExtras pattern for the Invite List, captured in reconcile() and spread first in save(), cleared on stop()"
  - "A cross-cutting conformance suite (document-caps-conformance.test.ts) proving the round trip end to end through the real client publish path, with three mandatory non-vacuity mutations observed RED"
  - "WIRE-09 closed end to end; REQUIREMENTS.md and STATE.md blockers updated"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-tier document-extras carrier: snapshot the WHOLE last-read document (not stripped of known fields) and rely on spread-first/assign-after ordering at every write site so the client's own authoritative merged arrays always win over a stale snapshot value — distinct from the PARSE-layer open-object idiom (12-07) because the client never holds the whole document as its own state, only this carrier snapshot of it"

key-files:
  created:
    - packages/concord/src/__tests__/document-caps-conformance.test.ts
  modified:
    - packages/concord/src/client/client.ts
    - packages/concord/src/client/invite-manager.ts
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md

key-decisions:
  - "documentExtras stores the WHOLE captured document (including entries/tombstones as of that read), not a stripped extras-only object — this is what makes the spread-first/assign-after ordering at the write sites a real, testable protection rather than a no-op, and matches the plan's must-haves truth that a stale entries key inside the carrier must be provably unable to shadow the client's merged state"
  - "documentExtras is deliberately EXCLUDED from the publishedListFingerprint / publishedFingerprint dirty check in both engines — a value captured there was just read off the same document the fingerprint believes is already on the relay, so its mere presence should never force an extra encrypt/sign/publish; it still travels on the next save triggered for any other reason. Both engines' seed-on-read and compute-on-save fingerprints are unchanged (still {entries, tombstones} only), so they stay shape-identical by construction — no separate verification needed"
  - "The carrier is explicitly NOT the thing D-12 rejected: D-12 rejected a bolted-on field at the PARSE layer where the root itself could be opened and the reconstruction deleted outright. At the client tier there is no reconstruction to delete — list/tombstones ARE the authoritative merged state, and the whole document is never otherwise held in memory. Recorded in both fields' doc comments so a future reader cannot cite D-12 to remove this carrier"
  - "ConcordInviteManager gains no size diagnostic and no new logging (D-25 scopes D-08's diagnostic carve-out to saveCommunityList only; D-20 forbids deriving a logger at a call site, and this task adds no logging at all)"
  - "Task 1's read_first bullet phrase ('destructure entries and tombstones out of it, and accumulate the remaining keys') was superseded during implementation once the must-haves truths and Test C's non-vacuity requirement made clear the carrier must be capable of holding a stale entries/tombstones value for the ordering protection to be real and testable — documented as a deviation below"

requirements-completed: [WIRE-09]

coverage:
  - id: D1
    description: "ConcordClient.saveCommunityList/saveMirror spread a captured document-extras snapshot FIRST, then assign entries/tombstones from the client's own merged arrays — an unrecognized top-level key on the relay's Community List survives a join/leave round trip"
    requirement: "WIRE-09"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/document-caps-conformance.test.ts#Test A: unrecognized top-level keys survive a full read -> merge -> mutate -> publish cycle"
        status: pass
      - kind: unit
        ref: "packages/concord/src/__tests__/document-caps-conformance.test.ts#Test B: the membership mutation actually landed in the published plaintext"
        status: pass
      - kind: unit
        ref: "packages/concord/src/__tests__/document-caps-conformance.test.ts#Test C: preserved keys cannot shadow the client's merged entries"
        status: pass
      - kind: unit
        ref: "packages/concord/src/__tests__/document-caps-conformance.test.ts#Test D: a mirror-only publish (no relay copy ever fetched this session) still preserves an unrecognized key"
        status: pass
      - kind: unit
        ref: "packages/concord/src/__tests__/document-caps-conformance.test.ts#Test F: the wire key set is right — entries/tombstones present, no renamed alias"
        status: pass
    human_judgment: false
  - id: D2
    description: "ConcordInviteManager.save() applies the identical carrier pattern for the Invite List, proven through the manager's own read-and-save cycle"
    requirement: "WIRE-09"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/document-caps-conformance.test.ts#Test E: the Invite List round-trips unrecognized keys through ConcordInviteManager's own read-and-save cycle"
        status: pass
    human_judgment: false
  - id: D3
    description: "Three mandatory non-vacuity mutations at the exact pre-phase defect site observed RED and reverted, proving the suite would have failed against the original hand-rolled two-field literal"
    verification:
      - kind: unit
        ref: "manual revert-observe-restore against packages/concord/src/client/client.ts and invite-manager.ts (see Deviations/Non-Vacuity section below)"
        status: pass
    human_judgment: false

duration: 151min
completed: 2026-07-30
status: complete
---

# Phase 12 Plan 09: ConcordClient/ConcordInviteManager document-extras carrier Summary

**A `documentExtras` snapshot field in both `ConcordClient` and `ConcordInviteManager`, spread first and overridden after by the client's own merged arrays at every publish/mirror write site, closing WIRE-09 at the tier a real consumer actually uses**

## Performance

- **Duration:** ~151 min
- **Started:** 2026-07-30T13:35:00Z (approx, first commit 13:36:45)
- **Completed:** 2026-07-30T16:07:41Z
- **Tasks:** 3 (plus 1 in-flight design correction, see Deviations)
- **Files modified:** 3 (client.ts, invite-manager.ts, new test file) + REQUIREMENTS.md + STATE.md

## Accomplishments

- `ConcordClient` gained a private `documentExtras` field: a snapshot of the last-read Community List document (every top-level key, INCLUDING its own `entries`/`tombstones` as of that read), captured in `watchLists` (off the cast's event via `getCommunityList`) and in `loadMirror` (off the parsed mirror payload), and spread FIRST — before `entries`/`tombstones` are assigned from `this.list`/`this.tombstones` — in both `saveCommunityList` and `saveMirror`.
- `ConcordInviteManager` gained the identical `documentExtras` field, captured in `reconcile()` off the cast's event via `getInviteList`, spread first in `save()`, and cleared in `stop()` alongside `invites`/`tombstones`/`publishedFingerprint` so a restart cannot replay a previous session's snapshot onto a document never read this session.
- The hand-rolled two-field plaintext literals (`JSON.stringify({ entries: list, tombstones })` and `JSON.stringify({ entries: this.invites, tombstones: this.tombstones })`) — the exact site D-23 identifies as WIRE-09's real defect — are both gone.
- A new cross-cutting suite, `packages/concord/src/__tests__/document-caps-conformance.test.ts`, drives the round trip through the real public API (`ConcordClient.start()`, `.createNewCommunity()`, `ConcordInviteManager.record()`) with six behavioral tests (A–F), asserting only on decrypted, `JSON.parse`d raw plaintext — never through the package's own parse helpers, which would apply the identical transformation on both sides and hide a regression.
- Three mandatory non-vacuity mutations were performed at the exact pre-phase defect sites and each observed RED before being reverted (see below).
- WIRE-09 is now closed end to end; `REQUIREMENTS.md` and `STATE.md`'s carried-forward blocker notes for plans 12-01/02/03/07/08 (all of which explicitly deferred WIRE-09's completion to this plan) are resolved.

## Task Commits

Each task was committed atomically:

1. **Task 1: ConcordClient document-extras carrier** — `247719d1` (feat), corrected by `a4eb78e2` (fix, see Deviations)
2. **Task 2: ConcordInviteManager document-extras carrier** — `d731ff20` (feat), corrected by `e3f8fcf3` (fix, see Deviations)
3. **Task 3: cross-cutting conformance suite** — `2f6955a0` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/concord/src/client/client.ts` — new private `documentExtras` field; capture sites in `watchLists`/`loadMirror`; spread-first write sites in `saveCommunityList`/`saveMirror`
- `packages/concord/src/client/invite-manager.ts` — new private `documentExtras` field; capture site in `reconcile()`; spread-first write site in `save()`; cleared in `stop()`
- `packages/concord/src/__tests__/document-caps-conformance.test.ts` (NEW) — the phase's cross-cutting WIRE-09 conformance suite (Tests A–F)
- `.planning/REQUIREMENTS.md` — WIRE-09 marked Complete
- `.planning/STATE.md` — stale WIRE-09 blocker notes (from plans 12-01/02/03/07/08) cleared; position/decisions/metrics updated

## Decisions Made

See `key-decisions` in frontmatter. Most notably: the carrier stores the WHOLE last-read document snapshot (not a stripped extras-only object), because that is the only design under which the spread-first/assign-after ordering is a real, testable protection rather than a structurally-guaranteed no-op — see Deviations below for how this was discovered mid-implementation.

The fingerprint decision (Task 1/2's required deliberate choice): `documentExtras` is EXCLUDED from both `publishedListFingerprint` and `publishedFingerprint`. A value captured there was just read off the same document the fingerprint believes is on the relay, so its presence alone should never force a fresh encrypt/sign/publish — it still travels on the next save triggered for any other reason (a join, a leave, a sync-time epoch catch-up). Both engines' seed-on-read computation (`watchLists`/`reconcile`) and compute-on-save computation (`saveCommunityList`/`save`) remain unchanged — still `canonicalJson({ entries, tombstones })` — so they are trivially shape-identical; there is no risk of the publish-loop scenario Task 1/2 warned against.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug/design correction] `documentExtras` redesigned to snapshot the whole document rather than a stripped extras-only object**
- **Found during:** Task 1, while preparing Task 3's non-vacuity mutations
- **Issue:** Task 1's `read_first` bullet literally reads "destructure `entries` and `tombstones` out of it, and accumulate the remaining keys into `documentExtras`" — my first implementation followed this literally, storing only the OTHER top-level keys (stripped of `entries`/`tombstones`). But the plan's own `must_haves.truths` explicitly state: "The preserved keys never shadow entries or tombstones: the spread comes first and both arrays are assigned after, so a document carrying a stale `entries` key cannot override the client's own merged state" — this is only a meaningful, testable property if the carrier CAN hold an `entries` key. Under the stripped design, `documentExtras` never contains `entries`/`tombstones` by construction, so Task 3's required non-vacuity mutation #2 (reorder the spread to come LAST) would have been a semantic no-op — object-spread order is irrelevant when the two operands share no keys — and Test C could never go RED as the plan mandates.
- **Fix:** Changed both capture sites (`watchLists`, `loadMirror` in `client.ts`; `reconcile` in `invite-manager.ts`) to snapshot the ENTIRE parsed document (`{ ...this.documentExtras, ...document }`), including whatever `entries`/`tombstones` that document held at read time. The write sites (`saveCommunityList`, `saveMirror`, `save()`) were already correctly spread-first/assign-after, so no change was needed there — only the capture sites changed. This makes the ordering protection real: a later mutation grows `this.list` beyond what was captured in the snapshot, so the snapshot's own stale `entries` is now genuinely inconsistent with the merged state, and only the assign-after ordering keeps it from winning.
- **Files modified:** `packages/concord/src/client/client.ts`, `packages/concord/src/client/invite-manager.ts`
- **Verification:** Task 3's mutation #2 (reorder the spread to LAST in `saveCommunityList`) now observably fails Test B/C/D; reverted. Full acceptance-criteria greps re-run and passed under the corrected design (see Task 1/2 acceptance criteria below).
- **Committed in:** `a4eb78e2` (client.ts), `e3f8fcf3` (invite-manager.ts)

---

**Total deviations:** 1 auto-fixed design correction (Rule 1 — a defect in the interim implementation's fidelity to the plan's own testable must-haves, caught before Task 3's suite was written).
**Impact on plan:** Necessary — without it, the plan's own mandated non-vacuity mutation #2 could never produce the required RED result, meaning the phase's headline guarantee (WIRE-09 proven by a test that fails against the pre-phase site) would have been unprovable for the shadowing property specifically. No scope creep: the final design still satisfies every literal acceptance-criteria grep in the plan (spread precedes `entries` assignment at all three write sites, `documentExtras` count thresholds, no whole-document cast accessor, `.extend()` counts unchanged, byte-cap/membership-guard/diagnostic wording all intact).

## Non-Vacuity: Three Mandatory Mutations (Task 3)

All three performed via a temporary in-place edit, `npx vitest run src/__tests__/document-caps-conformance.test.ts` to observe the result, then restored from a pre-edit copy and re-diffed (`git diff --stat` empty) to confirm an exact revert:

1. **Restored the two-field literal in `saveCommunityList`** (`JSON.stringify({ entries: list, tombstones })`, dropping the `documentExtras` spread) — Test A and Test D failed (`expected undefined to be 7`, the seeded scalar key vanished). Reverted.
2. **Reordered `saveCommunityList`'s plaintext so the carrier spread comes LAST** (`JSON.stringify({ entries: list, tombstones, ...this.documentExtras })`) — Test B, C, and D failed: the published `entries` reverted to the stale single-community snapshot captured before the mutation, losing the newly-created community entirely (Test C's exact "preserved keys cannot shadow" failure mode). Reverted.
3. **Removed the carrier spread from `invite-manager.save()`** (`JSON.stringify({ entries: this.invites, tombstones: this.tombstones })`) — only Test E failed, in isolation from the Community List tests, confirming the two engines' carriers are independent. Reverted.

All three mutations produced the exact failure mode each observation was designed to detect, and each revert restored a byte-identical diff against the prior commit (`git diff --stat` empty after restoring from the pre-mutation copy).

## Issues Encountered

None beyond the design correction documented above — no auth gates, no checkpoints, no blocking issues requiring Rule 3 fixes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- WIRE-09 is closed end to end at the client publish tier; the phase's remaining requirements (WIRE-06/07/08/10/12, TEST-01/02) were already closed by prior plans in this phase (12-01 through 12-08).
- Phase gate green across all four affected packages: `applesauce-concord` (546 tests, 54 files), `applesauce-core` (671 tests, 59 files), `applesauce-common` (533 tests, 65 files), `applesauce-relay` (150 tests, 8 files).
- `npx tsc --noEmit -p packages/concord/tsconfig.json` exits 0.
- No `.changeset/` file created (D-19 — `applesauce-concord` is unreleased; this plan's changes are internal-only, no public API surface widened).
- This is the final plan (9 of 9) in Phase 12 (document-caps-conformance). Phase completion / transition is the next step, not a further plan.

---
*Phase: 12-document-caps-conformance*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: `.planning/phases/12-document-caps-conformance/12-09-SUMMARY.md`
- FOUND commits: `247719d1`, `d731ff20`, `a4eb78e2`, `e3f8fcf3`, `2f6955a0`
