# Phase 26 Release Changeset Audit

## Method and result

The source inventory is the current 74 tracked release-note files returned in byte order by `git ls-files '.changeset/*.md'` with `README.md` excluded. Existing IDs remain stable for surviving notes; CS-009 follows its first focused replacement, CS-074 identifies the second replacement, and CS-075 is the post-verification wallet remediation. Every row was reviewed separately for package/bump, exact body, Markdown line shape, `Intl.Segmenter("en", { granularity: "sentence" })` count, and whether the sentence describes one shipped change supported by the cited evidence. Parser success is only mechanical evidence; the Semantic column records the separate provenance-backed judgment required by REL-04.

The 73 pre-gap judgments remain the exact semantic-review subset established before verification. The current inventory has 74 notes after adding CS-075 for the wallet root fix. The human accepted all 74 row-specific semantic judgments under the exact inventory recorded in [`26-SEMANTIC-ACCEPTANCE.md`](./26-SEMANTIC-ACCEPTANCE.md); that artifact binds the accepted IDs, paths, package bumps, bodies, and provenance to schema `phase26-semantic-inventory/v1` and digest `sha256:bed7a41516fc2fe7f6ca623a7afc54e009ebdb049ff7f5b5845b16f774c7baf2`.

An “implementation commit + input path” citation means the immutable `git show <commit> -- <changeset> <sibling source/test paths>` diff contains both the exact release metadata and its implementation; consolidation citations additionally follow predecessor-note history to current named test families. Summary citations below are only used where that exact summary names the audited note or the exact behavior, never as generic phase-theme evidence.

| ID | Input path | Package + bump | Exact final body | Line | Sentence | Semantic | Provenance | Held | Disposition / final path |
|---|---|---|---|---|---|---|---|---|---|
| CS-001 | `.changeset/add-is-valid-seal.md` | `applesauce-common: minor` | Add `isValidSeal`, a type guard that checks an event is a NIP-59 seal with a valid id and signature. | PASS | 1 | PASS | `422ce62b` implementation commit + input path | — | RETAIN |
| CS-002 | `.changeset/android-native-account-restore-fields.md` | `applesauce-accounts: patch` | Restore the persisted `id` and metadata of `AndroidNativeAccount` when rehydrating from JSON. | PASS | 1 | PASS | `44416390` implementation commit + input path | — | RETAIN |
| CS-003 | `.changeset/android-native-signer-seed-pubkey.md` | `applesauce-signers: patch`<br>`applesauce-accounts: patch` | Seed `AndroidNativeSigner` with the persisted pubkey so relaunching an app does not re-prompt the signer app for `getPublicKey`. | PASS | 1 | PASS | `44416390` implementation commit + input path | — | RETAIN |
| CS-004 | `.changeset/auth-retry-error-channel.md` | `applesauce-relay: patch` | Prevent relay operations from starting a second authentication phase after an authentication retry has already failed. | PASS | 1 | PASS | `d4165276` consumer-facing revision; `db7ed4a7` implementation commit + input path | — | REVISE — consumer-visible failure behavior |
| CS-005 | `.changeset/brave-ids-batch.md` | `applesauce-relay: minor` | Batch sync requests for missing events into REQs of up to 500 ids, configurable with `batchSize` | PASS | 1 | PASS | `e4d5977c` implementation commit + input path | — | RETAIN |
| CS-006 | `.changeset/cache-write-frozen-throws.md` | `applesauce-core: minor` | Writing a cached value onto a frozen event now throws instead of failing silently. | PASS | 1 | PASS | `bfe32678` consolidation + predecessor note history and current cache tests | — | RETAIN |
| CS-007 | `.changeset/cache-writes-hidden-from-spread.md` | `applesauce-core: patch` | Cached values are no longer copied by an object spread, so a duplicated event can no longer carry a stale cached value forward. | PASS | 1 | PASS | `bfe32678` consolidation + predecessor note history and current cache tests | — | RETAIN |
| CS-008 | `.changeset/chat-message-factory.md` | `applesauce-common: minor` | Add a NIP-C7 chat message factory for building kind 9 chat messages and their replies. | PASS | 1 | PASS | `696b860a` implementation commit + input path | — | RETAIN |
| CS-009 | `.changeset/clamp-expiration-timer-delay.md` | `applesauce-core: patch` | Clamp NIP-40 expiration timer delays to Node's 32-bit limit so far-future events do not trigger a `TimeoutOverflowWarning` hot loop. | PASS | 1 | PASS | `.planning/quick/260805-ds0-clamp-expirationmanager-settimeout-delay/260805-ds0-SUMMARY.md` and current core timer tests | — | RETAIN — focused replacement for the historical combined timer note |
| CS-010 | `.changeset/comment-parent-rumor.md` | `applesauce-common: minor` | Support NIP-59 rumors as the parent of a NIP-22 comment. | PASS | 1 | PASS | `557a8c17` implementation commit + input path | — | RETAIN |
| CS-011 | `.changeset/common-falsy-app-data.md` | `applesauce-common: patch` | Preserve valid falsy JSON values when parsing application data. | PASS | 1 | PASS | `.planning/phases/25-ecosystem-riders-react-19-snort-worker-relay-v2/25-04-SUMMARY.md` | — | RETAIN |
| CS-012 | `.changeset/copy-symbols-guards.md` | `applesauce-core: patch` | Decrypted content and signature verification results are no longer copied onto a different version of a replaceable event. | PASS | 1 | PASS | `bfe32678` consolidation + predecessor note history and current symbol tests | — | RETAIN |
| CS-014 | `.changeset/forum-thread-nip7d.md` | `applesauce-common: minor` | Add NIP-7D forum thread support with a thread factory, cast, helpers, and a title operation. | PASS | 1 | PASS | `560e193d` implementation commit + input path | — | RETAIN |
| CS-015 | `.changeset/generic-common-helpers.md` | `applesauce-common: minor` | The NIP-10 reference, reaction emoji, hashtag, and content warning helpers now accept unsigned rumors as well as signed events. | PASS | 1 | PASS | `bfe32678` consolidation + v1.0 implementation history | — | RETAIN |
| CS-016 | `.changeset/generic-event-stores.md` | `applesauce-core: minor` | Event stores, models, casts, and helpers are now generic over the event type, so they can hold unsigned rumors as well as signed events. | PASS | 1 | PASS | `bfe32678` consolidation + v1.0 implementation history | — | RETAIN |
| CS-017 | `.changeset/gift-wrap-symbols-to-core.md` | `applesauce-core: patch`<br>`applesauce-common: patch` | Move the gift wrap, seal, and rumor symbols into `applesauce-core` and re-export them from `applesauce-common`. | PASS | 1 | PASS | `.planning/milestones/v1.1-phases/05.1-symbol-propagation-redesign/05.1-01-SUMMARY.md` | — | RETAIN |
| CS-018 | `.changeset/group-pointer-lossless-roundtrip.md` | `applesauce-common: patch` | Preserve complete normalized relay endpoints when group pointers round-trip through compatibility strings. | PASS | 1 | PASS | `82fe2739` implementation/test commit + input path | — | RETAIN |
| CS-019 | `.changeset/hidden-content-unlock-guards.md` | `applesauce-common: patch` | The hidden-content unlock guards now report unlocked only after the hidden values are decrypted, so the matching unlock helpers no longer resolve undefined. | PASS | 1 | PASS | `bfe32678` consolidation + current hidden-content guard tests | — | REWRITE → same path (removed `is...Unlocked` parser ambiguity) |
| CS-020 | `.changeset/hidden-tags-undefined-not-throw.md` | `applesauce-core: minor` | `getHiddenTags` now returns undefined when the hidden content is not valid tags instead of throwing. | PASS | 1 | PASS | `.planning/quick/260804-g0c-undefined-over-throw/260804-g0c-SUMMARY.md` | — | RETAIN |
| CS-021 | `.changeset/loaders-sync-fallback-auth.md` | `applesauce-loaders: patch` | Resume timeout tracking before a sync loader falls back to paginated requests so the fallback cannot hang indefinitely. | PASS | 1 | PASS | `d4165276` consumer-facing revision; `.planning/phases/24-negentropy-sync-re-layer/24-10-SUMMARY.md` | — | REVISE — consumer-visible timeout behavior |
| CS-022 | `.changeset/lock-app-data-clears-plaintext.md` | `applesauce-common: patch` | `lockAppData` now clears the decrypted content so `getAppDataContent` returns undefined after locking. | PASS | 1 | PASS | `.planning/milestones/v1.1-phases/05.1-symbol-propagation-redesign/05.1-05-SUMMARY.md` | — | RETAIN |
| CS-023 | `.changeset/logger-colors.md` | `applesauce-core: minor` | Add colored logger output with a stable per-namespace color and a `+Nms` time diff | PASS | 1 | PASS | `a4c6cd50` implementation commit + input path | — | RETAIN |
| CS-024 | `.changeset/logger-sink-record.md` | `applesauce-core: minor` | Pass a structured `LogRecord` as a second argument to logger sinks | PASS | 1 | PASS | `a4c6cd50` implementation commit + input path | — | RETAIN |
| CS-025 | `.changeset/lucky-pans-shave.md` | `applesauce-relay: patch` | Reconnect negentropy sync when a RECEIVE transfer fails with a transport error instead of failing the whole sync | PASS | 1 | PASS | `e4d5977c` implementation commit + input path | — | RETAIN |
| CS-026 | `.changeset/multi-user-authentication.md` | `applesauce-relay: minor` | Add support for authenticating multiple users on a single relay connection with `authentications$`, `authenticatedPubkeys$`, and `isAuthenticated` | PASS | 1 | PASS | `18997319` implementation commit + input path | — | RETAIN |
| CS-027 | `.changeset/pubkey-casts-store-cache.md` | `applesauce-core: patch` | Pubkey casts are now cached per event store so the same pubkey can be cast independently across multiple stores. | PASS | 1 | PASS | `e17c1f8a` implementation commit + input path | — | RETAIN |
| CS-028 | `.changeset/reaction-parent.md` | `applesauce-common: minor` | `setReactionParent` and `ReactionFactory` now accept a lightweight `{ id, pubkey, kind }` pointer or a rumor in addition to a full signed event. | PASS | 1 | PASS | `bfe32678` consolidation + predecessor note history and current reaction tests | — | RETAIN |
| CS-029 | `.changeset/relay-auth-family-re-layer.md` | `applesauce-relay: major` | Remove the public EVENT/AUTH selector and make authenticate own bounded challenge acquisition and freshness. | PASS | 1 | PASS | `.planning/phases/20-auth-family-re-layer/20-04-SUMMARY.md` | — | RETAIN |
| CS-030 | `.changeset/relay-auth-handler-sync-throw-mapped.md` | `applesauce-relay: patch` | A synchronously-throwing `onAuthRequired` handler now maps to `AuthHandlerError` identically to a rejected promise, instead of escaping as a raw, unmapped `Error`. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-031 | `.changeset/relay-auth-lifecycle-debug-logging.md` | `applesauce-relay: patch` | NIP-42 auth activity is now logged to a dedicated `:auth` sub-namespace covering the challenge, signing, send, result, and per-operation retry lifecycle. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/14-auth-lifecycle-debug-logging/14-07-SUMMARY.md` | — | RETAIN |
| CS-032 | `.changeset/relay-auth-log-namespace-order.md` | `applesauce-relay: patch` | Move the relay auth debug namespace from `applesauce:Relay:<url>:auth` to `applesauce:Relay:auth:<url>` so `applesauce:Relay:auth:*` filters every relay's auth trace at once. | PASS | 1 | PASS | `e876bc3f` implementation commit + input path | — | RETAIN |
| CS-033 | `.changeset/relay-auth-resend-req-count-observed.md` | `applesauce-relay: patch` | A synchronous `onAuthRequired` handler resolving `req()` or `count()`'s auth phase now sends a real resend frame and observes its reply, instead of silently rejoining an already-terminated listen chain and completing with no results. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-034 | `.changeset/relay-auth-retry-bound-not-reset-by-req-open.md` | `applesauce-relay: patch` | `req()`, `request()`, and `subscription()` auth-required retries are now correctly bounded by `authRetries` instead of being silently reset by the synthetic `OPEN` message emitted on every resubscribe. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-035 | `.changeset/relay-auth-timeout-bounded-wait.md` | `applesauce-relay: minor` | An operation that previously waited indefinitely against an auth-required relay now fails with a timeout after 30 seconds by default, since `waitForAuth` no longer pre-blocks the operation on the relay-wide auth-required flags and the wait is instead bounded by the new `authTimeout` option — pass `authTimeout: false` to restore the previous indefinite wait for out-of-band authentication. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-07-SUMMARY.md` | — | RETAIN |
| CS-036 | `.changeset/relay-auth-wire-request-context.md` | `applesauce-relay: minor` | The auth-required handler context now carries the exact NIP-01/NIP-77 request that triggered it, discriminated by wire verb (`REQ`/`COUNT`/`EVENT`/`NEG-OPEN`), replacing the previous read/publish/sync category. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/14-auth-lifecycle-debug-logging/14-07-SUMMARY.md` | — | RETAIN |
| CS-037 | `.changeset/relay-closed-prefix-safety.md` | `applesauce-relay: patch` | Treat unrecognized `CLOSED` prefixes that match JavaScript prototype properties as ordinary relay closures instead of invalid errors. | PASS | 1 | PASS | `d4165276` consumer-facing revision; `25909a1d` implementation commit + input path | — | REVISE — consumer-visible closure classification |
| CS-038 | `.changeset/relay-count-nip45.md` | `applesauce-relay: minor` | Make `COUNT` a validated high-level Observable with configurable policy and NIP-45 HLL utilities. | PASS | 1 | PASS | `.planning/phases/19-count-becomes-the-high-level-member/19-03-SUMMARY.md` | — | RETAIN |
| CS-039 | `.changeset/relay-event-publish-layering.md` | `applesauce-relay: major` | Make `event` a one-attempt raw interaction and move authentication, retry, reconnect, and timeout policy to publish. | PASS | 1 | PASS | `.planning/phases/18-event-family-re-layer/18-05-SUMMARY.md` | — | RETAIN |
| CS-040 | `.changeset/relay-group-count-progressive.md` | `applesauce-relay: major` | Make Group and Pool COUNT emit progressive per-relay success and failure outcomes. | PASS | 1 | PASS | `.planning/phases/23-group-count-isolation/23-VERIFICATION.md` | — | RETAIN |
| CS-041 | `.changeset/relay-group-error-surface.md` | `applesauce-relay: major` | Make high-level group requests and subscriptions report total relay failure with every relay cause preserved. | PASS | 1 | PASS | `.planning/phases/21-group-error-surface-request-subscription/21-04-SUMMARY.md` | — | RETAIN |
| CS-042 | `.changeset/relay-group-logger-routing.md` | `applesauce-relay: patch` | `RelayGroup` now routes its debug diagnostics through the package's shared debug logger instead of writing directly to the console, so a consumer can silence them like every other class in the package. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-043 | `.changeset/relay-group-request-error-not-progress.md` | `applesauce-relay: patch` | `RelayGroup.request()`'s operation clock no longer treats a relay's connection error as progress, so a group whose relays all fail or fall silent now errors on its declared timeout instead of hanging forever. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-14-SUMMARY.md` | — | RETAIN |
| CS-044 | `.changeset/relay-group-request-timeout-suspended.md` | `applesauce-relay: patch` | `RelayGroup.request()`'s operation timeout is now suspended for the duration of a relay's auth phase instead of racing it. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-045 | `.changeset/relay-group-sync-per-relay-isolation.md` | `applesauce-relay: minor` | Emit an attributed `relay-failed` result when one relay fails without ending sibling sync operations. | PASS | 1 | PASS | `.planning/phases/24-negentropy-sync-re-layer/24-10-SUMMARY.md` | — | RETAIN |
| CS-046 | `.changeset/relay-negentropy-rounds.md` | `applesauce-relay: major` | Replace callback-based negentropy with a raw Observable of negotiation rounds. | PASS | 1 | PASS | `.planning/phases/24-negentropy-sync-re-layer/24-10-SUMMARY.md` | — | RETAIN |
| CS-047 | `.changeset/relay-operation-scoped-auth-callbacks.md` | `applesauce-relay: minor` | Move operation-scoped authentication callbacks to publish, request, count, and sync. | PASS | 1 | BEHAVIOR PASS | `.planning/phases/18-event-family-re-layer/18-05-SUMMARY.md`; `packages/relay/src/types.ts`; `packages/relay/src/relay.ts`; `packages/relay/src/__tests__/relay.test.ts`; 16 files / 418 tests PASS | HELD v1.2 | RETAIN — current release-tree behavior proven |
| CS-048 | `.changeset/relay-publish-response-error-field.md` | `applesauce-relay: minor` | Attach typed errors to relay rejection verdicts and RelayGroup-converted failures. | PASS | 1 | PASS | `.planning/phases/18-event-family-re-layer/18-05-SUMMARY.md` | — | RETAIN |
| CS-049 | `.changeset/relay-publish-timeout-marks-itself.md` | `applesauce-relay: patch` | Reject publish calls when their client-side timeout expires. | PASS | 1 | PASS | `.planning/phases/18-event-family-re-layer/18-05-SUMMARY.md` | — | RETAIN |
| CS-050 | `.changeset/relay-quiet-empty-auth-invalidation.md` | `applesauce-relay: patch` | Stop logging the auth invalidation line on reset when no authenticated pubkeys were dropped. | PASS | 1 | PASS | `0420f75a` implementation commit + input path | — | RETAIN |
| CS-051 | `.changeset/relay-req-family-re-layer.md` | `applesauce-relay: major` | Make req a one-interaction raw REQ primitive and move authentication, reconnect, and repeat policy to request and subscription. | PASS | 1 | PASS | `89a39898` plus Phase 22 release-metadata history | — | RETAIN |
| CS-052 | `.changeset/relay-request-timeout-can-fire.md` | `applesauce-relay: patch` | `request()`'s own operation timeout can now actually fire against an unresponsive relay, instead of being permanently cancelled by the synthetic `OPEN` message it previously treated as first progress. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-053 | `.changeset/relay-sync-outcomes.md` | `applesauce-relay: major` | Make sync own coordinated authentication, reconnect, bounded transfers, and explicit transfer outcomes. | PASS | 1 | PASS | `.planning/phases/24-negentropy-sync-re-layer/24-10-SUMMARY.md` | — | RETAIN |
| CS-054 | `.changeset/remove-event-factory-kind.md` | `applesauce-core: patch` | Remove the unused `EventFactory.kind()` method, whose returned promise never resolved. | PASS | 1 | PASS | `e829d0a3` implementation commit + input path | — | RETAIN |
| CS-055 | `.changeset/rumor-stores.md` | `applesauce-core: minor` | Add `RumorStore` and `AsyncRumorStore` for storing NIP-59 rumors, verifying each one by recomputing its event hash. | PASS | 1 | PASS | `bfe32678` consolidation + v1.0 implementation history | — | RETAIN |
| CS-056 | `.changeset/rumor-type-and-helpers.md` | `applesauce-core: minor` | Add a shared `Rumor` type for unsigned events along with `isRumor` and `verifyRumor` helpers. | PASS | 1 | PASS | `bfe32678` consolidation + v1.0 implementation history | — | RETAIN |
| CS-057 | `.changeset/seal-parse-failures-return-undefined.md` | `applesauce-common: minor` | Reading a malformed gift wrap seal now returns undefined instead of throwing or permanently caching the failure. | PASS | 1 | PASS | `bfe32678` consolidation + current seal parsing tests | — | RETAIN |
| CS-058 | `.changeset/shaggy-clowns-smile.md` | `applesauce-relay: minor` | Add `RelayPool.added$` and `RelayPool.removed$` aliases | PASS | 1 | PASS | `165a27ba` implementation commit + input path | — | RETAIN |
| CS-059 | `.changeset/sqlite-optional-backends.md` | `applesauce-sqlite: patch` | Mark every supported SQLite backend peer as optional for consumer installs. | PASS | 1 | PASS | `f961e73b` implementation/release commit + input path | — | RETAIN |
| CS-060 | `.changeset/stamp-no-caller-mutation.md` | `applesauce-core: patch` | `stamp()` no longer removes `id` and `sig` from the draft that was passed into it. | PASS | 1 | PASS | `.planning/milestones/v1.1-phases/05.1-symbol-propagation-redesign/05.1-03-SUMMARY.md` | — | RETAIN |
| CS-061 | `.changeset/sync-loader-auth-hooks.md` | `applesauce-loaders: minor` | Make high-level sync own authentication hooks while the sync loader preserves them across its paginated fallback. | PASS | 1 | BEHAVIOR PASS | `.planning/phases/24-negentropy-sync-re-layer/24-10-SUMMARY.md`; `packages/loaders/src/loaders/sync-loader.ts`; `packages/loaders/src/loaders/__tests__/sync-loader.test.ts`; 16 files / 130 tests PASS | HELD v1.2 | RETAIN — current release-tree behavior proven |
| CS-062 | `.changeset/sync-loader-auth-phase-timer-leak-fixed.md` | `applesauce-loaders: patch` | `SyncLoader` no longer leaves an auth-phase timer pending after a load is torn down or after a handler settles once its auth phase was already force-closed. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-063 | `.changeset/sync-loader-handlerless-stall-suspension.md` | `applesauce-loaders: patch` | `SyncLoader`'s stall guard is now suspended for the full duration of a relay's auth phase even when the caller supplies no `onAuthRequired` handler. | PASS | 1 | PASS | `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-12-SUMMARY.md` | — | RETAIN |
| CS-064 | `.changeset/sync-loader-wait-for-auth.md` | `applesauce-loaders: minor` | Add `waitForAuth` support to the sync loader so auth-required relays wait for NIP-42 authentication and retry. | PASS | 1 | PASS | `98875b1f` implementation commit + input path | — | RETAIN |
| CS-065 | `.changeset/tall-months-invite.md` | `applesauce-relay: major` | Remove the deprecated `RelayPool.ignoreOffline` property and the `ignoreOffline` argument of `RelayPool.group()` in favor of the `ignoreUnhealthyRelays` operator | PASS | 1 | PASS | `.planning/quick/260907-g46-remove-deprecated-relaypool-ignoreofflin/260907-g46-SUMMARY.md` | — | RETAIN |
| CS-066 | `.changeset/tricky-pots-teach.md` | `applesauce-core: patch` | Import from `nostr-tools` subpaths instead of the package root so bundles no longer pull in modules that reference `fetch` | PASS | 1 | PASS | `4f2c1bbe` implementation commit + input path | — | RETAIN |
| CS-067 | `.changeset/verify-event-undefined-fix.md` | `applesauce-core: patch` | Event stores now honor `verifyEvent: undefined` to disable event verification. | PASS | 1 | PASS | `.planning/milestones/v1.0-phases/01-generic-store-foundation/01-04-SUMMARY.md` | — | RETAIN |
| CS-068 | `.changeset/verify-gift-wrap-seal-signatures.md` | `applesauce-common: patch` | Gift wrap seals are now signature verified before they are trusted, so a seal with an invalid signature is no longer accepted as proof of authorship. | PASS | 1 | PASS | `422ce62b` implementation commit + input path | — | RETAIN |
| CS-069 | `.changeset/wait-for-auth-pubkeys.md` | `applesauce-relay: minor` | Add `waitForAuth` support to publish, request, count, and sync. | PASS | 1 | PASS | `.planning/phases/18-event-family-re-layer/18-05-SUMMARY.md` | — | RETAIN |
| CS-074 | `.changeset/wait-for-paid-timer-fixes.md` | `applesauce-wallet-connect: patch` | Fix `waitForPaid()` timer handling so invoices without an expiry do not reject immediately and far-future expiry delays stay within Node's 32-bit limit. | PASS | 1 | PASS | `.planning/quick/260805-ds0-clamp-expirationmanager-settimeout-delay/260805-ds0-SUMMARY.md` and current wallet-connect timer tests | — | RETAIN — focused replacement for the historical combined timer note |
| CS-070 | `.changeset/wallet-getters-return-undefined.md` | `applesauce-wallet: minor` | The token content, history content, and nutzap P2PK getters now return undefined on malformed input instead of throwing. | PASS | 1 | PASS | `bfe32678` consolidation + predecessor note history and current wallet tests | — | RETAIN |
| CS-071 | `.changeset/wallet-lock-relays.md` | `applesauce-wallet: patch` | Clear cached relay metadata when locking a wallet. | PASS | 1 | PASS | `.planning/phases/25-ecosystem-riders-react-19-snort-worker-relay-v2/25-04-SUMMARY.md` | — | RETAIN |
| CS-072 | `.changeset/wallet-notification-safe-parse.md` | `applesauce-wallet-connect: patch` | `getWalletNotification` now returns undefined when the notification content is not valid JSON instead of throwing. | PASS | 1 | PASS | `.planning/quick/260804-g0c-undefined-over-throw/260804-g0c-SUMMARY.md` | — | RETAIN |
| CS-073 | `.changeset/wide-donkeys-smile.md` | `applesauce-relay: minor` | Accept synchronous event stores in `NegentropyWriteStore` so a store written to during sync is typed as writeable | PASS | 1 | PASS | `e4d5977c` implementation commit + input path | — | RETAIN |
| CS-075 | `.changeset/wallet-node-root-import.md` | `applesauce-wallet: patch` | Allow the package root to load in supported Node runtimes without eagerly evaluating the animated QR dependency. | PASS | 1 | HUMAN ACCEPTED | Plan 26-13 packed-root Node evidence and focused animated-QR regressions | — | POST-VERIFICATION REMEDIATION — accepted in Plan 26-14 |

## Final-path accounting

The current pending inventory contains exactly 74 paths and has a one-to-one mapping to the 74 rows above: the exact 73 pre-gap judgments plus CS-075 as post-verification remediation. Human semantic acceptance covers this exact inventory and no other; line and sentence parser PASS results remain mechanical evidence only. The removed `.changeset/clamp-timer-delays.md` and `.changeset/core-stamp-comment.md` paths are historical dispositions only: the former was split into CS-009 and CS-074, while the latter was removed because a source-comment-only correction is not a consumer release change.

## Final package result

The current preserved-history oracle is `pnpm exec changeset status --verbose --since=master --output=/tmp/opencode/phase26-10-status.json`. Its non-`none` release-name set is exactly the thirteen configured publishable packages, every computed version is `7.0.0`, and classification is derived only from whether the live `changesets` array is nonempty. No no-op release note was added.

| Package | Version | Final classification | Exact changesets array |
|---|---|---|---|
| applesauce-accounts | 7.0.0 | downstream dependency cascade | `[]` |
| applesauce-actions | 7.0.0 | downstream dependency cascade | `[]` |
| applesauce-common | 7.0.0 | direct | `["common-falsy-app-data","group-pointer-lossless-roundtrip","hidden-content-unlock-guards"]` |
| applesauce-content | 7.0.0 | downstream dependency cascade | `[]` |
| applesauce-core | 7.0.0 | direct | `["clamp-expiration-timer-delay","logger-colors","logger-sink-record"]` |
| applesauce-extra | 7.0.0 | downstream dependency cascade | `[]` |
| applesauce-loaders | 7.0.0 | direct | `["loaders-sync-fallback-auth","sync-loader-auth-hooks"]` |
| applesauce-react | 7.0.0 | downstream dependency cascade | `[]` |
| applesauce-relay | 7.0.0 | direct | `["auth-retry-error-channel","brave-ids-batch","lucky-pans-shave","relay-auth-family-re-layer","relay-auth-lifecycle-debug-logging","relay-auth-log-namespace-order","relay-auth-wire-request-context","relay-closed-prefix-safety","relay-count-nip45","relay-event-publish-layering","relay-group-count-progressive","relay-group-error-surface","relay-group-sync-per-relay-isolation","relay-negentropy-rounds","relay-operation-scoped-auth-callbacks","relay-publish-response-error-field","relay-publish-timeout-marks-itself","relay-quiet-empty-auth-invalidation","relay-req-family-re-layer","relay-sync-outcomes","shaggy-clowns-smile","tall-months-invite","wait-for-auth-pubkeys","wide-donkeys-smile"]` |
| applesauce-signers | 7.0.0 | downstream dependency cascade | `[]` |
| applesauce-sqlite | 7.0.0 | direct | `["sqlite-optional-backends"]` |
| applesauce-wallet | 7.0.0 | direct | `["wallet-lock-relays","wallet-node-root-import"]` |
| applesauce-wallet-connect | 7.0.0 | direct | `["wait-for-paid-timer-fixes"]` |

## Observable truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Every current pending note is represented exactly once, has valid frontmatter, one nonempty Markdown body line, one segmented sentence, and an explicitly accepted semantic judgment. | PASS | The fixed ten-column matrix is bijective with `git ls-files '.changeset/*.md'`; the dependency-free Node gate passes all 74 files, while the distinct human judgment is bound to the exact inventory by `26-SEMANTIC-ACCEPTANCE.md`. |
| 2 | The current release graph contains exactly the configured thirteen publishable packages at `7.0.0`, independent of Changesets output order. | PASS | `/tmp/opencode/phase26-10-status.json` passes exact-name set equality and per-row version checks. |
| 3 | The two held v1.2 notes remain direct inputs to the current release result. | PASS | The status JSON arrays contain `relay-operation-scoped-auth-callbacks` and `sync-loader-auth-hooks`; Task 2 records current behavior evidence. |
| 4 | Preserved history governs the release path and the obsolete squash candidate is not an oracle. | PASS | The captured release base equals local `next`; the isolated executor branch adds only this plan's commits while `next` stays unchanged. Local `master` equals `origin/master`, `master` is an ancestor of `next`, and no squash/CAS evidence remains in this audit. |

## Artifact and link evidence

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.changeset/*.md` | Current consumer release-note population | PASS | 74 tracked pending notes, excluding README, each represented once above; all 74 semantic judgments are human accepted under the digest-bound inventory. |
| `26-SEMANTIC-ACCEPTANCE.md` | Durable human semantic judgment | PASS | Records the exact bounded response, all accepted IDs and paths, the 73 pre-gap subset, CS-075, audit content identity, canonical digest, and invalidation rule. |
| `/tmp/opencode/phase26-10-status.json` | Installed Changesets release projection | PASS | Exact thirteen-package set; every non-`none` release computes `7.0.0`. |
| `/tmp/opencode/phase26-10-baseline.json` | Schema-v1 checkout/ref/content baseline | PASS | Captured before the audit edit and reserved for Task 2 restoration proof. |

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Current changeset inventory | Changeset audit matrix | Fixed column-two path parser and bijection | WIRED | Duplicate IDs/paths, missing paths, extra paths, and malformed rows fail closed. |
| Current Changesets JSON | Final package result | Exact name-set/version checks and live `changesets` arrays | WIRED | Empty arrays classify real dependency cascades; no synthetic note forces inclusion. |
| Historical implementation evidence | Current semantic claims | Row-specific commits, summaries, source, and tests | WIRED | Mechanical sentence success is never used as semantic proof. |
| Human semantic acceptance | Exact 74-row inventory | `phase26-semantic-inventory/v1` digest and bounded response | WIRED | Any ID/path/package+bump/body/provenance change invalidates acceptance. |

## Command evidence

All release-audit commands returned status 0:

- `git ls-files --error-unmatch` for every existing Task 1 read path.
- Canonical release-boundary checks: the captured worktree base equals `next`; local `master` equals `origin/master`; `master` is an ancestor of `next`; later HEAD movement is confined to required commits on `worktree-agent-p10`.
- `pnpm exec changeset status --verbose --since=master --output=/tmp/opencode/phase26-10-status.json`.
- Current-note ten-column schema, path-bijection, frontmatter, line, sentence, semantic, exact-package-set, and `7.0.0` assertions.
- `pnpm build` — 17/17 workspace build targets passed after the clean install populated dependencies.
- `pnpm --filter applesauce-relay test` — 16 files and 418 tests passed.
- `pnpm --filter applesauce-loaders test` — 16 files and 130 tests passed.

No versioning, changelog mutation, publication, push, tag creation, hosted release, branch rewrite, or snapshot mutation ran.

## Held v1.2 notes

- **CS-047 — `relay-operation-scoped-auth-callbacks.md` (HELD v1.2, BEHAVIOR PASS):** The current status JSON contains the held ID. `RelayAuthOptions` in `packages/relay/src/types.ts` declares `waitForAuth`, `onAuthRequired`, `authTimeout`, and `authRetries`; `packages/relay/src/relay.ts` makes high-level `publish()`, `request()`, `count()`, and `sync()` own or thread those options. `packages/relay/src/__tests__/relay.test.ts` exercises those operation-scoped paths. `pnpm --filter applesauce-relay test` passed 16 files and 418 tests.
- **CS-061 — `sync-loader-auth-hooks.md` (HELD v1.2, BEHAVIOR PASS):** The current status JSON contains the held ID. `packages/loaders/src/loaders/sync-loader.ts` constructs `methodOptions` once, derives one per-relay options object, and passes that same object to direct sync and the paginated fallback. `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` asserts direct sync, direct request, and reference-identical fallback reuse. `pnpm --filter applesauce-loaders test` passed 16 files and 130 tests.

## Checkout restoration

| Check | Status | Evidence |
|---|---|---|
| PHASE26-10 RESTORATION PASS | PASS | Schema-v1 baseline SHA-256 `936eb0fb8da68ad398a1b271e2c545d0412695dfec6eca855381a43fee41edea`; protected refs/tags, `next`, `master`, `origin/master`, lock/config/changeset hashes, and non-audit porcelain records remained unchanged. The isolated `worktree-agent-p10` ref advanced only through this plan's required atomic task commit. |
| Developer state | PASS | The baseline had no dirty paths; `.planning/STATE.md` remained clean, byte-identical to the index, and unstaged. |

## Plan 26-11 immutable next snapshot evidence

### Observable truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | NEXT SNAPSHOT GATE PASS | PASS | Detached worktree `/tmp/opencode/phase26-11-worktree` pinned source `750fec4e93290e644aa838425a9dfcf20a0c82f1` and tree `59ef11ef9b1fb1c69895f3ce703c485d0cccac11`; the frozen full gate and isolated verify-only snapshot command returned status 0. |
| 2 | 13 snapshot packages share one timestamped version | PASS | All thirteen non-private linked manifests resolve to `0.0.0-next-20260924153023`; the exact names are recorded below. |
| 3 | CONFIG RESTORATION PASS | PASS | `.changeset/config.json` returned to SHA-256 `0a89968a98d8596451710c1f206e3ee54de3a10d13debcea0f9c9ca8122c99f6`, exactly matching the pinned source and checkout baseline. |
| 4 | Every pending release note remains available | PASS | All 73 tracked changeset paths and SHA-256 values match the baseline after restoring the snapshot versioner's disposable deletions from pinned `HEAD`; local `next` was never mutated. |
| 5 | NO PUBLICATION | PASS | `scripts/snapshot-release.mjs` ran with `--verify-only`; its publish loop and OTP/registry publication path were not entered, and no tag, push, release, or ref mutation command ran. |

### Snapshot package set

| Package | Snapshot version | Status |
|---|---|---|
| `applesauce-accounts` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-actions` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-common` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-content` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-core` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-extra` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-loaders` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-react` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-relay` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-signers` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-sqlite` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-wallet-connect` | `0.0.0-next-20260924153023` | PASS |
| `applesauce-wallet` | `0.0.0-next-20260924153023` | PASS |

### Artifact and link evidence

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `/tmp/opencode/phase26-11-baseline.json` | Schema-v1 checkout/ref/content baseline | PASS | SHA-256 `cac2a6076cb879fe390509421041e9c73f21ee47939daf23178e592fe49c930a`; records the dedicated executor checkout at the exact `next` OID, every ref/tag OID, porcelain-v2 bytes, lock/config hashes, and 73 changeset hashes. |
| `/tmp/opencode/phase26-11-worktree.json` | Schema-v1 disposable identity | PASS | SHA-256 `bcc1693acd235a923d1db7c7a91ae6c880f60eee5139ee62777778a509f56e76`; records the detached path, administrative gitdir, pinned source/tree, tarball path, and consumer path. |
| Snapshot-versioned manifests | One coherent prerelease set | PASS | Exact thirteen-name equality against `.changeset/config.json`; one version matching `0.0.0-next-YYYYMMDDHHMMSS`. |

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `refs/heads/next` | Snapshot-versioned package manifests | Detached worktree plus `APPLESAUCE_SNAPSHOT_WORKTREE=1` | WIRED | The source OID/tree were resolved before worktree creation; snapshot mutation remained disposable. |
| Pending changesets | Stable release flow | Path/hash equality against schema-v1 baseline | WIRED | Versioning's disposable deletions were restored from pinned `HEAD`; no note changed or disappeared from `next`. |
| Snapshot manifests | Isolated consumer probe | Thirteen local tarballs | PENDING TASK 2 | Task 2 owns pack, install, import, removal, and restoration proof. |

### Command evidence

All commands below returned status 0 in the detached worktree:

- `pnpm install --frozen-lockfile` — lockfile resolution remained frozen.
- `pnpm test` — 232 files passed, 1 skipped; 2,235 tests passed, 2 skipped; 13 package builds passed.
- `pnpm build` — 17/17 workspace build targets passed.
- `pnpm --filter applesauce-docs build` — VitePress build completed.
- `pnpm --filter applesauce-examples build` — TypeScript and Vite build completed.
- `APPLESAUCE_SNAPSHOT_WORKTREE=1 node scripts/snapshot-release.mjs --tag next --verify-only` — snapshot versioning, 17 workspace builds, 13 package builds, and the same 2,235-test suite passed without publication.

The dedicated executor branch `worktree-agent-p11` began at the same immutable OID as `next`; release inputs came only from `refs/heads/next`. Local `master` remained equal to `origin/master` at `ec51f7d4ecfd3db6099e786e8eec0062255588d4`, and `master` remained an ancestor of `next`.

### Pack, consumer, and restoration evidence

| Check | Status | Evidence |
|---|---|---|
| 13 TARBALLS PASS | PASS | `pnpm --dir packages/<name> pack --pack-destination /tmp/opencode/phase26-11-tarballs` produced exactly thirteen archives; every embedded manifest has the expected package name and shared `0.0.0-next-20260924153023` version. |
| CONSUMER INSTALL PASS | PASS | One isolated pnpm 11.10.0 consumer installed all thirteen local tarballs together with lifecycle scripts disabled. Because the snapshot is intentionally unpublished, a consumer-local `pnpm-workspace.yaml` override mapped every transitive `applesauce-*` edge to its matching tarball instead of consulting npm. |
| HISTORICAL WALLET NODE IMPORT FAILURE | FAIL | Node imported seven representative roots but rejected the wallet root through `@gandlaf21/bc-ur@1.1.12`'s extensionless ESM import. Bun loaded the wallet only as historical diagnostic evidence; it was never supported-Node success and is superseded by Plan 26-13. |
| TEMPORARY WORKTREE REMOVED | PASS | Consumer and tarball paths were removed first; tracked disposable mutations were restored path-by-path; `git worktree remove /tmp/opencode/phase26-11-worktree` removed both the checkout and its recorded administrative gitdir. |
| PRIMARY CHECKOUT RESTORATION PASS | PASS | Branch remains `worktree-agent-p11`; protected `next`, its tree, `master`, `origin/master`, lock/config bytes, 73 release notes, `.planning/STATE.md`, and the baseline porcelain-v2 stream are unchanged. Only the dedicated executor ref advanced through this plan's required atomic commit. |
| CHANGESET HASH RESTORATION PASS | PASS | Every one of the 73 baseline changeset paths exists at its original SHA-256; no snapshot versioning mutation reached `next`. |
| REF AND TAG RESTORATION PASS | PASS | All 262 baseline refs other than the dedicated executor ref match exactly, no ref or tag was added, and `next` remains `750fec4e93290e644aa838425a9dfcf20a0c82f1`. |

The isolated consumer resolved all thirteen installed manifests to `0.0.0-next-20260924153023`. No npm publish, registry write, tag, push, hosted release, branch rewrite, or protected-ref mutation occurred.

Evidence files remained present through every equality check. Their final SHA-256 values were `cac2a6076cb879fe390509421041e9c73f21ee47939daf23178e592fe49c930a` for `/tmp/opencode/phase26-11-baseline.json` and `bcc1693acd235a923d1db7c7a91ae6c880f60eee5139ee62777778a509f56e76` for `/tmp/opencode/phase26-11-worktree.json`; both are deleted only after this audit update and the final restoration assertion pass.

## Plan 26-12 immutable final release source

### Exact-source gate

| Claim | Status | Evidence |
|---|---|---|
| EXACT RELEASE SOURCE GATE PASS | PASS | Immutable source `6e83afa3532bc054b8fe0c755d7e4942462d89d8`, tree `ec5046e21248f0c8cd92f17997c682f4b678b255`, passed every D-08/D-16 command in a detached disposable worktree. |
| STRUCTURED CHANGESET ACCOUNTING PASS | PASS | The fixed ten-column parser found 73 unique `CS-NNN` rows and a bijection with all 73 tracked pending `.changeset/*.md` paths; every note passed package/bump, body-line, sentence, and semantic-evidence checks. |
| 13 PACKAGE ORACLE PASS | PASS | Changesets reported exactly the thirteen checklist packages at `7.0.0`, with arrays and direct/cascade classifications identical to Plan 26-10; both held IDs remain direct inputs. |
| PROSPECTIVE NORMAL MERGE PASS | PASS | Unreachable commit `20b7853c525daa43fdf139648b9aeaf58b7cf7f5` has ordered parents stable master `ec51f7d4ecfd3db6099e786e8eec0062255588d4` then exact source `6e83afa3532bc054b8fe0c755d7e4942462d89d8`, and tree `ec5046e21248f0c8cd92f17997c682f4b678b255`. Both parent ancestries are preserved. |
| NO NPM PUBLICATION | PASS | No publish, registry, OTP, version, changelog, tag, push, or hosted-release operation ran. |
| NO REAL MASTER MERGE | PASS | The merge object is unreachable evidence only; local `master` remains exactly equal to `origin/master` at `ec51f7d4ecfd3db6099e786e8eec0062255588d4`. |

The durable machine evidence is `.git/gsd-phase-26-release-evidence/final-source/release-source.json` with SHA-256 `0e7ec3637396da21f6c348c2342605d4875f617a2a84ee6b8a739602ae264960`. Its atomic terminal marker contains exactly `COMPLETE 6e83afa3532bc054b8fe0c755d7e4942462d89d8`. This immutable OID, not a later planning descendant or mutable branch name, is the sole source authorized for the later stable merge.

### Full D-08/D-16 command ledger

| Command | Status | Log SHA-256 |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | `54e88c79b43a1373e3088501599baa227cb434abb41851b4e70ae8b4169b0a7d` |
| `pnpm test` | PASS | `0aff927af8910457c324391be0dfc70b50b2f21cbe6a0b2d6af615164f74e552` |
| `pnpm build` | PASS | `079808d75c793ef97eee0ff497fbf0eeb0ce2ad225f7d80e8ef3736d6990002d` |
| `pnpm --filter applesauce-docs build` | PASS | `f09a46d25db807675dbcf84ff3110ae1c3ddbe77c235800d59c69546cb9ee701` |
| `pnpm --filter applesauce-examples build` | PASS | `7f3e35222661f15a07cf72ac0af961fc57900eb6e8a024fd2f673cd8971e1459` |
| Structured changeset parser | PASS | `7196746178d102d9d512aeea4d984bec97c8f6f9c89131dc6818c992d54c2bb8` |
| Changesets status oracle | PASS | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Exact disposable-checkout restoration | PASS | `b11a2b02d5e97f757332a839784c7c36d16f4bcd29660955e7fbcc6889d7ed57` |
| Prospective normal merge proof | PASS | `0f2e2e2278522693fe0a342231c3df55b3c37b3405c50728a9465a7069ba0704` |

The detached checkout returned to the pinned source with an empty porcelain-v2 stream and exact lock, config, 73 changeset, package-manifest, and changelog hashes after guarded removal of ignored generated directories. Release input resolution occurred once from `refs/heads/next`; every gate, oracle, held-note check, source-tree comparison, merge second parent, JSON record, and terminal marker reused the captured OID.

### Final restoration and descendant scope

| Check | Status | Evidence |
|---|---|---|
| PRIMARY CHECKOUT RESTORATION PASS | PASS | The recorded disposable path `/tmp/opencode/phase26-12-worktree` and administrative gitdir are absent. Stable `master` and `origin/master` remain identical at `ec51f7d4ecfd3db6099e786e8eec0062255588d4`; all remote-tracking refs, tags, protected local refs, lock/config bytes, 73 changesets, thirteen package manifests, and thirteen changelogs match the schema-v2 entry baseline. |
| PLANNING-ONLY DESCENDANTS PASS | PASS | `next` remains exactly the immutable source `6e83afa3532bc054b8fe0c755d7e4942462d89d8`, so `RELEASE_SOURCE..next` contains no commits. The executor-only descendant at the Task 2 check boundary is `d0aa49181c48f1337a89c063caf774e7fc281244`, changing only `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md`; pending closeout paths are restricted to this audit, `26-VALIDATION.md`, `.planning/REQUIREMENTS.md`, and the later `26-12-SUMMARY.md`. |
| FINAL REPLACEMENT READINESS PASS | PASS | Plans 26-10 through 26-12 jointly prove 73 structured notes, thirteen `7.0.0` packages, both held IDs, the non-publishing snapshot consumer, the exact-source full gate, normal-merge object, planning-only closeout, and complete restoration. Plans 26-04 through 26-09 remain historical and non-gating. |

The entry evidence hashes are `501f92f160e86a555ff84fb03e6dbd85c50bba0f79bcc432e5c6f48da3e03011` for the schema-v2 baseline and `8cd5899d50f6078556666857fd26779a14adf9586c60b4d603c49dc9e8fd14f7` for the disposable-worktree identity. The durable release-source evidence remains byte-identical to its temporary source record. D-16's later stable transition must merge recorded source OID `6e83afa3532bc054b8fe0c755d7e4942462d89d8` normally into stable master and then use the standard Changesets workflow; neither current `next` nor a later planning tip may replace that OID.

## Plan 26-13 wallet Node remediation

| Claim | Status | Evidence |
|---|---|---|
| SUPPORTED NODE WALLET ROOT PASS | PASS | Node `v26.4.0` imported the exact extracted `applesauce-wallet` archive root with no Bun substitution, resolver override, or runtime flag and returned nonempty exports `Actions`, `Casts`, `Factories`, `Helpers`, `Models`, and `Operations`. |
| PACKED BYTES IDENTIFIED | PASS | The imported archive SHA-256 is `e52b84416b8d0de3903ef2011af57881b723c1b217c412265081cf0986fab18f`; `.git/gsd-phase-26-release-evidence/wallet-node/result.json` records schema `phase26-wallet-node/v1`, runtime, hash, import status `0`, and exports. |
| ANIMATED QR RETAINED | PASS | The focused wallet suite keeps ordered fragments, receive progress and reconstruction, deferred-load behavior, and both public helper exports green. |
| RELEASE NOTE SEMANTICS | HUMAN ACCEPTED | CS-075 passes package/frontmatter, one-line, and one-sentence checks, and Plan 26-14's separate D-02/D-04 human judgment is durably bound in `26-SEMANTIC-ACCEPTANCE.md`. |

The Plan 26-11 Bun result is retained above only as historical failure evidence. It is not a supported-runtime pass and no longer supports the representative-import claim.
