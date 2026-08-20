---
phase: 17-correctness-fixes-concord-residuals
reviewed: 2026-08-20T13:25:38Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - packages/common/src/helpers/__tests__/groups.test.ts
  - packages/common/src/helpers/groups.ts
  - packages/concord/src/client/__tests__/client.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
  - packages/concord/src/client/__tests__/private-channel.test.ts
  - packages/concord/src/client/admin.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/invite-manager.ts
  - packages/concord/src/client/private-channel.ts
  - packages/concord/src/client/revocation.ts
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/relay.ts
  - packages/sqlite/package.json
  - packages/sqlite/scripts/verify-optional-peers.mjs
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 17: Code Review Report

**Reviewed:** 2026-08-20T13:25:38Z
**Depth:** deep
**Files Reviewed:** 14
**Status:** clean

## Summary

Reviewed every Phase 17 implementation and regression artifact, with a focused cross-file trace of the 17-06 required-publication gap closure through `ConcordCommunityAdmin`, `ConcordCommunity.publishToPlane`, relay acknowledgement validation, revocation ordering, and local tombstone mutation.

The previous CR-01 is closed. A required invite-registry edition now rejects when `publishRequired` is absent, cannot fall through to optimistic `publish`, and applies its local control-plane echo only after at least one relay acknowledges the publication. The member and membership-free revocation paths retain acknowledgement-before-local-mutation ordering, while ordinary admin publications remain optimistic.

All reviewed files meet quality standards. No issues found.

## Narrative Findings (AI reviewer)

No BLOCKER or WARNING findings remain after the 17-06 gap closure.

## Verification

- Focused exported-admin required-publication regression: 1 passed, 66 skipped.
- Full `applesauce-concord` suite: 602 passed.
- `applesauce-concord` TypeScript build: passed.
- Focused group-pointer suite: 13 passed.
- Focused relay suite: 175 passed.

---

_Reviewed: 2026-08-20T13:25:38Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
