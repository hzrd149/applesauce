# Codebase Concerns

**Analysis Date:** 2026-07-08

## Tech Debt

**Non-composable tag operations in common event builders:**
- Issue: Several operations rebuild `draft.tags` manually instead of using the shared `modifyPublicTags`/tag operation pattern, so duplicate handling and tag mutation behavior can diverge between event types.
- Files: `packages/common/src/operations/reaction.ts`, `packages/common/src/operations/share.ts`, `packages/common/src/operations/media-attachment.ts`
- Impact: Future NIP helpers can introduce duplicate tags, inconsistent relay hints, or accidental tag loss when multiple operations are piped together.
- Fix approach: Convert tag mutations to shared operations from `applesauce-core/operations/tags` and add focused tests beside `packages/common/src/operations/__tests__/reaction.test.ts`, `packages/common/src/operations/__tests__/share.test.ts`, and `packages/common/src/operations/__tests__/media-attachment.test.ts`.

**Wrapped-message relay hints omitted:**
- Issue: Direct-message tag operations write bare `p` and `e` tags without relay hints.
- Files: `packages/common/src/operations/wrapped-message.ts`
- Impact: Clients receiving wrapped messages have less routing context for conversation participants and parent messages, especially when the relevant events are not on the same relay.
- Fix approach: Add optional relay hint callbacks mirroring `setReactionParent` in `packages/common/src/operations/reaction.ts`, preserve current overloads, and test both hinted and unhinted output.

**Generated agent-skill assets duplicate source examples:**
- Issue: Built files under `apps/agent-skills/dist/applesauce/assets/examples/` duplicate many files from `apps/examples/src/examples/`.
- Files: `apps/agent-skills/dist/applesauce/assets/examples/wallet/wallet.tsx`, `apps/agent-skills/dist/applesauce/assets/examples/wallet/admin.tsx`, `apps/examples/src/examples/wallet/wallet.tsx`, `apps/examples/src/examples/wallet/admin.tsx`
- Impact: Searches and reviews surface duplicate large files, edits can be made in the wrong copy, and codebase-wide metrics overstate complexity.
- Fix approach: Treat `apps/agent-skills/dist/` as generated output; regenerate it from source and exclude it from human edits or remove it from committed source if release packaging allows.

**Large example components mix UI, state, and protocol logic:**
- Issue: Several examples are single files above 700 lines that combine React view code, relay/wallet setup, storage, and action logic.
- Files: `apps/examples/src/examples/wallet/wallet.tsx`, `apps/examples/src/examples/wallet/admin.tsx`, `apps/examples/src/examples/nwc/simple-wallet.tsx`, `apps/examples/src/examples/outbox/social-feed.tsx`, `apps/examples/src/examples/zap/zap-modal.tsx`
- Impact: Example changes are high-friction, regressions are hard to isolate, and patterns copied by users include app-specific globals.
- Fix approach: Split new examples into small local helpers/components under the same example directory and keep the route file focused on wiring and rendering.

**Broad `any` and forced casts in public APIs:**
- Issue: Several public interfaces use `any` or forced casts where protocol-specific generics can preserve types.
- Files: `packages/actions/src/action-runner.ts`, `packages/extra/src/primal.ts`, `packages/signers/src/interop.ts`, `packages/wallet-connect/src/wallet-connect.ts`
- Impact: Callers lose compile-time guarantees around publish results, cache responses, signer interop, and wallet-connect request/response matching.
- Fix approach: Replace `Promise<any>`/`Observable<any>` surfaces with `unknown` or typed generics and isolate unavoidable protocol casts in private helper functions.

## Known Bugs

**Relay selection counter uses post-increment:**
- Symptoms: `maxRelaysPerUser` accounting starts by storing the old count, so the selected relay count can lag behind the actual number of selected relays for a user.
- Files: `packages/core/src/helpers/relay-selection.ts`
- Trigger: Call `selectOptimalRelays(users, { maxConnections, maxRelaysPerUser: 1 })` with a user that has multiple popular relays.
- Workaround: Consumers relying on a strict per-user cap need to slice `pointer.relays` after calling `selectOptimalRelays`.

**Returned relay lists can exceed `maxRelaysPerUser`:**
- Symptoms: Output pointers include all relays that are in the global selection, even when that leaves one user with more relays than `maxRelaysPerUser`.
- Files: `packages/core/src/helpers/relay-selection.ts`
- Trigger: Multiple selected relays overlap the same `ProfilePointer`.
- Workaround: Apply a final per-user cap before using the returned pointers for outbox requests.

**SQLite relay broadcasts newly accepted events twice:**
- Symptoms: A new accepted event is sent by `handleEvent` and again through the `eventStore.insert$` subscription.
- Files: `packages/sqlite/src/relay.ts`
- Trigger: Submit an `EVENT` that matches an active `REQ` subscription.
- Workaround: Subscribers can de-duplicate by event id; the relay implementation should use one broadcast path only.

**Nostr Connect signer leaves completed request entries in memory:**
- Symptoms: `requests` is populated in `makeRequest` and resolved/rejected in `handleEvent`, but completed ids are not removed from the map.
- Files: `packages/signers/src/signers/nostr-connect-signer.ts`
- Trigger: Long-lived `NostrConnectSigner` sessions that make many signing, encryption, or ping requests.
- Workaround: Recreate the signer for long sessions; the implementation should delete `this.requests` entries in a `finally`/completion path and on close.

**Wallet loader relay comparison name is misleading:**
- Symptoms: `sameRelays` compares arrays by index but comments describe order-independent comparison.
- Files: `packages/wallet/src/wallet/loading.ts`
- Trigger: Reusing `sameRelays` outside the current sorted relay pipeline or modifying the upstream normalization.
- Workaround: Keep the `.sort()` step before `distinctUntilChanged` until the comparator is replaced with an order-independent set comparison.

## Security Considerations

**Plain browser storage for wallet bearer material:**
- Risk: Cashu tokens and decrypted wallet content are stored in browser storage without encryption in helper and example code.
- Files: `packages/wallet/src/helpers/local-storage-couch.ts`, `packages/wallet/src/helpers/indexed-db-couch.ts`, `apps/examples/src/examples/wallet/multiple-wallets.tsx`
- Current mitigation: Example comments in `apps/examples/src/examples/wallet/multiple-wallets.tsx` state that real apps should encrypt content at rest.
- Recommendations: Use encrypted storage by default for production wallet helpers, document `LocalStorageCouch`/`IndexedDBCouch` as unsafe for hostile browser contexts, and keep plaintext storage limited to explicit demos.

**Concord key material defaults to `localStorage` when available:**
- Risk: Membership/key material persists in script-accessible storage by default in browser contexts.
- Files: `packages/concord/src/storage.ts`
- Current mitigation: `ConcordKeyStorage` is injectable and `memoryKeyStorage()` is available for non-durable storage.
- Recommendations: Require an explicit storage choice for key material or make the default storage memory-only, with documented encrypted IndexedDB/localForage adapters for durable clients.

**SQLite relay has no connection, subscription, filter, or event-size limits:**
- Risk: A public-facing relay process can be exhausted by large JSON messages, unlimited subscriptions, expensive filters, or many concurrent clients.
- Files: `packages/sqlite/src/relay.ts`
- Current mitigation: Events are verified through `eventStore.verifyEvent = verifyEvent` and invalid protocol frames receive `NOTICE`/`OK` failures.
- Recommendations: Add max message size, max subscriptions per socket, max filters per `REQ`, bounded `limit`, auth/rate-limit hooks, and backpressure-aware send handling before production exposure.

**Example fallback HTML uses direct `innerHTML`:**
- Risk: Fallback UI builds HTML strings containing relay-derived text.
- Files: `apps/examples/src/examples/relay-discovery/monitor-feed.tsx`, `apps/examples/src/examples/relay-discovery/contacts-relays.tsx`
- Current mitigation: The inserted dynamic value is currently `relayUrl.slice(0, 1).toUpperCase()`, which limits the immediate injection surface.
- Recommendations: Replace `innerHTML` fallbacks with React state/conditional rendering so future edits do not accidentally interpolate untrusted relay data.

**QR rendering injects generated SVG markup:**
- Risk: QR SVG markup is inserted with `dangerouslySetInnerHTML`; safety depends on `@libs/qrcode` producing inert SVG for arbitrary input.
- Files: `apps/examples/src/components/qr-code.tsx`
- Current mitigation: The SVG is generated locally from `value` rather than fetched from the network.
- Recommendations: Prefer a React/SVG QR renderer or sanitize generated SVG before insertion if the component is reused outside examples.

## Performance Bottlenecks

**Event pointer consolidation is quadratic per event id:**
- Problem: Relay array merging repeatedly uses `includes` while processing pointers.
- Files: `packages/loaders/src/helpers/event-pointer.ts`
- Cause: Existing relay arrays are scanned for every relay in a duplicate pointer.
- Improvement path: Use the shared relay-set merge helper or a local `Set` when merging large pointer batches, then preserve stable ordering in the returned array.

**Relay selection repeatedly sorts all candidate relays:**
- Problem: `selectOptimalRelays` sorts every remaining relay candidate during each selected connection.
- Files: `packages/core/src/helpers/relay-selection.ts`
- Cause: The loop rebuilds coverage maps and sorts candidates until `maxConnections` is reached.
- Improvement path: Add benchmark coverage for large follow graphs and replace full sorts with a max-heap or top-candidate scan when candidate counts are high.

**SQLite relay scans every subscription on every event:**
- Problem: `broadcastToSubscribers` checks each subscription and each filter for every inserted event.
- Files: `packages/sqlite/src/relay.ts`
- Cause: Subscriptions are stored in a flat `Map<string, Subscription>` without indexes by kind, author, id, or tag.
- Improvement path: Index subscriptions by common filter keys and keep the flat scan only as a fallback for broad filters.

**Search index rebuild loads all events into memory:**
- Problem: Search rebuild APIs fetch every event before inserting search rows.
- Files: `packages/sqlite/src/better-sqlite3/methods.ts`, `packages/sqlite/src/libsql/methods.ts`
- Cause: `GET_ALL_EVENTS_STATEMENT` results are mapped to event objects before iteration.
- Improvement path: Stream or page events during rebuild and report progress for large relay databases.

## Fragile Areas

**Nostr Connect request lifecycle:**
- Files: `packages/signers/src/signers/nostr-connect-signer.ts`, `packages/signers/src/signers/__tests__/nostr-connect-signer.test.ts`
- Why fragile: Request promises depend on relay delivery, remote signer behavior, auth callbacks, and manual map cleanup; errors in decryption/JSON parsing are swallowed.
- Safe modification: Add lifecycle tests for timeout, malformed response, duplicate response, auth callback failure, close while pending, and map cleanup before changing request handling.
- Test coverage: Core signer tests exist, but request cleanup and swallowed parse/decryption failures need explicit assertions.

**Wallet token recovery and couch state transitions:**
- Files: `packages/wallet/src/actions/tokens.ts`, `packages/wallet/src/wallet/nut-wallet.ts`, `packages/wallet/src/wallet/__tests__/nut-wallet.test.ts`, `packages/wallet/src/actions/__tests__/tokens.test.ts`
- Why fragile: Wallet operations coordinate relay-published token events, delete events, local couch recovery, mint quote timeouts, and optional cache restoration.
- Safe modification: Preserve transactional ordering around publish/delete/couch clear operations and add tests for partial failures before changing flows.
- Test coverage: Wallet and token action tests exist; integration coverage with real storage adapters and relay failures is limited.

**SQLite backend parity across implementations:**
- Files: `packages/sqlite/src/better-sqlite3/methods.ts`, `packages/sqlite/src/libsql/methods.ts`, `packages/sqlite/src/native/`, `packages/sqlite/src/turso/`, `packages/sqlite/src/turso-wasm/`
- Why fragile: Similar SQL behavior is implemented across multiple drivers with different transaction, row, and `INSERT OR IGNORE` semantics.
- Safe modification: Add shared conformance tests for every new database behavior and run all backend-specific event database suites.
- Test coverage: Backend tests exist under `packages/sqlite/src/*/__tests__/event-database.test.ts`; server-level behavior in `packages/sqlite/src/relay.ts` is not covered.

**Concord client is large and protocol-dense:**
- Files: `packages/concord/src/client.ts`, `refs/accordian/src/concord/client.ts`, `packages/concord/src/__tests__/client.test.ts`
- Why fragile: Community control, invite, rekey, channel, guestbook, stream, cache, and relay-auth behavior converge in large client modules.
- Safe modification: Keep new protocol behavior in helpers/operations/factories first, then wire through `ConcordClient` with round-trip and relay-auth tests.
- Test coverage: Concord has broad helper/factory/client tests, but the large client file remains a high-risk integration point.

## Scaling Limits

**In-memory event store use in SQLite relay process:**
- Current capacity: Limited by process memory for live `EventStore` state plus SQLite database size.
- Limit: Large relay datasets duplicate state between SQLite and the in-memory store path.
- Scaling path: Route relay queries directly through database-backed interfaces where possible and bound in-memory retention for server mode.

**Wallet loader loads from every configured relay:**
- Current capacity: `loadWalletEvents` opens sync/load and live subscription work against every relay in the normalized relay set.
- Limit: Large wallet relay sets increase network load, duplicate events, and error/status noise.
- Scaling path: Apply relay selection and health filtering before `loadWalletEvents`, and expose concurrency/backoff knobs at the wallet loader boundary.

**Local browser token couch grows without compaction:**
- Current capacity: Browser `localStorage`/IndexedDB quotas and per-origin storage behavior.
- Limit: Recovered or abandoned couch tokens accumulate until explicit clear/remove succeeds.
- Scaling path: Add age/size metadata, compaction, and quota-error handling to `LocalStorageCouch` and `IndexedDBCouch`.

## Dependencies at Risk

**External Primal cache API typing bypass:**
- Risk: `PrimalCache.cacheRequest` uses `@ts-expect-error` and casts the relay request to the expected response observable.
- Impact: API drift in Primal cache responses can reach callers as runtime shape errors.
- Migration plan: Introduce runtime response validators for `packages/extra/src/primal.ts` and add tests under `packages/extra/src/__tests__/` before relying on new Primal methods.

**`packages/extra` has no tests:**
- Risk: Integrations such as Primal and OpenRank are not exercised by the repository test suite.
- Impact: External API wrappers can break silently during dependency or protocol updates.
- Migration plan: Add unit tests with mocked relay/API responses for `packages/extra/src/primal.ts` and `packages/extra/src/open-ranking.ts`.

## Missing Critical Features

**Production relay policy hooks:**
- Problem: The SQLite relay server lacks admission policy, authentication, rate limiting, retention policy, and operational configuration beyond `PORT` and `DATABASE_PATH`.
- Blocks: Safe use as an internet-facing relay service.

**Encrypted production storage adapters for wallet/concord secrets:**
- Problem: The repository exposes plaintext local storage helpers and injectable storage interfaces, but no first-class encrypted browser storage adapter for wallet proofs or Concord key material.
- Blocks: Production apps need to build their own secure persistence before adopting the wallet and Concord flows.

## Test Coverage Gaps

**SQLite relay server behavior:**
- What's not tested: WebSocket protocol handling, duplicate broadcast behavior, subscription cleanup, malformed messages, search-filter live behavior, and shutdown.
- Files: `packages/sqlite/src/relay.ts`
- Risk: Server regressions are missed even though database backend tests pass.
- Priority: High

**Relay selection edge cases:**
- What's not tested: Strict `maxRelaysPerUser`, overlapping relay sets, custom score ties, empty relay arrays, and final output capping.
- Files: `packages/core/src/helpers/relay-selection.ts`
- Risk: Outbox routing can select more relays than consumers expect.
- Priority: Medium

**Common operations with TODOs:**
- What's not tested: Relay hints in wrapped messages, duplicate imeta merging, and `modifyPublicTags` compatibility for reactions/shares.
- Files: `packages/common/src/operations/wrapped-message.ts`, `packages/common/src/operations/media-attachment.ts`, `packages/common/src/operations/reaction.ts`, `packages/common/src/operations/share.ts`
- Risk: NIP-specific event builders drift from expected tag semantics.
- Priority: Medium

**Browser storage adapters:**
- What's not tested: Quota failures, corrupted JSON/token entries, concurrent stores/removes, unavailable storage APIs, and cleanup callbacks.
- Files: `packages/wallet/src/helpers/local-storage-couch.ts`, `packages/wallet/src/helpers/indexed-db-couch.ts`, `packages/concord/src/storage.ts`
- Risk: Wallet recovery and key persistence can fail silently in real browsers.
- Priority: Medium

---

*Concerns audit: 2026-07-08*
