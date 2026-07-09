# Technology Stack

**Analysis Date:** 2026-07-09

## Languages

**Primary:**
- TypeScript 5.8-5.9.3 - All packages and applications
- JavaScript - Build and configuration scripts

**Secondary:**
- Bash - Build and utility scripts
- Vue 3.5.25 - Documentation site (VitePress)

## Runtime

**Environment:**
- Node.js >= 20.19.0

**Package Manager:**
- pnpm 11.10.0
- Lockfile: `pnpm-lock.yaml` (present)

## Frameworks

**Core SDK:**
- RxJS 7.8.1-7.8.2 - Reactive data streams across all packages
- nostr-tools ~2.19 - Nostr protocol utilities

**Build/Dev:**
- Turbo 2.9.14 - Monorepo build orchestration (`turbo.json`)
- TypeScript 5.8.3-5.9.3 - Type checking and compilation

**Testing:**
- Vitest 4.0.15-4.1.8 - Unit and integration testing
- @vitest/browser 4.1.6 - Browser testing
- @vitest/browser-playwright 4.1.6 - Playwright browser driver
- @vitest/coverage-v8 4.1.6 - Code coverage
- Playwright 1.60.0 - Browser automation
- vitest-websocket-mock 0.5.0 - WebSocket mocking

**Frontend (Examples App):**
- React 18.3.1 - UI framework
- React Router 7.13.0 - Client-side routing
- React Hook Form 7.69.0 - Form state management
- TailwindCSS 4.1.18 - Utility-first CSS framework
- Vite 8.0.6 - Frontend build tool
- @vitejs/plugin-react-swc 3.11.0 - SWC React compiler

**UI Components & Styling:**
- DaisyUI 5.5.14 - Tailwind CSS component library
- Emotion 11.14.0-11.14.1 - CSS-in-JS styling
- Lucide React 0.562.0 - Icon library

**Documentation:**
- VitePress 1.6.4 - Documentation site generator
- Vue 3.5.25 - Documentation UI

## Key Dependencies

**Critical Core:**
- nostr-tools ~2.19 - Nostr protocol message handling, NIP implementations
- rxjs 7.8.1-7.8.2 - Reactive streams foundation for all async operations
- nanoid 5.0.9-5.1.6 - Unique ID generation
- debug 4.4.0-4.4.3 - Debug logging utility

**Cryptography & Security:**
- @noble/secp256k1 3.1.0 - Elliptic curve cryptography
- @noble/hashes 2.2.0 - Cryptographic hashing
- @noble/curves 2.2.0 - Advanced curve operations
- @noble/ciphers 2.2.0 - Symmetric encryption
- @scure/base 2.2.0 - Base encoding/decoding (base64, bech32, etc.)

**Data Structures & Utilities:**
- fast-deep-equal 3.1.3 - Deep equality checks
- hash-sum 2.0.0 - Object hashing
- light-bolt11-decoder 3.2.0 - BOLT11 lightning invoice parsing

**Content Processing:**
- remark 15.0.1 - Markdown processor
- remark-parse 11.0.0 - Markdown parser
- unified 11.0.5 - Text processing ecosystem
- mdast-util-find-and-replace 3.0.2 - Markdown AST transformation
- unist-util-visit-parents 6.0.1 - AST tree traversal
- @types/hast, @types/mdast, @types/unist - AST type definitions

**Bitcoin & Lightning:**
- @cashu/cashu-ts 4.5.1 - Cashu ecash token support (peer dependency)
- light-bolt11-decoder 3.2.0 - BOLT11 invoice decoding

**External Services:**
- @gandlaf21/bc-ur 1.1.12 - BC-UR encoding for hardware wallets
- blossom-client-sdk 5.0.0 - File storage (NIP-96)

**Frontend Libraries (Examples App):**
- Chart.js 4.5.1 - Charts and graphs
- react-chartjs-2 5.3.1 - React Chart.js bindings
- chartjs-chart-wordcloud 4.4.5 - Word cloud charts
- react-player 3.4.0 - Media player
- hls.js 1.6.16 - HLS streaming
- Leaflet 1.9.4 - Maps
- react-leaflet 4.2.1 - React Leaflet bindings
- ngeohash 0.6.3 - Geohash utilities
- react-force-graph-2d 1.29.1 - Force-directed graphs
- react-blurhash 0.3.0 - Blurhash image placeholders
- react-markdown 10.1.0 - Markdown rendering
- remark-gfm 4.0.1 - GitHub Flavored Markdown
- Tiptap 3.22.1 - Rich text editor
- @tiptap/react 3.22.1 - React integration
- @tiptap/starter-kit 3.22.1 - Common Tiptap extensions
- tiptap-markdown 0.9.0 - Markdown for Tiptap
- nostr-editor 1.2.0 - Nostr-specific editor

**Validation & Form Handling:**
- Zod 4.3.5 - TypeScript-first schema validation
- @hookform/resolvers 3.9.1 - React Hook Form validation resolvers

**Storage & Caching:**
- localforage 1.10.0 - LocalStorage/IndexedDB abstraction
- nostr-idb 5.0.0 - IndexedDB event storage

**Network & Data:**
- @nostrify/nostrify jsr:0.46.5 - Nostr protocol abstraction
- @snort/worker-relay 1.5.0 - Worker-based relay
- nostr-social-graph 1.0.36 - Social graph computation
- window.nostrdb.js 0.7.0 - JavaScript NostrDB binding

**Utilities:**
- chalk 5.6.2 - Terminal colors
- clsx 2.1.1 - Classname utility
- localforage 1.10.0 - Cross-browser storage
- react-use 17.6.0 - React hooks collection
- react-error-boundary 6.0.1 - Error boundary component
- observable-hooks 4.2.4 - RxJS React integration

**Audio/Visual:**
- @fontsource/roboto 5.2.9 - Roboto font
- pastellify 0.1.4 - Pastel color generation

**QR Codes:**
- @libs/qrcode jsr:3.0.1 - QR code generation

**Torrent Support:**
- create-torrent 6.1.0 - Torrent file creation
- parse-torrent 11.0.19 - Torrent file parsing

**Development Tools:**
- Prettier 3.8.3 - Code formatter
- @changesets/cli 2.31.0 - Release changesets
- @changesets/changelog-git 0.2.1 - Git changelog generation
- @changesets/types 6.1.0 - Types for changesets
- TypeDoc 0.28.19 - API documentation generation
- @hirez_io/observer-spy 2.2.0 - RxJS testing utilities
- rimraf 6.0.1-6.1.3 - Cross-platform file deletion

## Configuration

**Environment:**
- Configured via environment variables (no `.env` file template documented in codebase)
- Each package managed independently via workspace

**Build:**
- `turbo.json` - Task orchestration and caching configuration
- `.turbo/` - Turbo cache directory
- Root `tsconfig.json` inherited by packages
- Each package has own `tsconfig.json` or uses inherited config

**Code Style:**
- `.prettierrc` - Prettier configuration (2-space indent, 120 char line width)
- `.prettierignore` - Files to skip formatting

## Platform Requirements

**Development:**
- Node.js >= 20.19.0
- pnpm 11.10.0
- TypeScript support

**Production:**
- Deployment targets vary by package:
  - Core packages: Node.js environment, browser via bundling
  - SQLite: Node.js (better-sqlite3), Deno, Bun, Wasm
  - React packages: Browser bundled with Vite or similar
  - Docs: Static HTML via VitePress

**Optional Runtimes:**
- Deno via `./native` exports in applesauce-sqlite
- Bun via `./bun` exports in applesauce-sqlite
- Turso/LibSQL for cloud SQLite
- Browser WebSocket for Nostr relay communication

---

*Stack analysis: 2026-07-09*
