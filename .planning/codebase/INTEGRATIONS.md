# External Integrations

**Analysis Date:** 2026-07-09

## Nostr Protocol & Relays

**WebSocket Relay Communication:**
- Transport: WebSocket via `rxjs/webSocket` (`packages/relay/src/relay.ts:53`)
- Protocol: NIP-01 (Nostr protocol base)
- Client: `applesauce-relay` package manages connections
- Connection pooling: `RelayPool` and `RelayGroup` classes in `packages/relay/`
- Relay discovery: NIP-65 (Relay List Metadata)

**Relay Features:**
- NIP-11: Relay Information Document support
- NIP-42: Authentication (stream-key auth for gated relays)
- NIP-77: Negentropy synchronization for efficient event syncing
- NIP-98: HTTP File Storage (via Blossom)

## NIP Protocol Support

**Event Types & Kinds Supported:**
- `packages/common/src/helpers/` contains NIP-specific helpers for:
  - NIP-02: Contact Lists (`contacts.ts`)
  - NIP-04: Encrypted Direct Messages (`messages.ts`, `legacy-messages.ts`)
  - NIP-05: Nostr Address Identification (`external-id.ts`)
  - NIP-06: Basic Key Derivation
  - NIP-09: Event Deletion
  - NIP-10: Handling Mentions
  - NIP-13: Proof of Work
  - NIP-14: Subject Tag in Text Events
  - NIP-17: Private Direct Messages (encrypted)
  - NIP-19: Bech32 Encoding
  - NIP-22: Event `created_at` Limits
  - NIP-23: Long-form Content (Articles)
  - NIP-24: Extra Metadata Tags
  - NIP-25: Reactions
  - NIP-26: Delegated Event Signing
  - NIP-27: Text Note References
  - NIP-30: Custom Emoji (Emoji Sets)
  - NIP-32: Labeling (Reports)
  - NIP-33: Parameterized Replaceable Events
  - NIP-34: Git Events (Repositories)
  - NIP-35: Torrents
  - NIP-36: Sensitive Content
  - NIP-38: User Statuses
  - NIP-40: Expiration Tag
  - NIP-42: Authentication Challenge
  - NIP-44: Encrypted Payloads (Content Encryption)
  - NIP-47: Wallet Connect (Nostr Wallet Connect protocol)
  - NIP-50: Keywords Filter
  - NIP-51: Lists (Bookmark Lists, Mutes, Follows)
  - NIP-52: Calendar Events
  - NIP-53: Live Chat Message
  - NIP-54: Wiki
  - NIP-55: Android Signer
  - NIP-56: Reporting
  - NIP-57: Lightning Zaps
  - NIP-58: Badges
  - NIP-59: Gift Wrap (Content Wrapping)
  - NIP-60: Distributed File Descriptors
  - NIP-65: Relay List Metadata
  - NIP-71: Video Events
  - NIP-72: Moderated Communities
  - NIP-75: Zap Goals
  - NIP-87: Signing Key Request
  - NIP-92: Media Attachments
  - NIP-98: HTTP File Storage (Blossom)

**Concord Protocol (CORD):**
- `packages/concord/` - Concord protocol implementation
- Community management and event synchronization
- Stream-key authentication for community relays

## Data Storage

**Databases:**

**SQLite:**
- Package: `applesauce-sqlite`
- Multiple SQLite implementations via conditional exports:
  - **Node.js**: `better-sqlite3` 12.8.0 - Synchronous SQLite bindings
  - **Deno**: Native SQLite support via `./native` export
  - **Bun**: Native SQLite support via `./bun` export
  - **WASM**: Turso WASM implementation via `./turso-wasm` export
  - **LibSQL**: `@libsql/client` 0.15.15 - Remote LibSQL client
  - **Turso**: `@tursodatabase/database` 0.2.2 - Turso cloud SQLite

**IndexedDB:**
- `nostr-idb` 5.0.0 - Browser-based event storage
- Used in `apps/examples` for in-browser persistence

**LocalStorage/Storage Abstraction:**
- `localforage` 1.10.0 - Cross-browser storage (localStorage/IndexedDB)

## File Storage

**Blossom (NIP-98 HTTP File Storage):**
- `blossom-client-sdk` 5.0.0 - File upload/download
- Integration: `packages/common/src/helpers/blossom.ts`
- Used in examples app for media storage

**Torrent Support:**
- `create-torrent` 6.1.0 - Create torrent files
- `parse-torrent` 11.0.19 - Parse torrent data
- Integration: `packages/common/src/helpers/torrent.ts`

## Signer & Key Management

**Nostr Signers:**
- Package: `applesauce-signers`
- Account management: `applesauce-accounts`
- Cryptographic signing via `@noble/secp256k1`

**NIP-46 Support (Nostr Connect/Bunker):**
- Remote signer protocol support
- Optional dependency: `nostr-signer-capacitor-plugin` 0.0.5

**NIP-47 Support (Nostr Wallet Connect):**
- Package: `applesauce-wallet-connect`
- Wallet service discovery and request handling
- Kind 23194-23197 event handling

## Authentication & Identity

**Auth Methods:**

**NIP-42 (Event Authentication):**
- Used for relay authentication
- Stream-key auth for Concord community relays
- Implementation: `packages/relay/src/relay.ts`

**NIP-98 (HTTP Authentication):**
- HTTP authentication tokens for file storage
- Implementation via nostr-tools NIP-98 support

**External Identity:**
- NIP-05: DNS TXT record identity verification
- NIP-35: External ID handling

## Wallet & Bitcoin/Lightning

**Bitcoin/Lightning:**
- `@cashu/cashu-ts` 4.5.1 - Cashu ecash token support
  - Package peer dependency in `applesauce-wallet` and `applesauce-content`
  - Optional peer dependency in `applesauce-content`
  - BOLT11 invoicing integration

**BOLT11 Lightning Invoice:**
- `light-bolt11-decoder` 3.2.0 - Invoice parsing
- Integration: `packages/common/src/helpers/bolt11.ts`

**NIP-57 (Zaps):**
- Lightning payment requests tied to events
- Integration: `packages/common/src/helpers/zap.ts`

## Content Processing

**Markdown & Text Processing:**
- `remark` 15.0.1 - Markdown processor
- `remark-parse` 11.0.0 - Markdown parser
- `unified` 11.0.5 - Text processing framework
- `mdast-util-find-and-replace` 3.0.2 - Markdown AST manipulation
- `unist-util-visit-parents` 6.0.1 - AST tree traversal
- `remark-gfm` 4.0.1 - GitHub Flavored Markdown support

**NIP-23 Long-form Content:**
- Article parsing and rendering
- Markdown-based article support

**AST Processing (NAST - Nostr Abstract Syntax Tree):**
- Text transformers in `packages/content/src/text/`
- Markdown transformers in `packages/content/src/markdown/`
- Raw NAST tree processing

## Cryptography & Encoding

**Elliptic Curve Cryptography:**
- `@noble/secp256k1` 3.1.0 - ECDSA signing and verification
- `@noble/curves` 2.2.0 - Curve operations
- `@noble/hashes` 2.2.0 - SHA256, SHA1, RIPEMD160, Blake2b, etc.
- `@noble/ciphers` 2.2.0 - AES-GCM, ChaCha20-Poly1305, XSalsa20-Poly1305

**Encoding/Decoding:**
- `@scure/base` 2.2.0 - Base64, Base58, Bech32, Hex encoding

**Hardware Wallet Support:**
- `@gandlaf21/bc-ur` 1.1.12 - BC-UR encoding for hardware wallet communication

## External APIs & Services

**Nostr Utilities & Abstractions:**
- `nostr-tools` ~2.19 - Core Nostr protocol utilities
- `@nostrify/nostrify` jsr:0.46.5 - Nostr protocol abstraction
- `@snort/worker-relay` 1.5.0 - Worker-based relay implementation
- `nostr-social-graph` 1.0.36 - Social graph computation

**Editor & Content UI:**
- `nostr-editor` 1.2.0 - Nostr-aware text editor

**Web Monetization:**
- `window.nostrdb.js` 0.7.0 - JavaScript NostrDB binding (event indexing)

## Maps & Geolocation

**Mapping Services:**
- `leaflet` 1.9.4 - Map library
- `react-leaflet` 4.2.1 - React Leaflet bindings
- `ngeohash` 0.6.3 - Geohash encoding/decoding

## Data Visualization

**Charts & Graphs:**
- `chart.js` 4.5.1 - Chart library
- `react-chartjs-2` 5.3.1 - React Chart.js integration
- `chartjs-chart-wordcloud` 4.4.5 - Word cloud charts
- `react-force-graph-2d` 1.29.1 - Force-directed graph visualization

## Media & Streaming

**Video/Audio Playback:**
- `react-player` 3.4.0 - Universal media player
- `hls.js` 1.6.16 - HTTP Live Streaming (HLS) support

**QR Codes:**
- `@libs/qrcode` jsr:3.0.1 - QR code generation

**Image Processing:**
- `react-blurhash` 0.3.0 - Blurhash placeholder generation

## Environment Configuration

**Required env vars:**
- No hardcoded env vars documented
- Relay URLs configured per application usage
- Database connections configured per use case
- Optional: Turso database URL for cloud SQLite

**Secrets location:**
- Private keys: Stored in browser localStorage or client signer
- NWC URIs: Wallet connection strings
- API tokens: Relay authentication keys
- Database credentials: Passed at runtime

**Convention:**
- Each package handles its own runtime configuration
- `packages/relay/` manages relay connection strings
- `packages/accounts/` manages private key storage
- Applications (examples, docs) configure services via instantiation

## Webhooks & Callbacks

**Incoming:**
- NIP-42 authentication challenges from relays
- NIP-47 wallet service requests (23194 events)
- NIP-98 HTTP auth token generation

**Outgoing:**
- Event publishing to Nostr relays (NIP-01)
- File uploads to Blossom servers (NIP-98)
- Relay discovery queries (NIP-65)

## Testing & Development Integrations

**WebSocket Testing:**
- `vitest-websocket-mock` 0.5.0 - Mock WebSocket for relay tests
- Used in: `packages/relay/__tests__/`

**RxJS Testing:**
- `@hirez_io/observer-spy` 2.2.0 - RxJS observable testing utilities
- Used throughout packages for subscription testing

---

*Integration audit: 2026-07-09*
