<!-- refreshed: 2026-07-09 -->
# Architecture

**Analysis Date:** 2026-07-09

## System Overview

Applesauce is a reactive Nostr SDK for TypeScript/JavaScript built on RxJS and a single in-memory EventStore. The architecture follows a layered, functional approach where events flow through helpers, models, factories, operations, and casts. The core principle is reactive composition: all data access is observable, enabling real-time updates across multiple consumers.

```text
┌─────────────────────────────────────────────────────────────┐
│          Applications & UI                                  │
│  (React Hooks / CLI / Smart Contracts)                      │
│  `apps/examples/`, `packages/react/`                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│   Actions & Commands Layer                                  │
│   Create/sign events, perform user actions                  │
│   `packages/actions/`, `packages/signers/`                  │
│   `packages/accounts/`, `packages/concord/`                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│   Content & Model Layer                                     │
│   Parse/render events, create computed views                │
│   `packages/content/`, `packages/core/models/`              │
│   `packages/core/factories/`, `packages/core/casts/`        │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│   EventStore & In-Memory Database                           │
│   Stores events, manages subscriptions, indexes             │
│   `packages/core/event-store/`                              │
│   - EventStore<E> (generic over StoreEvent)                 │
│   - RumorStore (unsigned NIP-59 rumor events)               │
│   - EventMemory (in-memory index)                           │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│   Relay & Transport Layer                                   │
│   WebSocket relay connections, subscriptions                │
│   `packages/relay/`, `packages/loaders/`                    │
│   Negentropy sync, EventLoaders                             │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│   Helper Layer                                              │
│   Guards, parsers, utilities (framework-agnostic)           │
│   `packages/core/helpers/`, `packages/common/helpers/`      │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| EventStore | Core in-memory store for events, subscriptions, streaming | `packages/core/src/event-store/event-store.ts` |
| EventMemory | Indexing and LRU caching for fast lookups | `packages/core/src/event-store/event-memory.ts` |
| RumorStore | Specialized store for unsigned NIP-59 rumor events | `packages/core/src/event-store/rumor-store.ts` |
| Models | Observable-based computed views (profiles, contacts, etc.) | `packages/core/src/models/` |
| Factories | Fluent builders for creating and signing events | `packages/core/src/factories/` |
| Operations | Composable tag/content mutations on event drafts | `packages/core/src/operations/` |
| Casts | Typed wrappers around events (NIP-specific) | `packages/core/src/casts/` |
| Helpers | Type guards, parsers, utilities (NIP-agnostic) | `packages/core/src/helpers/`, `packages/common/src/helpers/` |
| Relay Pool | Multi-relay communication and management | `packages/relay/src/pool.ts` |
| EventLoaders | Fetch events from relays into store | `packages/loaders/src/loaders/` |
| ActionRunner | Execute composable actions (replies, follows, etc.) | `packages/actions/src/` |
| AccountManager | Manage signers and active account state | `packages/accounts/src/` |
| React Hooks | Subscribe to observables in React components | `packages/react/src/hooks/` |
| Content Parser | Parse and render event content (text, markdown) | `packages/content/src/` |

## Pattern Overview

**Overall:** Reactive Observable Architecture

**Key Characteristics:**
- **Event-driven:** All data flows through RxJS Observables
- **Generic EventStore:** Core store is generic over `E extends StoreEvent = NostrEvent` to support unsigned rumors
- **Functional composition:** Operations, models, and casts are pure functions returning Observables
- **Single in-memory database:** EventStore holds all events; no distributed state
- **Lazy loading:** Events can be loaded from relays on-demand via `eventLoader` callback
- **Claim tracking:** Events are reference-counted; unclaimed events can be evicted (LRU)

## Layers

**EventStore & In-Memory Database:**
- Purpose: Central event repository, subscriptions, indexing
- Location: `packages/core/src/event-store/`
- Contains: `EventStore<E>`, `EventMemory<E>`, `RumorStore`, `DeleteManager`, `ExpirationManager`
- Depends on: Helpers (event guards, filters, pointers)
- Used by: Models, loaders, React hooks, all consumers

**Model Layer:**
- Purpose: Create observable computed views from raw events
- Location: `packages/core/src/models/`
- Contains: `ProfileModel`, `ContactsModel`, `OutboxModel`, etc.
- Pattern: `Model<T, E>(events: ModelEventStore<E>) => Observable<T>`
- Example: `ProfileModel(pubkey)` subscribes to kind-0 events and parses profile content
- Depends on: EventStore subscriptions, helpers for parsing
- Used by: React hooks, actions, other models

**Factory & Operations Layer:**
- Purpose: Build events fluently and apply composable mutations
- Location: `packages/core/src/factories/`, `packages/core/src/operations/`
- Factories: `EventFactory<K>` — Promise-like builder for creating and signing events
- Operations: Pure functions like `setMetaTags()`, `modifyPublicTags()` that return mutations
- Pattern: Chain factories to build, modify, and sign events: `EventFactory.fromKind(1).content("hello").sign(signer)`
- Depends on: Event helpers, signers
- Used by: Actions, manual event creation

**Casts & NIP-Specific Types:**
- Purpose: Typed wrappers for NIP-specific events with observable properties
- Location: `packages/core/src/casts/`, `packages/common/src/casts/`
- Pattern: Cast wraps an event and adds type-safe property accessors and observables
- Example: `BadgeAward` cast on kind-8 parses recipient and badge pointers
- Depends on: Core helpers, operations
- Used by: Models, factories, actions

**Helpers Layer:**
- Purpose: Type guards, parsers, utilities (NIP-agnostic)
- Location: `packages/core/src/helpers/`, `packages/common/src/helpers/`
- Contains: Event types, Nostr filters, pointers, profile parsing, encryption, etc.
- Exports: Type guards (`isValidProfile`), parsers (`getProfileContent`), utilities (`createReplaceableAddress`)
- No dependencies on: Models, factories, operations
- Used by: Everything

**Relay & Loader Layer:**
- Purpose: Fetch events from Nostr relays into the store
- Location: `packages/relay/src/`, `packages/loaders/src/loaders/`
- Components: `Relay` (single connection), `RelayPool` (multi-relay), `RelayGroup` (management)
- EventLoaders: Emit events matching filters to populate store
- Pattern: Observable<Event> emitted → captured by `eventStore.add()` → triggers subscriptions
- Used by: Applications, tests

**Account & Signer Layer:**
- Purpose: Manage active account and sign events
- Location: `packages/accounts/src/`, `packages/signers/src/signers/`
- AccountManager: Holds active account state, propagates to factories
- Signers: Various implementations (PrivateKeySigner, NIP-46, etc.)
- Pattern: Factory reads `manager.signer` to sign events
- Depends on: Core (EventFactory, helpers)
- Used by: Actions, applications

**Action & Command Layer:**
- Purpose: Execute common Nostr actions (reply, follow, like)
- Location: `packages/actions/src/actions/`
- ActionRunner: Composes factories with user input and signer
- Pattern: `followUser(runner, pubkey)` — returns Observable<Event> when complete
- Depends on: Factories, AccountManager, EventStore
- Used by: React hooks, applications

**React Integration:**
- Purpose: Subscribe to Observables in React components
- Location: `packages/react/src/hooks/`
- Hooks: `useObservable`, `useEventStoreObservable`, `useModel`, `useModelValue`
- Pattern: Wrap Observable subscription in React lifecycle
- Depends on: Core models, accounts, actions (all optional peer deps)
- Used by: React applications

**Content Parsing & Rendering:**
- Purpose: Parse and render event content
- Location: `packages/content/src/`
- Modules: Text parsing (NAST), Markdown rendering, component mapping
- Pattern: `renderContent(text, components)` → NAST tree → React components
- Depends on: Core helpers, unified/remark for parsing
- Used by: React applications, examples

## Data Flow

### Primary Request Path (Publish New Event)

1. **User initiates action** → `followUser(runner, pubkey)` in `packages/actions/src/actions/follow.ts`
2. **Factory builds event** → `EventFactory.fromKind(3).modifyPublicTags(...).sign(signer)` in `packages/core/src/factories/event.ts`
3. **Sign event** → `sign()` operation calls `signer.sign()` in `packages/core/src/operations/event.ts`
4. **Publish to relay** → `relay.publish(event)` in `packages/relay/src/relay.ts`
5. **Relay broadcasts** → WebSocket frame sent to Nostr relay
6. **Relay echoes back** → `EVENT` message received (or from other relays)
7. **EventStore receives** → `store.add(event)` in `packages/core/src/event-store/event-store.ts`
8. **Indexing** → `EventMemory` indexes by kind, author, tags, created_at in `packages/core/src/event-store/event-memory.ts`
9. **Subscriptions triggered** → All matching `store.filters()`, `store.timeline()` emit new event in `packages/core/src/event-store/event-store.ts`
10. **Models recompute** → `ProfileModel.subscribe()` re-runs if profile event matches in `packages/core/src/models/profile.ts`
11. **React re-renders** → Hook receives new model value → component updates

### Load Events from Relay

1. **Application starts** → Create `RelayPool`, add relay URLs in `packages/relay/src/pool.ts`
2. **Create loader** → `EventLoader(relay, filters)` in `packages/loaders/src/loaders/event-loader.ts`
3. **Subscribe to loader** → `loader.subscribe()` opens REQ on relay in `packages/loaders/src/loaders/event-loader.ts`
4. **Relay sends events** → WebSocket `EVENT` messages streamed from relay
5. **Loader emits** → `Observable<Event>` emits each received event
6. **EventStore receives** → `.subscribe().pipe(...).subscribe(e => store.add(e))` in `packages/core/src/event-store/event-store.ts`
7. **Models subscribe** → `store.replaceable(kind, pubkey)` / `store.timeline(filters)` emits in `packages/core/src/event-store/event-store.ts`
8. **React components receive** → `useModel(ProfileModel(pubkey))` receives updated profile in `packages/react/src/hooks/use-observable.ts`

### Create & Cast Event (Type-Safe Wrapper)

1. **Raw event received** → From relay, cache, or application
2. **Guard check** → `isValidBadgeAward(event)` in `packages/common/src/helpers/badge-award.ts`
3. **Create cast** → `new BadgeAward(event)` in `packages/common/src/casts/badge-award.ts`
4. **Access properties** → `cast.issuer$` (Observable), `cast.recipient` (string), `cast.badge$` (Observable)
5. **Subscribe to observables** → Related events loaded on-demand via `eventLoader` callback in `packages/core/src/event-store/event-store.ts`
6. **React hook receives** → `useModel(BadgeAwardModel(event))` in React application

**State Management:**
- **In-memory:** EventStore is the single source of truth; no Redux/Zustand
- **Subscriptions:** All data access via Observables; consumers subscribe and unsubscribe
- **Reference counting:** Events tracked via claims; unclaimed events eligible for LRU eviction in `packages/core/src/event-store/event-memory.ts`
- **Lazy loading:** Events can be loaded on-demand via `eventLoader` callback when missing in `packages/core/src/event-store/interface.ts`
- **Claim tracking:** `store.claim(event)` / `store.removeClaim(event)` in `packages/core/src/event-store/event-store.ts`

## Key Abstractions

**StoreEvent:**
- Purpose: Structural type for events that can live in the store
- Definition: `{ id, kind, pubkey, created_at, content, tags }`
- Includes: Signed `NostrEvent`, unsigned `Rumor`, and intermediate states
- Used as: Generic bound for `EventStore<E extends StoreEvent = NostrEvent>`
- Location: `packages/core/src/helpers/event.ts`

**IEventStore<E>:**
- Purpose: Complete event store interface combining read, write, subscription, and model methods
- Methods: `add()`, `remove()`, `getEvent()`, `getByFilters()`, `filters()`, `timeline()`, `model()`
- Observables: `insert$`, `update$`, `remove$`
- Generic: Over event type E; defaults to NostrEvent
- Location: `packages/core/src/event-store/interface.ts`

**Model<T, E>:**
- Purpose: Function that creates an Observable computed view from events
- Signature: `(events: ModelEventStore<E>) => Observable<T>`
- Pattern: Pure function, no side effects; rebuilds on event changes
- Example: `ProfileModel(pubkey): Model<ProfileContent>` → `events => events.replaceable(...).pipe(filter(...), map(...))`
- Location: `packages/core/src/event-store/interface.ts`

**EventFactory<K>:**
- Purpose: Promise-like builder for creating, modifying, and signing events
- Pattern: Chainable methods return new factory instance; `.then()` executes chain
- Flow: `EventFactory.fromKind(1).content(...).modifyPublicTags(...).sign(signer).then(e => ...)`
- Location: `packages/core/src/factories/event.ts`

**EventOperation<T>:**
- Purpose: Pure async function that transforms event draft
- Signature: `(draft: T) => Promise<T>`
- Pattern: Operations compose via factory chain; each returns new draft
- Examples: `setMetaTags()`, `modifyPublicTags()`, `sign()`
- Location: `packages/core/src/factories/types.ts`

**Rumor:**
- Purpose: Unsigned event with computed id (NIP-59)
- Type: `UnsignedEvent & { id: string }`
- Use case: Events from encrypted group protocols that don't have signatures
- Verification: `verifyRumor(rumor)` recomputes hash and compares to `rumor.id`
- Store: `RumorStore` extends `EventStore<Rumor>` with rumor verification
- Location: `packages/core/src/helpers/event.ts`, `packages/core/src/event-store/rumor-store.ts`

**Cast:**
- Purpose: Typed wrapper around NIP-specific event with property accessors
- Pattern: `new SomeEventCast(event)` exposes type-safe properties and observables
- Example: `BadgeAward` cast on kind-8 event provides `issuer$`, `badge$`, `recipient`
- Depends on: Operations for mutable variants (e.g., `BadgeAwardDraft`)
- Location: `packages/core/src/casts/`, `packages/common/src/casts/`

## Entry Points

**EventStore Creation:**
- Location: `packages/core/src/event-store/event-store.ts`
- Usage: `const store = new EventStore()` or `new EventStore({ keepDeleted: true, database: custom })`
- Creates: Single in-memory database, subscriptions, managers

**EventFactory Creation:**
- Location: `packages/core/src/factories/event.ts`
- Usage: `EventFactory.fromKind(1)` or `EventFactory.fromEvent(existing)`
- Flow: Build → modify → sign → publish

**Relay Pool Creation:**
- Location: `packages/relay/src/pool.ts`
- Usage: `const pool = new RelayPool()` → `.addRelay(url)` → `.query(filters)` emits events
- Flow: Connect → authenticate (if needed) → broadcast/subscribe

**React Application:**
- Location: `packages/react/src/hooks/use-observable.ts` (entry)
- Usage: `const value = useObservable(observable)` in React component
- Flow: Hook subscribes to observable → component receives value → re-renders on change

**Concord Client (Encrypted Group):**
- Location: `packages/concord/src/client/`
- Purpose: Manage encrypted group protocols (CORD)
- Usage: `new ConcordClient(store, signers)` → `.createGroup()` → manage members

## Architectural Constraints

- **Threading:** Single-threaded event loop (JavaScript/Node.js model)
- **Global state:** EventStore is the single source of truth; all subscribers read from same instance
- **Circular imports:** Avoided by keeping helpers framework-agnostic; dependencies flow down the layer stack
- **Event immutability:** Events immutable once added to store; modifications create new events
- **Memory bounds:** LRU cache + claim tracking prevent unbounded growth; unclaimed events evicted
- **Replaceable event ordering:** Stored in reverse time order; always latest first in `EventMemory.replaceable`
- **Event deduplication:** Duplicate IDs silently ignored; existing event returned by `store.add()`

## Anti-Patterns

### Global Signer State

**What happens:** Using a global variable for the active signer instead of passing through AccountManager
**Why it's wrong:** Makes testing hard, breaks account switching, violates single-responsibility principle
**Do this instead:** Use `AccountManager` in `packages/accounts/src/` to manage active signer; factories read via `manager.signer`

### Modifying Events In-Place

**What happens:** Directly mutating event.tags or event.content after adding to store
**Why it's wrong:** Breaks reactive subscriptions; observers see stale data; breaks equality checks
**Do this instead:** Use operations like `modifyPublicTags()`, `setContent()` in `packages/core/src/operations/` to create new draft; add result as new event

### Directly Reading Model Streams Without Subscribe

**What happens:** Calling `getEvent()` once instead of subscribing to `filters()` or `timeline()`
**Why it's wrong:** Misses updates; ignores reactive architecture; doesn't see events added later
**Do this instead:** Subscribe to `store.filters(filters)` or `store.timeline(filters)` to observe all matching events over time

### Bypassing EventStore for Direct EventMemory Access

**What happens:** Creating `EventMemory` directly instead of using `EventStore`
**Why it's wrong:** Skips delete handling, expiration, replaceable event logic, subscriptions
**Do this instead:** Use `EventStore` in `packages/core/src/event-store/event-store.ts`; if need raw memory access, read via `store.memory` property

## Error Handling

**Strategy:** Fail silently on invalid events; optionally verify before adding

**Patterns:**
- Invalid events: `store.add(event)` returns `null` if verification fails (when `verifyEvent` is set)
- Missing fields: Type guards like `isValidProfile(event)` check structure before parsing
- Relay errors: `RelayPool` emits connection state; consumers handle disconnects
- Async operations: Factories and loaders return Promises/Observables that can error
- Filters and models: Model functions catch errors in `.pipe(...)`; bad models don't crash

## Cross-Cutting Concerns

**Logging:** Debug module in `packages/core/src/logger.ts`; enable via `DEBUG=applesauce:*`

**Validation:** Type guards in helpers (`isValidProfile`, `isRumor`, etc.) check before parsing in `packages/core/src/helpers/`, `packages/common/src/helpers/`

**Authentication:** Relay authentication via NIP-42 in `packages/relay/src/relay.ts`; account signers in `packages/accounts/src/`

---

*Architecture analysis: 2026-07-09*
