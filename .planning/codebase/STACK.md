# Technology Stack

**Analysis Date:** 2026-07-08

## Languages

**Primary:**
- TypeScript 5.8-5.9 - package source, tests, React examples, VitePress config, and build configs under `packages/*/src`, `apps/examples/src`, `apps/docs/.vitepress/config.ts`, and `vitest.config.ts`.
- JavaScript ES modules - Node build scripts and reference app lint config under `apps/agent-skills/src/build.mjs` and `refs/accordian/eslint.config.js`.

**Secondary:**
- Markdown - documentation content under `docs/`, `apps/docs/`, and package documentation generated with `typedoc.json`.

## Runtime

**Environment:**
- Node.js >=20.19.0 - enforced by `package.json` `engines.node`; package scripts use Node APIs, `node:sqlite`, and `node dist/relay.js` in `packages/sqlite/package.json`.
- Browser ES2022 - examples app targets `es2022` in `apps/examples/vite.config.ts` and uses browser APIs such as WebSocket, IndexedDB, localStorage, Web Serial, and `window.nostr`-style signers under `packages/*/src`.
- Bun and Deno-compatible SQLite adapters - package export aliases and implementations exist in `packages/sqlite/package.json`, `packages/sqlite/src/bun/*`, and `packages/sqlite/src/native/*`.

**Package Manager:**
- pnpm 11.10.0 - declared in `package.json` `packageManager`.
- Lockfile: present at `pnpm-lock.yaml`.
- Workspace: `pnpm-workspace.yaml` includes `packages/*` and `apps/*` with `linkWorkspacePackages: true`.

## Frameworks

**Core:**
- RxJS ^7.8.x - reactive foundation for stores, loaders, relays, wallets, and React hooks in packages including `packages/core/package.json`, `packages/relay/package.json`, `packages/loaders/package.json`, and `packages/wallet/package.json`.
- nostr-tools ~2.19 - Nostr protocol helpers for event verification, NIP-19, NIP-42, NIP-44, NIP-49, and NIP-98 in `packages/core/package.json`, `packages/relay/src/relay.ts`, and `packages/relay/src/management.ts`.
- React 18/19 peer support - library hooks in `packages/react/package.json`; example app uses React 18.3.1 in `apps/examples/package.json`.
- Vite 8 + React SWC - examples development/build pipeline configured in `apps/examples/package.json` and `apps/examples/vite.config.ts`.
- VitePress 1.6 - documentation site configured in `apps/docs/package.json` and `apps/docs/.vitepress/config.ts`.

**Testing:**
- Vitest 4.1.x - root test runner configured in `package.json`, `vitest.config.ts`, and `vitest.workspace.ts`.
- Vitest browser + Playwright - browser test dependencies in `package.json` with `@vitest/browser`, `@vitest/browser-playwright`, and `playwright`.
- V8 coverage - configured in `vitest.config.ts` with reporters `text`, `json`, `html`, and `lcov`.
- vitest-websocket-mock - relay/WebSocket tests dependency in `package.json` and package dev dependencies such as `packages/relay/package.json`.

**Build/Dev:**
- TypeScript `tsc` - every library package builds with `tsc` via `packages/*/package.json` scripts.
- Turborepo 2.9 - orchestrates monorepo builds/tests in `package.json` and `turbo.json`.
- Changesets 2.31 - release/version management in `package.json` scripts `version-packages`, `release`, and `release-next`.
- Prettier 3.8 - formatting configured in `.prettierrc` and run through `package.json` script `format`.
- TypeDoc 0.28 - API docs dependency in `package.json` and config in `typedoc.json`.
- Tailwind CSS 4 + DaisyUI 5 - examples styling dependencies in `apps/examples/package.json`; Tailwind Vite plugin configured in `apps/examples/vite.config.ts`.

## Key Dependencies

**Critical:**
- `applesauce-core` 6.2.0 - central event store, helpers, models, operations, factories, and casts exposed by `packages/core/package.json`.
- `applesauce-relay` 6.2.1 - Nostr relay client/pool, NIP-42 auth, NIP-86 relay management, and negentropy support in `packages/relay/package.json` and `packages/relay/src/relay.ts`.
- `applesauce-loaders` 6.2.0 - observable event loaders built on relay pools in `packages/loaders/package.json`.
- `applesauce-common` 6.2.0 - NIP-specific helpers, casts, operations, factories, and validation in `packages/common/package.json`.
- `applesauce-actions` 6.2.0 - reusable Nostr actions in `packages/actions/package.json`.
- `applesauce-signers` 6.2.2 - browser, serial, Amber/Android, and Nostr Connect signing abstractions in `packages/signers/package.json`.
- `applesauce-accounts` 6.2.0 - account management with optional Capacitor signer support in `packages/accounts/package.json`.
- `applesauce-react` 6.0.0 - React providers and hooks over RxJS observables in `packages/react/package.json`.
- `applesauce-wallet` 6.2.0 - NIP-60/Cashu wallet, token actions, and wallet state observables in `packages/wallet/package.json` and `packages/wallet/src/wallet/nut-wallet.ts`.
- `applesauce-wallet-connect` 6.2.0 - Nostr Wallet Connect client/service helpers in `packages/wallet-connect/package.json`.
- `applesauce-sqlite` 6.0.0 - SQLite-backed event databases and local relay server in `packages/sqlite/package.json` and `packages/sqlite/src/relay.ts`.
- `applesauce-content` 6.2.0 - text/Markdown/NAST processing through Unified/Remark in `packages/content/package.json`.
- `applesauce-concord` 6.2.0 - Concord protocol helpers, client, casts, factories, and storage interfaces in `packages/concord/package.json` and `packages/concord/src/storage.ts`.

**Infrastructure:**
- `@cashu/cashu-ts` ^4.5.1 - Cashu mint/wallet/token protocol client in `packages/wallet/package.json`, `packages/wallet/src/wallet/nut-wallet.ts`, and optional content parsing in `packages/content/package.json`.
- `@libsql/client` ^0.15.15 - libSQL database backend for `packages/sqlite/src/libsql/*`.
- `better-sqlite3` ^12.8.0 - synchronous SQLite backend and local relay storage in `packages/sqlite/src/better-sqlite3/*` and `packages/sqlite/src/relay.ts`.
- `@tursodatabase/database` and `@tursodatabase/database-wasm` ^0.2.2 - Turso/native and Turso WASM backends in `packages/sqlite/src/turso/*` and `packages/sqlite/src/turso-wasm/*`.
- `ws` ^8.18.3 - Node WebSocket server for the SQLite relay in `packages/sqlite/src/relay.ts`.
- `debug` ^4.4.x - package-scoped debug logging in `packages/core/package.json`, `packages/signers/package.json`, and `packages/wallet/package.json`.
- `@noble/*` and `@scure/base` - cryptography and encoding primitives in `packages/signers/package.json`, `packages/concord/package.json`, and `packages/relay/package.json`.
- `unified`, `remark`, `remark-parse`, and `mdast-util-find-and-replace` - content parsing pipeline in `packages/content/package.json`.

## Configuration

**Environment:**
- Root runtime requires Node >=20.19.0 via `package.json`.
- Build base paths are configured with `VITE_BASE` in `apps/examples/vite.config.ts` and `apps/docs/.vitepress/config.ts`.
- SQLite relay runtime uses `DATABASE_PATH` and `PORT` in `packages/sqlite/src/relay.ts`; defaults are `:memory:` and `8080`.
- Accordian reference app supports `VITE_NOSTR_CONNECT_RELAYS`, `VITE_LOOKUP_RELAYS`, and `VITE_CONCORD_AV_SERVERS` in `refs/accordian/src/nostr.ts` and `refs/accordian/src/app/voice/brokers.ts`.
- No `.env*` files detected at repository root; do not commit secrets into repo configuration.

**Build:**
- Monorepo packages and apps are declared in `pnpm-workspace.yaml`.
- Build graph is declared in `turbo.json`; `build` depends on `^build` and outputs `dist/**` and `.vitepress/dist/**`.
- Test configuration is in `vitest.config.ts`; workspace discovery is in `vitest.workspace.ts`.
- Example app build config is `apps/examples/vite.config.ts`.
- Documentation site config is `apps/docs/.vitepress/config.ts`.
- Formatting config is `.prettierrc` with 2-space indentation, no tabs, and `printWidth: 120`.
- API docs config is `typedoc.json`.

## Platform Requirements

**Development:**
- Use Node.js >=20.19.0 with pnpm 11.10.0 from `package.json`.
- Run `pnpm install` against `pnpm-lock.yaml`; workspace packages are linked through `pnpm-workspace.yaml`.
- Native SQLite development may require build tooling for `better-sqlite3`, which is explicitly allowed in `pnpm-workspace.yaml` `allowBuilds`.
- Browser relay and example work requires WebSocket support; tests use `vitest-websocket-mock` and Playwright from `package.json`.

**Production:**
- Library packages publish ESM/CJS-compatible entrypoints from `dist/` as declared in each `packages/*/package.json` `exports` map.
- Docs deploy as a VitePress static site from `apps/docs`.
- Examples deploy as a Vite static React app from `apps/examples`.
- Optional local relay runs as a Node process from `packages/sqlite` using `node dist/relay.js` and stores events in `DATABASE_PATH` or memory.

---

*Stack analysis: 2026-07-08*
