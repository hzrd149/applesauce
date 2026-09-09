---
phase: 09
slug: authority-permission-fold-correctness
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-19
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `09-RESEARCH.md` § Validation Architecture and the five committed plans (09-01…09-05).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Config file** | `vitest.config.ts` (repo root) |

---

## Sampling Rate

- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*TEST-01 (standing) is cross-cutting: every row above pairs its fix with an independently hand-derived CORD-04 spec value plus a non-vacuity check (see § Non-Vacuity below).*

---

## Wave 0 Requirements

*None — existing infrastructure covers all phase requirements.* `helpers/__tests__/control.test.ts`, `helpers/__tests__/guestbook.test.ts`, and `client/__tests__/community.test.ts` already exist with the right shape (imports, `decoded()` fixture helper, `createCommunity` / `EditionFactory` scaffolding) to extend directly. No new test file or shared fixture is needed (`wave_0_complete: true`).

---

## Non-Vacuity Checks (TEST-01 / D-12)

Every behavioral fix ships with a test that flips RED when the guard is reverted:

- **AUTH-03:** comment out the coordinate gate → the forged-eid Grant folds.
- **AUTH-04:** remove the shape guard → `foldControl` throws an uncaught `TypeError` (reproduces M06).
- **AUTH-05:** remove the local guard → `kick()`/`ban()` resolve without throwing for an under-ranked caller (L04 symptom).
- **AUTH-06:** revert the `Number.isInteger` guard → a `NaN`-position role folds and confers bits (L05 symptom).
- **AUTH-07:** revert the target-rank gate → the junior's revoke Grant folds (vacuous-`[].every()` hole).
- **AUTH-08:** pass `undefined` for `verifyVac` → the demoted actor's Kick succeeds (S02 symptom).
- **D-14:** revert the per-entry rank check or the owner exemption independently → junior bans senior / owner gets banned.

Spec values are computed **by hand** from the CORD-04/02 formula (or from the frozen `crypto.ts` coordinate primitives called directly — never from `foldControl`/`foldMembers` under test), per D-12.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Upstream CORD-04 §2/§3 clarification note filed (D-03) | AUTH-07 rider | Documentation artifact, not code behavior | Confirm plan 09-05 Task 1 produced the note (GH issue or in-repo note referenced from the changeset), per D-03 discretion |
| REQUIREMENTS/audit traceability updated; D-14 recorded as a NEW finding | AUTH-03..08 + D-14 | Planning-doc bookkeeping | Confirm plan 09-05 Task 2 marked AUTH-03..08 resolved and added the D-14 banlist rider as a new finding |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (Wave 0 empty — infra exists)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every behavioral task carries a targeted vitest command)
- [x] Wave 0 covers all MISSING references (none missing)
- [x] No watch-mode flags (all commands are single-shot `pnpm ... test`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-19
