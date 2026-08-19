# Stack Research: v7.0.0 relay-method-layering — Ecosystem Riders

**Domain:** TypeScript/JavaScript monorepo (reactive Nostr SDK), 14 published packages, pnpm workspace
**Researched:** 2026-08-19
**Confidence:** HIGH for versions and empirically-tested compiler behavior; MEDIUM for React 19 runtime-behavior claims (verified via official React docs + peer-range precedent, not by running this repo's own hooks under React 19); LOW flagged explicitly where noted.

## Scope note

The relay re-layering itself (999.23–999.28, 999.20/999.21, residual fixes) introduces **no new
dependencies** — it is internal restructuring of `applesauce-relay`. This document covers only the
three ecosystem riders (SEED-002/003/004) and the changesets release-mechanics question, because
those are the only places this milestone touches the stack.

## Recommended Stack

### Ecosystem riders

| Technology | Current → Target | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `typescript` | `^5.7.3–5.9.3` (varies per package) → `^7.0.2` | Build every package (`tsc`, no bundler) | TS 7.0 is GA (confirmed live: `npm view typescript dist-tags` → `latest: 7.0.2`, `rc: 7.0.1-rc`, `next: 7.1.0-dev.*`). It is a **semver successor to 6.x/5.x** — the same `typescript` npm package, same `tsc` binary, same CLI — not a separate `tsgo`/`@typescript/native-preview` install. Empirically verified in this session (see Verification below) that `tsc@7.0.2` still does everything this repo's build depends on: `declaration: true` emit, `NodeNext`/`ES2022`, `strict`, `experimentalDecorators`+`emitDecoratorMetadata`, and generic-class declaration emit shaped like `EventStore<E extends StoreEvent>`. |
| `react` (peer) | already declared `^18.0.0 \|\| ^19.0.0` in `packages/react/package.json`, but only `18.3.1` is actually installed/tested (`pnpm-lock.yaml` has zero `react@19.*` entries) | React bindings peer | The **declaration is already done**; what's missing is verification. `packages/react` has never installed, built, or tested against a real React 19. |
| `@types/react` (dev) | already declared `^18.0.0 \|\| ^19.0.0` | Types for the peer | Confirmed React 19 does **not** bundle its own `.d.ts` — `@types/react` is still DefinitelyTyped-maintained, current `latest: 19.2.18`. The dual-range pattern already in this repo's `package.json` is the exact pattern `@testing-library/react@16.3.2` itself uses for its own peers (`react: ^18.0.0 \|\| ^19.0.0`, same for `react-dom`/`@types/react`/`@types/react-dom`) — corroborates this is the correct, idiomatic shape, not a guess. |
| `@testing-library/react` | not present → add `^16.3.2` (dev, `applesauce-react` only) | Render hooks against a real reconciler for both majors | **`packages/react` currently has zero tests that exercise React's rendering/reconciler.** Its four test files are all `exports.test.ts` snapshot-of-exports checks (`src/__tests__`, `src/hooks/__tests__`, `src/providers/__tests__`, `src/helpers/__tests__`). No `renderHook`, no `@testing-library/*` anywhere. `use-observable-state.ts` (the load-bearing hook `use$` sits on) has meaningful `useState`/`useEffect`/`useLayoutEffect`/ref-timing logic that is currently untested by anything that actually renders. Claiming React 19 support without this is asserting an untested peer range. |
| `@snort/worker-relay` | `^1.5.0` → `2.0.1` | SQLite-backed relay running in a Web Worker | **Confirmed via npm dist-tags: `latest: 2.0.1`.** Used **only** in `apps/examples` (`applesauce-examples`), which is in `.changeset/config.json`'s `ignore` list. **No package under `packages/` depends on it.** This bump does not touch the lockstep major at all — it is an app-level dependency update outside the changesets/release pipeline entirely. |

### Supporting/needed for verification (not currently present)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@testing-library/react` | `^16.3.2` | Hook rendering under a real React reconciler | Add to `packages/react` devDependencies only; nothing else in the workspace renders React. |
| `react-dom` | matching whatever React major is under test (`18.3.1` or `19.2.8`) | `@testing-library/react` requires it as a peer | Test-only devDependency, not currently present in `packages/react/package.json` at all — confirm it's needed before adding `@testing-library/react`. |

No `jsdom`/`happy-dom` exists anywhere in this workspace today. `@testing-library/react` needs a DOM.
Two options, both real given what's already in the repo:

- **Add `jsdom`** as a `vitest` `environment` for `packages/react` only — cheapest, fastest, the
  conventional choice for a hooks-only library (no visual rendering, no CSS, no browser APIs beyond
  `document`/`window`). This is a genuinely new devDependency.
- **Reuse `@vitest/browser-playwright`**, already a root devDependency (`^4.1.6`), and already imported
  in root `vitest.config.ts` (`import { playwright } from "@vitest/browser-playwright"` — present but
  **not currently wired into an active `browser: {...}` test project**; the import appears unused in the
  current config body). Real-browser testing is heavier per-test but avoids adding jsdom.

**Recommendation: `jsdom`.** It is the standard for hook libraries, it's fast enough to run a full
18×19 matrix in CI without real browser startup cost, and it avoids depending on an already-half-wired
Playwright path that isn't proven to work for component rendering yet.

## Installation

```bash
# Root — TypeScript 7 across every package that pins its own typescript devDependency
pnpm -w up typescript@^7.0.2

# packages/react — test infra for dual React major verification
pnpm --filter applesauce-react add -D @testing-library/react@^16.3.2 jsdom react-dom@^18.3.1

# apps/examples — worker-relay v2 (NOT part of the lockstep major; no changeset needed)
pnpm --filter applesauce-examples up @snort/worker-relay@^2.0.0
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| React 19 test DOM | `jsdom` | `@vitest/browser-playwright` (already installed) | Real-browser tests are correct for visual/interaction concerns this repo doesn't have (no rendered UI in `packages/react` — it ships hooks, not components); jsdom is the lower-friction, faster, more conventional choice and the Playwright wiring in root `vitest.config.ts` is not proven functional today. |
| React 19 support mechanism | Keep single dual-range peerDependency (`^18.0.0 \|\| ^19.0.0`) | Ship `applesauce-react-19` as a separate package, or use `exports` conditions per React major | Nothing in the current hook implementations (`use-observable-state.ts`, `use$`) uses a React-19-only or React-18-only API — no `useSyncExternalStore`, no `use()`, no Actions API, no `useOptimistic`. A single dual-range peer is correct and is what the ecosystem (`@testing-library/react` itself) does. |
| TypeScript upgrade path | Jump straight to `^7.0.2` | Land on `6.0.x` first as a stepping stone | The official 6→7 migration guidance ("baseline on 6.0 first, fix every deprecation") targets codebases with `ignoreDeprecations`/legacy-flag debt. Empirical check of this repo's `tsconfig.json` files found none of the TS7-removed flags (`target: es5`, `baseUrl`, `moduleResolution: node10`) anywhere — the repo is already `NodeNext`/`ES2022`/`strict` everywhere. The stepping-stone is for a different kind of codebase than this one. |

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@typescript/native-preview` / raw `tsgo` binary as the build compiler | That is a **separate, still-preview** package with known gaps (no stable programmatic API until 7.1, incomplete tool compatibility). The GA `typescript@7.0.2` you get from `npm install typescript` is the JS-compatible successor with the same `tsc` CLI — that's what was verified working here, not `tsgo`. Do not conflate the two when reading TS7 blog coverage; most of the "things break" articles are about `tsgo`/`native-preview`, not mainline `typescript@7`. | `typescript@^7.0.2` (mainline npm package) |
| `typescript-eslint` / any TS7-programmatic-API-dependent lint tooling as a blocker concern | This repo has **no eslint config and no `typescript-eslint` dependency at all** (verified: no `.eslintrc*`, no `eslint.config.*`, no `typescript-eslint` in any `package.json`). The commonly-cited TS7 blocker ("breaks typescript-eslint until 7.1") does not apply here. | N/A — non-issue for this repo |
| `react-test-renderer` | Deprecated in React 19 with a runtime warning; React's own docs direct migration to `@testing-library/react`. Not currently used here anyway (zero rendering tests exist), so there's nothing to migrate — just don't reach for it when adding new tests. | `@testing-library/react` |
| A separate `applesauce-worker-relay` wrapper package, or moving `@snort/worker-relay` into `packages/` | It's an example-app integration, not an SDK dependency. Nothing in the 14 published packages imports it. Elevating it into the lockstep release surface would be scope creep this milestone doesn't need. | Leave it exactly where it is: `apps/examples`, upgraded independently of the major |
| Hand-writing a changeset for every one of the 14 packages "just to be safe" for the lockstep major | See Version Compatibility section below — `linked` groups do **not** force-bump packages with zero changesets (that's `fixed` group behavior). If a package genuinely has no code change and no ecosystem-rider touching it, giving it an empty changeset is the correct move — but it must be a deliberate, explicit choice per package, not defaulted. | One changeset per actually-changed package; verify the resulting set with `changeset status --verbose --since=master` before cutting |

## Version Compatibility — changesets `linked` group behavior (verified against official docs)

This directly affects how the v7.0.0 major is actually cut, and contradicts a stated assumption in
`.planning/PROJECT.md` ("Lockstep majors... one `major` changeset bumps every member") that is worth
flagging now, before the release is cut:

- **Confirmed (official `changesets` docs, `linked-packages.md`):** *"Unlike fixed packages, there is
  no guarantee that all packages in the group of linked packages will be version-bumped and published,
  only those with changeset(s) will be."* A package in `.changeset/config.json`'s `linked` array with
  **zero** changesets targeting it does **not** get bumped, does **not** get published, and stays on its
  last-released version — even though 13 of its 14 siblings just went to `7.0.0`.
- **What `linked` does guarantee:** every package that *does* have at least one changeset gets bumped
  to the **same bump type** — the highest bump type present anywhere in the linked group's changesets
  for that release cycle — applied to its own current highest version. One `major` changeset anywhere
  in the group elevates every *other-changeset-bearing* package in the group to `major` too, even if
  its own changeset said `patch`.
- **`updateInternalDependencies: "minor"`:** governs whether an internal monorepo dependency's `package.json`
  range gets rewritten when the depended-on package is released. `"minor"` means ranges only get rewritten
  on a minor-or-major release of the dependency (not on every patch) — reduces changelog/diff noise for
  small bumps. **Critical scope limit, confirmed from docs:** this only touches packages that are *also*
  being released in the same publish cycle — a package sitting out this release (no changeset) does not
  get its internal `applesauce-*` dependency ranges touched at all, even if those deps moved to `7.0.0`.
- **Practical consequence for this milestone:** because "lockstep" is the explicit goal, **every one of
  the 14 packages needs at least one changeset in this release** — real ones for `applesauce-relay`
  (999.23–999.28, 999.20/999.21), `applesauce-loaders` (held v1.2 changesets + auth threading),
  `applesauce-concord` (first stable release), `applesauce-react` (SEED-003), and an explicit (even if
  trivial/"no behavior change, republished under the coordinated major") changeset for any package that
  has no other reason to move, or it silently stays behind at its pre-7.0.0 version while its siblings
  jump — the opposite of what "lockstep major" is supposed to guarantee.
- **Deliberately holding one package back:** `changeset version --ignore PACKAGE_NAME` is the documented
  mechanism — it excludes a named package from being versioned in that run even if it has a changeset
  (e.g., an internal-dependency-triggered one). For a package that should simply sit out because it has
  no changeset at all, no flag is needed — default `linked` behavior already does not touch it (see
  above). Given `.planning/PROJECT.md` already resolves the one live "hold back?" question in this
  milestone — **`applesauce-concord` is being published as v7's first stable release, not held back** —
  `--ignore` is documented here as the mechanism for the general case, not because it's currently needed.
- **Dry-run mechanism (no dedicated `--dry-run` flag exists on `status`, `version`, or `publish` per the
  current documented CLI surface):** run `changeset status --verbose --since=master` (matches this repo's
  own `baseBranch: "master"`) before running `changeset version`. It prints the exact resulting version
  for every package that would be bumped and a link to each contributing changeset summary — this is
  the way to catch a package that unexpectedly stayed behind (or unexpectedly jumped to major) before
  `changeset version` mutates `package.json`/`CHANGELOG.md` files.
- **Not verified live against this repo's actual `.changeset/*.md` files** — this section describes the
  general, doc-confirmed mechanics of `linked`+`updateInternalDependencies`; running `changeset status
  --verbose --since=master` against the real held changesets (v1.2's + whatever this milestone adds) is
  still required before cutting, and was out of scope for this research pass (no changesets exist yet
  for the in-flight 999.23–999.28 work).

## Migration Cost Summary (for roadmap phase sizing)

| Rider | Phase sizing | Can run parallel with relay re-layering? | Why |
|-------|-------------|-------------------------------------------|-----|
| **TypeScript 7** (SEED-002) | **One small phase.** Empirically verified zero tsconfig incompatibilities across every package (`NodeNext`, `ES2022`, `strict`, `experimentalDecorators`+`emitDecoratorMetadata`, generic class declaration emit all confirmed working under `tsc@7.0.2` in this session). This is a version bump + `pnpm run build`/`pnpm test` full-workspace green-check, not a rewrite. | **Yes, safely, and should go first or very early.** It changes the compiler everything else builds with; landing it before the relay re-layering plans start means those plans are written/verified against the actual compiler the major will ship with, not a compiler that gets swapped out from under them mid-milestone. |
| **React 19 dual support** (SEED-003) | **Multi-plan phase**, larger than it looks. The `package.json` declaration is already done (peer ranges already dual-range) — the actual work is: (1) add `@testing-library/react`+`jsdom` to `packages/react`, (2) write real rendering tests for `use$`/`useObservableState`/`useAction`/`useActionRunner`/the three providers — none exist today, (3) run that suite twice, once installed against React 18.3.1, once against React 19.2.x, (4) fix whatever the untested `useLayoutEffect`/ref-timing logic in `use-observable-state.ts` does differently under React 19's Strict Mode double-invoke behavior, if anything. Step 2 alone (writing the first rendering tests this package has ever had) is real, unbounded-until-attempted work. | **No — sequence after the relay re-layering's `applesauce-relay`/`applesauce-loaders` work, or run genuinely in parallel on a separate branch.** `applesauce-react` optionally depends on `applesauce-core`/`applesauce-accounts`/`applesauce-actions`/`applesauce-content`, not on `applesauce-relay` directly — there's no hard code dependency forcing sequencing. But it touches the same lockstep major and the same test-infra decisions (jsdom vs. playwright) are worth deciding once, not mid-milestone twice. |
| **`@snort/worker-relay` v2** (SEED-004) | **Tiny, isolated phase — arguably not a "phase" at all.** Confirmed real breaking changes exist (see Sources below): `insertBatchSize` constructor option removed (both `apps/examples` usages pass it and need updating), `setEventMetadata` changed from `Promise<void>` to synchronous `void` (any `await relay.setEventMetadata(...)` call still works but is now awaiting a non-promise, harmless but worth cleaning up), a new `isInstance()` static and `setSeenAt`/`batchSetSeenAt` API added, and `dump()`'s return type narrowed to `Uint8Array<ArrayBufferLike>`. All of this is confined to `apps/examples/src/examples/{cache,database}/worker-relay.tsx`. | **Fully parallel, and arguably shouldn't be "in" the milestone's critical path at all** — `applesauce-examples` is changesets-`ignore`d, so this bump needs **no changeset, no version bump, no lockstep coordination**. It was pulled in "because every package republishes anyway," but this rider doesn't touch any republished package. |

## Sources

**Verified live in this session (HIGH confidence — direct registry/compiler checks, not recalled):**
- `npm view typescript dist-tags --json` — `latest: 7.0.2`, `rc: 7.0.1-rc`, `next: 7.1.0-dev.20260819.1`
- `npm view typescript versions --json` — confirms `7.0.1-rc` → `7.0.2` → `7.1.0-dev.*` sequence, `6.0.1-rc`/`6.0.2`/`6.0.3` also exist as a distinct prior major
- Direct install + compile of `typescript@7.0.2` in an isolated scratch dir against a tsconfig mirroring this repo's own (`NodeNext`/`ES2022`/`strict`/`declaration`/`experimentalDecorators`/`emitDecoratorMetadata`) — successful `.d.ts` emit, including a generic class shaped like `EventStore<E extends StoreEvent>`
- `typescript@7.0.2`'s own `package.json` — ships `optionalDependencies` on 20 `@typescript/typescript-<platform>-<arch>` packages (same pattern as `esbuild`, already handled by this repo's `resolutions` block and by `pnpm`); resolved cleanly under plain `npm install` in this session. **Not directly tested under this repo's own `pnpm@11.10.0` workspace** — inferred low-risk from precedent (`esbuild`, `playwright`, `turbo` already use the identical optional-platform-binary pattern in this same workspace today).
- `npm view @snort/worker-relay dist-tags --json` — `latest: 2.0.1`; `npm pack` + diff of `1.5.0` vs `2.0.1` tarballs' `dist/*.d.ts` files and `package.json` — confirms every breaking-change claim above by direct diff, not a changelog (no changelog was reachable — `git.v0l.io` returned 403 on direct fetch)
- `npm view react dist-tags --json` — `latest: 19.2.8`; `npm view @types/react dist-tags --json` — `latest: 19.2.18` (React itself does not ship its own types)
- `npm view @testing-library/react peerDependencies` — confirms `react: ^18.0.0 || ^19.0.0` / `react-dom: ^18.0.0 || ^19.0.0` / `@types/react: ^18.0.0 || ^19.0.0` / `@types/react-dom: ^18.0.0 || ^19.0.0`, matching this repo's existing `packages/react/package.json` peer shape exactly
- Direct repo inspection: `packages/react/package.json` (peer ranges already dual-major), `packages/react/src/hooks/use-observable-state.ts` + `use-$.ts` (no `useSyncExternalStore` in the live implementation — it's commented out in `use-$.ts` as an abandoned alternative; the shipped hook uses `useState`+`useEffect`+`useLayoutEffect`+refs instead), all four `**/__tests__/exports.test.ts` files (only export-snapshot tests exist, zero rendering tests), `vitest.config.ts`/`vitest.workspace.ts` (no `jsdom`, no wired browser test project despite `@vitest/browser-playwright` being imported), `tsconfig.json` × 2 sampled packages (no TS7-removed flags present), `turbo.json` (no TS-specific task config to worry about), root + all `packages/*/package.json` (no `eslint`/`typescript-eslint` anywhere), `.changeset/config.json` (`applesauce-examples` in `ignore`; `applesauce-*` 14-package `linked` array confirmed)

**Official docs fetched directly (HIGH confidence):**
- `changesets/changesets` GitHub repo, `docs/linked-packages.md` and `docs/config-file-options.md` — `linked` group behavior (only changeset-bearing packages move; shared highest-bump-type; `updateInternalDependencies` scope limited to packages in the current publish cycle)
- `changesets/changesets` GitHub repo, `docs/command-line-options.md` — documented flags for `status`/`version`/`publish` (`--verbose`, `--since`, `--ignore`, `--snapshot`, `--otp`, `--tag`; no dedicated `--dry-run` on any of the three as of the current docs)

**Web search, cross-checked against the above (MEDIUM confidence — general TS7/React19 ecosystem claims not specific to this repo):**
- TypeScript 7.0 GA July 8 2026, Go-native compiler, 8–12x faster type-checking, no stable programmatic API until 7.1 (blocks `typescript-eslint`/`ts-morph`/template checkers generally — **confirmed not applicable to this specific repo**, see above)
- React 19 Strict Mode double-invoke reuses `useMemo`/`useCallback` results from the first pass; `useSyncExternalStore` exists specifically to prevent tearing under concurrent rendering — **this repo's hooks don't use it, so this is background context, not a direct risk**, but worth re-confirming once real React-19 rendering tests exist
- `react-test-renderer` deprecated as of React 19 in favor of `@testing-library/react` — not in use here, non-issue

**Could not verify (explicitly flagged as gaps):**
- Whether `pnpm@11.10.0` resolves `typescript@7.0.2`'s platform-optional dependencies cleanly in *this* workspace specifically (only verified under plain `npm`, in isolation) — low risk given the precedent of `esbuild`/`playwright`/`turbo` already working this way in the same `pnpm-lock.yaml`, but not directly run.
- Whether any of the untested `use-observable-state.ts` timing logic (`useIsomorphicLayoutEffect`, the sync-value probe inside `useState`'s lazy initializer, the stale-observable staleness check in `useEffect`) actually behaves differently under React 19's Strict Mode or concurrent scheduling — cannot be known without writing and running the rendering tests recommended above; flagging as the actual unresolved risk behind SEED-003, not the peer-range declaration (which is already correct).
- `@snort/worker-relay`'s official changelog/migration notes — the source repo (`git.v0l.io`, self-hosted Gitea) returned `403 Forbidden` on direct fetch and no mirrored changelog was found; the breaking-change list above comes from a direct `.d.ts`/`package.json` diff of the published npm tarballs, which is authoritative for the API surface but may miss non-typed runtime behavior changes (e.g., internal SQLite schema migrations, worker message protocol version bumps) invisible to a `.d.ts` diff.
- `.changeset/*.md` files for this in-flight milestone do not exist yet, so `changeset status --verbose --since=master` was not run against real content — the linked-group mechanics above are doc-verified in general but not demonstrated against this repo's actual pending release.

---
*Stack research for: applesauce v7.0.0 relay-method-layering ecosystem riders (SEED-002/003/004) + changesets release mechanics*
*Researched: 2026-08-19*
