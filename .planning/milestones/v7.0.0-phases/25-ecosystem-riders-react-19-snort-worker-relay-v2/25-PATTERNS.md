# Phase 25: Ecosystem Riders — React 19 & @snort/worker-relay v2 - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 19 new/modified files
**Analogs found:** 18 / 19

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/react/package.json` | config | batch | `apps/examples/package.json` | role-match |
| `apps/examples/package.json` | config | batch | `packages/react/package.json` | role-match |
| `pnpm-lock.yaml` | config | batch | existing `pnpm-lock.yaml` | exact |
| `.github/workflows/test.yml` | config | batch | existing `test-node` matrix in same file | exact |
| `packages/react/src/__tests__/rendering-fixtures.tsx` | test utility | event-driven | no repository-local React rendering fixture | none |
| `packages/react/src/hooks/__tests__/use-observable-state.test.tsx` | test | event-driven | `packages/common/src/helpers/__tests__/encrypted-content-cache.test.ts` | flow-match |
| `packages/react/src/hooks/__tests__/use-$.test.tsx` | test | event-driven | `packages/react/src/hooks/__tests__/exports.test.ts` | role-match |
| `packages/react/src/providers/__tests__/providers.test.tsx` | test | request-response | `packages/react/src/providers/__tests__/exports.test.ts` | role-match |
| `apps/examples/src/examples/cache/worker-relay.tsx` | component/service integration | streaming, file-I/O | `apps/examples/src/examples/database/worker-relay.tsx` | exact |
| `apps/examples/src/examples/database/worker-relay.tsx` | component/service integration | CRUD, file-I/O | `apps/examples/src/examples/cache/worker-relay.tsx` | exact |
| `packages/core/src/operations/event.ts` | utility/operation | transform | existing `stamp` implementation in same file | exact |
| `packages/core/src/operations/__tests__/event.test.ts` | test | transform | existing `stamp` regression in same file | exact |
| `packages/wallet/src/helpers/wallet.ts` | utility | transform | `lockAppData` in `packages/common/src/helpers/app-data.ts` | exact |
| `packages/wallet/src/helpers/__tests__/wallet.test.ts` | test | transform | `packages/common/src/helpers/__tests__/app-data.test.ts` | exact |
| `packages/common/src/helpers/app-data.ts` | utility | transform | `getWalletPrivateKey` in `packages/wallet/src/helpers/wallet.ts` | exact |
| `packages/common/src/helpers/__tests__/app-data.test.ts` | test | transform | existing cache/lock cases in same file | exact |
| `.changeset/<core-stamp-comment>.md` | config | batch | `.changeset/lock-app-data-clears-plaintext.md` | exact |
| `.changeset/<wallet-lock-relays>.md` | config | batch | `.changeset/lock-app-data-clears-plaintext.md` | exact |
| `.changeset/<app-data-falsy>.md` | config | batch | `.changeset/lock-app-data-clears-plaintext.md` | exact |

The test utility is optional: if its boundary/tracked-observable helpers are only used by one suite, keep them in that test file rather than creating `rendering-fixtures.tsx`.

## Pattern Assignments

### React package manifest and workspace React 19 baseline (config, batch)

**Analogs:** `packages/react/package.json`, `apps/examples/package.json`

**Package-local scripts and dependency grouping** (`packages/react/package.json` lines 8-14, 57-81):

```json
"scripts": {
  "build": "tsc",
  "test": "vitest run --passWithNoTests",
  "watch:test": "vitest"
},
"peerDependencies": { "react": "^18.0.0 || ^19.0.0" },
"devDependencies": {
  "@types/react": "^18.0.0 || ^19.0.0",
  "react": "^18.0.0 || ^19.0.0",
  "vitest": "^4.0.15"
}
```

Keep the published peer range unchanged. Add `react-dom`, matching React 19 type/runtime dev dependencies, `@testing-library/react`, and `jsdom` under `devDependencies`. Ordinary `test` remains the local entry point; D-04 forbids a separate local matrix command.

**Application baseline pattern** (`apps/examples/package.json` lines 59-63, 86-90):

```json
"react": "^18.3.1",
"react-dom": "^18.3.1",
"react-error-boundary": "^6.0.1"
```

Move runtime React and React DOM together to major 19 and move both type packages together to major 19. Let pnpm regenerate the existing lockfile; do not hand-edit resolution entries.

---

### `.github/workflows/test.yml` (config, batch)

**Analog:** `.github/workflows/test.yml` `test-node` job

**Matrix/setup/install pattern** (lines 15-38):

```yaml
test-node:
  name: Test on Node.js ${{ matrix.node-version }}
  needs: build
  runs-on: ubuntu-latest
  strategy:
    matrix:
      node-version: [22.x, 24.x, 26.x]
    fail-fast: false
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
    - run: pnpm install --frozen-lockfile
```

Add a sibling React-compatibility job with `react-major: [18, 19]`, the same checkout/pnpm/Node/install ordering, and `fail-fast: false`. After the frozen install, use a no-lockfile package-filtered install for all four matching-major runtime/type packages, then run exactly the same `applesauce-react` suite in both legs. Use a jsdom-compatible Node line (22.22.2+, 24.15.0+, or 26).

---

### `packages/react/src/hooks/__tests__/use-observable-state.test.tsx` (test, event-driven)

**Primary contracts:** `packages/react/src/hooks/use-observable-state.ts`

**Imports/controlled-source pattern** (`use-observable-state.ts` lines 1-3, 26-47):

```tsx
import { useDebugValue, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BehaviorSubject, Observable, Subscription } from "rxjs";

subState.subscription = observable.subscribe({
  next: (value) => {
    subState.latestValue = value;
    subState.onValue?.(value);
  },
  error: (error) => {
    subState.latestError = error;
    subState.onError?.();
  },
});
```

Use Vitest imports first, then Testing Library and React/RxJS, matching package tests' direct imports. A tracked `Observable` should retain its subscriber and return a teardown closure; wrap controlled `next`/`error` calls in Testing Library `act`.

**Initial synchronous/undefined behavior** (`use-observable-state.ts` lines 75-88):

```tsx
const [state, setState] = useState<TState | undefined>(() => {
  const subState = createSubscription(state$);
  subStateRef.current = subState;
  return subState.latestValue !== NO_VALUE ? subState.latestValue : undefined;
});
```

Test a `BehaviorSubject` or synchronous `Observable` for immediate value and a `Subject`/controlled `Observable` for initial `undefined`, followed by an `act` emission and rerender assertion.

**Replacement and stale-source guard** (`use-observable-state.ts` lines 96-138):

```tsx
if (!subState || subState.observable !== state$) {
  subState?.subscription.unsubscribe();
  subState = createSubscription(state$);
  subStateRef.current = subState;
  setState(subState.latestValue !== NO_VALUE ? subState.latestValue : undefined);
}
subState.onValue = (value) => {
  if (state$Ref.current === state$) setState(value);
};
```

Rerender the hook with a new source and assert old teardown, replacement initial state, ignored late old values/errors, and continued new-source updates.

**Error/cleanup contract** (`use-observable-state.ts` lines 140-159):

```tsx
return () => {
  subState.onValue = null;
  subState.onError = null;
  subState.subscription.unsubscribe();
  if (subStateRef.current === subState) subStateRef.current = null;
};

if (subState?.latestError !== null && subState?.observable === state$) {
  throw subState.latestError;
}
```

Use a React class error boundary for both subscribe-time and later errors. For Strict Mode, track each subscription instance and teardown count; assert every created instance is released once and aggregate active subscriptions return to zero, not a fixed number of subscriptions.

---

### `packages/react/src/hooks/__tests__/use-$.test.tsx` (test, event-driven)

**Analog/contract:** `packages/react/src/hooks/use-$.ts` lines 1-17

```tsx
import { useMemo } from "react";
import { BehaviorSubject, Observable, of } from "rxjs";
import { useObservableState } from "./use-observable-state.js";

const resolved = useMemo(
  () => (typeof observable === "function" ? observable() : observable) ?? of(undefined),
  deps ?? [observable],
);
return useObservableState(resolved);
```

Exercise both public forms: direct observable replacement and factory/dependency replacement. Reuse the tracked source fixture rather than repeating lifecycle machinery. Assert the factory runs only when dependencies change, and retain the same synchronous/async expectations as the underlying hook.

**Repository test shape** (`packages/react/src/hooks/__tests__/exports.test.ts` lines 1-6):

```tsx
import { describe, expect, it } from "vitest";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot();
  });
});
```

Use focused `describe` blocks and behavioral `it` names; no snapshots are needed for rendered values.

---

### `packages/react/src/providers/__tests__/providers.test.tsx` (test, request-response)

**Analogs/contracts:** provider and public hook implementations

**Provider value pattern** (`store-provider.tsx` lines 4-8; identical structure in accounts/actions providers):

```tsx
export const EventStoreContext = createContext<IEventStore | null>(null);

export function EventStoreProvider({ eventStore, children }: PropsWithChildren<{ eventStore: IEventStore }>) {
  return <EventStoreContext.Provider value={eventStore}>{children}</EventStoreContext.Provider>;
}
```

**Missing-provider contract** (`use-event-store.ts` lines 6-9; `use-account-manager.ts` lines 7-13; `use-action-runner.ts` lines 5-8):

```tsx
const store = useContext(EventStoreContext);
if (!store) throw new Error("Missing EventStoreProvider");
```

Test exact strings for all three required hooks and assert `useAccountManager(false)` returns `undefined`. Render small consumer probes calling public hooks, not raw contexts. Rerender providers to prove identity replacement; nest providers to prove nearest-value selection and outer-value restoration when the inner provider is removed.

---

### Worker relay integrations (component/service integration, streaming/CRUD + file-I/O)

**Mutual analogs:** both worker-relay example files

**Shared worker construction/init pattern** (`cache/worker-relay.tsx` lines 18-32; database analog lines 27-42):

```tsx
import WorkerVite from "@snort/worker-relay/src/worker?worker";

const workerScript = import.meta.env.DEV
  ? new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url)
  : new WorkerVite();
const workerRelay = new WorkerRelayInterface(workerScript);
await workerRelay.init({ databasePath: "cache-relay.db" });
```

Preserve both worker entry paths and the distinct database names. Remove only `insertBatchSize`; v2 `setEventMetadata` is synchronous, so do not add `await`/promise chaining around metadata calls. The cache example's persistence shape (lines 53-61) uses `Promise.allSettled` over `workerRelay.event`; the database adapter's CRUD methods (lines 44-77) throw on unsuccessful writes and directly await query/delete/count. Keep those existing semantics.

---

### `packages/core/src/operations/event.ts` and test (utility/test, transform)

**Analog:** existing immutable `stamp` regression

**Operation pattern** (`event.ts` lines 120-140):

```ts
const pubkey = await signer.getPublicKey();
const newDraft = { ...draft, pubkey };
Reflect.deleteProperty(newDraft, "id");
Reflect.deleteProperty(newDraft, "sig");
if (Reflect.has(draft, EncryptedContentSymbol))
  setCachedValue(newDraft, EncryptedContentSymbol, Reflect.get(draft, EncryptedContentSymbol)!);
```

This is comment-only production work: reconcile the stale commentary with the current non-enumerable cache propagation behavior and do not change operation semantics.

**Regression test pattern** (`operations/__tests__/event.test.ts` lines 41-59):

```ts
const result = await stamp(user)(signedEvent);
expect(signedEvent.id).toBe(originalId);
expect(signedEvent.sig).toBe(originalSig);
expect(result).not.toHaveProperty("id");
expect(result).not.toHaveProperty("sig");
expect(result.pubkey).toBe(user.pubkey);
```

If verification needs expansion, add assertions to this existing `describe("stamp")` block rather than a new test file.

---

### `packages/wallet/src/helpers/wallet.ts` and test (utility/test, transform)

**Analog:** `packages/common/src/helpers/app-data.ts` lines 96-103

```ts
export function lockAppData<T extends object>(event: T): void {
  Reflect.deleteProperty(event, AppDataContentSymbol);
  lockHiddenContent(event);
}
```

Extend `lockWallet`'s adjacent symbol deletes (`wallet.ts` lines 141-146) with `WalletRelaysSymbol` before `lockHiddenTags(wallet)`.

**Test setup/assertion pattern** (`wallet.test.ts` lines 25-48):

```ts
const wallet = await WalletFactory.create(
  ["https://mint.example"], privateKey, ["wss://relay.example/"]
).as(user).sign();
const relays = getWalletRelays(wallet);
expect(relays).toEqual(["wss://relay.example/"]);
expect(Reflect.ownKeys(wallet)).toContain(WalletRelaysSymbol);
```

Import `lockWallet`, populate all caches, lock, and assert all three cache symbols are absent. Keep this in the existing wallet suite.

---

### `packages/common/src/helpers/app-data.ts` and test (utility/test, transform)

**Closest cached-value analog:** `packages/wallet/src/helpers/wallet.ts` lines 68-88

```ts
if (WalletPrivateKeySymbol in wallet)
  return wallet[WalletPrivateKeySymbol] as Uint8Array | null;
const key = privkey ? hexToBytes(privkey) : null;
setCachedValue(wallet, WalletPrivateKeySymbol, key);
return key;
```

Use cache presence (`Reflect.has` or `AppDataContentSymbol in event`) rather than truthiness, because `false`, `0`, `""`, and `null` are valid JSON values. In parsing, distinguish only `undefined` as failure; avoid `if (!data)` at `app-data.ts` lines 54, 60, and 64.

**Test fixture and direct assertion pattern** (`app-data.test.ts` lines 14-24, 46-60):

```ts
function createEncryptedAppDataEvent(data: unknown): NostrEvent {
  return {
    id: "test-id", pubkey: "test-pubkey", created_at: 0,
    kind: APP_DATA_KIND, tags: [],
    content: `nip44:${JSON.stringify(data)}`, sig: "test-sig",
  };
}
```

Add a compact table-driven or parameterized case for `false`, `0`, `""`, and `null`, including repeated reads to cover cached falsy values. Include plain JSON and, where useful, decrypted content paths.

---

### Changesets (config, batch)

**Analog:** `.changeset/lock-app-data-clears-plaintext.md` lines 1-5

```md
---
"applesauce-common": patch
---

`lockAppData` now clears the decrypted content so `getAppDataContent` returns undefined after locking.
```

Create one patch changeset per independent published-package change: core commentary/contract if release-worthy, wallet lock cleanup, and common falsy parsing. Each body must be exactly one Markdown sentence. Do not add a changeset for the private examples app.

## Shared Patterns

### Imports

Tests import Vitest primitives directly from `vitest`, production symbols through package subpath exports where crossing package boundaries, and local implementation modules with `.js` suffixes. Follow `packages/common/src/helpers/__tests__/app-data.test.ts` lines 1-4 and `packages/react/src/hooks/__tests__/exports.test.ts` lines 1-2.

### Error Handling

Production hooks throw exact provider errors (`Missing EventStoreProvider`, `Missing AccountsProvider`, `Missing ActionsProvider`) and observable errors during render. Tests should use a React error boundary for render/effect errors, while ordinary rejected promises use Vitest assertions. Do not suppress the error path merely to quiet React console output.

### Cache Presence vs. Value

The codebase's symbol caches may intentionally store falsy values. Readers must check property presence and return the stored value; writers use `setCachedValue` for non-enumerable identity memos. Locks clear all derived plaintext/cache symbols with `Reflect.deleteProperty` before locking underlying hidden data.

### Regression Test Placement

Extend the nearest existing `__tests__` suite for core, wallet, and common fixes. React rendering behavior belongs beside hooks/providers, while a shared fixture remains package-local. Keep cases focused and use `act` for emissions that trigger React updates.

### Dependency and CI Coupling

React, React DOM, and their two type packages move as one matching-major set. The committed workspace baseline is React 19; React 18 exists only in the ephemeral CI leg. The peer declaration remains `^18.0.0 || ^19.0.0`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/react/src/__tests__/rendering-fixtures.tsx` | test utility | event-driven | No existing repository-local React Testing Library/error-boundary/tracked-observable fixture exists; follow RESEARCH.md and the production hook contracts. |

## Metadata

**Analog search scope:** `packages/react`, `packages/core`, `packages/wallet`, `packages/common`, `apps/examples`, `.github/workflows`, root manifests/config, `.changeset`
**Files scanned:** 1,259 tracked source/config paths; analog search stopped after strong same-role matches were identified
**Pattern extraction date:** 2026-09-02
