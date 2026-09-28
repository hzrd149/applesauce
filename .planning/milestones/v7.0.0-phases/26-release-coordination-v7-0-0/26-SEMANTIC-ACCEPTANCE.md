# Phase 26 Semantic Changeset Acceptance

Canonical schema: phase26-semantic-inventory/v1
Canonical digest: sha256:bed7a41516fc2fe7f6ca623a7afc54e009ebdb049ff7f5b5845b16f774c7baf2

## Acceptance

On 2026-09-24, the human reviewer accepted every semantic one-change judgment in the exact 74-row release-note inventory identified below. This acceptance is judgment evidence, separate from the line and sentence parser results recorded in the release audit.

<!-- exact-response:start -->
accept-semantic-inventory phase26-semantic-inventory/v1 sha256:bed7a41516fc2fe7f6ca623a7afc54e009ebdb049ff7f5b5845b16f774c7baf2
<!-- exact-response:end -->

The response is reproduced byte-for-byte from the uniquely bounded response in `26-14-SUMMARY.md`.

## Accepted inventory identity

| Property | Accepted value |
|---|---|
| Audit content | Git blob `d0269d8d88472f946d0a4e6cefeb92302db00e85` |
| Audit SHA-256 | `8a72bc9e8bff7ab266441b0557287b3710ea2c99dad7f02f55e68aef59acf7f0` |
| Canonical UTF-8 bytes | 24,098 |
| Accepted rows | 74 |
| Tracked changeset paths | 74 |
| Path bijection | PASS — every tracked path occurs exactly once |
| Source-shape contract | PASS — LF UTF-8, exact frontmatter, one nonempty body line, and one segmented sentence |

The canonical payload sorts rows by bytewise UTF-8 comparison of `id + "\u0000" + path`, serializes the top-level `schema` and `rows` keys and each row's `id`, `path`, `packageBump`, `body`, and `provenance` keys in that insertion order with whitespace-free `JSON.stringify`, and hashes the resulting UTF-8 bytes with lowercase SHA-256. Package cells are split on literal `<br>`, exactly one enclosing backtick pair is removed from every component, and the components are rejoined with literal `<br>` before comparison and serialization.

## Accepted rows

| ID | Path |
|---|---|
| CS-001 | `.changeset/add-is-valid-seal.md` |
| CS-002 | `.changeset/android-native-account-restore-fields.md` |
| CS-003 | `.changeset/android-native-signer-seed-pubkey.md` |
| CS-004 | `.changeset/auth-retry-error-channel.md` |
| CS-005 | `.changeset/brave-ids-batch.md` |
| CS-006 | `.changeset/cache-write-frozen-throws.md` |
| CS-007 | `.changeset/cache-writes-hidden-from-spread.md` |
| CS-008 | `.changeset/chat-message-factory.md` |
| CS-009 | `.changeset/clamp-expiration-timer-delay.md` |
| CS-010 | `.changeset/comment-parent-rumor.md` |
| CS-011 | `.changeset/common-falsy-app-data.md` |
| CS-012 | `.changeset/copy-symbols-guards.md` |
| CS-014 | `.changeset/forum-thread-nip7d.md` |
| CS-015 | `.changeset/generic-common-helpers.md` |
| CS-016 | `.changeset/generic-event-stores.md` |
| CS-017 | `.changeset/gift-wrap-symbols-to-core.md` |
| CS-018 | `.changeset/group-pointer-lossless-roundtrip.md` |
| CS-019 | `.changeset/hidden-content-unlock-guards.md` |
| CS-020 | `.changeset/hidden-tags-undefined-not-throw.md` |
| CS-021 | `.changeset/loaders-sync-fallback-auth.md` |
| CS-022 | `.changeset/lock-app-data-clears-plaintext.md` |
| CS-023 | `.changeset/logger-colors.md` |
| CS-024 | `.changeset/logger-sink-record.md` |
| CS-025 | `.changeset/lucky-pans-shave.md` |
| CS-026 | `.changeset/multi-user-authentication.md` |
| CS-027 | `.changeset/pubkey-casts-store-cache.md` |
| CS-028 | `.changeset/reaction-parent.md` |
| CS-029 | `.changeset/relay-auth-family-re-layer.md` |
| CS-030 | `.changeset/relay-auth-handler-sync-throw-mapped.md` |
| CS-031 | `.changeset/relay-auth-lifecycle-debug-logging.md` |
| CS-032 | `.changeset/relay-auth-log-namespace-order.md` |
| CS-033 | `.changeset/relay-auth-resend-req-count-observed.md` |
| CS-034 | `.changeset/relay-auth-retry-bound-not-reset-by-req-open.md` |
| CS-035 | `.changeset/relay-auth-timeout-bounded-wait.md` |
| CS-036 | `.changeset/relay-auth-wire-request-context.md` |
| CS-037 | `.changeset/relay-closed-prefix-safety.md` |
| CS-038 | `.changeset/relay-count-nip45.md` |
| CS-039 | `.changeset/relay-event-publish-layering.md` |
| CS-040 | `.changeset/relay-group-count-progressive.md` |
| CS-041 | `.changeset/relay-group-error-surface.md` |
| CS-042 | `.changeset/relay-group-logger-routing.md` |
| CS-043 | `.changeset/relay-group-request-error-not-progress.md` |
| CS-044 | `.changeset/relay-group-request-timeout-suspended.md` |
| CS-045 | `.changeset/relay-group-sync-per-relay-isolation.md` |
| CS-046 | `.changeset/relay-negentropy-rounds.md` |
| CS-047 | `.changeset/relay-operation-scoped-auth-callbacks.md` |
| CS-048 | `.changeset/relay-publish-response-error-field.md` |
| CS-049 | `.changeset/relay-publish-timeout-marks-itself.md` |
| CS-050 | `.changeset/relay-quiet-empty-auth-invalidation.md` |
| CS-051 | `.changeset/relay-req-family-re-layer.md` |
| CS-052 | `.changeset/relay-request-timeout-can-fire.md` |
| CS-053 | `.changeset/relay-sync-outcomes.md` |
| CS-054 | `.changeset/remove-event-factory-kind.md` |
| CS-055 | `.changeset/rumor-stores.md` |
| CS-056 | `.changeset/rumor-type-and-helpers.md` |
| CS-057 | `.changeset/seal-parse-failures-return-undefined.md` |
| CS-058 | `.changeset/shaggy-clowns-smile.md` |
| CS-059 | `.changeset/sqlite-optional-backends.md` |
| CS-060 | `.changeset/stamp-no-caller-mutation.md` |
| CS-061 | `.changeset/sync-loader-auth-hooks.md` |
| CS-062 | `.changeset/sync-loader-auth-phase-timer-leak-fixed.md` |
| CS-063 | `.changeset/sync-loader-handlerless-stall-suspension.md` |
| CS-064 | `.changeset/sync-loader-wait-for-auth.md` |
| CS-065 | `.changeset/tall-months-invite.md` |
| CS-066 | `.changeset/tricky-pots-teach.md` |
| CS-067 | `.changeset/verify-event-undefined-fix.md` |
| CS-068 | `.changeset/verify-gift-wrap-seal-signatures.md` |
| CS-069 | `.changeset/wait-for-auth-pubkeys.md` |
| CS-070 | `.changeset/wallet-getters-return-undefined.md` |
| CS-071 | `.changeset/wallet-lock-relays.md` |
| CS-072 | `.changeset/wallet-notification-safe-parse.md` |
| CS-073 | `.changeset/wide-donkeys-smile.md` |
| CS-074 | `.changeset/wait-for-paid-timer-fixes.md` |
| CS-075 | `.changeset/wallet-node-root-import.md` |

The **73 pre-gap judgments** are CS-001 through CS-012, CS-014 through CS-074. The post-gap remediation ID is CS-075. Together they are the complete accepted inventory above.

## Invalidation rule

Any change to an accepted row's ID, path, package + bump, exact body, or provenance changes the canonical payload and invalidates this acceptance. Any added or removed tracked changeset also invalidates the path bijection and this acceptance. A later inventory requires a newly recomputed digest and explicit human acceptance; parser success cannot extend this judgment to changed content.
