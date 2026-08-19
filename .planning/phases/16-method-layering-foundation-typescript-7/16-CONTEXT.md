# Phase 16: Method Layering Foundation & TypeScript 7 - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Amend Phase 13's D-01 and every shipped-source citation so the low/high relay method layering rule permits throw-as-signal at a one-hop aggregator or retry boundary while retaining the prohibition across multi-hop chains, then upgrade the workspace compiler to TypeScript 7 and verify the unchanged workspace builds and tests cleanly.

</domain>

<decisions>
## Implementation Decisions

### the agent's Discretion
All implementation choices are at the agent's discretion — this is a pure infrastructure and documentation phase. Preserve runtime behavior, use the established workspace dependency conventions, and treat any TypeScript-7-specific source change as evidence to investigate rather than intended scope.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- The authoritative D-01 text lives in Phase 13's context; the current milestone research enumerates the fourteen shipped citations in `relay.ts`, `operators/auth-retry.ts`, and `relay.test.ts`.
- Root and package manifests already use a shared `typescript` dependency pattern managed by pnpm.

### Established Patterns
- Source comments carry decision identifiers so later reviews can trace behavior back to planning decisions.
- Workspace-wide build and test commands are the acceptance gate for compiler upgrades.

### Integration Points
- Update the D-01 source of record and all fourteen shipped citations together.
- Upgrade every direct workspace TypeScript pin and refresh `pnpm-lock.yaml` before running the full build and test suites.

</code_context>

<specifics>
## Specific Ideas

Use mainline `typescript@^7.0.2`, not the separate native-preview package; the milestone research already established that the repository has no TypeScript-eslint integration blocking the upgrade.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
