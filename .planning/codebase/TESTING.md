# Testing Patterns

**Analysis Date:** 2026-07-09

## Test Framework

**Runner:**
- Vitest 4.1.6 (`vitest run` for CLI, `vitest` for watch mode)
- Config: `vitest.config.ts` at root and workspace config in `vitest.workspace.ts`

**Assertion Library:**
- Vitest's built-in `expect()` function (compatible with Jasmine)

**Run Commands:**
```bash
pnpm test                # Build packages, then run all tests once
pnpm coverage            # Build packages, then run tests with coverage report
pnpm test:browser        # Run in watch mode for browser environment
vitest run               # Run once (from within workspace)
vitest                   # Watch mode
```

**Coverage Configuration:**
- Provider: v8
- Reporters: text, json, html, lcov
- Include: `packages/**/src/**/*`
- Exclude: test files and `apps/examples/**/*`
- Output: `coverage/` directory in repo root

## Test File Organization

**Location:**
- Co-located: tests live in `__tests__/` subdirectory within `src/` (preferred pattern)
- Example: `src/helpers/__tests__/badges.test.ts` tests `src/helpers/badge.ts`

**Naming:**
- Feature tests: `{feature}.test.ts` (e.g., `badges.test.ts`)
- Export tests: `exports.test.ts` (snapshot of public API)
- Utilities: `{helper}.ts` (e.g., `fixtures.ts`, `fake-user.js`)

**Structure:**
```
packages/{name}/src/
├── helpers/
│   ├── badge.ts
│   ├── badge-award.ts
│   └── __tests__/
│       ├── badges.test.ts
│       └── exports.test.ts
├── operations/
│   ├── badge.ts
│   └── __tests__/
│       └── badge.test.ts
├── factories/
│   ├── badge.ts
│   └── __tests__/
│       └── badge.test.ts
└── casts/
    ├── badge.ts
    └── __tests__/
        └── badge.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from "vitest";

describe("badge helpers", () => {
  it("reads badge definition tags", () => {
    const event = createEvent({ kind: kinds.BadgeDefinition, tags: [...] });
    expect(getBadgeIdentifier(event)).toBe("bravery");
  });

  it("parses profile badge slots", () => {
    const slots = getProfileBadgeSlots(event);
    expect(slots).toHaveLength(1);
    expect(slots[0].badge.identifier).toBe("courage");
  });
});
```

**Patterns:**
- One `describe()` per module/feature
- One `it()` per specific behavior being tested
- Descriptive test names that read as sentences: "reads badge definition tags"
- Setup helpers created as module-level functions

## Test Setup & Fixtures

**Test Event Creation:**
```typescript
function createEvent(
  partial: Partial<NostrEvent>,
): NostrEvent {
  return {
    id: partial.id ?? "id",
    pubkey: partial.pubkey ?? "pubkey".padStart(64, "0"),
    sig: partial.sig ?? "sig".padStart(128, "0"),
    created_at: partial.created_at ?? 1,
    kind: partial.kind ?? 1,
    content: partial.content ?? "",
    tags: partial.tags ?? [],
  };
}
```

**FakeUser Fixture (`packages/common/src/__tests__/fixtures.ts`):**
```typescript
export class FakeUser implements EncryptedContentSigner, EventSigner {
  key = generateSecretKey();
  pubkey = getPublicKey(this.key);
  
  signEvent(draft: EventTemplate | UnsignedEvent) {
    return finalizeEvent(draft, this.key);
  }
  
  note(content = "Hello World", extra?: Partial<NostrEvent>) {
    return this.event({ kind: kinds.ShortTextNote, content, ...extra });
  }
}
```

**Usage:**
```typescript
const issuer = new FakeUser();
const recipientA = new FakeUser();
const event = issuer.event({ kind: kinds.BadgeAward, tags: [...] });
```

**Setup & Teardown:**
```typescript
import { beforeEach, afterEach, vi } from "vitest";

beforeEach(async () => {
  // Mock external dependencies
  vi.spyOn(Relay, "fetchInformationDocument").mockImplementation(() => of(null));
  server = new WS("wss://test", { jsonProtocol: true });
});

afterEach(async () => {
  await WS.clean();
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.clearAllMocks();
  vi.useRealTimers();
});
```

## Testing Helpers

**Type Guards & Getters:**
```typescript
describe("badge helpers", () => {
  it("validates badge events", () => {
    const event = createEvent({ kind: kinds.BadgeDefinition, tags: [["d", "bravery"]] });
    expect(isValidBadge(event)).toBe(true);
    expect(getBadgeIdentifier(event)).toBe("bravery");
    expect(getBadgeName(event)).toBeUndefined();
  });
});
```

**Pattern:**
- Create event with minimal required tags
- Assert each getter/type guard returns expected value
- Test edge cases: missing tags, wrong kind, empty identifier

## Testing Operations

**Operation Testing Pattern:**
```typescript
const badgePointer = { kind: kinds.BadgeDefinition, pubkey: issuer.pubkey, identifier: "alpha" };

function createAwardDraft(tags: string[][] = []): EventTemplate {
  return {
    kind: kinds.BadgeAward,
    content: "",
    tags,
    created_at: unixNow(),
  };
}

describe("badge award operations", () => {
  it("sets and replaces badge pointers", async () => {
    const result = await setBadgePointer(badgePointer)(createAwardDraft());
    expect(result.tags).toEqual([["a", `${badgePointer.kind}:${issuer.pubkey}:${badgePointer.identifier}`]]);

    const updated = await setBadgePointer(secondBadgePointer)(result);
    expect(updated.tags).toEqual([["a", `${secondBadgePointer.kind}:${issuer.pubkey}:${secondBadgePointer.identifier}`]]);
  });

  it("adds and removes recipients", async () => {
    const withRecipient = await addRecipient(recipientA)(createAwardDraft());
    expect(withRecipient.tags).toEqual([["p", recipientA.pubkey]]);

    const withBoth = await addRecipient(recipientB)(withRecipient);
    expect(withBoth.tags).toEqual([
      ["p", recipientA.pubkey],
      ["p", recipientB.pubkey],
    ]);

    const withoutA = await removeRecipient(recipientA)(withBoth);
    expect(withoutA.tags).toEqual([["p", recipientB.pubkey]]);
  });
});
```

**Pattern:**
- Create blank draft with `createAwardDraft()`
- Pass through operation as function: `await operation(draft)`
- Assert tags are correctly added/replaced/removed
- Test chaining: apply multiple operations to same draft
- Verify both creation and modification flows

## Testing Factories

**Factory Testing Pattern:**
```typescript
describe("BadgeAwardFactory", () => {
  it("builds a badge award event", async () => {
    const event = await BadgeAwardFactory.create()
      .badge(badgeAddress)
      .recipients([recipientA, recipientB]);

    expect(event.kind).toBe(kinds.BadgeAward);
    expect(event.tags).toEqual([
      ["a", `${badgeAddress.kind}:${badgeAddress.pubkey}:${badgeAddress.identifier}`],
      ["p", recipientA.pubkey],
      ["p", recipientB],
    ]);
  });

  it("modifies an existing badge award", async () => {
    const existing: NostrEvent = {
      kind: kinds.BadgeAward,
      id: HEX("f"),
      pubkey: HEX("e"),
      sig: HEX("c", 128),
      created_at: 1,
      content: "",
      tags: [["a", `...`], ["p", recipientA.pubkey]],
    };

    const result = await BadgeAwardFactory.modify(existing)
      .clearBadge()
      .clearRecipients();
    
    expect(result.tags).toEqual([]);
  });
});
```

**Pattern:**
- `BadgeFactory.create()` builds from scratch
- `BadgeFactory.modify(event)` starts from existing event
- Chain methods (fluent builder pattern)
- Await final call to resolve EventTemplate Promise
- Test both creation and modification scenarios

## Testing Casts

**Cast Testing Pattern:**
```typescript
import { EventStore } from "applesauce-core";

describe("Badge cast", () => {
  it("creates cast from valid event", () => {
    const store = new EventStore();
    const event = createEvent({ kind: kinds.BadgeDefinition, tags: [["d", "bravery"]] });
    store.add(event);

    const badge = castEvent(event, Badge, store);
    expect(badge.identifier).toBe("bravery");
    expect(badge.name).toBeUndefined();
    expect(badge.pointer).toEqual({
      kind: kinds.BadgeDefinition,
      pubkey: event.pubkey,
      identifier: "bravery",
    });
  });

  it("throws on invalid event", () => {
    const store = new EventStore();
    const event = createEvent({ kind: 1 }); // Wrong kind
    
    expect(() => castEvent(event, Badge, store)).toThrow("Invalid badge definition event");
  });
});
```

**Pattern:**
- Create EventStore and add event to it
- Call `castEvent()` with event, cast class, and store
- Assert getters return expected values
- Test error cases: invalid kind, missing required tags

## Snapshot Testing

**Export Snapshot Tests:**
```typescript
import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "Casts",
        "Factories",
        "Helpers",
        "Models",
        "Observable",
        "Operations",
      ]
    `);
  });
});
```

**Pattern:**
- One test per module's `index.ts`
- Snapshot all exported names using `Object.keys(exports).sort()`
- Uses `toMatchInlineSnapshot()` for inline snapshot
- Update snapshot with `vitest --update` when API changes intentionally
- File: `packages/{name}/src/__tests__/exports.test.ts`

**Helper Snapshot Tests:**
- Extend `helpers/__tests__/badges.test.ts` with new helper tests
- Update `helpers/__tests__/exports.test.ts` snapshot when adding helpers
- Run `pnpm --filter applesauce-common test` to verify snapshot integrity

## Mocking

**Framework:**
- Vitest's built-in `vi` spy/mock system
- `vitest-websocket-mock` for WebSocket testing
- `@hirez_io/observer-spy` for RxJS observable spying

**Mocking External Dependencies:**
```typescript
import { vi } from "vitest";

beforeEach(() => {
  vi.spyOn(Relay, "fetchInformationDocument")
    .mockImplementation(() => of(null));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
```

**WebSocket Mocking:**
```typescript
import { WS } from "vitest-websocket-mock";

let server: WS;

beforeEach(async () => {
  server = new WS("wss://test", { jsonProtocol: true });
  relay = new Relay("wss://test");
});

afterEach(async () => {
  await WS.clean();
});

it("sends REQ message", async () => {
  subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
  await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
});
```

**RxJS Observable Spying:**
```typescript
import { subscribeSpyTo } from "@hirez_io/observer-spy";

const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
await server.connected;

server.send(["EVENT", "sub1", mockEvent]);
server.send(["EOSE", "sub1"]);

expect(spy.getValues()).toEqual([
  expect.objectContaining({ type: "OPEN" }),
  expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
  expect.objectContaining({ type: "EOSE" }),
]);
```

**What to Mock:**
- External WebSocket servers
- Relay information documents
- Static async functions that make HTTP requests
- Timers for time-dependent tests

**What NOT to Mock:**
- Event creation/signing (use FakeUser)
- EventStore operations (test with real store)
- Tag operations (test actual behavior)
- RxJS operators (use them as-is)

## Common Test Patterns

**Async Testing:**
```typescript
it("handles async operations", async () => {
  const result = await someAsyncFunction();
  expect(result).toEqual(expected);
});

it("uses firstValueFrom for observables", async () => {
  const value = await firstValueFrom(observable$);
  expect(value).toBe(expected);
});
```

**Error Testing:**
```typescript
it("throws on invalid input", () => {
  expect(() => {
    isValidBadge(event); // type guard throws
  }).toThrow("Invalid badge definition event");
});

it("rejects invalid promises", async () => {
  await expect(factory.sign()).rejects.toThrow("Signer required");
});
```

**Observable Testing:**
```typescript
it("emits events in order", async () => {
  const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
  
  server.send(["EVENT", "sub1", event1]);
  server.send(["EVENT", "sub1", event2]);
  server.send(["EOSE", "sub1"]);
  
  expect(spy.getValues()).toHaveLength(4); // OPEN, EVENT, EVENT, EOSE
});
```

**Type Narrowing:**
```typescript
it("narrows type with type guard", () => {
  const event: NostrEvent = createEvent({ kind: kinds.BadgeDefinition, tags: [...] });
  
  if (isValidBadge(event)) {
    // TypeScript now knows event is BadgeEvent
    const id: string = getBadgeIdentifier(event);
    expect(id).toBe("bravery");
  }
});
```

## Coverage Requirements

**Target:**
- No explicit minimum enforced; coverage reports generated
- Coverage data at `coverage/` directory (git-ignored)

**View Coverage:**
```bash
pnpm coverage                 # Generate and view in terminal
open coverage/index.html      # Open HTML report in browser
cat coverage/coverage-final.json  # Raw JSON data
```

**Coverage Scope:**
- Includes: `packages/**/src/**/*`
- Excludes: test files (`*.test.ts`), `__tests__/` directories, `apps/examples/**/*`

---

*Testing analysis: 2026-07-09*
