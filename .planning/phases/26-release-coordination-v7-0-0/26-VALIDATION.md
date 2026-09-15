---
phase: "26"
slug: "release-coordination-v7-0-0"
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| **Quick run command** | Fail-closed Plan 26-03 preflight: validate release metadata, capture baseline/lock/HEAD, and prove cleanup candidates repository-contained, ignored, and non-symlinked before the long gate |
| **Full suite command** | `pnpm test && pnpm build && pnpm --filter applesauce-docs build && pnpm --filter applesauce-examples build` after `pnpm install --frozen-lockfile` |
| **Estimated runtime** | preflight &lt;30 seconds; mandatory full gate ~900 seconds |

---

## Sampling Rate

- **After every changeset-audit task commit:** Run the sentence parser, unfiltered status, and `--since=master` status checks
- **After every package/release-graph task:** Run focused relay/loaders tests and regenerate the package checklist
- **Before pinning the source tree:** Run the frozen install, full workspace tests/builds, docs/examples builds, cleanup, and exact baseline comparison
- **Before moving local `master`:** Run candidate parent/tree/history checks and snapshot `next` plus all remote refs
- **Fast preflight feedback latency:** &lt;30 seconds before the mandatory ~900-second full gate
- **Max full-gate latency:** ~900 seconds (required by D-08)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 1 | REL-03, REL-04 | T-26-01, T-26-02, T-26-04 | All 73 physical pending notes are individually audited and known scope/sentence defects are corrected | static + review | Complete-note parser plus 73-row matrix assertion | ✅ audit artifact | ✅ green |
| 26-01-02 | 01 | 1 | REL-03, REL-04 | T-26-02 | Every disposition has recoverable semantic provenance and both held notes are flagged | static + judgment | Audit-row/provenance and held-ID assertion | ✅ audit artifact | ✅ green |
| 26-02-01 | 02 | 2 | REL-01 | T-26-05, T-26-06, T-26-08 | Exactly thirteen publishable packages compute `7.0.0` with derived direct/downstream classification | integration/static | Changesets status JSON exact-set/version assertion | ✅ checklist | ✅ green |
| 26-02-02 | 02 | 2 | REL-03 | T-26-07 | Both held note IDs are present and proven against current relay/loaders behavior | regression + static | Relay/loaders tests plus status/audit assertion | ✅ package tests and matrix | ✅ green |
| 26-03-01 | 03 | 3 | REL-01, REL-03, REL-04 | T-26-09, T-26-10, T-26-11, T-26-SC | Fast cleanup/baseline preflight passes; every full-gate command and restoration check records status 0/PASS before a terminal completion marker | integration | Under-30-second fail-closed preflight, then exact thirteen-step status/terminal-marker assertion for frozen install, tests/builds, docs/examples, Changesets, cleanup, and restoration | ✅ status ledger | ✅ green |
| 26-03-02 | 03 | 3 | REL-01, REL-03, REL-04 | T-26-09, T-26-11, T-26-12 | Exact status/lock baseline is restored and gated source is recorded | integration/static | Direct pre/post status diff, lock hash equality, empty inventory | ✅ evidence files | ✅ green |
| 26-04-01 | 04 | 4 | REL-01, REL-03, REL-04 | T-26-13, T-26-14, T-26-15, T-26-17 | Candidate has pinned tree/sole base parent, resulting-master reachable history has no Concord product/release path or content, only local master moves by CAS, and next stays pinned | Git integration | OID/parent/tree/count checks plus per-reachable-commit case-insensitive path/blob scans with explicit grep status branching and preserved-ref assertions | ✅ final evidence | ✅ green |
| 26-04-02 | 04 | 4 | REL-01, REL-03, REL-04 | T-26-16, T-26-18 | Final identities are recorded, later GSD commits are detached planning-only, and all three requirement checkbox and traceability statuses are Complete | Git integration/static | Fail-closed SOURCE-to-worktree path list parsed for `.planning/**` only; REQUIREMENTS parser asserts checked rows and `Phase 26 | Complete` traceability rows for REL-01/03/04 | ✅ final evidence | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [x] Plan 26-01 creates `26-RELEASE-AUDIT.md` with 73 physical-input rows and final-note accounting
- [x] Plans 26-01/02 carry dependency-free Node checks for note shape and exact status package set/version
- [x] Plan 26-04 encodes fail-closed candidate/ref proof commands before any ref mutation
- [x] Plan 26-04 pins immutable SOURCE, detaches closeout bookkeeping so next never moves, and confines later descendants to `.planning/**`
- [x] Plan 26-04 final verification parses both requirement checkboxes and Phase 26 traceability statuses for REL-01, REL-03, and REL-04

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Each changeset describes exactly one semantic change and matches shipped behavior | REL-03, REL-04 | Semantic scope and provenance cannot be established by sentence parsing alone | Review every audit row against its cited phase summary, verification record, historical commit, and current source where needed; require no unresolved rows |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Fast preflight feedback &lt;30s; mandatory D-08 full gate remains ~900s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete — all eight task rows are green and the immutable release-history evidence is retained
