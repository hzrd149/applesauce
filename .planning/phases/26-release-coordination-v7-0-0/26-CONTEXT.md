# Phase 26: Release Coordination - v7.0.0 - Context

**Gathered:** 2026-09-14T18:11:49Z
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 26 prepares the coordinated stable `applesauce-*@7.0.0` release without publishing it. It audits and corrects pending changesets, proves all thirteen publishable packages resolve to `7.0.0`, reruns the full clean-checkout release gate, and rewrites local `master` from the last pre-Concord base into one squash commit whose tree exactly matches the reviewed `next` tree. Version mutation, npm publication, pushes, tags, GitHub releases, and a publication runbook are outside this phase.

</domain>

<decisions>
## Implementation Decisions

### Changeset Truth Audit
- **D-01:** Audit every pending `.changeset/*.md` file for semantic accuracy, one-change scope, and a single-sentence Markdown body.
- **D-02:** Use the owning phase summaries and verification records as the semantic provenance for each changeset.
- **D-03:** Rewrite inaccurate or stale wording, split files that describe genuinely distinct changes, and remove duplicate or no-longer-shipped notes.
- **D-04:** Retain one committed Phase 26 audit matrix mapping every pending changeset to its package, compliance result, summary provenance, and final disposition.
- **D-05:** The held v1.2 `applesauce-relay` and `applesauce-loaders` changesets must be explicitly identified in the matrix and confirmed to describe behavior present in the final release tree.

### Release Stopping Point
- **D-06:** Stop at a release-ready local commit. Do not run `changeset version`, mutate package versions or changelogs, run `changeset publish`, publish npm packages, push branches, create tags, or create a hosted release.
- **D-07:** Do not add a post-phase publication runbook. Phase 26 ends with its release evidence and the release-ready local history.
- **D-08:** Define release readiness with a full clean-checkout gate: frozen-lockfile installation, all package tests and builds, documentation and examples builds, Changesets audits, repository cleanup, unchanged `pnpm-lock.yaml`, and exact restoration of the recorded non-generated checkout baseline.

### Thirteen-Package Version Result
- **D-09:** A publishable package does not need its own changeset when the current internal dependency graph legitimately propagates the coordinated major bump.
- **D-10:** The final `changeset status --verbose --since=master` output is the source of truth and must show all thirteen publishable packages resolving to `7.0.0`.
- **D-11:** Keep an explicit package checklist recording each package name, computed `7.0.0` version, and whether its bump is direct or downstream from `applesauce-core` through the current release graph.
- **D-12:** If a package disappears from the final computed release, diagnose the release graph discrepancy. Do not invent a no-op changeset merely to force inclusion.

### Squash and Reachable History
- **D-13:** The original reviewed source remains `SOURCE=4786d952e04eb4535e9c776d86adf4058c69801f`, `SOURCE_TREE=0099380fb3df8c9e97b4ac19b0066e32e445d617`, and the installed result remains `OLD_INSTALLED_MASTER=399eea787eb86e4eeab3a7c8138092255fce180f` with `OLD_INSTALLED_MASTER_TREE=0099380fb3df8c9e97b4ac19b0066e32e445d617`; those identities are retained as superseded-source provenance, not silently redefined. For this user-approved gap closure, the final reviewed release source is `INTENDED_TREE = OLD_INSTALLED_MASTER_TREE` plus exactly two authorized blob replacements and no other tree delta: `.changeset/relay-count-nip45.md` with body `Make \`COUNT\` a validated high-level Observable with configurable policy and NIP-45 HLL utilities.` and `.changeset/relay-event-publish-layering.md` with body `Make \`event\` a one-attempt raw interaction and move authentication, retry, reconnect, and timeout policy to publish.` Both developer-authored edits remain uncommitted and byte-preserved in the developer checkout while their exact blobs are audited into `INTENDED_TREE`.
- **D-14:** Run a fresh full D-08 gate against exactly `INTENDED_TREE` before reconstructing local `master` from the last pre-Concord base. Only after that gate and independent reconstruction pass, replace the old installed master with one expected-old compare-and-swap to a new squash commit whose tree is byte-identical to `INTENDED_TREE` and whose sole parent is the re-verified base. A normal squash merge onto current `master`, reuse of the old gate alone, or construction from mutable worktree bytes is insufficient. — **Reversibility:** costly — changing the selected base or intended tree requires reconstructing and re-verifying the rewritten branch.
- **D-15:** Update local `master` with the verified squash commit while leaving `next` and all remote refs untouched.
- **D-16:** Record the complete supersession chain: original `SOURCE`/`SOURCE_TREE`, `OLD_INSTALLED_MASTER`/`OLD_INSTALLED_MASTER_TREE`, both authorized path→old-blob→approved-blob relationships, `INTENDED_TREE`, fresh-gate commit/tree and terminal hashes, pre-Concord base, resulting `NEW_MASTER`/tree, expected-old CAS proof, tree equality, and the case-insensitive reachable-history absence check for Concord code. The old identities remain provenance for the prior reviewed installation; `INTENDED_TREE` and its fresh gate are the reviewed release source for the new CAS.

### the agent's Discretion
- Choose the audit matrix filename and exact table layout as long as every pending changeset and all thirteen packages are explicit and traceable.
- Choose safe temporary refs or backup refs used while constructing and verifying the local rewrite, provided the final local branch and remote boundaries above are preserved.
- Choose exact full-gate commands by reusing the strongest existing Phase 25.5 release checks and current package scripts.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and Release Contract
- `.planning/ROADMAP.md` - Phase 26 requirements, success criteria, and the squash-history boundary.
- `.planning/REQUIREMENTS.md` - REL-01, REL-03, and REL-04 definitions and traceability.
- `.planning/PROJECT.md` - Stable v7 release goal, held v1.2 changesets, and coordinated-major context.
- `.planning/STATE.md` - Current Phase 26 project position.

### Changesets and Package Graph
- `.changeset/config.json` - Thirteen-package linked group, `master` base branch, dependency update policy, and ignored applications.
- `.changeset/*.md` - Complete pending release-note set to audit and reconcile.
- `.changeset/changelog.mjs` - Changelog rendering behavior for changeset bodies and dependency updates.
- `package.json` - Root versioning, release, build, and test commands.
- `packages/*/package.json` - Current package versions and internal dependency graph that drives downstream major bumps.

### Prior Release Evidence
- `.planning/phases/25.5-repository-extraction-cleanup/25.5-CONTEXT.md` - Locked checkout-only cleanup boundary and Phase 26 history deferral.
- `.planning/phases/25.5-repository-extraction-cleanup/25.5-03-SUMMARY.md` - Full remaining-workspace validation and cleanup evidence.
- `.planning/phases/25.5-repository-extraction-cleanup/25.5-04-SUMMARY.md` - Frozen-install release gate and final active-surface absence checks.
- `.planning/phases/25.5-repository-extraction-cleanup/25.5-VERIFICATION.md` - Verified handoff from checkout cleanup to Phase 26 history cleanup.
- `.planning/research/STACK.md` - Changesets linked-group mechanics and dry-run guidance.
- `.planning/research/PITFALLS.md` - Release graph, changeset, and migration-note failure modes.
- `.planning/research/SUMMARY.md` - Milestone-level release mechanics findings.

### Per-Change Provenance
- `.planning/phases/**/**-SUMMARY.md` - Owning implementation summaries used as semantic provenance for pending changesets.
- `.planning/phases/**/**-VERIFICATION.md` - Canonical phase verification records used to confirm shipped outcomes.

No external specification was introduced during discussion; the repository release records above are canonical.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pnpm exec changeset status --verbose --since=master` already computes all thirteen publishable packages at `7.0.0`; it is the final version-result oracle.
- `.changeset/config.json` contains the live thirteen-package linked group after Concord extraction.
- The root `build`, `test`, `version-packages`, and `release` scripts define the existing release pipeline, although only build and test behavior is exercised in this phase.
- Phase 25.5's frozen-install, full-workspace, docs/examples, cleanup, and exact-baseline checks provide the release-gate foundation.

### Established Patterns
- Every changeset file describes exactly one change with one Markdown sentence.
- Changesets target packages that actually changed; legitimate internal dependency cascades may include downstream packages without direct changesets.
- Release checks fail closed and retain command output or structured evidence rather than relying on assumptions about linked-package behavior.
- Generated install and build residue is removed after verification, with `pnpm-lock.yaml` and the original non-generated status preserved exactly.

### Integration Points
- Pending `.changeset/*.md` files integrate phase-level implementation outcomes into the public changelog.
- Package manifests and `.changeset/config.json` determine the thirteen-package release graph.
- Local Git refs `next` and `master` are the source and destination of the final history operation; remote refs are verification inputs only and must not be mutated.
- The candidate pre-Concord base found during discussion is `5d0260e296a15b85bc4e58abc34cde3fb055179c`, the parent of first case-insensitive Concord code commit `452dc444df7e3f48a8099f3917de705e4389d264`. Planning must re-verify this boundary before rewriting history.

</code_context>

<specifics>
## Specific Ideas

- Keep one reviewable matrix for both release-note truth and the explicit thirteen-package checklist rather than scattering proof across plan summaries.
- Bind the squash to commit and tree identities, not branch names that can move during execution.
- Construct and verify the replacement history safely before moving local `master` to it.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within Phase 26 scope.

</deferred>

---

*Phase: 26-release-coordination-v7-0-0*
*Context gathered: 2026-09-14T18:11:49Z*
