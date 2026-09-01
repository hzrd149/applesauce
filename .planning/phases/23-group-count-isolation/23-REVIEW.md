---
phase: 23-group-count-isolation
reviewed: 2026-09-01T23:51:07Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - .changeset/relay-group-count-progressive.md
  - apps/docs/loading/relays/pool.md
  - packages/relay/src/__tests__/group-count.test.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/group.ts
  - packages/relay/src/pool.ts
  - packages/relay/src/types.ts
  - packages/relay/type-tests/group-count-types.ts
findings:
  critical: 3
  warning: 0
  info: 0
  total: 3
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-09-01T23:51:07Z
**Depth:** deep
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The progressive Group COUNT accumulator, synchronous settlement paths, normalized dynamic membership, replay/reset/cancellation behavior, Pool/type forwarding, docs, provenance, and mutation evidence were reviewed. All 383 relay tests pass, but three dynamic/replay terminal defects remain untested.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Removing the last settled outcome replays a stale removed relay

**File:** `packages/relay/src/group.ts:480-493,520-523`
**Issue:** When membership removes the only settled relay while another active relay is still pending, `outcomes.size` becomes zero and no internal value is sent to the `ReplaySubject`. Its buffer therefore remains the previous snapshot containing the removed URL. A subscriber joining the still-active operation immediately receives that stale outcome, violating latest-cohort membership and replay semantics. The terminal-only sentinel does not cover this active, temporarily outcome-empty state.
**Fix:** Emit an internal non-public empty/retraction sentinel whenever the latest replayable snapshot becomes empty, not only on terminal empty completion, and filter it from the public stream. Add a pending-retained/remove-last-settled/late-subscriber test.

### CR-02: Same-URL replacement does not immediately retract the replaced outcome

**File:** `packages/relay/src/group.ts:480-506`
**Issue:** Replacing a relay instance with another instance at the same normalized URL deletes the old outcome, but `changed` compares only URL-set membership and length. It remains false for same-URL replacement, so subscribers and the replay buffer continue exposing the old instance's settled result until the replacement settles. This contradicts the requirement that replacement immediately discards the old COUNT/result and makes partial snapshots provisional against the latest instance.
**Fix:** Treat relay-instance replacement as a cohort change, update/clear replay immediately, and start the replacement only after the replacement cohort state is installed. Cover replacement after an already-emitted success with a pending replacement and late subscriber.

### CR-03: A membership source that completes without emitting leaves count open forever

**File:** `packages/relay/src/group.ts:510-513`
**Issue:** The membership subscription handles `next` and `error` but not `complete`. For `new RelayGroup(EMPTY).count(...)`, no cohort is ever installed and `finishIfSettled()` is never invoked, so the finite operation neither emits nor completes. D-09 requires membership completion to let the current cohort settle; when the current cohort is empty, it must complete immediately and replay completion without `{}`.
**Fix:** Add a membership `complete` handler that records source completion and calls the common settlement decision. Preserve pending active counts when non-empty, but complete immediately for the empty current cohort. Add `EMPTY` and completed-after-pending membership tests.

---

_Reviewed: 2026-09-01T23:51:07Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
