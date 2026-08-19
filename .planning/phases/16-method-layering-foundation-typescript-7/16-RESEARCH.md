# Phase 16: Method Layering Foundation & TypeScript 7 - Research

**Researched:** 2026-08-19
**Domain:** Relay method-layering documentation and monorepo compiler migration
**Confidence:** HIGH for repository findings; MEDIUM for current TypeScript 7 migration guidance

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

None stated in `## Implementation Decisions`; all choices are delegated below.

### the agent's Discretion

All implementation choices are at the agent's discretion — this is a pure infrastructure and documentation phase. Preserve runtime behavior, use the established workspace dependency conventions, and treat any TypeScript-7-specific source change as evidence to investigate rather than intended scope.

### Deferred Ideas (OUT OF SCOPE)

None — infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LAYER-01 | Amend D-01 so throw-as-signal is a smell except at an immediate aggregator or retry consumer, and record low/high layering. | Exact replacement semantics, source-of-record, and architectural ownership are mapped below. [VERIFIED: codebase grep and source read] |
| LAYER-02 | Make all 14 shipped D-01 citations consistent. | The exact 10 + 3 + 1 citation inventory is below and can be used as an implementation/verification checklist. [VERIFIED: codebase grep] |
| ECO-01 | Build, test, and emit declarations under TypeScript 7. | All 17 direct compiler pins, 14 declaration-emitting configs, two TS7 incompatibilities, and acceptance commands are mapped below. [VERIFIED: manifests, tsconfig files, and npm registry] |
</phase_requirements>

## Summary

Phase 16 should be planned as two ordered, behavior-preserving work units. First, amend the archived Phase 13 D-01 source of record and all 14 shipped citations in one sweep. The amended rule must say that low-level relay methods perform one wire interaction and high-level methods own policy; throwing is acceptable only when the immediate caller deliberately aggregates or retries the upstream call, while a signal crossing uninterested intermediate layers remains a smell. This preserves the milestone's already-researched distinction: `event()` throwing into `publish()` is one-hop retry-layer handling, while `req()` remains value-signalled because its auth state traverses a multi-hop operator chain. [VERIFIED: `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md`, `.planning/research/ARCHITECTURE.md`, and relay source]

Second, migrate the workspace compiler. `typescript@7.0.2` is the npm `latest` release, published 2026-07-08, and the package legitimacy seam returns `OK`. [VERIFIED: npm registry and package-legitimacy seam] This is not a pin-only upgrade: every one of the 14 publishable-package tsconfigs sets `downlevelIteration: true`, which TypeScript 7 rejects because that option is removed. [VERIFIED: codebase grep; CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/] Removing that now-no-op option is a configuration migration, not a runtime/source behavior change, because every package already targets ES2022. [VERIFIED: all 14 package tsconfigs]

There is one genuine scope discrepancy that the plan must make explicit. `apps/llms/src/build-exports.mjs` imports the TypeScript compiler API, but TypeScript 7.0 ships no programmatic API. The root `turbo build` includes this app, so updating its `typescript` dependency directly to 7 would break the full workspace build. [VERIFIED: app source, app manifest, root/turbo scripts; CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/] Use the official `@typescript/typescript6@6.0.2` compatibility package for this API-only app while using `typescript@^7.0.2` as the CLI compiler everywhere else; this is a small tooling-source import change and must be documented as the investigated exception to the context's intended no-source-change scope. [CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/] `@typescript/typescript6` also passes the package-legitimacy gate. [VERIFIED: npm registry and package-legitimacy seam]

**Primary recommendation:** Land the D-01 comment sweep first, then migrate all CLI compiler pins to `^7.0.2`, remove the 14 obsolete `downlevelIteration` options, isolate `apps/llms` on the official TypeScript 6 compatibility API, refresh the lockfile, and run the full root build/test gates plus explicit declaration checks.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| D-01 source-of-record amendment | Planning/documentation | Relay source comments | The archived Phase 13 context defines the decision; shipped comments cite it. [VERIFIED: codebase] |
| Low-level relay interaction | API / Backend (`Relay`) | WebSocket transport | `event()`, `req()`, `negentropy()`, and `auth()` own one relay interaction and surface failure. [VERIFIED: milestone architecture research] |
| High-level retry/policy | API / Backend (`Relay`) | RxJS operators | `publish()`, `request()`, `subscription()`, `sync()`, and `authenticate()` own configurable policy. [VERIFIED: milestone architecture research] |
| One-hop aggregation | API / Backend (`RelayGroup`) | Relay methods | Group methods deliberately catch and retain upstream per-relay outcomes. [VERIFIED: `group.ts` and milestone architecture research] |
| TypeScript compiler/version resolution | Build tooling / workspace | Package manifests | pnpm resolves direct pins and lockfile; package scripts invoke `tsc`. [VERIFIED: manifests and lockfile] |
| Declaration emit | Package build tier | TypeScript compiler | All 14 package configs use `declaration: true`, `rootDir: src`, and `outDir: dist`. [VERIFIED: package tsconfigs] |
| Compiler API consumer | Build tooling / `apps/llms` | TypeScript 6 compatibility package | The export scanner calls `createProgram` and AST helpers unavailable from TypeScript 7's package API. [VERIFIED: `build-exports.mjs`; CITED: TypeScript 7 announcement] |

## Discovery Level

**Level 3 — cross-workspace dependency and compatibility audit.** Research covered the authoritative decision record, all shipped citations, all direct TypeScript pins, all tsconfigs, root/Turbo build topology, compiler-API imports, relevant peer ranges, registry provenance, and validation commands. No runtime relay implementation change is required or authorized. [VERIFIED: repository audit]

## Project Constraints (from AGENTS.md)

- Documentation must integrate with existing documents rather than create redundant best-practices files; code blocks must remain short and focused (about 20 lines maximum), and summary sections are prohibited in product documentation. This generated planning research retains the GSD-required executive Summary but should not cause a new end-user “Best Practices” document. [VERIFIED: `AGENTS.md`]
- Documentation examples must be checked, navigation updated when product docs move, and duplicate/orphaned files avoided. Phase 16 changes no VitePress product docs, so no navigation edit is expected. [VERIFIED: `AGENTS.md`]
- Any changeset must describe exactly one change in a single Markdown sentence, with the smallest applicable bump. Phase 16 is infrastructure/comment-only and should not add a publishable-package changeset unless implementation reveals a package-visible change. [VERIFIED: `AGENTS.md` and phase boundary]
- UI guidance, DaisyUI guidance, agent-skill guidance, and new-NIP guidance do not apply to this phase. [VERIFIED: scope comparison against `AGENTS.md`]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `typescript` | `^7.0.2` (published 2026-07-08) | CLI type-checking and declaration emit | Official stable package and `latest` dist-tag; legitimacy `OK`. [VERIFIED: npm registry; CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/] |
| `@typescript/typescript6` | `^6.0.2` (published 2026-07-06) | Compiler API only for `apps/llms` | Official side-by-side compatibility package recommended while TS7 lacks an API; legitimacy `OK`. [VERIFIED: npm registry and legitimacy seam; CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/] |
| `pnpm` | `11.10.0` (workspace `packageManager`) | Workspace dependency and lockfile management | Existing locked workspace package manager. [VERIFIED: root manifest and local CLI] |
| `turbo` | `^2.9.14` | Workspace build orchestration | Existing root `build` and package dependency ordering. [VERIFIED: root manifest and `turbo.json`] |
| `vitest` | `^4.1.6` | Full test suite | Existing root and per-package test framework. [VERIFIED: root/package manifests] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `typedoc` | `0.28.20` | API docs generation | Retain for now, but do not claim it runs on TS7: its current peer range ends at TypeScript 6.0.x. [VERIFIED: npm registry] |
| `@hirez_io/observer-spy` | `2.2.0` | Observable test assertions | Existing tests; peer range accepts all TypeScript versions `>=2.8.1`. [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mainline `typescript@^7.0.2` | `@typescript/native-preview` | Rejected by locked context and official release state; native preview was the beta-era package, while stable 7 ships as `typescript`. [CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/] |
| Compatibility API in `apps/llms` | Rewrite the AST scanner without compiler API | Out of scope and higher risk; the official compatibility package preserves behavior. [CITED: TypeScript 7 announcement] |
| Remove `downlevelIteration` | Keep it and suppress diagnostics | Impossible in TS7: it is a hard-error removed option; packages already target ES2022 so removal is the correct mechanical migration. [VERIFIED: package configs; CITED: TypeScript 7 announcement] |

**Installation/update shape:**

```bash
pnpm update -r typescript@^7.0.2
pnpm --filter applesauce-llms add -D @typescript/typescript6@^6.0.2
```

The executor should inspect the resulting manifest diff rather than trusting the recursive command blindly: `apps/llms` needs both the TS7 CLI pin (to satisfy “workspace compiler”) and the separately named TS6 API dependency/import, or an explicitly recorded exception. [VERIFIED: workspace topology]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `typescript` | npm | Created 2012; 7.0.2 published 2026-07-08 | 225,564,163/week at audit | `github.com/microsoft/TypeScript` | OK | Approved; official docs confirm package identity. [VERIFIED: npm registry and official TypeScript announcement] |
| `@typescript/typescript6` | npm | 6.0.2 published 2026-07-06 | 2,702,900/week at audit | `github.com/microsoft/TypeScript` | OK | Approved; official TS7 docs recommend it for API compatibility. [VERIFIED: npm registry and official TypeScript announcement] |
| `typedoc` | npm | Current 0.28.20 published 2026-07-05 | 4,181,512/week at audit | `github.com/TypeStrong/TypeDoc` | OK | Retain, but peer-incompatible with TS7; do not update/install as a TS7 solution. [VERIFIED: npm registry] |

No audited package exposes a `postinstall` script. [VERIFIED: npm registry queries and legitimacy seam]

**Packages removed due to SLOP verdict:** none.

**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
Phase 13 D-01 source of record
        │
        ├── amend rule ──> 14 shipped citations ──> grep/count consistency gate
        │
        └── layering contract
              ├── low-level Relay method ──failure──> immediate retry wrapper (allowed throw)
              ├── low-level Relay calls ──failure──> RelayGroup aggregator (allowed throw)
              └── multi-hop operator chain ──state──> discriminated value (throw remains a smell)

17 manifests ──pnpm resolution──> TypeScript 7 CLI ──tsc──> 14 package dist/*.d.ts
                                           └── config gate: remove downlevelIteration
apps/llms ──AST API──> @typescript/typescript6 ──build export markdown
```

### Recommended Project Structure

```text
.planning/milestones/v1.2-phases/.../13-CONTEXT.md  # D-01 source of record
packages/relay/src/
├── relay.ts                                        # ten citations
├── operators/auth-retry.ts                         # three citations
└── __tests__/relay.test.ts                         # one citation
packages/*/tsconfig.json                             # fourteen identical config removals
apps/llms/src/build-exports.mjs                      # sole compiler API import
package.json + packages/*/package.json + apps/*/... # direct pins
pnpm-lock.yaml                                       # resolved compiler graph
```

### Pattern 1: One-hop consumer carve-out

**What:** A thrown failure is legitimate when its immediate consumer's purpose is to retry or aggregate that upstream call. It is not legitimate as expected state transported across unrelated operators or multiple wrapper layers. [VERIFIED: milestone architecture research]

**When to use:** Use it to explain `event()` → `publish()` and per-relay group aggregation. Preserve value signalling for `req()`'s multi-hop auth flow. [VERIFIED: relay source and milestone architecture research]

### Pattern 2: Separate CLI compiler from programmatic API

**What:** TypeScript 7's `typescript` package provides `tsc` but no programmatic API; keep API-dependent tooling on the official TypeScript 6 compatibility package. [CITED: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/]

**Example:**

```js
// apps/llms/src/build-exports.mjs
import ts from "@typescript/typescript6";
```

The exact import form must be verified against Node ESM after install with `pnpm --filter applesauce-llms build`; the package currently declares `main: ./lib/typescript.js` and provides the API. [VERIFIED: npm registry; MEDIUM confidence on ESM interop until executed]

### Anti-Patterns to Avoid

- **Pin-only migration:** It leaves 14 removed compiler flags and the `apps/llms` compiler-API dependency broken. [VERIFIED: repository + official migration notes]
- **Broad wording such as “throws are fine in wrappers”:** The carve-out is only an immediate aggregator or retry consumer; multi-hop expected-state signalling remains prohibited. [VERIFIED: milestone architecture research]
- **Editing only one of adjacent `relay.ts:1605` and `:1606`:** They are two grep-visible D-01 occurrences and the requirement's count includes both. [VERIFIED: codebase grep]
- **Treating root test success as declaration proof:** Root `test` builds packages first, but explicit artifact checks make ECO-01's declaration requirement auditable. [VERIFIED: root scripts and package configs]
- **Upgrading TypeDoc as if it supports TS7:** Current `typedoc@0.28.20` peers only through TypeScript 6.0.x. [VERIFIED: npm registry]

## Exact D-01 Citation Inventory

| # | File:line | Current assertion | Required treatment |
|---|-----------|-------------------|--------------------|
| 1 | `packages/relay/src/relay.ts:841` | Errors constructed only at caller boundary | Qualify for multi-hop/value-signal path; do not imply universal rule. |
| 2 | `relay.ts:983` | `req()` auth-required is a value | Retain and connect explicitly to multi-hop-chain prohibition. |
| 3 | `relay.ts:990` | Only auth-required is a value | Retain; clarify other CLOSED reasons are genuine failures. |
| 4 | `relay.ts:1117` | `count()` auth-required is a value | Amend to avoid claiming value signalling is universally required. |
| 5 | `relay.ts:1266` | `event()` value response is the model | Amend because future layering permits `event()` throwing into immediate `publish()` retry. |
| 6 | `relay.ts:1285` | Shared operator throws only on exhaustion | Qualify as current implementation, not universal architecture. |
| 7 | `relay.ts:1288` | `publish()` reconstructs error at boundary | Amend to recognize immediate retry consumer carve-out. |
| 8 | `relay.ts:1373` | Negentropy translates error to value | Retain edge-translation rationale; connect to multi-hop path. |
| 9 | `relay.ts:1605` | `event()` yields value after retry exhaustion | Amend consistently with high/low method rule. |
| 10 | `relay.ts:1606` | `publish()` is caller boundary | Amend consistently; this adjacent second citation is independently counted. |
| 11 | `packages/relay/src/operators/auth-retry.ts:39` | Internal auth signal stays off error channel | Retain for multi-hop auth operator. |
| 12 | `operators/auth-retry.ts:248` | Signal is never thrown/forwarded | Retain as this operator's contract, not blanket policy. |
| 13 | `operators/auth-retry.ts:372` | Raw signal never reaches subscriber | Retain as subscriber-boundary guarantee. |
| 14 | `packages/relay/src/__tests__/relay.test.ts:1797` | `req()` subscriber observes only `RelayReqMessage` | Retain; this is behavioral proof of value-signal encapsulation. |

**Source of record:** `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md`, D-01 under “Signalling model — value, not throw.” [VERIFIED: file read]

**Suggested semantic replacement:** “Throwing expected state as an internal signal is a smell when it crosses a multi-hop chain or forces uninterested intermediaries to filter it. A throw is appropriate when the immediate consumer is deliberately an aggregator over upstream calls or a retry layer over them. Low-level relay methods perform one interaction and throw on failure; high-level methods own configurable retries, reconnects, auth, resubscription, clocks, and concurrency.” [VERIFIED: synthesis of locked requirements and milestone architecture research]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TS7 compiler | Custom/native-preview invocation | Official `typescript@^7.0.2` | Stable package owns `tsc`; correct registry provenance. [VERIFIED/CITED] |
| TS compiler API compatibility | AST parser or copied compiler bundle | `@typescript/typescript6@^6.0.2` | Official bridge exists specifically because TS7.0 has no API. [VERIFIED/CITED] |
| Workspace lockfile edits | Manual YAML rewrite | pnpm update/add | pnpm must recompute peers and snapshots. [VERIFIED: workspace convention] |
| Citation verification | Sample a few comments | Exact `rg -n 'D-01'` count and inventory | Requirement explicitly covers all 14 occurrences. [VERIFIED: LAYER-02] |
| Declaration validation | Infer from tests | `pnpm run build` plus artifact assertions | ECO-01 explicitly requires emitted declarations. [VERIFIED: requirement and configs] |

## Common Pitfalls

### Pitfall 1: Removed `downlevelIteration` blocks every package

**What goes wrong:** TypeScript 7 reports a hard configuration error before useful source checking. [CITED: TypeScript 7 announcement]

**Why it happens:** The same option is duplicated in all 14 package tsconfigs, inherited from older compiler targets even though current target is ES2022. [VERIFIED: codebase grep]

**How to avoid:** Remove exactly that line from all 14 configs as one mechanical task; do not change target/module/declaration settings. Verify `rg -n 'downlevelIteration' --glob 'tsconfig*.json'` returns no matches. [VERIFIED: repository audit]

### Pitfall 2: `apps/llms` silently loses its compiler API

**What goes wrong:** Its build imports `typescript` and calls `createProgram`, `canHaveModifiers`, syntax guards, and `forEachChild`; TS7.0 exposes no API. [VERIFIED: app source; CITED: TS7 announcement]

**How to avoid:** Add the official TS6 compatibility package, change only the tooling import, and run the app build separately as well as the root build. [CITED: TS7 announcement]

### Pitfall 3: Peer graph is reported clean when TypeDoc is not TS7-compatible

**What goes wrong:** `typedoc@0.28.20` declares a TypeScript peer range ending at `6.0.x`; a fresh install may warn or fail under stricter peer settings, and TypeDoc itself cannot be used as proof of TS7 declaration compatibility. [VERIFIED: npm registry]

**How to avoid:** Record this as a known tooling exception. Phase acceptance uses package `tsc` builds, not TypeDoc. Do not expand scope into replacing TypeDoc unless pnpm installation is actually blocked. [VERIFIED: phase scope]

### Pitfall 4: Comment amendment drifts into runtime refactoring

**What goes wrong:** Later method-layering behavior is pulled into the foundation phase, invalidating its zero-behavior-risk role. [VERIFIED: ROADMAP sequencing]

**How to avoid:** Restrict relay files to comment/test-title wording only. Any `.pipe`, type, or executable test-body diff is a stop-and-investigate signal. [VERIFIED: context]

## Code Examples

### Citation completeness gate

```bash
rg -n "D-01" packages/relay/src/relay.ts \
  packages/relay/src/operators/auth-retry.ts \
  packages/relay/src/__tests__/relay.test.ts
```

Expected distribution after edits remains `10 / 3 / 1`; additionally inspect the archived `13-CONTEXT.md` source of record. [VERIFIED: LAYER-02 and current grep]

### Compiler/config gate

```bash
pnpm exec tsc --version
rg -n 'downlevelIteration' --glob 'tsconfig*.json' .
pnpm run build
pnpm run test
```

The version must resolve to 7.0.2-compatible `tsc`; the grep must be empty. [VERIFIED: intended stack and official TS7 option removal]

### Declaration artifact gate

```bash
find packages -path '*/dist/*.d.ts' -type f | sort
```

For stronger verification, compare the 14 package directories containing `tsconfig.json` with the package directories containing at least one emitted `dist/*.d.ts`; every declaration-emitting package must appear. [VERIFIED: package configs]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@typescript/native-preview` with `tsgo` | `typescript@7.0.2` with `tsc` | Stable 7.0, 2026-07-08 | Use mainline package, as locked by context. [CITED: TS7 beta/stable announcements] |
| TypeScript package includes compiler API | TS7.0 CLI has no programmatic API; bridge via `@typescript/typescript6` | TS7.0 | `apps/llms` needs explicit API compatibility dependency. [CITED: TS7 announcement] |
| `downlevelIteration` accepted | Removed/hard error | TS7.0 via TS6 deprecation bridge | Remove from all 14 package configs. [CITED: TS7 announcement] |
| Blanket “never throw as internal signal” | Immediate aggregator/retry carve-out plus low/high layering | Phase 16 decision | Aligns comments with actual one-hop consumers without weakening multi-hop rule. [VERIFIED: LAYER-01 and architecture research] |

**Deprecated/outdated:** `@typescript/native-preview` for stable adoption; `downlevelIteration`; and the original blanket D-01 wording. [VERIFIED/CITED as above]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The default ESM import from `@typescript/typescript6` works unchanged in Node 22. | Architecture Pattern 2 | `apps/llms` build fails; executor must test and use the package's supported import shape. |
| A2 | Phase acceptance does not require running TypeDoc itself. | Common Pitfall 3 | If release CI invokes TypeDoc outside root scripts, its TS7 peer/API incompatibility needs a separate compatibility arrangement. |

## Open Questions (RESOLVED)

1. **Does “every direct workspace TypeScript pin” permit the API-only app to carry both TS7 CLI and TS6 API packages?**
   - What we know: Context says upgrade every direct TypeScript pin, while official TS7 has no API and `apps/llms` imports it. [VERIFIED/CITED]
   - What's unclear: Whether the milestone author knew about this app-level compiler API consumer.
   - **RESOLVED:** Keep `typescript@^7.0.2` in `apps/llms` for compiler consistency and add `@typescript/typescript6@^6.0.2` solely for the import. Plans 16-02 and 16-07 encode this tooling exception.

2. **Is TypeDoc included in an external CI/release workflow not represented by root scripts?**
   - What we know: Root `build` does not invoke `typedoc`; the README documents a manual `pnpm typedoc` command, and current TypeDoc peers exclude TS7. [VERIFIED: repository and registry]
   - **RESOLVED:** Phase acceptance follows the repository's root build/test scripts and does not invoke TypeDoc. Do not expand Phase 16 unless an executor discovers concrete CI evidence that TypeDoc blocks those required gates; such evidence is a stop-and-investigate condition.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all builds/tests | ✓ | 22.23.1 | — |
| pnpm | workspace update/build | ✓ | 11.10.0 | — |
| TypeScript | current baseline | ✓ | lockfile resolves 5.x pins; target 7.0.2 available from registry | install target through pnpm |
| Vitest | tests | ✓ | 4.1.6 declared | — |
| Turbo | root build | ✓ | 2.9.14 declared | per-package builds only for diagnosis |
| `@typescript/typescript6` | `apps/llms` API | ✗ currently | 6.0.2 available | install as planned |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** `@typescript/typescript6` is absent but installable and approved by the legitimacy gate. [VERIFIED: registry]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 plus Turbo/package `tsc` builds |
| Config file | `vitest.config.ts`, `turbo.json`, package `tsconfig.json` files |
| Quick run command | `pnpm --filter applesauce-relay test` for comment-adjacent regression assurance; `pnpm --filter applesauce-llms build` for API compatibility |
| Full suite command | `pnpm run test` (builds all packages, then runs Vitest); also run `pnpm run build` because it includes apps/docs/examples/llms |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LAYER-01 | Source-of-record states amended rule | static content audit | `rg -n "D-01|aggregator|retry|Low-level|High-level" .planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md` | ✅ |
| LAYER-02 | Exactly 14 shipped citations remain and agree | static inventory/manual semantic review | `rg -n "D-01" packages/relay/src/{relay.ts,operators/auth-retry.ts,__tests__/relay.test.ts}` | ✅ |
| ECO-01 | Workspace compiles/tests/emits declarations under TS7 | integration/build | `pnpm run build && pnpm run test` plus version/config/artifact gates | ✅ infrastructure; ❌ no dedicated phase script |

### Sampling Rate

- **Per task commit:** citation count after comment task; `pnpm --filter applesauce-llms build` and one representative package build after dependency/config task.
- **Per wave merge:** `pnpm run build` then `pnpm run test`.
- **Phase gate:** TypeScript version is 7.0.2-compatible, no `downlevelIteration` remains, all root builds/tests are green, and every package emits at least one `.d.ts`.

### Wave 0 Gaps

- [ ] Add a small verification command/script or plan action that asserts the 10/3/1 D-01 distribution, because no automated test currently checks comment semantics.
- [ ] Add an explicit declaration-artifact assertion to the plan; existing builds emit declarations but the root test does not report coverage of all 14 package outputs.
- [ ] Resolve and verify the `apps/llms` TS6 compiler-API import before treating the root build as a TS7-only dependency graph.

## Security Domain

This phase changes comments and build tooling, not request handling, authentication behavior, persistence, or cryptography. Supply-chain integrity is the applicable security concern. [VERIFIED: phase boundary]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No runtime auth changes |
| V3 Session Management | no | No session surface |
| V4 Access Control | no | No access-control surface |
| V5 Input Validation | no runtime input | Lockfile/registry integrity and existing source checks |
| V6 Cryptography | no | No crypto implementation |

### Known Threat Patterns for npm/pnpm tooling

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquatted compiler/compatibility package | Spoofing/Tampering | Official-doc confirmation plus package-legitimacy gate and registry provenance. [VERIFIED] |
| Unexpected lifecycle script | Tampering/Elevation | Registry audit confirms no `postinstall`; inspect lockfile diff. [VERIFIED] |
| Unreviewed transitive churn | Tampering | Use pnpm, preserve lockfile, review diff, run frozen install/build in verification. [VERIFIED: workspace practice] |

## Sources

### Primary (HIGH confidence)

- Repository: Phase 16 context, ROADMAP/REQUIREMENTS/STATE, archived Phase 13 context, milestone `ARCHITECTURE.md` and `PITFALLS.md`, all 14 citation locations, 17 manifests, 14 tsconfigs, root scripts, Turbo/Vitest configs, `apps/llms/src/build-exports.mjs`, and `pnpm-lock.yaml` — exact project facts.
- npm registry plus GSD package-legitimacy seam — `typescript@7.0.2`, `@typescript/typescript6@6.0.2`, `typedoc@0.28.20`, package origins, publish dates, peers, downloads, and lifecycle scripts.

### Secondary (MEDIUM confidence)

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ — official stable package, no TS7.0 API, compatibility package, changed defaults, and removed options.
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/ — official history confirming native-preview was transitional and stable would use `typescript`/`tsc`.

### Tertiary (LOW confidence)

- None used as factual authority.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for versions/provenance; MEDIUM for the compatibility import shape until executed.
- Architecture: HIGH — derived from locked requirements and direct source reads.
- Pitfalls: HIGH — two are directly reproducible config/API incompatibilities; TypeDoc CI reach is the only open scope question.

**Research date:** 2026-08-19
**Valid until:** 2026-08-26 (fast-moving compiler/tool compatibility)
