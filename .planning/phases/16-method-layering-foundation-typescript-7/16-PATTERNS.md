# Phase 16: Method Layering Foundation & TypeScript 7 - Pattern Map

**Mapped:** 2026-08-19
**Files analyzed:** 38 planned files (1 archived decision record, 3 relay citation files, 18 manifests, 14 package tsconfigs, 1 tooling source, 1 lockfile)
**Analogs found:** 38 / 38

## File Classification

| New/Modified File(s) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md` | config / decision record | documentation | its own D-01 block, lines 27-43 | exact source of record |
| `packages/relay/src/relay.ts` | service | streaming / request-response | its ten existing D-01 comments | exact in-place |
| `packages/relay/src/operators/auth-retry.ts` | utility / operator | streaming / retry | its three existing D-01 comments | exact in-place |
| `packages/relay/src/__tests__/relay.test.ts` | test | streaming | D-01 test at line 1797 | exact in-place |
| root `package.json`; all 14 `packages/*/package.json`; `apps/{agent-skills,examples,llms}/package.json` | config | dependency resolution | Phase 12 dependency migration plan `12-02-PLAN.md:100-149` | exact workflow match |
| all 14 `packages/*/tsconfig.json` | config | declaration emit | `packages/relay/tsconfig.json:1-29` (identical compiler-option shape) | exact |
| `apps/llms/src/build-exports.mjs` | utility / build generator | file-I/O / transform | existing compiler API import and `parseFile`, lines 1-3 and 76-197 | exact in-place |
| `pnpm-lock.yaml` | config | dependency resolution | Phase 12 dependency migration plan `12-02-PLAN.md:118-143` | exact workflow match |

> Inventory correction: the live repository has **18**, not 17, direct `typescript` pins: root + 14 publishable packages + 3 apps. Planning must use the live 18-file list below rather than the stale count in `16-RESEARCH.md`.

## Pattern Assignments

### Archived D-01 and shipped citations (documentation, streaming contract)

**Source of record:** `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md:27-43`

**Current decision shape:**

```markdown
### Signalling model — value, not throw

- **D-01:** Auth-required is signalled as a **value on an internal type**, not by throwing.
```

Replace the blanket rule in this existing section; do not append a second D-01. The amended text needs both halves of LAYER-01 in one place:

- low-level relay methods perform one interaction and surface failure;
- high-level methods own configurable policy (auth, retry, reconnect, resubscribe, clocks, concurrency);
- throw-as-signal remains a smell across multi-hop chains or uninterested intermediaries;
- a throw is valid when the **immediate** consumer deliberately retries or aggregates the upstream call.

The closest shipped citation pattern is the contextual, decision-tagged comment already used in `relay.ts:983-985`:

```ts
// D-01/D-02/D-03: signal auth-required as a value instead of throwing (the shared auth operator
// consumes and never forwards it); every other prefixed CLOSED still throws its typed error
```

Preserve that concrete `req()` multi-hop rationale, but qualify it as this path's contract rather than a universal prohibition. Apply the same precision to all 14 sites:

| Distribution | Exact locations | Treatment |
|---|---|---|
| 10 in `relay.ts` | 841, 983, 990, 1117, 1266, 1285, 1288, 1373, 1605, 1606 | Comment-only edits; preserve adjacent executable code byte-for-byte. Lines 1605 and 1606 are separately counted. |
| 3 in `operators/auth-retry.ts` | 39, 248, 372 | Retain the value-signal/operator guarantee; scope it to this multi-hop operator. |
| 1 in `relay.test.ts` | 1797 | Retain the behavioral test and body; title/comment wording may clarify that `req()` subscribers never see the internal value. |

**Ownership:** one executor task should own the archived D-01 plus all three citation files. Splitting the source of record from citations risks contradictory wording.

**Static gate:**

```bash
test "$(rg -c 'D-01' packages/relay/src/relay.ts)" = 10
test "$(rg -c 'D-01' packages/relay/src/operators/auth-retry.ts)" = 3
test "$(rg -c 'D-01' packages/relay/src/__tests__/relay.test.ts)" = 1
```

Also inspect `git diff --word-diff` and reject any executable `.pipe`, type, or test-body change. Phase 18+ owns runtime re-layering.

### Direct TypeScript pins (config, dependency resolution)

**Analog:** `.planning/milestones/v1.1-phases/12-document-caps-conformance/12-02-PLAN.md:100-149`

That plan establishes the repository's dependency-migration sequence: make the same exact range edit in every intended manifest, touch no unrelated dependency, run pnpm at the root, commit/review the generated lockfile, assert the installed version rather than merely grepping manifests, then run affected and workspace gates.

**Complete live manifest ownership (18 pins):**

```text
package.json
apps/agent-skills/package.json
apps/examples/package.json
apps/llms/package.json
packages/{accounts,actions,common,concord,content,core,extra,loaders,react,relay,signers,sqlite,wallet-connect,wallet}/package.json
```

Change only each direct `typescript` range to `^7.0.2`. This intentionally normalizes the current `^5.7.3`, `^5.8.3`, `^5.9.3`, and `~5.6.3` variants. Keep the TS7 CLI dependency in `apps/llms`; its programmatic API exception is additive and separately named.

Use the package manager to regenerate `pnpm-lock.yaml`; never hand-edit it. Prefer explicit manifest review after the recursive update because `pnpm update -r` can affect more than the intended 18 entries.

```bash
pnpm update -r typescript@^7.0.2
pnpm --filter applesauce-llms add -D @typescript/typescript6@^6.0.2
git diff -- package.json 'apps/*/package.json' 'packages/*/package.json' pnpm-lock.yaml
pnpm exec tsc --version
```

The installed compiler version must report 7.0.2-compatible output. Do not add a changeset: this phase changes workspace tooling/comments, not a published package API or behavior.

**Ownership:** the same compiler-migration task owns all 18 manifests, all 14 tsconfigs, the llms compatibility import, and `pnpm-lock.yaml`. They form one resolution unit and should not be run concurrently with any other dependency edit.

### Package tsconfigs (config, declaration emit)

**Analog:** `packages/relay/tsconfig.json:1-29`; all 14 package configs have the same relevant shape.

```json
"target": "ES2022",
"rootDir": "src",
"outDir": "dist",
"downlevelIteration": true,
"declaration": true
```

Remove only `"downlevelIteration": true,` from these 14 files:

```text
packages/{accounts,actions,common,concord,content,core,extra,loaders,react,relay,signers,sqlite,wallet-connect,wallet}/tsconfig.json
```

Preserve `target: ES2022`, NodeNext module settings, strictness, declaration output, include, and test exclusions. With ES2022 targets, removing the obsolete downlevel option is configuration cleanup and must not prompt source rewrites.

```bash
if rg -n 'downlevelIteration' --glob 'tsconfig*.json' .; then exit 1; fi
```

### `apps/llms/src/build-exports.mjs` (utility, file-I/O transform)

**Analog:** the file's current compiler API adapter. The import at lines 1-3 feeds helpers at lines 76-197, including `canHaveModifiers`, `getModifiers`, `SyntaxKind`, `createProgram`, syntax guards, and `forEachChild`.

```js
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
```

Preserve the default-import shape and change only the module specifier to `@typescript/typescript6`, subject to the app build proving Node ESM interop:

```js
import ts from "@typescript/typescript6";
```

Do not rewrite the scanner or migrate its AST logic. `apps/llms/src/build.mjs:33-37` invokes `buildExports` inside `Promise.all`, and the root `turbo build` includes this private app, so a broken import fails the workspace build. Verify the narrow seam first:

```bash
pnpm --filter applesauce-llms build
```

If default ESM interop fails, investigate the compatibility package's actual export shape and make the smallest import-only adjustment; do not fall back to TS7's absent API or a hand-rolled parser.

### `pnpm-lock.yaml` (config, dependency graph)

**Analog:** Phase 12's root-install pattern at `12-02-PLAN.md:118-143`.

Generate it with pnpm 11.10.0 after all manifest edits. Review for expected TypeScript 7 CLI snapshots/importers plus the single `@typescript/typescript6` llms importer. Unexpected unrelated package churn is a stop-and-investigate signal. A follow-up frozen install is the reproducibility gate:

```bash
pnpm install --frozen-lockfile
```

## Shared Patterns

### Behavior-preserving infrastructure migration

Apply to every task: comment changes must not touch runtime statements; compiler migration fixes are limited to known removed config and the official compiler-API bridge. A new TypeScript source diagnostic is evidence to report and investigate, not authorization for broad source edits.

### Narrow-to-broad verification

The repository's plans consistently use a narrow package build before workspace gates. For this phase:

```bash
pnpm --filter applesauce-llms build
pnpm --filter applesauce-relay test
pnpm run build
pnpm run test
```

Root `package.json:6-8` defines `build` as `turbo build` and `test` as package builds followed by Vitest. `turbo.json:5-7` makes each build depend on upstream package builds and tracks `dist/**` outputs.

### Explicit declaration evidence

All 14 package configs declare `rootDir: src`, `outDir: dist`, and `declaration: true`; the root build should therefore leave at least one `.d.ts` under every package `dist`. Validate the set, not merely one artifact:

```bash
for dir in packages/*; do
  test -f "$dir/tsconfig.json" || continue
  find "$dir/dist" -name '*.d.ts' -type f -print -quit | grep -q . || exit 1
done
```

### Exact-scope diff audit

Expected implementation files are the archived context, three relay files, 18 manifests, 14 tsconfigs, llms export builder, and lockfile. `16-RESEARCH.md` is currently untracked user/upstream work and must remain preserved. No `.changeset/`, runtime relay logic, docs navigation, TypeDoc config, or generated `dist` artifact should be committed.

## Suggested Plan Boundaries and File Ownership

| Plan/task | Files owned | Depends on | Commit/gate |
|---|---|---|---|
| 16-01 Amend layering decision | archived `13-CONTEXT.md`; three relay citation files | none | exact 10/3/1 citation audit; relay test; comment-only diff |
| 16-02 Migrate compiler/tooling | 18 manifests; 14 tsconfigs; `apps/llms/src/build-exports.mjs`; `pnpm-lock.yaml` | preferably after 16-01 to keep diagnosis isolated | llms build; TS version/config assertions; full build/test; declaration set; frozen install |

Do not parallelize manifest/lockfile ownership. The documentation sweep can be planned separately, but landing it first keeps any later failure attributable to the compiler migration.

## Pitfalls for Executor Planning

- **Stale count:** research says 17 TypeScript pins; live grep shows 18. Include `apps/examples/package.json` (`~5.6.3`) as well as both other apps, root, and 14 packages.
- **Adjacent citation undercount:** `relay.ts:1605` and `:1606` are two D-01 occurrences; preserve total distribution 10/3/1.
- **Semantic overcorrection:** do not rewrite `req()` to throw or weaken its multi-hop value-signal guarantee. This phase documents the one-hop carve-out only.
- **Pin-only upgrade:** TS7 rejects all 14 `downlevelIteration` options.
- **Compiler API break:** TypeScript 7 supplies the CLI but no programmatic API used by the llms export scanner. Keep TS7 for CLI and use the official TS6 compatibility package only for that import.
- **TypeDoc peer warning:** root `typedoc` currently peers only through TypeScript 6. Do not claim TypeDoc validates TS7 and do not expand scope unless installation/CI actually blocks.
- **Generated output noise:** root builds create `dist` outputs. Verify them, but do not accidentally commit generated artifacts unless already tracked and intentionally changed.
- **Broad auto-update churn:** inspect recursive-update results before accepting the lockfile; retain exact intended manifest edits.
- **Unrelated work:** preserve the untracked `.planning/phases/16-method-layering-foundation-typescript-7/16-RESEARCH.md` and any concurrent changes.

## No Analog Found

None. Every planned edit is either an in-place contract/config migration or has a strong prior dependency-upgrade workflow analog.

## Metadata

**Analog search scope:** archived v1.2 Phase 13 context/plans; all relay D-01 sites; root/apps/packages manifests; all package tsconfigs; root/Turbo/llms build scripts; prior dependency-install plans
**Files scanned:** 18 direct-pin manifests, 14 tsconfigs, 14 citation occurrences across 3 files, archived D-01, llms builder and build entrypoint, root scripts, Turbo config, lockfile history, prior plans
**Pattern extraction date:** 2026-08-19
