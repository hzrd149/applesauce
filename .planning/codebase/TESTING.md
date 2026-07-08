# Testing Patterns

**Analysis Date:** 2026-07-08

## Test Framework

**Runner:**
- Vitest 4.x (`vitest` `^4.1.6` at repo root, package dev deps around `^4.0.15`).
- Config: `vitest.config.ts`.
- Browser-related test tooling is installed at root (`@vitest/browser`, `@vitest/browser-playwright`, `playwright`), but package tests are normal Vitest unit/integration tests under `packages/*/src/**/__tests__`.

**Assertion Library:**
- Vitest `expect` with built-in matchers: `toEqual`, `toBe`, `toMatchObject`, `toHaveBeenCalled`, `rejects.toThrow`, `toMatchInlineSnapshot`.
- Observable assertions use `@hirez_io/observer-spy` in relay tests: `packages/relay/src/__tests__/relay.test.ts`.
- WebSocket protocol assertions use `vitest-websocket-mock`: `packages/relay/src/__tests__/relay.test.ts`.

**Run Commands:**
```bash
pnpm test              # Build packages, then run all tests with vitest run
pnpm test:browser      # Run vitest in interactive/browser-capable mode
pnpm coverage          # Build packages, then run vitest with v8 coverage
pnpm --filter applesauce-core test       # Run one package's tests
pnpm --filter applesauce-core watch:test # Watch one package's tests
```

## Test File Organization

**Location:**
- Tests are co-located in `__tests__` directories under each package source tree: `packages/core/src/helpers/__tests__`, `packages/wallet/src/actions/__tests__`, `packages/concord/src/factories/__tests__`.
- Submodule tests live beside the submodule they verify: `packages/core/src/operations/__tests__/tags.test.ts`, `packages/content/src/markdown/__tests__/blossom.test.ts`.
- Package-level export tests live directly under `src/__tests__`: `packages/core/src/__tests__/exports.test.ts`, `packages/react/src/__tests__/exports.test.ts`.
- App-level tests are not detected under `apps/`; coverage config excludes `apps/examples/**/*` in `vitest.config.ts`.

**Naming:**
- Use `*.test.ts` for all detected tests; no `*.spec.ts` files are detected.
- Name tests after the unit under test: `events.test.ts`, `action-runner.test.ts`, `nut-wallet.test.ts`, `catch-error-inline.test.ts`.
- Use `exports.test.ts` for snapshot tests that lock public exports.

**Structure:**
```text
packages/<package>/src/<area>/__tests__/<unit>.test.ts
packages/<package>/src/__tests__/exports.test.ts
packages/<package>/src/__tests__/fixtures.ts
packages/<package>/src/__tests__/fake-user.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

let eventStore: EventStore;

beforeEach(() => {
  eventStore = new EventStore();
  User.cache.clear();
});

describe("FeatureName", () => {
  it("does the observable behavior", async () => {
    await expect(runFeature()).resolves.toBeUndefined();
  });
});
```

**Patterns:**
- Group by exported symbol or behavior, not by implementation detail: `describe("MintTokens")`, `describe("RolloverTokens")`, and `describe("RecoverFromCouch")` in `packages/wallet/src/actions/__tests__/tokens.test.ts`.
- Use top-level `beforeEach` for fresh stores, mocks, and caches: `packages/wallet/src/actions/__tests__/tokens.test.ts`, `packages/relay/src/__tests__/relay.test.ts`.
- Clear singleton/static caches between tests when models or casts cache by event/user: `User.cache.clear()` in `packages/wallet/src/actions/__tests__/tokens.test.ts` and `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.
- Prefer asserting externally visible outputs: published events, relay messages, event-store state, Observable values, and exported keys.
- Keep tests short enough to show a single behavior; use local helper functions for setup-heavy protocol data.

## Mocking

**Framework:** Vitest `vi` mocks/spies plus explicit in-memory fakes.

**Patterns:**
```typescript
function mockPool() {
  const relay = { getSupported: vi.fn().mockResolvedValue([]), request: vi.fn().mockReturnValue(EMPTY) };
  return {
    publish: vi.fn().mockImplementation((relays: string[]) => relays.map((from) => ({ ok: true, from }))),
    subscription: vi.fn().mockReturnValue(EMPTY),
    relay: vi.fn().mockReturnValue(relay),
  } as unknown as RelayPool;
}
```

**What to Mock:**
- Mock relay pools and network boundaries with inert Observables (`EMPTY`, `NEVER`, `Subject`) rather than live sockets, as in `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts` and `packages/concord/src/__tests__/client.test.ts`.
- Mock WebSocket relays only when testing relay protocol behavior, using `WS` from `vitest-websocket-mock` in `packages/relay/src/__tests__/relay.test.ts`.
- Mock Cashu wallet providers and couch storage for wallet actions: `mintingProvider`, `swappingProvider`, and `memoryCouch` in `packages/wallet/src/actions/__tests__/tokens.test.ts`.
- Use `vi.spyOn` for specific method interception and restore/clear in teardown: `Relay.fetchInformationDocument` in `packages/relay/src/__tests__/relay.test.ts`, signer decrypt methods in `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.

**What NOT to Mock:**
- Do not mock pure helper logic under test; construct real signed events with `FakeUser` from `packages/core/src/__tests__/fixtures.ts`.
- Do not mock `EventStore` for model/action tests; create a real `new EventStore()` so cache, replaceable-event, and subscription behavior is exercised.
- Do not use live relays in unit tests; Concord client tests inject fake pools in `packages/concord/src/__tests__/client.test.ts`.

## Fixtures and Factories

**Test Data:**
```typescript
export class FakeUser implements EncryptedContentSigner, EventSigner {
  key = generateSecretKey();
  pubkey = getPublicKey(this.key);
  signEvent(draft: EventTemplate | UnsignedEvent) {
    return finalizeEvent(draft, this.key);
  }
}
```

**Location:**
- Shared Nostr signer/event fixtures live in `packages/core/src/__tests__/fixtures.ts`.
- Several packages maintain local `FakeUser` copies for package-specific dependency boundaries: `packages/wallet/src/__tests__/fake-user.ts`, `packages/actions/src/__tests__/fake-user.ts`, `packages/relay/src/__tests__/fake-user.ts`.
- Test-only data builders live inside the test file when scoped to one behavior: `makeToken` and `addTokenEvent` in `packages/wallet/src/actions/__tests__/tokens.test.ts`, `mockPool` in `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.
- Use real factories to create signed Nostr events in tests: `WalletFactory` and `WalletTokenFactory` in `packages/wallet/src/actions/__tests__/tokens.test.ts`.

## Coverage

**Requirements:** No numeric coverage threshold is enforced.

**View Coverage:**
```bash
pnpm coverage
```

- Coverage provider is V8 in `vitest.config.ts`.
- Coverage includes `packages/**/src/**/*`.
- Coverage excludes `**/src/**/*.test.ts`, `**/src/**/__tests__/**/*`, and `apps/examples/**/*`.
- Reporters are `text`, `json`, `html`, and `lcov`.

## Test Types

**Unit Tests:**
- Pure helpers and operations are tested directly with small inputs and exact outputs: `packages/core/src/helpers/__tests__/events.test.ts`, `packages/core/src/operations/__tests__/tags.test.ts`, `packages/content/src/markdown/__tests__/blossom.test.ts`.
- Export barrels are tested with inline snapshots: `packages/core/src/__tests__/exports.test.ts`, `packages/wallet/src/models/__tests__/exports.test.ts`.

**Integration Tests:**
- Package-level integration tests compose real stores, factories, actions, signers, and mocked boundary services: `packages/wallet/src/actions/__tests__/tokens.test.ts`, `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.
- Relay integration tests exercise WebSocket protocol flows against `vitest-websocket-mock`: `packages/relay/src/__tests__/relay.test.ts`.
- Concord client tests exercise dependency-injected storage, relay pools, and optimistic local echo without network: `packages/concord/src/__tests__/client.test.ts`.

**E2E Tests:**
- No Vitest E2E suite is detected.
- Reference app `refs/accordian/AGENTS.md` documents Puppeteer driver scripts under `refs/accordian/scripts/*.mjs` for browser/protocol checks outside the package test suite.

## Common Patterns

**Async Testing:**
```typescript
await hub.run(MintTokens, mint, 100, "quote-id", { getCashuWallet: mintingProvider(proofs) });
expect(publish).toHaveBeenCalled();
```

**Error Testing:**
```typescript
publish.mockRejectedValueOnce(new Error("relay down"));
await expect(hub.run(MintTokens, mint, 100, "quote-id", { couch })).rejects.toThrow();
```

**Observable Testing:**
```typescript
const states: boolean[] = [];
const sub = wallet.busy$.subscribe((busy) => states.push(busy));
await wallet.setMints(["https://mint.example.com"]);
sub.unsubscribe();
expect(states).toContain(true);
```

**Snapshot Testing:**
```typescript
import * as exports from "../index.js";

expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`[
  "EventStore",
]`);
```

---

*Testing analysis: 2026-07-08*
