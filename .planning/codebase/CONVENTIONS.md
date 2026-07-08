# Coding Conventions

**Analysis Date:** 2026-07-08

## Naming Patterns

**Files:**
- Use lowercase kebab-case for implementation modules: `packages/core/src/event-store/event-store.ts`, `packages/core/src/observable/catch-error-inline.ts`, `packages/wallet/src/actions/mint-recomendation.ts`.
- Use `index.ts` as a package or submodule export barrel: `packages/core/src/index.ts`, `packages/wallet/src/helpers/index.ts`, `packages/react/src/hooks/index.ts`.
- Place tests in `__tests__` next to the package submodule they cover: `packages/core/src/helpers/__tests__/events.test.ts`, `packages/wallet/src/actions/__tests__/tokens.test.ts`.
- Use `exports.test.ts` for public API snapshot coverage in every export surface: `packages/core/src/__tests__/exports.test.ts`, `packages/wallet/src/models/__tests__/exports.test.ts`.
- Test fixtures are named by role: shared fixtures use `fixtures.ts` (`packages/core/src/__tests__/fixtures.ts`); package-specific signer helpers use `fake-user.ts` (`packages/wallet/src/__tests__/fake-user.ts`).

**Functions:**
- Use camelCase for normal functions and helpers: `getReplaceableAddress` in `packages/core/src/helpers/event.ts`, `modifyPublicTags` in `packages/core/src/operations/tags.ts`, `loadCashuWallet` in `packages/wallet/src/actions/tokens.ts`.
- Use PascalCase for action builder functions that represent user operations: `AddToken`, `ReceiveToken`, `MintTokens`, `RolloverTokens` in `packages/wallet/src/actions/tokens.ts`.
- Use `use*` camelCase for React hooks: `useAction` in `packages/react/src/hooks/use-action.ts`, `useEventStore` in `packages/react/src/hooks/use-event-store.ts`.
- Use factory-style names for test helpers: `makeToken`, `addTokenEvent`, `mintingProvider`, `memoryCouch`, and `mockPool` in `packages/wallet/src/actions/__tests__/tokens.test.ts` and `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.

**Variables:**
- Use camelCase for locals and module variables: `publicOperations`, `hiddenOperations`, `staticArgs`, `eventStore`, `proofCounter`.
- Use uppercase constants for fixed protocol/test values: `WALLET_TOKEN_KIND` in `packages/wallet/src/helpers/tokens.ts`, `HASH` and `PUBKEY` in `packages/content/src/markdown/__tests__/blossom.test.ts`.
- Use `$` suffix for Observables and Subjects: `insert$`, `update$`, `remove$`, `status$`, `busy$` in `packages/core/src/event-store/event-store.ts` and `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.
- Use leading underscore for private backing fields: `_verifyEventMethod` in `packages/core/src/event-store/event-store.ts`, `_context` in `packages/actions/src/action-runner.ts`.

**Types:**
- Use PascalCase for classes, interfaces, and type aliases: `EventStore`, `EventStoreOptions`, `ActionContext`, `CashuWalletProvider`, `FakeUser`.
- Use `I*` prefixes for event-store interfaces in `packages/core/src/event-store/interface.ts`, consumed by `packages/actions/src/action-runner.ts`.
- Use generic constraints on event operations and helpers when preserving event shape: `modifyPublicTags<E extends EventTemplate | UnsignedEvent | NostrEvent>` in `packages/core/src/operations/tags.ts`.
- Use specific event aliases for narrowed Nostr kinds: `KnownEvent`, `KnownEventTemplate`, `KnownUnsignedEvent`, and `Rumor` in `packages/core/src/helpers/event.ts`.

## Code Style

**Formatting:**
- Use Prettier from `package.json` with `.prettierrc`: 2 spaces, spaces instead of tabs, `printWidth` 120.
- Keep object and function call formatting compact until readability requires wrapping; examples appear in `packages/core/src/operations/tags.ts` and `packages/wallet/src/actions/__tests__/tokens.test.ts`.
- Use double quotes throughout TypeScript imports and strings: `packages/core/src/helpers/event.ts`, `packages/react/src/hooks/use-action.ts`.
- Include trailing commas in multiline calls and function parameters as produced by Prettier: `modifyTags` in `packages/core/src/operations/tags.ts`, `useAction` in `packages/react/src/hooks/use-action.ts`.

**Linting:**
- No root ESLint config is detected for packages; package quality is enforced primarily through strict TypeScript and Prettier.
- TypeScript strictness is enabled per package `tsconfig.json`; `packages/core/tsconfig.json` enables `strict`, `noImplicitAny`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`.
- The `refs/accordian/eslint.config.js` reference app uses ESLint recommended rules, TypeScript ESLint recommended rules, React Hooks, and React Refresh for `**/*.{ts,tsx}` only inside that reference app.

## Import Organization

**Order:**
1. External packages first: `nostr-tools`, `rxjs`, `vitest`, `@cashu/cashu-ts`, `react`.
2. Workspace package imports next: `applesauce-core`, `applesauce-common`, `applesauce-actions`, `applesauce-relay`.
3. Relative imports last, grouped by nearby module paths: `../helpers/event.js`, `../../__tests__/fake-user.js`, `./use-action-runner.js`.
4. Side-effect registration imports go after normal imports and must be explicit: `import "../casts/__register__.js";` in `packages/wallet/src/wallet/nut-wallet.ts`, `import "../../casts/index.js";` in `packages/wallet/src/actions/__tests__/tokens.test.ts`.

**Path Aliases:**
- No repo-wide TypeScript path aliases are detected in package `tsconfig.json` files; use package imports for public workspace APIs and relative imports inside a package.
- Use ESM `.js` extensions for local runtime imports even in `.ts` sources: `../helpers/event.js` in `packages/core/src/operations/tags.ts`, `./use-action-runner.js` in `packages/react/src/hooks/use-action.ts`.
- Existing code sometimes imports package subpaths without `.js` when using workspace package export maps: `applesauce-core/helpers/event` in `packages/wallet/src/actions/tokens.ts`.
- Prefer `import type` for type-only dependencies when possible: `import type { RelayPool } from "applesauce-relay"` in `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.

## Error Handling

**Patterns:**
- Validate preconditions early and throw `Error` with direct messages: `if (!signer) throw new Error("Missing signer")` in `packages/wallet/src/actions/tokens.ts`; `if (!this.publishMethod) throw new Error("Missing publish method, use ActionRunner.exec")` in `packages/actions/src/action-runner.ts`.
- Use domain-specific error classes only where they carry protocol meaning: `SignerMismatchError` in `packages/accounts/src/account.ts`, `AuthRequiredError` in `packages/relay/src/relay.ts`.
- Preserve loading state around async failures with `try/catch` and rethrow the original error: `useAction` in `packages/react/src/hooks/use-action.ts`.
- For Observable APIs, surface errors through the stream subscriber: `ActionRunner.exec` calls `subscriber.error(err)` in `packages/actions/src/action-runner.ts`.
- In tests, assert rejection paths with `await expect(...).rejects.toThrow(...)`: `packages/wallet/src/actions/__tests__/tokens.test.ts`, `packages/concord/src/__tests__/client.test.ts`.
- Use `DOMException("Aborted", "AbortError")` for abort semantics: `packages/wallet/src/wallet/nut-wallet.ts`.

## Logging

**Framework:** `debug` plus limited `console`.

**Patterns:**
- Use the `debug` package for library-level diagnostic logging; `Debugger` is passed through wallet loading and wallet APIs in `packages/wallet/src/wallet/types.ts`, `packages/wallet/src/wallet/loading.ts`, and `packages/wallet/src/wallet/nut-wallet.ts`.
- Use `console.warn` for explicit opt-in dangerous configuration warnings: disabled signature verification warning in `packages/core/src/event-store/event-store.ts`.
- Avoid `console.log` in package code except quiet-load fallbacks such as `packages/accounts/src/manager.ts`; prefer structured errors or debug logging in new code.
- Do not log secrets, private keys, encrypted payloads, or Cashu proofs; wallet code handles token and signer material in `packages/wallet/src/actions/tokens.ts` and `packages/wallet/src/wallet/nut-wallet.ts`.

## Comments

**When to Comment:**
- Use comments to explain protocol choices, side effects, and non-obvious sequencing: optimistic local store updates in `packages/actions/src/action-runner.ts`, hidden tag encryption flow in `packages/core/src/operations/tags.ts`.
- Keep comments adjacent to the behavior they explain; avoid standalone best-practice prose in implementation files.
- Mark compatibility APIs with `@deprecated` and a replacement: `getReplaceableUID` in `packages/core/src/helpers/event.ts`, `ActionHub` in `packages/actions/src/action-runner.ts`.
- TODO comments exist in protocol and relay selection areas; new TODOs should include a concrete follow-up target and file-local context, matching `packages/common/src/operations/reaction.ts` and `packages/core/src/helpers/relay-selection.ts`.

**JSDoc/TSDoc:**
- Exported functions, classes, options, and public types should have short JSDoc blocks: `EventStoreOptions` and `EventStore` in `packages/core/src/event-store/event-store.ts`, `ActionContext` and `ActionRunner` in `packages/actions/src/action-runner.ts`.
- Include `@param`, `@returns`, and `@throws` only when they add information beyond the signature: `modifyHiddenTags` in `packages/core/src/operations/tags.ts`.
- Keep docs concise and API-focused; examples belong in docs or tests unless they clarify a public API directly.

## Function Design

**Size:** Keep helpers small and composable; when a domain operation is large, split local helper functions above exported action builders, as in `loadCashuWallet`, `AddToken`, and `ReceiveToken` in `packages/wallet/src/actions/tokens.ts`.

**Parameters:** Use options objects for optional behavior and dependency injection: `ReceiveToken(token, options)` in `packages/wallet/src/actions/tokens.ts`, `NutWallet.create(..., { mints, relays })` in `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`.

**Return Values:** Prefer immutable updates for event/tag operations: `modifyPublicTags` returns `{ ...draft, tags: ... }` in `packages/core/src/operations/tags.ts`; `EventStore.add` returns the stored event or `null` for ignored events in `packages/core/src/event-store/event-store.ts`.

## Module Design

**Exports:**
- Public package APIs are controlled by `exports` maps in each package `package.json` and barrel files under `src/index.ts` or submodule `index.ts` files.
- Add new public helpers to the relevant barrel and update `exports.test.ts` snapshots, for example `packages/core/src/helpers/__tests__/exports.test.ts` and `packages/wallet/src/actions/__tests__/exports.test.ts`.
- Keep framework-specific code isolated in package-specific directories: React hooks/providers in `packages/react/src/hooks` and `packages/react/src/providers`; Nostr event helpers stay framework-agnostic in `packages/core/src/helpers` and `packages/common/src/helpers`.

**Barrel Files:**
- Use submodule barrels for consumer-facing entry points: `packages/core/src/helpers/index.ts`, `packages/core/src/operations/index.ts`, `packages/wallet/src/factories/index.ts`.
- Test every barrel with an inline snapshot of sorted exported keys: `packages/core/src/__tests__/exports.test.ts`.
- Do not rely on barrels for internal side effects; registration modules stay explicit via `__register__.js` imports in `packages/wallet/src/wallet/nut-wallet.ts`.

---

*Convention analysis: 2026-07-08*
