<!-- refreshed: 2026-07-08 -->
# Architecture

**Analysis Date:** 2026-07-08

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│              Apps, docs, examples, and consumers             │
├──────────────────┬──────────────────┬───────────────────────┤
│  React examples  │   VitePress docs │  generated assets      │
│ `apps/examples`  │   `apps/docs`    │ `apps/llms`,`skills`   │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 Feature packages and adapters                │
│ `packages/common`, `actions`, `wallet`, `concord`, `react`   │
│ `packages/loaders`, `relay`, `sqlite`, `accounts`, `signers` │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                       Core event layer                       │
│ `packages/core/src/event-store`, `helpers`, `models`         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│            Nostr events, relays, signers, and databases      │
│ `packages/relay`, `packages/signers`, `packages/sqlite`      │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Core event store | Own in-memory event identity, insert/update/remove streams, delete/expiration handling, model subscriptions | `packages/core/src/event-store/event-store.ts` |
| Event model cache | Deduplicate and keep reactive computed models warm with `share`/`ReplaySubject` | `packages/core/src/event-store/event-models.ts` |
| Event factory base | Build fluent, promise-like event drafts and sign/stamp them with an `EventSigner` | `packages/core/src/factories/event.ts` |
| Event operations | Provide immutable draft/tag transformations consumed by factories | `packages/core/src/operations/event.ts`, `packages/core/src/operations/tags.ts` |
| NIP helpers/models | Add NIP-specific guards, parsers, operations, factories, casts, and model prototype extensions | `packages/common/src/helpers/badge.ts`, `packages/common/src/models/thread.ts` |
| Relay pool | Own relay connection instances and expose grouped request/publish/subscription APIs | `packages/relay/src/pool.ts` |
| Loaders | Convert relay/upstream APIs into Observable loaders for events, addresses, timelines, social graph, and sync | `packages/loaders/src/loaders/index.ts` |
| React bindings | Provide hooks, helpers, and providers for using RxJS/event-store APIs in React | `packages/react/src/index.ts` |
| SQLite adapters | Implement event database persistence backends and an optional relay server | `packages/sqlite/src/better-sqlite3/event-database.ts`, `packages/sqlite/src/libsql/event-database.ts`, `packages/sqlite/src/relay.ts` |
| Example app | Demonstrate package integration through routed React examples | `apps/examples/src/index.tsx`, `apps/examples/src/examples.ts` |

## Pattern Overview

**Overall:** Reactive monorepo SDK with a core event-store kernel, feature packages layered on top, and adapter packages at the edges.

**Key Characteristics:**
- Use `EventStore` as the central normalized event cache; add events via `EventStore.add()` and read through direct queries or Observable models in `packages/core/src/event-store/event-store.ts`.
- Represent derived state as `Model<T>` functions that receive a store and return `Observable<T>`; add domain models under package `src/models/` and register convenience methods through `EventModels.prototype` when needed, as in `packages/common/src/models/thread.ts`.
- Build events by composing immutable `EventOperation`s; expose low-level operations from `src/operations/` and fluent domain factories from `src/factories/`, as in `packages/common/src/operations/note.ts` and `packages/common/src/factories/note.ts`.
- Keep package public surfaces explicit through `src/index.ts` and submodule `index.ts` barrel files matching `package.json` export maps, such as `packages/core/src/index.ts` and `packages/wallet/package.json`.

## Layers

**Core primitives:**
- Purpose: Define Nostr event types, filters, pointers, cache symbols, store interfaces, operations, factories, observables, and core models.
- Location: `packages/core/src`
- Contains: `event-store/`, `helpers/`, `models/`, `factories/`, `operations/`, `observable/`, `promise/`, `casts/`
- Depends on: `nostr-tools`, `rxjs`, `debug`, small utility packages declared in `packages/core/package.json`
- Used by: All SDK packages including `packages/common`, `packages/actions`, `packages/loaders`, `packages/relay`, `packages/signers`, `packages/sqlite`, `packages/wallet`

**Protocol feature packages:**
- Purpose: Add NIP/domain-specific behavior without bloating core.
- Location: `packages/common/src`, `packages/wallet/src`, `packages/wallet-connect/src`, `packages/concord/src`, `packages/content/src`
- Contains: guarded helpers, casts, reactive models, operations, fluent factories, action helpers, content parsers
- Depends on: `applesauce-core` plus package-specific SDKs such as `@cashu/cashu-ts` in `packages/wallet/package.json`
- Used by: `packages/actions`, `packages/react`, `apps/examples`, downstream consumers

**Network and loading:**
- Purpose: Connect to relays, group relay operations, publish events, and load missing/remote events into stores.
- Location: `packages/relay/src`, `packages/loaders/src`
- Contains: `RelayPool`, `RelayGroup`, `Relay`, loaders, helper operators, upstream adapters
- Depends on: `applesauce-core`, `rxjs`, WebSocket-capable runtimes
- Used by: apps and packages that need relay IO, including `packages/wallet` peer dependencies and `apps/examples`

**Identity and signing:**
- Purpose: Abstract Nostr account types and signer implementations.
- Location: `packages/accounts/src`, `packages/signers/src`
- Contains: account classes, `AccountManager`, private key/password/extension/Nostr Connect signers, signer helpers
- Depends on: `applesauce-core`, `@noble/secp256k1`, `@scure/base`, optional native signer plugins
- Used by: event factories, actions, wallet flows, and examples

**Persistence adapters:**
- Purpose: Persist/query events outside the default memory database.
- Location: `packages/sqlite/src`
- Contains: `better-sqlite3/`, `libsql/`, `native/`, `bun/`, `turso/`, `turso-wasm/`, SQL/search helpers, relay wrapper
- Depends on: `applesauce-core` interfaces and peer SQLite clients from `packages/sqlite/package.json`
- Used by: consumers needing durable stores and examples under `apps/examples/src/examples/database/`

**UI and documentation:**
- Purpose: Show and document integration patterns.
- Location: `packages/react/src`, `apps/examples/src`, `apps/docs`, `docs/typedoc`
- Contains: hooks/providers, Vite React examples, VitePress docs, generated TypeDoc output
- Depends on: React, Vite/VitePress, workspace packages
- Used by: maintainers and downstream developers

## Data Flow

### Primary Event Ingestion Path

1. A relay request/subscription emits `NostrEvent` values through `RelayPool.request()` or `RelayPool.subscription()` (`packages/relay/src/pool.ts:184`, `packages/relay/src/pool.ts:193`).
2. Loaders or app code pass events into `EventStore.add(event, relay)` (`packages/core/src/event-store/event-store.ts:216`).
3. `EventStore.add()` verifies delete/expiration/replaceable rules, records seen relay metadata, stores the canonical event instance, and emits `insert$`/`update$` streams (`packages/core/src/event-store/event-store.ts:92`, `packages/core/src/event-store/event-store.ts:95`).
4. Models subscribed through `events.filters()`, `events.timeline()`, or `events.model()` recompute from store streams (`packages/core/src/event-store/event-models.ts:56`, `packages/core/src/event-store/event-models.ts:102`, `packages/core/src/event-store/event-models.ts:138`).
5. React hooks or direct RxJS subscribers render/use derived data from package models such as `ThreadModel` (`packages/common/src/models/thread.ts:45`).

### Event Creation and Publishing Path

1. Feature factories start from `blankEventTemplate()` or an existing event (`packages/core/src/factories/event.ts:23`, `packages/common/src/factories/note.ts:23`).
2. Factory methods compose `EventOperation`s through `chain()` without mutating prior drafts (`packages/core/src/factories/event.ts:69`, `packages/common/src/factories/note.ts:48`).
3. Operations clone and return updated drafts/tags, as in `setThreadParent()` and `includePubkeyNotificationTags()` (`packages/common/src/operations/note.ts:14`, `packages/common/src/operations/note.ts:46`).
4. `EventFactory.sign()` stamps and signs with an `EventSigner`, validating that signer output keeps pubkey and kind stable (`packages/core/src/factories/event.ts:126`).
5. Relay adapters publish signed events with `RelayPool.publish()`/`RelayGroup.publish()` (`packages/relay/src/pool.ts:175`).

### Package Extension Flow

1. Domain packages implement models as `Model<T>` constructors (`packages/common/src/models/thread.ts:45`).
2. Domain packages register convenience methods by mutating `EventModels.prototype` and declaring module augmentation (`packages/common/src/models/thread.ts:168`).
3. Package `src/index.ts` imports registration side effects where needed, such as `packages/common/src/index.ts` importing `packages/common/src/models/__register__.ts`.

**State Management:**
- Use RxJS `Observable`, `Subject`, `BehaviorSubject`, and `ReplaySubject` for state propagation. Core global-ish state is held per class instance (`EventStore`, `RelayPool`, `AccountManager`), not in process-wide stores. Model cache state lives on an `EventStore`/`EventModels` instance in `packages/core/src/event-store/event-models.ts`.

## Key Abstractions

**EventStore:**
- Purpose: Canonical event cache and reactive subscription source.
- Examples: `packages/core/src/event-store/event-store.ts`, `packages/core/src/event-store/interface.ts`, `packages/core/src/event-store/event-memory.ts`
- Pattern: Interface-driven store with sync/async variants and optional database injection.

**Model<T>:**
- Purpose: Computed reactive view over a store/event set.
- Examples: `packages/core/src/event-store/interface.ts`, `packages/core/src/models/base.ts`, `packages/common/src/models/thread.ts`
- Pattern: Function constructor returning `(events) => Observable<T>` plus optional `getKey` for cache identity.

**EventOperation and TagOperation:**
- Purpose: Reusable immutable transformations for event drafts and tags.
- Examples: `packages/core/src/factories/types.ts`, `packages/core/src/operations/event.ts`, `packages/common/src/operations/note.ts`
- Pattern: Small pure or async functions composed by factories and `eventPipe`.

**EventFactory:**
- Purpose: Fluent, promise-like builder for event drafts and signed events.
- Examples: `packages/core/src/factories/event.ts`, `packages/common/src/factories/note.ts`, `packages/wallet/src/factories/wallet.ts`
- Pattern: Subclass `EventFactory` per NIP/domain and expose static `create()`/`modify()`/semantic methods.

**RelayPool / RelayGroup / Relay:**
- Purpose: Manage relay connection lifecycle and multiplex requests/publishes.
- Examples: `packages/relay/src/pool.ts`, `packages/relay/src/group.ts`, `packages/relay/src/relay.ts`
- Pattern: Pool owns normalized relay singletons; groups execute Observable-based network calls.

**Casts:**
- Purpose: Event-centric wrappers that validate events and expose typed relationships/properties.
- Examples: `packages/common/src/casts/index.ts`, `packages/wallet/src/casts/wallet.ts`, `packages/concord/src/casts/index.ts`
- Pattern: Keep parsing/validation in helpers and use casts for richer event UX.

## Entry Points

**Workspace scripts:**
- Location: `package.json`
- Triggers: `pnpm build`, `pnpm test`, `pnpm coverage`, `pnpm docs`, `pnpm dev`
- Responsibilities: Run Turbo builds/tests, Vitest, Vite example app, and VitePress docs.

**Package public APIs:**
- Location: `packages/*/src/index.ts`
- Triggers: TypeScript builds from each package `package.json` `build` script
- Responsibilities: Export public modules and side-effect registrations matching `exports` maps.

**Core SDK entry:**
- Location: `packages/core/src/index.ts`
- Triggers: Importing `applesauce-core`
- Responsibilities: Export factories, casts, event-store, logger, observable helpers, and namespaces for helpers/models/operations/factories.

**Example app entry:**
- Location: `apps/examples/src/index.tsx`
- Triggers: `pnpm dev` or `apps/examples` Vite build
- Responsibilities: Mount the React example application and routes.

**Docs app entry:**
- Location: `apps/docs/package.json`
- Triggers: `pnpm docs`, `vitepress dev`, `vitepress build`
- Responsibilities: Serve and build VitePress documentation.

**SQLite relay entry:**
- Location: `packages/sqlite/src/relay.ts`
- Triggers: `pnpm --filter applesauce-sqlite relay` after build
- Responsibilities: Run a WebSocket/HTTP relay backed by SQLite event database adapters.

## Architectural Constraints

- **Threading:** Runtime code is single-threaded JavaScript/TypeScript with RxJS async streams. The example app may demonstrate workers (`apps/examples/src/examples/database/worker-relay.tsx`, `apps/examples/src/examples/cache/worker-relay.tsx`), but packages primarily assume event-loop concurrency.
- **Global state:** Avoid module-level mutable application state in packages. Approved shared registries are prototype registrations from model modules (`packages/common/src/models/thread.ts`) and symbol-based per-event caches (`packages/common/src/helpers/badge.ts`).
- **Circular imports:** Not detected during static sampling. Keep package dependency direction pointed toward `applesauce-core`; feature packages should not import from apps or generated docs.
- **ES modules:** All packages use `type: module` in `packages/*/package.json`; internal relative imports include `.js` extensions in TypeScript source, as in `packages/core/src/index.ts`.
- **Public API stability:** Add exports to both `src/*/index.ts` barrel files and package `exports` maps when exposing new subpaths, following `packages/wallet/package.json`.

## Anti-Patterns

### Mutating event drafts directly

**What happens:** A factory or operation changes `draft.tags`/`draft.content` in place.
**Why it's wrong:** Factory chains in `packages/core/src/factories/event.ts` rely on immutable operation return values and symbol cleanup between chain steps.
**Do this instead:** Return cloned drafts/tags from `EventOperation`s, as in `packages/common/src/operations/note.ts`.

### Putting NIP-specific logic in core

**What happens:** New protocol helpers/models are added under `packages/core/src` instead of a feature package.
**Why it's wrong:** `packages/core/src` is the reusable kernel; NIP/domain growth belongs in `packages/common/src`, `packages/wallet/src`, `packages/wallet-connect/src`, or another focused package.
**Do this instead:** Add guarded helpers under `packages/common/src/helpers/`, operations under `packages/common/src/operations/`, factories under `packages/common/src/factories/`, and models/casts only when needed.

### Reading from relays inside models

**What happens:** A `Model<T>` directly opens relay subscriptions or performs network IO.
**Why it's wrong:** Models are derived views over a store; IO belongs in `packages/loaders/src` or `packages/relay/src` so stores remain testable and cache-driven.
**Do this instead:** Load events through loaders/relay subscriptions, add them to `EventStore`, then derive views with `events.filters()`/`events.timeline()` as in `packages/common/src/models/thread.ts`.

## Error Handling

**Strategy:** Throw synchronously/asynchronously for invalid factory inputs and signer failures; use Observable errors/completion for network streams; return `null`/`undefined` for rejected or missing events in store helpers.

**Patterns:**
- Validate factory preconditions and throw early, e.g. `NoteFactory.reply()` in `packages/common/src/factories/note.ts`.
- Validate signer behavior and throw if signer mutates pubkey/kind in `packages/core/src/factories/event.ts` and `packages/core/src/operations/event.ts`.
- Store APIs return `NostrEvent | null` on add and `undefined` for misses in `packages/core/src/event-store/interface.ts`.

## Cross-Cutting Concerns

**Logging:** Use package-local `debug`/logger utilities where present, with core export from `packages/core/src/logger.ts`; relay/store adapters import `logger` from core in files such as `packages/sqlite/src/better-sqlite3/event-database.ts`.
**Validation:** Use type guards and helper checks in `src/helpers/`, such as `isValidBadge()` in `packages/common/src/helpers/badge.ts`, plus Nostr signature verification in `EventStore.verifyEvent` (`packages/core/src/event-store/event-store.ts`).
**Authentication:** Use signer/account abstractions from `packages/core/src/factories/types.ts`, `packages/signers/src`, and `packages/accounts/src`; do not embed private key handling in feature packages.

---

*Architecture analysis: 2026-07-08*
