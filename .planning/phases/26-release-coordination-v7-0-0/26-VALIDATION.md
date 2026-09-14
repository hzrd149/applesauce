---
phase: "26"
slug: "release-coordination-v7-0-0"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-14"
---

# Phase 26 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Changesets CLI 2.31.1, Vitest 4.1.x, Turbo 2.9.x, and Git plumbing assertions |
| **Config file** | `.changeset/config.json`, `vitest.config.ts`, `turbo.json` |
| **Quick run command** | `pnpm exec changeset status --verbose --since=master --output=/tmp/phase26-status.json` plus the Phase 26 audit checker |
| **Full suite command** | `pnpm test && pnpm build && pnpm --filter applesauce-docs build && pnpm --filter applesauce-examples build` after `pnpm install --frozen-lockfile` |
| **Estimated runtime** | ~900 seconds |

---

## Sampling Rate

- **After every changeset-audit task commit:** Run the sentence parser, unfiltered status, and `--since=master` status checks
- **After every package/release-graph task:** Run focused relay/loaders tests and regenerate the package checklist
- **Before pinning the source tree:** Run the frozen install, full workspace tests/builds, docs/examples builds, cleanup, and exact baseline comparison
- **Before moving local `master`:** Run candidate parent/tree/history checks and snapshot `next` plus all remote refs
- **Max feedback latency:** 900 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 1 | REL-04 | T-26-03, T-26-06 | Every pending note is traceable, single-change, one-line, and one-sentence | static + review | Phase 26 audit checker over every `.changeset/*.md` file | ❌ W0 | ⬜ pending |
| 26-02-01 | 02 | 2 | REL-01, REL-03 | T-26-03, T-26-06 | Exact thirteen-package `7.0.0` result and both held note IDs are proven | integration + regression | Changesets status JSON assertion plus relay/loaders tests | ❌ W0 checklist; ✅ package tests | ⬜ pending |
| 26-03-01 | 03 | 3 | REL-01, REL-03, REL-04 | T-26-04 | Generated residue is removed without changing the lockfile or checkout baseline | integration | frozen install, full tests/builds, docs/examples builds, cleanup, and baseline diff | ✅ established pattern | ⬜ pending |
| 26-04-01 | 04 | 4 | REL-01, REL-03, REL-04 | T-26-01, T-26-02, T-26-05 | Only local `master` moves to a one-commit post-base history with the pinned source tree | Git integration | OID, parent, tree, reachability, compare-and-swap, and preserved-ref assertions | ❌ W0 evidence commands | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [ ] Create `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` with all pending changeset rows and all thirteen package rows
- [ ] Add a dependency-free Node checker for one-line/one-sentence changeset bodies and the exact status JSON package set/version
- [ ] Encode fail-closed Git history proof commands before any ref mutation
- [ ] Resolve closeout ordering so no tracked commit silently moves `next` after the release tree is pinned

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Each changeset describes exactly one semantic change and matches shipped behavior | REL-03, REL-04 | Semantic scope and provenance cannot be established by sentence parsing alone | Review every audit row against its cited phase summary, verification record, historical commit, and current source where needed; require no unresolved rows |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 900s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
