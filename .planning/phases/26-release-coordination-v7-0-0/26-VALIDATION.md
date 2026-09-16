---
phase: "26"
slug: "release-coordination-v7-0-0"
status: in_progress
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
- **During intended-tree construction (26-05):** Per D-13/D-14/D-16, derive INTENDED_TREE from the old installed master tree plus exactly the two authorized backticked COUNT/event blobs; exhaustively validate every schema field, computed identity, live state value, and frontmatter/body/blob relationship without touching the ordinary index
- **During isolated re-gating (26-06):** Run the fresh complete clean gate against INTENDED_TREE before CAS, then capture a new Task-2-local complete preservation pair after Task 1's execution commit and independently reconstruct the whole gate contract, exact 13-package 9/4 oracle, held IDs, inventories/guards, restoration/current state, temporary-worktree absence, terminal hashes, immutable index/bodies/untracked/HEAD/all refs/lock, and the sole validation-file worktree delta
- **During reconstruction/oracle work (26-07):** Execute the sole local-master CAS, compare complete all-ref snapshots with only the authorized master delta, then regenerate the canonical oracle from installed master; consume `status.json.next` as a transient atomic-rename candidate and compare complete Task-2 worktree records/hashes with exactly the audit/validation deltas
- **At semantic review (26-08):** Independently derive every field of all 74 records from matching NEW_MASTER/INTENDED_TREE blobs and exactly one pinned-audit row, then hash an envelope binding master, tree, manifest, pinned audit blob, and oracle before recording the exact response
- **At cleanup/final acceptance (26-09):** Structurally extract the fixed Plan 26-03 Task 1 action, enforce the immutable exact 25-source plan/task→role→expectation map, rerun complete semantic/cleanup derivations and both bounded records, and parse the complete/green twelve-row final validation contract immediately before and after closing exactly six REQUIREMENTS lines
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
| 26-05-01 | 05 | 5 | REL-01, REL-03, REL-04 | T-26R-01, T-26R-02, T-26R-03 | Fixed-schema preflight captures complete state and audits exactly the two authorized bodies under D-13/D-14/D-16 | static/Git | Exhaustive top-level/nested key, primitive, order/uniqueness, computed OID/hash, live-state, capturedAt, and body/frontmatter/blob/provenance assertions | ⬜ generated by task | ⬜ pending |
| 26-05-02 | 05 | 5 | REL-01, REL-03, REL-04 | T-26R-01, T-26R-03 | Private-index intended tree has exactly two direct blob-equal path deltas and preserves developer state | Git plumbing | Complete diff inventory, git-cat-file hashes, and structural before/after snapshot comparison | ⬜ generated by task | ⬜ pending |
| 26-06-01 | 06 | 6 | REL-01, REL-03, REL-04 | T-26R-04, T-26R-05, T-26-SC | Full frozen gate runs against exact INTENDED_TREE with concrete before/after inventories | integration | Five release commands plus blob parser, isolated oracle, held assertions, sorted inventory, and ordered statuses | ⬜ generated by task | ⬜ pending |
| 26-06-02 | 06 | 6 | REL-01, REL-03, REL-04 | T-26R-05, T-26R-06 | Per-path guards pass, generated after inventory is empty, complete gate state restores, and a fresh post-Task-1 Task-2 pair preserves index/bodies/untracked/HEAD/all refs/lock with only the validation-file worktree delta | integration/static | Independent full gate reconstruction plus Task-2-local before/after schema/state comparison; no cross-task HEAD equality | ⬜ generated by task | ⬜ pending |
| 26-07-01 | 07 | 7 | REL-01, REL-03, REL-04 | T-26R-07, T-26R-08 | Exactly one expected-old master CAS occurs after candidate proof and every other ref/state identity is unchanged | Git integration | Sole-command ledger, complete all-ref map comparison, and tree/parent/count/history/state assertions | ⬜ generated by task | ⬜ pending |
| 26-07-02 | 07 | 7 | REL-01, REL-03, REL-04 | T-26R-09 | Installed-master JSON and exact thirteen audit rows agree directly while every undeclared Task-2 worktree record is byte-identical | integration/static | Filesystem JSON load, exact 9-direct/4-cascade sets, held IDs, table-cell equality, transient-candidate absence, and complete worktree record/hash comparison | ⬜ generated by task | ⬜ pending |
| 26-08-01 | 08 | 8 | REL-03, REL-04 | T-26R-10, T-26R-11 | All 74 complete records come from matching NEW_MASTER/INTENDED_TREE blobs and exactly one pinned audit row; the hashed envelope binds master, tree, manifest, audit, and oracle | Git/static | Independent dual-tree reconstruction of exact record keys, packageBump/body/blob OID/SHA, unique audit row/ID, semantic/disposition/provenance, and envelope equality | ⬜ generated by task | ⬜ pending |
| 26-08-02 | 08 | 8 | REL-04 | T-26R-12 | Human reviews the immutable manifest plus identity envelope and supplies one exhaustive response | manual judgment | Envelope/manifest digest precheck plus blocking-human response | ⬜ generated by task | ⬜ pending |
| 26-08-03 | 08 | 8 | REL-04 | T-26R-12 | Exactly one semantic record validates against retained envelope identities | static/judgment | Unique marker/JSON parser with exact response, scope, timestamp, envelope/manifest digests, master/tree/oracle | ⬜ generated by task | ⬜ pending |
| 26-09-01 | 09 | 9 | REL-01, REL-03, REL-04 | T-26R-13, T-26R-14 | Fixed five assertions, 57 removals, three authority-correct relocation/restoration records, fresh evidence, and the immutable exact 25-source map are structurally packetized | static | ElementTree extraction, predetermined literals, source/action hashes, relocation roots from temporarily-relocated-untracked.txt, exact paths/record bytes from byte-identical status snapshots, and final.env limited to recorded Git identities | ⬜ generated by task | ⬜ pending |
| 26-09-02 | 09 | 9 | REL-01, REL-03, REL-04 | T-26R-15 | Human reviews the fixed cleanup packet and supplies one permitted response | manual judgment | Packet digest precheck plus blocking-human response | ⬜ generated by task | ⬜ pending |
| 26-09-03 | 09 | 9 | REL-01, REL-03, REL-04 | T-26R-15 | Both bounded records, complete derivations, and all twelve redesigned deterministic/manual validation rows are complete/green before and after exact six-line requirement closure | static/judgment | Rerun all semantic/cleanup proofs; parse complete frontmatter, twelve exact rows, both checked acceptance items, complete sign-off, and final approval immediately before and after substitutions; then compare transformed REQUIREMENTS bytes | ⬜ generated by task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [x] Plan 26-01 creates `26-RELEASE-AUDIT.md` with 73 physical-input rows and final-note accounting
- [x] Plans 26-01/02 carry dependency-free Node checks for note shape and exact status package set/version
- [x] Plan 26-04 encodes fail-closed candidate/ref proof commands before any ref mutation
- [x] Plan 26-04 pins immutable SOURCE, detaches closeout bookkeeping so next never moves, and confines later descendants to `.planning/**`
- [x] Plan 26-04 final verification parses both requirement checkboxes and Phase 26 traceability statuses for REL-01, REL-03, and REL-04
- [x] Plan 26-05 defines and validates complete preservation/preflight schemas and proves the exact two-blob intended tree
- [x] Plan 26-06 owns the isolated full gate, concrete generated inventories, exact restoration, terminal binding, and a fresh post-Task-1 Task-2 preservation pair with one exact validation-file delta
- [x] Plan 26-07 owns the sole master CAS, complete all-ref comparison, canonical oracle, and exact thirteen-row table
- [x] Plan 26-08 derives all changeset values from matching NEW_MASTER/INTENDED_TREE blobs and binds manifest, pinned audit blob, oracle, master, and tree in one hashed envelope before human review
- [x] Plan 26-09 uses ElementTree structural extraction, the predetermined exact five claim/assertion literals, independent full/action hashes, and an exact 25-source hashed producer/expectation ledger whose restoration authority comes from the relocation file plus byte-identical status snapshots while final.env remains Git-identity-only
- [x] Plans 26-05/06/07 retain their 10/13/13-file evidence sets as explicit atomic proof boundaries because splitting would break stage-local snapshot comparisons, terminal-hash closure, or CAS atomicity; estimates include that evidence cost
- [x] Plans 26-08/09 parse unique bounded acceptance records locally and defer REQUIREMENTS closure until both exact acceptances
- [x] Every runnable gap-plan `<automated>` command has an immediate outcome-specific `<fails_when>` sibling

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Each changeset describes exactly one semantic change and matches shipped behavior | REL-03, REL-04 | Semantic scope and provenance cannot be established by sentence parsing alone | Review every audit row against its cited phase summary, verification record, historical commit, and current source where needed; require no unresolved rows |
| Historical cleanup preserved unrelated ignored/untracked content | REL-01, REL-03, REL-04 | Deleted ignored content cannot be reconstructed solely from post-run state | Review all 57 generated removal paths, the containment/ignore/no-symlink guards, and evidence for all three restored pre-existing runtime paths; require the exact cleanup acceptance signal |

---

## Validation Sign-Off

- [x] All auto/tracer tasks have `<automated>` verify; pure human checkpoints have explicit manual rows and adjacent automated preparation/recording tasks
- [x] Sampling continuity: no 3 consecutive tasks without automated verification
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Fast preflight feedback &lt;30s; mandatory D-08 full gate remains ~900s
- [x] `nyquist_compliant: true` set in frontmatter
- [ ] Plans 26-05 through 26-09 are green
- [ ] Exact response `SEMANTIC REVIEW: ACCEPT ALL 74` is durably recorded in the sole bounded semantic record as ACCEPTED
- [ ] Exact response `CLEANUP SAFETY: ACCEPT 57 REMOVALS AND 3 RESTORATIONS` is durably recorded in the sole bounded cleanup record as ACCEPTED

**Approval:** pending — all redesigned 26-05 through 26-09 rows and both structurally bounded human acceptance records must be green; any duplicate or recorded rejection keeps this sign-off incomplete
