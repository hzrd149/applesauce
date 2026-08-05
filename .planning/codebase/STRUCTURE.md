# Codebase Structure

**Analysis Date:** 2026-07-09

## Directory Layout

```
applesauce/
├── packages/                  # Core library packages (pnpm workspace)
│   ├── core/                 # Main EventStore, factories, operations, models
│   ├── common/               # NIP-specific helpers, casts, models (depends on core)
│   ├── relay/                # WebSocket relay communication and pooling
│   ├── loaders/              # Event loaders for fetching from relays
│   ├── signers/              # Event signing implementations
│   ├── accounts/             # Account management and signer selection
│   ├── actions/              # High-level user actions (follow, reply, like)
│   ├── content/              # Text and markdown parsing/rendering
│   ├── react/                # React hooks for observable subscription
│   ├── wallet/               # Lightning/payment wallet integration
│   ├── wallet-connect/       # WalletConnect (Cosmos) signer
│   ├── sqlite/               # SQLite event database backend
│   ├── extra/                # Experimental features
│   └── concord/              # Concord protocol (CORD) client
│
├── apps/                      # Applications and documentation
│   ├── docs/                 # VitePress documentation site
│   ├── examples/             # Example applications and code samples
│   ├── snippets/             # Standalone code snippets
│   ├── agent-skills/         # Claude agent skills for code generation
│   └── llms/                 # LLM context and prompt management
│
├── .planning/                 # Project planning documents
│   ├── codebase/             # This directory
│   ├── milestones/           # Milestone tracking
│   └── phases/               # Phase execution plans
│
├── .claude/                   # Claude Code configuration
│   └── skills/               # Project-specific Claude skills
│
├── .agents/                   # Agent workflow definitions
│   └── skills/               # Agent skill definitions
│
├── .github/                   # GitHub Actions workflows
│   └── workflows/            # CI/CD pipeline definitions
│
├── .changeset/                # Changesets for versioning (via changesets)
├── pnpm-workspace.yaml        # pnpm monorepo configuration
├── tsconfig.json              # TypeScript base configuration
├── turbo.json                 # Turbo build cache configuration
└── package.json               # Root workspace package
```

## Directory Purposes

**packages/core:**
- Purpose: Foundation of applesauce — EventStore, helpers, models, factories, operations
- Contains: TypeScript source in `src/`, compiled output in `dist/`
- Key files: 
  - `src/event-store/event-store.ts` — Main store implementation
  - `src/event-store/interface.ts` — Type definitions for store and models
  - `src/helpers/event.ts` — Core event types (NostrEvent, Rumor, StoreEvent)
  - `src/factories/event.ts` — EventFactory for building events
  - `src/operations/` — Pure mutation functions
  - `src/models/` — Observable computed views
  - `src/casts/` — Typed event wrappers

**packages/common:**
- Purpose: NIP-specific helpers, casts, factories, and models
- Contains: Code for specific Nostr Improvement Proposals (badges, kind mappings, etc.)
- Exports: Via `packages/common/src/helpers/index.ts`, `packages/common/src/casts/index.ts`, etc.
- Depends on: `applesauce-core`

**packages/relay:**
- Purpose: Nostr relay communication via WebSocket
- Contains: `Relay` (single connection), `RelayPool` (multi-relay), `RelayGroup` (management)
- Key files:
  - `src/relay.ts` — Single relay connection
  - `src/pool.ts` — Relay pool for redundancy
  - `src/group.ts` — Relay grouping and batching
  - `src/operators/` — RxJS operators for relay queries

**packages/loaders:**
- Purpose: Load events from relays into EventStore
- Contains: EventLoader, ProfileLoader, FilterLoader implementations
- Key files:
  - `src/loaders/event-loader.ts` — Generic event loader
  - `src/loaders/profile-loader.ts` — Specialized loader for profiles
  - `src/loaders/filter-loader.ts` — Load by Nostr filter

**packages/signers:**
- Purpose: Sign events (PrivateKey, NIP-46, WalletConnect, etc.)
- Contains: Signer implementations and helpers
- Key files:
  - `src/signers/` — Various signer classes
  - `src/helpers/` — Signing utilities

**packages/accounts:**
- Purpose: Manage multiple accounts and signers
- Contains: AccountManager for active account state, account type registration
- Key files:
  - `src/accounts/account-manager.ts` — Core account management
  - `src/accounts/` — Account type implementations

**packages/actions:**
- Purpose: High-level actions (follow, reply, like, etc.)
- Contains: ActionRunner, action builders
- Key files:
  - `src/actions/` — Individual action builders (follow.ts, reply.ts, etc.)
  - Follows pattern: `action(runner, ...args): Observable<Event>`

**packages/content:**
- Purpose: Parse and render event content
- Contains: Text parsing (NAST), markdown rendering, component mapping
- Key files:
  - `src/text/` — Text parsing and NAST trees
  - `src/markdown/` — Markdown rendering via remark
  - `src/helpers/` — Content helpers

**packages/react:**
- Purpose: React hooks for observable subscription
- Contains: Hooks to bridge RxJS Observables and React lifecycle
- Key files:
  - `src/hooks/` — `useObservable`, `useModel`, `useModelValue`, etc.
  - `src/providers/` — Context providers for store/accounts
  - Peer dependencies: React 18+

**packages/wallet, packages/wallet-connect:**
- Purpose: Payment and account signature integration
- wallet: Lightning wallet, Cashu tokens
- wallet-connect: Cosmos ecosystem signer support

**packages/sqlite:**
- Purpose: SQLite backend for persistent event storage (alternative to in-memory)
- Contains: SQLite database implementation of IEventDatabase interface

**packages/extra:**
- Purpose: Experimental or optional features
- Contains: Unstable APIs, POCs, optional integrations

**packages/concord:**
- Purpose: Concord protocol (CORD) for encrypted group communications
- Contains: Helpers, operations, factories, casts, and client
- Structure mirrors core: `helpers/`, `operations/`, `factories/`, `casts/`, `models/`, `client/`
- Key files:
  - `src/client/` — Concord group client
  - `src/helpers/` — CORD event parsing
  - `src/factories/` — Build CORD events
  - `src/casts/` — Type-safe CORD event wrappers

**apps/docs:**
- Purpose: VitePress documentation site
- Contains: Markdown docs, typedoc API reference, example code snippets
- Build: `pnpm build` → static site in `dist/`

**apps/examples:**
- Purpose: Runnable example applications
- Contains: Small focused examples (CLI, React, Node.js)
- Structure: Each subdirectory is a self-contained example
- Run: `pnpm --filter applesauce-examples dev`

**apps/snippets:**
- Purpose: Standalone code snippets for documentation
- Contains: Small focused examples used in docs

**apps/agent-skills:**
- Purpose: Claude agent skills for code generation and refactoring
- Contains: Skill definitions for the Claude agent harness
- Structure: Aligns with skill definition format

**apps/llms:**
- Purpose: LLM context and prompt management
- Contains: Context files and prompts for Claude/GPT integration

**.planning/codebase:**
- Purpose: Architecture and structure documentation
- Contains: This directory; ARCHITECTURE.md, STRUCTURE.md, etc.
- Used by: `/gsd-plan-phase`, `/gsd-execute-phase` to understand codebase

**.claude/skills/ and .agents/skills/:**
- Purpose: Project-specific Claude skills
- Used by: Claude Code agent for specialized behaviors

## Key File Locations

**Entry Points:**
- `packages/core/src/index.ts` → Main export (EventStore, helpers, factories)
- `packages/relay/src/index.ts` → Relay and pool exports
- `packages/accounts/src/index.ts` → AccountManager export
- `packages/actions/src/index.ts` → ActionRunner export
- `packages/react/src/index.ts` → React hooks export

**Configuration:**
- `pnpm-workspace.yaml` → Monorepo workspace configuration
- `tsconfig.json` → Base TypeScript configuration (root level and per-package)
- `turbo.json` → Turbo build cache and task definitions
- `package.json` → Root workspace package name and scripts

**Core Logic:**
- `packages/core/src/event-store/event-store.ts` → EventStore<E> implementation
- `packages/core/src/event-store/interface.ts` → IEventStore, IModel, type definitions
- `packages/core/src/factories/event.ts` → EventFactory builder
- `packages/core/src/operations/` → Composable event mutations
- `packages/common/src/helpers/` → NIP-specific parsers and type guards

**Testing:**
- `packages/*/src/**/*.test.ts` or `*.spec.ts` → Vitest test files (co-located)
- `vitest.config.ts` (per-package or root) → Vitest configuration
- `.changeset/` → Changesets for versioning (one file per change)

## Naming Conventions

**Files:**
- PascalCase for classes: `EventStore.ts`, `EventFactory.ts`, `RelayPool.ts`
- camelCase for utilities/helpers: `event.ts`, `filter.ts`, `helpers.ts`
- Directories: kebab-case: `event-store/`, `relay-pool/`, `event-models/`
- Index files: `index.ts` to export public API

**Directories:**
- `src/` → TypeScript source files
- `dist/` → Compiled JavaScript output (generated)
- `__tests__/` → Test files (co-located with source)
- `helpers/` → Utility functions and type guards
- `operations/` → Tag/content mutation functions
- `factories/` → Event builders and factories
- `casts/` → Typed event wrappers
- `models/` → Observable computed views
- `hooks/` → React hooks (in react package)

## Where to Add New Code

**New Feature (e.g., new action):**
- Primary code: `packages/actions/src/actions/[feature-name].ts`
- Tests: `packages/actions/src/actions/__tests__/[feature-name].test.ts`
- Export: Add to `packages/actions/src/actions/index.ts`
- Pattern: `export function actionName(runner, ...args): Observable<Event> { ... }`

**New Component/Module (e.g., new signer type):**
- Implementation: `packages/signers/src/signers/[signer-name].ts`
- Tests: `packages/signers/src/signers/__tests__/[signer-name].test.ts`
- Export: Add to `packages/signers/src/signers/index.ts`
- Pattern: Implement `EventSigner` interface

**New NIP Support (e.g., new badge type):**
- Helpers: `packages/common/src/helpers/[nip-name].ts` → Type guards
- Casts: `packages/common/src/casts/[nip-name].ts` → Typed wrappers
- Operations: `packages/common/src/operations/[nip-name].ts` → Mutations
- Factories: `packages/common/src/factories/[nip-name].ts` → Builders
- Models: `packages/common/src/models/[nip-name].ts` → Observables
- Export: Update corresponding `index.ts` files
- Follow: [Checklist in CLAUDE.md](../../CLAUDE.md#adding-support-for-a-new-nip)

**New Utility/Helper:**
- Framework-agnostic: `packages/core/src/helpers/[name].ts`
- NIP-specific: `packages/common/src/helpers/[name].ts`
- Test: `packages/*/src/helpers/__tests__/[name].test.ts`
- Export: Add to helpers `index.ts`

**New React Hook:**
- Implementation: `packages/react/src/hooks/[hook-name].ts`
- Tests: `packages/react/src/hooks/__tests__/[hook-name].test.ts`
- Export: Add to `packages/react/src/hooks/index.ts`
- Pattern: Wrap RxJS observable subscription via `observable-hooks`

**Breaking Change or Major Refactor:**
- Create `.changeset/[unique-id].md` file describing change
- Format: Frontmatter with affected packages, then single-sentence body
- Example:
  ```
  ---
  "applesauce-core": minor
  "applesauce-common": patch
  ---
  Refactor EventStore to use generic E extends StoreEvent for unsigned rumors
  ```

## Special Directories

**packages/*/src/__tests__/:**
- Purpose: Top-level test files for package exports
- Contains: Integration tests, export snapshot tests
- Generated: No (checked in)

**packages/core/src/event-store/__tests__/:**
- Purpose: EventStore integration tests
- Contains: Tests for indexing, subscriptions, deletion, expiration
- Generated: No

**packages/core/src/helpers/__tests__/:**
- Purpose: Helper and utility tests
- Contains: Tests for guards, parsers, type utilities
- Generated: No

**packages/*/dist/:**
- Purpose: Compiled JavaScript output
- Generated: Yes (via `tsc` during build)
- Committed: No (gitignored)
- Includes: `.js` files and `.d.ts` type definitions

**coverage/:**
- Purpose: Code coverage reports
- Generated: Yes (via `pnpm test`)
- Committed: No (gitignored)

**node_modules/:**
- Purpose: Installed dependencies
- Generated: Yes (via `pnpm install`)
- Committed: No (gitignored)
- Workspace: pnpm manages shared instance + hoisting

**docs/typedoc/:**
- Purpose: Generated API documentation
- Generated: Yes (via `pnpm run typedoc`)
- Committed: No (gitignored)
- Replaces: Older static docs; now use `apps/docs`

---

*Structure analysis: 2026-07-09*
