# Codebase Structure

**Analysis Date:** 2026-07-08

## Directory Layout

```
applesauce/
├── packages/           # Publishable TypeScript SDK packages
│   ├── core/           # EventStore, helpers, models, operations, factories
│   ├── common/         # Common NIP-specific helpers/models/factories/casts
│   ├── actions/        # High-level Nostr actions built on core/common
│   ├── relay/          # Relay, relay group, relay pool, negentropy support
│   ├── loaders/        # Observable loaders and helper operators
│   ├── react/          # React hooks, providers, rendering helpers
│   ├── accounts/       # Account manager and account implementations
│   ├── signers/        # Signer implementations and signer helpers
│   ├── sqlite/         # SQLite event database adapters and relay wrapper
│   ├── content/        # Text, markdown, and NAST parsing utilities
│   ├── wallet/         # NIP-60/Cashu wallet helpers, models, actions
│   ├── wallet-connect/ # Nostr Wallet Connect helpers and services
│   ├── concord/        # Concord/community domain helpers and casts
│   └── extra/          # Extra optional integrations/helpers
├── apps/               # Non-published apps and generated assets
│   ├── examples/       # Vite React examples app
│   ├── docs/           # VitePress documentation app
│   ├── agent-skills/   # Generated Applesauce agent skill package
│   ├── llms/           # LLM documentation build package
│   └── snippets/       # Documentation/example snippets
├── docs/typedoc/       # Generated TypeDoc output
├── scripts/            # Repository automation scripts
├── refs/               # Reference/experimental code not part of core packages
├── .changeset/         # Changeset release notes
├── .planning/codebase/ # GSD codebase maps
├── package.json        # Workspace scripts and root dev dependencies
├── pnpm-workspace.yaml # Workspace package membership
├── turbo.json          # Turbo build pipeline
├── typedoc.json        # TypeDoc configuration
└── vitest.config.ts    # Shared Vitest configuration
```

## Directory Purposes

**`packages/core/`:**
- Purpose: Keep the minimal reusable kernel for Nostr events and reactive stores.
- Contains: `src/event-store/`, `src/helpers/`, `src/models/`, `src/factories/`, `src/operations/`, `src/observable/`, `src/promise/`, `src/casts/`
- Key files: `packages/core/src/index.ts`, `packages/core/src/event-store/event-store.ts`, `packages/core/src/event-store/interface.ts`, `packages/core/src/factories/event.ts`, `packages/core/src/factories/types.ts`

**`packages/common/`:**
- Purpose: House common NIP-specific behavior that is framework-agnostic.
- Contains: helpers, models, operations, factories, observable operators, casts, registration side effects.
- Key files: `packages/common/src/index.ts`, `packages/common/src/helpers/index.ts`, `packages/common/src/models/__register__.ts`, `packages/common/src/models/thread.ts`, `packages/common/src/factories/note.ts`, `packages/common/src/operations/note.ts`

**`packages/actions/`:**
- Purpose: Provide high-level user actions over core/common primitives.
- Contains: `src/actions/` action modules and package entry points.
- Key files: `packages/actions/src/index.ts`, `packages/actions/src/actions/index.ts`

**`packages/relay/`:**
- Purpose: Manage relay connections, grouped relay operations, subscriptions, publishing, and negentropy sync.
- Contains: pool/group/relay classes, operators, types, negentropy support.
- Key files: `packages/relay/src/pool.ts`, `packages/relay/src/group.ts`, `packages/relay/src/relay.ts`, `packages/relay/src/types.ts`

**`packages/loaders/`:**
- Purpose: Turn relay/upstream APIs into reusable Observable loaders.
- Contains: `src/loaders/`, `src/operators/`, `src/helpers/`, `src/types.ts`.
- Key files: `packages/loaders/src/loaders/event-loader.ts`, `packages/loaders/src/loaders/address-loader.ts`, `packages/loaders/src/loaders/timeline-loader.ts`, `packages/loaders/src/loaders/sync-loader.ts`

**`packages/react/`:**
- Purpose: Integrate Applesauce Observable APIs with React applications.
- Contains: `src/hooks/`, `src/providers/`, `src/helpers/`.
- Key files: `packages/react/src/index.ts`, `packages/react/src/hooks/index.ts`, `packages/react/src/providers/index.ts`

**`packages/accounts/` and `packages/signers/`:**
- Purpose: Keep identity/account orchestration separate from event creation.
- Contains: account classes, account manager, signer implementations, signer helpers.
- Key files: `packages/accounts/src/manager.ts`, `packages/accounts/src/account.ts`, `packages/accounts/src/accounts/private-key-account.ts`, `packages/signers/src/signers/index.ts`

**`packages/sqlite/`:**
- Purpose: Implement durable event databases that satisfy core store interfaces.
- Contains: SQLite variants for `better-sqlite3`, `libsql`, native/Deno/Bun/Turso/WASM, SQL helpers, optional relay server.
- Key files: `packages/sqlite/src/better-sqlite3/event-database.ts`, `packages/sqlite/src/libsql/event-database.ts`, `packages/sqlite/src/helpers/sql.ts`, `packages/sqlite/src/relay.ts`

**`packages/content/`:**
- Purpose: Parse and transform note/article content independently of UI frameworks.
- Contains: `src/text/`, `src/markdown/`, `src/nast/`, `src/helpers/`.
- Key files: `packages/content/src/text/parser.ts`, `packages/content/src/text/index.ts`, `packages/content/src/markdown/index.ts`, `packages/content/src/nast/types.ts`

**`packages/wallet/` and `packages/wallet-connect/`:**
- Purpose: Isolate wallet-specific NIP/Cashu/NWC features from core/common.
- Contains: wallet helpers, models, factories, operations, casts, actions, wallet service/connect URI helpers.
- Key files: `packages/wallet/src/wallet/nut-wallet.ts`, `packages/wallet/src/helpers/tokens.ts`, `packages/wallet/src/actions/wallet.ts`, `packages/wallet-connect/src/wallet-connect.ts`, `packages/wallet-connect/src/wallet-service.ts`

**`apps/examples/`:**
- Purpose: Run integration examples for SDK packages.
- Contains: React routes, components, per-topic examples, metadata, Vite config.
- Key files: `apps/examples/src/index.tsx`, `apps/examples/src/App.tsx`, `apps/examples/src/examples.ts`, `apps/examples/src/components/nav.tsx`

**`apps/docs/`:**
- Purpose: Build and serve documentation through VitePress.
- Contains: docs app package, VitePress config/content, postbuild scripts.
- Key files: `apps/docs/package.json`, `apps/docs/scripts/copy-markdown-sources.sh`

**`.claude/skills/` and `.agents/skills/`:**
- Purpose: Project-local agent skills. Current local skill is `skill-creator` for authoring and evaluating skills.
- Contains: `skill-creator/SKILL.md`, bundled references/scripts/assets.
- Key files: `.claude/skills/skill-creator/SKILL.md`, `.agents/skills/skill-creator/SKILL.md`

## Key File Locations

**Entry Points:**
- `packages/core/src/index.ts`: Core package public API and namespaces.
- `packages/common/src/index.ts`: Common package public API plus model registration side effect.
- `packages/*/src/index.ts`: Package-level public API entry points.
- `apps/examples/src/index.tsx`: Vite React example app mount point.
- `apps/examples/src/examples.ts`: Example registry for routes/navigation.
- `packages/sqlite/src/relay.ts`: Runnable SQLite-backed relay implementation.

**Configuration:**
- `package.json`: Root scripts, package manager, Node engine, shared dev dependencies.
- `pnpm-workspace.yaml`: Workspace membership for `packages/*` and `apps/*`.
- `turbo.json`: Monorepo build/test task graph.
- `vitest.config.ts`: Shared Vitest and coverage configuration.
- `vitest.workspace.ts`: Vitest workspace project list.
- `typedoc.json`: API documentation generation configuration.
- `packages/*/tsconfig.json`: Per-package TypeScript builds.
- `apps/examples/vite.config.ts`: Example app Vite configuration.

**Core Logic:**
- `packages/core/src/event-store/event-store.ts`: Main store implementation.
- `packages/core/src/event-store/interface.ts`: Store/model/database contracts.
- `packages/core/src/event-store/event-models.ts`: Model cache and subscription helpers.
- `packages/core/src/factories/event.ts`: Fluent event factory base.
- `packages/core/src/factories/types.ts`: `EventSigner`, `EventOperation`, `TagOperation`, and factory service types.
- `packages/core/src/operations/`: Core reusable event/tag/content operations.

**Feature Logic:**
- `packages/common/src/helpers/`: NIP-specific parsers, type guards, pointer extractors.
- `packages/common/src/operations/`: Low-level draft/tag mutations for common NIPs.
- `packages/common/src/factories/`: Fluent event builders wrapping common operations.
- `packages/common/src/models/`: Reactive NIP/domain models.
- `packages/common/src/casts/`: Typed event wrappers.
- `packages/wallet/src/`: Wallet-specific helpers, models, actions, factories, casts, wallet classes.
- `packages/concord/src/`: Concord/community-specific helpers, operations, factories, casts.

**Testing:**
- `packages/*/src/**/__tests__/*.test.ts`: Co-located package tests.
- `packages/*/src/**/__tests__/exports.test.ts`: Export snapshot/contract tests.
- `vitest.config.ts`: Shared runner config and coverage include/exclude rules.

## Naming Conventions

**Files:**
- Use lowercase kebab-case for source modules: `packages/core/src/event-store/event-store.ts`, `packages/common/src/factories/zap-request.ts`.
- Use `index.ts` barrel files for public subdirectories: `packages/common/src/helpers/index.ts`, `packages/loaders/src/loaders/index.ts`.
- Use `__tests__/*.test.ts` for tests: `packages/common/src/helpers/__tests__/exports.test.ts`.
- Use `__register__.ts` for side-effect model/cast registrations: `packages/common/src/models/__register__.ts`, `packages/wallet/src/casts/__register__.ts`.

**Directories:**
- Mirror architectural roles under package `src/`: `helpers/`, `models/`, `operations/`, `factories/`, `casts/`, `actions/`, `observable/`, `operators/`.
- Keep runtime package code under `packages/<name>/src/`; keep consumer-facing demos under `apps/examples/src/examples/<topic>/`.
- Place generated output in `dist/` for packages and `docs/typedoc/` for TypeDoc; do not add source logic there.

## Where to Add New Code

**New Core Primitive:**
- Primary code: `packages/core/src/helpers/`, `packages/core/src/event-store/`, `packages/core/src/operations/`, or `packages/core/src/factories/`
- Tests: matching `packages/core/src/**/__tests__/*.test.ts`
- Exports: update the closest `packages/core/src/**/index.ts` and `packages/core/package.json` only when exposing a new public subpath.

**New NIP/Common Feature:**
- Primary code: `packages/common/src/helpers/<feature>.ts`
- Operations: `packages/common/src/operations/<feature>.ts`
- Factories: `packages/common/src/factories/<feature>.ts`
- Models/casts: `packages/common/src/models/<feature>.ts` or `packages/common/src/casts/<feature>.ts` only when the feature needs reactive views or typed event wrappers.
- Tests: `packages/common/src/helpers/__tests__/`, `packages/common/src/operations/__tests__/`, `packages/common/src/factories/__tests__/`
- Exports: update `packages/common/src/helpers/index.ts`, `packages/common/src/operations/index.ts`, `packages/common/src/factories/index.ts`, and export tests.

**New High-Level Action:**
- Primary code: `packages/actions/src/actions/<action>.ts` for general Nostr actions or `packages/wallet/src/actions/<action>.ts` for wallet actions.
- Tests: colocated `src/actions/__tests__/<action>.test.ts`.
- Exports: update `src/actions/index.ts` and package `src/index.ts` if needed.

**New Relay/Loader Behavior:**
- Relay connection behavior: `packages/relay/src/`.
- Event loading behavior: `packages/loaders/src/loaders/<loader>.ts`.
- RxJS loader helpers/operators: `packages/loaders/src/helpers/` or `packages/loaders/src/operators/`.
- Tests: matching `packages/loaders/src/**/__tests__/*.test.ts` or `packages/relay/src/**/__tests__/*.test.ts`.

**New React Integration:**
- Hooks: `packages/react/src/hooks/<hook>.ts`.
- Providers: `packages/react/src/providers/<provider>.tsx` or existing provider modules.
- Helpers: `packages/react/src/helpers/<helper>.ts`.
- Examples: `apps/examples/src/examples/<topic>/<example>.tsx`.

**New Persistence Adapter:**
- Primary code: `packages/sqlite/src/<adapter>/event-database.ts` plus `packages/sqlite/src/<adapter>/index.ts`.
- Shared SQL/search helpers: `packages/sqlite/src/helpers/`.
- Tests: `packages/sqlite/src/<adapter>/__tests__/event-database.test.ts`.
- Exports: update `packages/sqlite/package.json` export map for new adapter subpaths.

**Documentation or Examples:**
- Docs app/content: `apps/docs/` following existing VitePress organization.
- Generated API docs: `docs/typedoc/` through TypeDoc scripts, not by hand.
- Examples: `apps/examples/src/examples/<topic>/` and register in `apps/examples/src/examples.ts`.

**Utilities:**
- Package-specific helpers: `packages/<package>/src/helpers/`.
- Cross-package utilities belong in `packages/core/src/helpers/` only when they are protocol-kernel level; otherwise prefer `packages/common/src/helpers/`.
- Test-only helpers stay in `packages/<package>/src/__tests__/` or the closest `__tests__/` directory, such as `packages/loaders/src/__tests__/fake-user.ts`.

## Special Directories

**`dist/`:**
- Purpose: Built package output referenced by `package.json` `main`, `types`, and `exports`.
- Generated: Yes
- Committed: Present in working tree; treat as generated output and prefer editing `src/`.

**`coverage/`:**
- Purpose: Vitest coverage reports configured by `vitest.config.ts`.
- Generated: Yes
- Committed: No source code should be added here.

**`docs/typedoc/`:**
- Purpose: Generated API reference from TypeDoc.
- Generated: Yes
- Committed: Present documentation output; source API changes belong under `packages/*/src/`.

**`.changeset/`:**
- Purpose: Release notes and package version bump metadata.
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: GSD mapping documents consumed by planning/execution agents.
- Generated: Yes
- Committed: Project workflow dependent.

**`refs/`:**
- Purpose: Reference or experimental code used for comparison.
- Generated: No
- Committed: Yes; do not place production package code here.

**`.claude/skills/` and `.agents/skills/`:**
- Purpose: Project-local agent skill definitions and resources.
- Generated: No
- Committed: Yes; edit with skill-creator conventions when working on skills.

---

*Structure analysis: 2026-07-08*
