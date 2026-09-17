# Phase 26: Release Coordination - v7.0.0 - Context

**Gathered:** 2026-09-14T18:11:49Z
**Status:** Needs replanning after prerelease strategy reset

<domain>
## Phase Boundary

Phase 26 prepares the coordinated `applesauce-*@7.0.0` release while preserving the complete development history. The `next` branch is the canonical prerelease branch and publishes disposable timestamped snapshots under npm's `next` dist-tag before a normal ancestry-preserving merge into `master` for the stable release. The abandoned squash candidate and Plans 26-04 through 26-09 remain historical evidence only and must not be resumed.

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

### Prerelease Branch and Preserved History
- **D-13:** Preserve the complete commit history. `next` is the canonical integration and prerelease branch; do not squash, replace, or reconstruct it from a tree object.
- **D-14:** Keep local `master` aligned with `origin/master` until the stable release is ready. The stable v7 transition is a normal ancestry-preserving merge from reviewed `next`, never a replacement-master compare-and-swap.
- **D-15:** Publish disposable timestamped snapshots from a clean `next` checkout under npm's `next` dist-tag. Snapshot versioning must not consume pending changesets or mutate the committed branch.
- **D-16:** Before each snapshot, validate the consumer-facing changeset set and full release gate. Before stable v7, rerun the gate, verify all thirteen package versions, merge `next` into `master` normally, and let the standard Changesets release workflow produce the stable release.

### the agent's Discretion
- Choose the audit matrix filename and exact table layout as long as every pending changeset and all thirteen packages are explicit and traceable.
- Choose safe temporary refs or backup refs used while constructing and verifying the local rewrite, provided the final local branch and remote boundaries above are preserved.
- Choose exact full-gate commands by reusing the strongest existing Phase 25.5 release checks and current package scripts.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and Release Contract
- `.planning/ROADMAP.md` - Phase 26 requirements, success criteria, and the preserved-history prerelease boundary.
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
- Local and remote `next` carry the full development history and prerelease state; `master` remains the stable branch until the final normal merge.
- The abandoned squash candidate is retained only under the local archive ref `archive/v7-squashed-release-candidate`; it is not a release source.

</code_context>

<specifics>
## Specific Ideas

- Keep one reviewable matrix for both release-note truth and the explicit thirteen-package checklist rather than scattering proof across plan summaries.
- Run snapshots from clean, disposable state so package-version mutations never contaminate `next`.
- Keep pending changesets intact across snapshots and consume them only in the stable Changesets release flow.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within Phase 26 scope.

</deferred>

---

*Phase: 26-release-coordination-v7-0-0*
*Context gathered: 2026-09-14T18:11:49Z*
