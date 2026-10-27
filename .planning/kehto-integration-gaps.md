# Kehto integration gaps

Source review against installed `@kehto/services@0.25.1`; no live-relay interoperability claims.

## Highest-value work

- Implemented: correct identity list extraction to return only item tags, not title/description/image or other metadata, retaining public-only reads.
- Implemented: expose custom NIP-51 list definitions through the convenience constructor; upload size/MIME policy and resource bulk/origin-policy controls remain separate follow-ups.
- Implemented: ContextVM adapter at `applesauce-extra/kehto/services/cvm` using Kehto's existing Nostr transport and the shared Applesauce pool, with per-window ephemeral keys, lifecycle ownership and tests.

## Further integrations

- NDR and Cordn messaging currently require application-owned adapters, authentication, discovery and persistence; assess demand before shipping turnkey integrations.
- Scoped relay opening/closing/publication, relay configuration mutations and NIP-66 suggestions remain host extensions.
- Identity list reads support five categories and public entries only, while mutations support 19 list definitions; decide whether richer read contracts are needed.
- Uploads support Blossom only; additional rails need separate implementations.
- COUNT reports the largest responding relay count, not a deduplicated network total; preserve and document this distinction.
- UI/device services (theme, notifications, intents, link handling, keys, media, config, filesystem, BLE, serial, WebRTC, gamepad) remain application/Kehto responsibilities rather than missing Nostr adapters.

## Verification and upstream follow-ups

- Measure subscription fan-out and cleanup across many concurrent napplet windows on real relays.
- Measure store hit rates and relay round-trips for repeated identity/outbox reads.
- Measure publish latency and error reporting through runtime-mediated signing.
- Remove explicit host `intent.deliver` recipient checks only when Kehto supplies equivalent recipient mapping, preserving denial tests.
- Keep signing approval separate from runtime ACL/consent; new transports must document whether they use account signing or ephemeral transport keys.

## Upstream issue draft: NAP-DM availability and subscription lifecycle notifications

Status: ready to discuss/submit upstream; not filed. Reviewed installed `@napplet/core@0.34.0` and `@kehto/services@0.25.1`.

### Reproduction

1. Open the generic messages napplet with all host messaging protocols disabled.
2. Enable a host protocol without changing the account or reloading the napplet.
3. The napplet's previous `dm.status()` result remains unavailable; there is no supported DM change event prompting it to query again.
4. With live delivery active, enable/disable another host protocol. Applesauce's composer cancels the old session-scoped subscription, but the napplet receives neither a termination event nor a replacement subscription.

### Verified API boundary

- `DmApi` exposes `status`, `conversations`, `messages`, `send`, `subscribe`, `unsubscribe`, and `onMessage`, but no availability/status-change or subscription-ended listener (`@napplet/core/dist/index.d.ts`, `DmApi`).
- Kehto's `createDmService` forwards query results and `dm.message`; its adapter callback has no subscription termination/status notification channel (`@kehto/services/dist/index.js`, `createDmService`).
- Applesauce currently invalidates operations on any protocol session replacement (`packages/extra/src/kehto/services/dm/multi-protocol.ts`, `withSessions$`). Silent cancellation is our integration behavior, not evidence that all Kehto adapters terminate on protocol changes.

### Proposed upstream contract

- A Kehto-mediated DM availability/capability change notification and SDK listener; payloads need not reveal protocol identities. Define initial snapshot, ordering, and account-change semantics.
- Subscription lifecycle notifications with subscription id and a typed reason, including loss of availability, account changes, permission revocation, and terminal failures; define whether restoration resumes a subscription or requires resubscription.
- A host adapter hook for emitting those changes and service-owned forwarding/cleanup scoped to each napplet window. Do not use raw iframe messages, fake `identity.changed` events, synthetic messages, or implementation labels as change tokens.
- Tests for disabled → enabled, one enabled backend → another, all backends disabled/restored, account switches, repeated toggles, and window destruction; verify no stale deliveries, duplicates, orphan subscriptions, or protocol-specific napplet logic.

### Honest interim behavior

The example has no custom host-to-iframe channel and does not poll. Its generic **Refresh messages** control uses only the public Kehto APIs to recheck availability, unsubscribe the previous id, load history, and establish live delivery again. After changing host protocols or NDR readiness, press it in the napplet. This deliberately leaves the API gap visible during manual testing.

## Cordn implementation progress

- Coordinator source reviewed at `Cordn-msg/cordn@59b2e541c232225d68945eeb9ac58468222eb57f`; contracts use `kp_list`, `kp_publish`, `kp_take`, `welcome_take`, `welcome_store`, `msg_post`, and `msg_fetch_many`.
- Added a separate signer-backed coordinator client using `@contextvm/sdk@0.13.10` / `@contextvm/mcp-sdk@1.30.0`, preserving the generic Kehto CVM transport's ephemeral defaults. Account-bound operations use the captured signer; other operations use a separate ephemeral identity. No raw account keys are required.
- Added a non-destructive host-side `kp_list` probe. Cordn messaging remains disabled/unavailable; no MLS state or fake message codec is exposed to the napplet.
- Tests exercise real SDK client/server gift wrapping and identity separation over an in-memory network; no live Cordn interoperability claim.
- Remaining: browser MLS runtime, signed key-package credential binding verification, encrypted durable state/history/outbox, account single-writer ownership, group/welcome lifecycle, and mapping into `DmProtocolAdapter`. `ts-mls@2.0.0-rc.13` is used by the current CAHMLS browser reference, but its application client is not a standalone published package.

This file is intentionally local and untracked; do not include it in implementation commits.
