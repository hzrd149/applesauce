# Coding Conventions

**Analysis Date:** 2026-07-09

## Naming Patterns

**Files:**
- kebab-case for all TypeScript/JavaScript files: `badge-award.ts`, `chat-message.ts`, `gift-wrap.ts`
- Module exports use PascalCase namespace: `export * as BadgeAward from "./badge-award.js"`
- Test files: co-located or in `__tests__/` directory, named `{module}.test.ts` or `exports.test.ts`

**Functions:**
- camelCase for all exported functions: `getBadgeIdentifier()`, `isValidBadge()`, `addRecipient()`
- Type guard functions: `isValid{Thing}()` or `is{Thing}()` for boolean predicates
- Getter functions: `get{Property}()` to extract data from events
- Operation functions: `set{Property}()`, `add{Item}()`, `remove{Item}()`, `clear{Collection}()`
- Private helper functions: also camelCase with `function` keyword

**Classes:**
- PascalCase: `EventFactory`, `BadgeFactory`, `Badge` (cast), `Relay`
- Private fields use `#` prefix: `#identifier`, `#signerRef`
- Getters use `get` keyword: `get identifier()`, `get pointer()`
- Observable properties end with `$`: `awards$`, `status$`, `relays$`

**Types & Interfaces:**
- PascalCase: `BadgeEvent`, `BadgeThumbnail`, `EventTemplate`, `NostrEvent`
- Type predicates: `T is {Type}` for type guards
- Template types: `BadgeTemplate`, `EventTemplate`
- Suffixes: `Event` for Nostr events, `Template` for unsigned drafts, `Pointer` for addressable references

**Variables:**
- camelCase for local variables: `issuer`, `recipientA`, `badgeAddress`
- Constants: UPPER_SNAKE_CASE: `CAST_REF_SYMBOL`, `PERM`, `VSK`
- Symbols: `Symbol.for("key-name")` for cross-realm sharing

**Abbreviations:**
- Use single-letter type parameters: `K` (kind), `T` (template), `C` (cast), `E` (event)
- Suffixes in generics: `EventFactory<K>` where K = kind number

## Code Style

**Formatting:**
- Prettier enforces formatting: 2-space indentation, 120-char line width
- Use `.prettierrc` with tabWidth: 2, useTabs: false, printWidth: 120
- All code runs through `pnpm format` before commit

**Linting:**
- No ESLint or Biome configuration detected; Prettier handles formatting
- TypeScript strict mode enforced via `tsconfig.json`
- `noImplicitAny`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` all enabled

**TypeScript Settings:**
- Target: ES2022
- Module: NodeNext
- `strict: true` enables all strict type-checking options
- `emitDecoratorMetadata` and `experimentalDecorators` enabled
- `declaration: true` generates `.d.ts` files

## Import Organization

**Order:**
1. External packages (RxJS, nostr-tools, etc.)
2. Absolute imports from other packages (applesauce-core, applesauce-common)
3. Relative imports from same package (using `../` and `.js` extensions)

**Example:**
```typescript
import { EventOperation } from "applesauce-core/factories";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { ChainableObservable } from "applesauce-core";
import { getBadgeIdentifier } from "../helpers/badge.js";
```

**Path Aliases:**
- No path aliases configured; use explicit relative imports ending with `.js`
- All imports must include `.js` extension for ESM compatibility

**Re-exports:**
- Use barrel files (`index.ts`) with namespace exports for organization
- Pattern: `export * as {ModuleName} from "./{module}.js"`
- Core package: `export * as Helpers`, `export * as Operations`, `export * as Factories`, `export * as Casts`
- Operations index: `export * as Badge from "./badge.js"` (namespaced by feature)
- Factories index: `export * from "./badge.js"` (direct exports)

## Error Handling

**Validation Errors:**
- Use `throw new Error("message")` for validation failures
- Pattern: validate at function entry, throw immediately if invalid
- Example: `if (!identifier) throw new Error("Invalid badge definition payload")`

**Type Guards:**
- Use overloaded function signatures to validate types at compile time
- Guard function returns `asserts event is BadgeEvent` (assertion signature) to narrow type
- Example:
```typescript
export function isValidBadge(event?: NostrEvent): event is BadgeEvent {
  if (!event || event.kind !== kinds.BadgeDefinition) return false;
  return !!identifier && identifier.length > 0;
}
```

**Async Errors:**
- Use try/catch for async operations (decryption, WebSocket)
- Use catchError RxJS operator in streams
- Example:
```typescript
try {
  const decrypted = await decrypt(ciphertext);
} catch (error) {
  // Handle decryption failure
}
```

## Comments

**When to Comment:**
- JSDoc comments required for exported functions and classes
- Brief inline comments for complex logic (validation, bit manipulation)
- No comments for obvious code

**JSDoc/TSDoc:**
- Use `/** ... */` for all exported functions, types, and classes
- Include `@param` and `@throws` for clarity
- Example:
```typescript
/**
 * Returns the human-readable badge name (`name` tag).
 */
export function getBadgeName(event?: NostrEvent): string | undefined {
```

**Section Comments:**
- Use inline `// ---- Section Name ----` comments in large files to organize code sections

## Function Design

**Size:**
- Keep functions small (typically < 30 lines)
- Extract helper functions for complex logic
- Type parameters make functions more readable than conditionals

**Parameters:**
- Accept events as `NostrEvent | undefined` and return `T | undefined`
- Use overloading to provide type-safe narrowed signatures
- Operations accept EventTemplate/EventOperation type parameters
- Factories use fluent builder pattern with chaining

**Return Values:**
- Return `undefined` rather than null for optional values
- Use `T | undefined` consistently across helpers
- Operations return `EventTemplate` (promise of modified template)
- Factories return `this` for method chaining
- Type guards return `event is TypeName` (assertion signature)

**Async:**
- Operations are async: `(draft: EventTemplate) => Promise<EventTemplate>`
- Use `async (draft) => { ... }` for operation implementations
- Factories resolve to EventTemplate via Promise inheritance

## Module Design

**Exports:**
- Each module exports its public API at the top level
- Helpers: export type guards, getters, parsers
- Operations: export modification functions taking no arguments, returning EventOperation
- Factories: export factory classes extending EventFactory
- Casts: export cast classes extending EventCast

**Helpers Pattern (`packages/common/src/helpers/badge.ts`):**
```typescript
export type BadgeEvent = KnownEvent<typeof kinds.BadgeDefinition>;
export function isValidBadge(event?: NostrEvent): event is BadgeEvent { }
export function getBadgeIdentifier(event?: NostrEvent): string | undefined { }
```

**Operations Pattern (`packages/common/src/operations/badge.ts`):**
```typescript
export function setIdentifier(identifier: string): EventOperation { }
export function setName(name: string | null): EventOperation { }
export function addThumbnail(url: string, dimensions?: ImageDimensions): EventOperation { }
```

**Factories Pattern (`packages/common/src/factories/badge.ts`):**
```typescript
export class BadgeFactory extends EventFactory<typeof kinds.BadgeDefinition, BadgeTemplate> {
  static create(): BadgeFactory { }
  static modify(event: NostrEvent): BadgeFactory { }
  identifier(value: string) { return this.chain(setIdentifier(value)); }
}
```

**Casts Pattern (`packages/common/src/casts/badge.ts`):**
```typescript
export class Badge extends EventCast<BadgeEvent> {
  get identifier() { return this.#identifier; }
  get name() { return getBadgeName(this.event); }
  get awards$(): ChainableObservable<BadgeAward[]> { }
}
```

**Barrel Exports (`packages/common/src/index.ts`):**
```typescript
export * as Helpers from "./helpers/index.js";
export * as Operations from "./operations/index.js";
export * as Factories from "./factories/index.js";
export * as Casts from "./casts/index.js";
```

## TypeScript Generics Patterns

**Kind-Constrained Factories:**
- `EventFactory<K, T>` where K = specific kind number, T = event template type
- `class BadgeFactory extends EventFactory<typeof kinds.BadgeDefinition, BadgeTemplate>`
- Preserves kind type through chain operations

**Cast Type Safety:**
- `CastConstructor<C, E>` where C = cast class, E = event type (NostrEvent or StoreEvent)
- `castEvent<C extends EventCast<T>>()` uses inference to ensure type compatibility
- Assertions in constructors: `function isBadge(event: NostrEvent): asserts event is BadgeEvent`

**Event Type Narrowing:**
- `KnownEvent<K>` = Nostr event with specific kind K
- `KnownEventTemplate<K>` = unsigned event template with kind K
- `StoreEvent` = union of all possible stored event types (includes Rumor)

**Conditional Generics:**
- `CastEventInput<T> = T extends { sig: string } ? NostrEvent : StoreEvent`
- Distinguishes signed vs unsigned events at type level

## Changesets Convention

**File Format:**
- Location: `.changeset/{name}.md` (hyphenated feature name)
- YAML frontmatter with package name and bump level (patch, minor, major)
- Single sentence describing the change (no bullet lists, code blocks, or multiple paragraphs)

**Example:**
```yaml
---
"applesauce-common": minor
---

Add a NIP-58 `BadgeFactory` and badge operations for building and modifying badge definition events.
```

**Rules:**
- One changeset file per distinct change
- Body is **always a single sentence** (markdown allowed, but no bullets or code fences)
- Commit alongside code changes
- Multiple packages in one file: list all in frontmatter on separate lines

## Observable Properties

**Naming:**
- Observable properties end with `$` suffix: `awards$`, `status$`, `connected$`
- Lazy observables use private `$$ref()` method for caching
- Public observables are BehaviorSubject or ReplaySubject

**RxJS Operators:**
- Use chainable patterns: `filter()`, `map()`, `switchMap()`, `shareReplay()`
- Initialization: `startWith(initialValue)`, `shareReplay(1)` for hot observables

---

*Convention analysis: 2026-07-09*
