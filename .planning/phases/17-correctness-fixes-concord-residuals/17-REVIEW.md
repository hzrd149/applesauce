---
phase: 17-correctness-fixes-concord-residuals
reviewed: 2026-08-20T12:28:05Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - packages/concord/src/client/__tests__/client.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
  - packages/concord/src/client/__tests__/private-channel.test.ts
  - packages/concord/src/client/admin.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/invite-manager.ts
  - packages/concord/src/client/private-channel.ts
  - packages/concord/src/client/revocation.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-08-20T12:28:05Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The canonical SUMMARY.md scope yielded eight Concord source and test files covering the fatal-only AUTH UI boundary and invite-revocation publication ordering. The AUTH boundary and direct revocation paths are internally consistent, but the new required-ack abstraction contains a public fallback that silently discards the guarantee it advertises.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: BLOCKER — required registry publication silently becomes optimistic when its callback is absent

**File:** `packages/concord/src/client/admin.ts:151`

**Issue:** `publishEdition(..., required = true)` uses `publishRequired` only when the optional callback happens to exist; otherwise it falls back to the ordinary optimistic `publish` callback. `ConcordCommunityAdmin` and its options are publicly exported, so a valid external construction that omits `publishRequired` can call `unregisterInviteLink()`, return success without inspecting any relay acknowledgements, and allow the enclosing revocation flow to report `revoked: true` even when every relay rejected the registry removal. This violates the method's required-publication contract and makes correctness depend on one particular constructor call site.

**Fix:** Make `publishRequired` mandatory in `ConcordCommunityAdminOptions`, or fail closed when a required publication is requested without it. For example:

```ts
if (required) {
  if (!this.opts.publishRequired) throw new Error("required publisher is not configured");
  await this.opts.publishRequired(rumor);
} else {
  await this.opts.publish(rumor);
}
```

Add a regression that constructs the exported admin without `publishRequired` and proves `unregisterInviteLink()` rejects rather than falling back to optimistic publication.

---

_Reviewed: 2026-08-20T12:28:05Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
