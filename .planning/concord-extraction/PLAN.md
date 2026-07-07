# Concord → `applesauce-extra` Extraction Plan

Status board for pulling the Concord protocol implementation out of the
`appelsauce-concord-test` app (`src/concord/`) into the upstream
`packages/extra` package as first-class helpers, operations, relay-auth, and a
reactive `ConcordClient` class.

**Source of truth for the code being lifted:** `appelsauce-concord-test/src/concord/`
(~3,800 LOC, CORD-01…07, wire-verified against armada's independent
implementation via `scripts/interop.ts` — 73 assertions, zero divergences).

## Decisions (locked)

- **Home:** a `src/concord/` subtree inside **`packages/extra`** (not a new
  package, not split across common/actions). Exposed as the `applesauce-extra/concord`
  subpath.
- **Scope of this effort:** CORD-01…06 — the pure protocol core + a
  dependency-injected `ConcordClient`. **CORD-07 voice is deferred** (LiveKit /
  broker-HTTP coupling, still-evolving surface) and stays in the app.

## Why not the standard helper/operation/factory mold

Concord does **not** map onto applesauce's "one kind → helper + operation +
factory + action" pattern:
- Bespoke gift-wrap envelope: kind-1059 with **symmetric self-ECDH plane keys**,
  so it uses its own `DecodedStreamSymbol` memoization, not applesauce's
  signer-based `EncryptedContentSymbol`. `EventFactory`/`ISigner`/blueprint
  don't reach this layer.
- "Actions" publish wraps to **derived plane addresses** with optimistic
  local-echo — not `ActionContext` outbox/inbox routing.
- "Helpers" are **fold reducers and key derivations**, not per-kind pointer
  extractors.

So we keep Concord's existing internal layering intact and dependency-invert the
app coupling, rather than reshaping it into the standard mold.

## Target shape

```
packages/extra/src/concord/
  bytes.ts            # extracted from app lib/bytes (hex/u64be/concat/ZERO_32/base64url)
  types.ts            # KIND/VSK/PERM consts + protocol interfaces (foundation)
  helpers/            # pure — crypto, permissions, control-fold, guestbook-fold,
                      #   community-list CRDT, rekey codec, edition-hash, key-derivation
  operations/         # rumor/event builders — editions, chat, invite, snapshot,
                      #   rekey-rumors, community genesis
  stream.ts           # CORD-01 envelope (createStreamEvent/decode/rewrapSeal), ISigner-based
  relay-auth.ts       # NIP-42 authenticate-as-derived-key (instance-scoped, no globals)
  client.ts           # ConcordClient — DI'd EventStore/RelayPool/signer/storage/uploader
  index.ts            # barrel
```

New deps landing on `extra`: `@noble/hashes`, `@noble/curves`, `nostr-tools`;
`applesauce-signers` / `applesauce-relay` graduate from optional → used.

## Five blockers to clean extraction

1. `lib/bytes` is a hard dep of nearly every pure module — extract it **first**.
2. `client.ts` imports app globals (`import { eventStore, pool } from "../nostr"`)
   → constructor DI.
3. `localStorage` + `File`/Blob hardwired → pluggable `ConcordStorage` interface
   + injectable media `uploader`.
4. `stream.ts Signer` interface duplicates `ISigner` → consume applesauce's.
5. Relay-auth stream-key registry is a module-level mutable singleton → make it
   instance-scoped.

## Phases

### Phase 0 — Foundation — STATUS: DONE (2026-07-07)
Unblocks everything. No behavior change.
- [x] Create `packages/extra/src/concord/` subtree.
- [x] Extract `lib/bytes.ts` → `concord/bytes.ts`.
- [x] Lift `types.ts` verbatim → `concord/types.ts`.
- [x] Add `@noble/hashes` `^2.2.0`, `@noble/curves` `^2.2.0`, `nostr-tools` `^2.19` to `extra/package.json`.
- [x] Add `exports` map to `extra/package.json` with `.`, `./concord`, `./concord/*` subpaths.
- [x] `concord/index.ts` barrel (subpath-only via `applesauce-extra/concord`).
- [x] `exports.test.ts` inline snapshot for the concord barrel (15 runtime exports).
- [x] `pnpm --filter applesauce-extra build` green; subpath resolves from dist
      (`import('applesauce-extra/concord')` → `KIND.WRAP=1059`, `toHex` fn).

### Phase 1 — Pure helpers (cleanest wins) — STATUS: DONE (2026-07-07)
Moved the zero-coupling reducers/derivations into `concord/helpers/`:
`crypto.ts`, `permissions.ts`, `control.ts`, `guestbook.ts`,
`community-list.ts`, `rekey.ts`, `community.ts`, `editions.ts`.
- [x] Imports repointed for NodeNext (`.js` extensions; `../lib/bytes`→`../bytes.js`).
- [x] `RumorTemplate` type moved into `types.ts` so helpers don't depend on the
      Phase-2 `stream.ts`. (Deviation: the pure `RumorTemplate` builders —
      `buildEdition`/`buildSnapshotRumors`/`buildRekeyRumors`/`createCommunity`/
      `dissolutionRumor` — ride with their helper modules rather than being
      force-split into `operations/`; they're pure, signer-free, no I/O.
      `operations/` is reserved for the signer/envelope-coupled builders:
      `chat.ts`, `invite.ts`, `stream.ts` in Phase 2.)
- [x] Dropped `control.ts`'s redundant `resolveStanding`/`canActOn` re-export
      (collided with `permissions.ts` under the flat barrel).
- [x] `helpers/index.ts` barrel; wired into `concord/index.ts` (76 exports).
- [x] Correctness anchor: `helpers/__tests__/helpers.test.ts` — 16 tests over
      derivations, permissions, control/guestbook folds, community-list CRDT
      (commutativity/idempotency/liveness), rekey codec (round-trip/continuity),
      and key derivation. Full envelope round-trip (needs `stream.ts`) deferred
      to Phase 2's `selftest.ts` port.
- [x] `pnpm --filter applesauce-extra test` green (2 files, 17 tests); build green.

### Phase 2 — Envelope + operations — STATUS: DONE (2026-07-07)
- [x] Lifted `stream.ts` (top-level envelope); dropped the local `Signer`
      interface for applesauce `ISigner` (type-only import — verified erased from
      the built `stream.js`, so no runtime `applesauce-signers` dep). Removed the
      duplicate `RumorTemplate` def (now sourced from `types.ts`).
- [x] Lifted the signer/envelope-adjacent builders into `operations/`:
      `chat.ts` (already built on `applesauce-core/operations`), `invite.ts`
      (CORD-05 codec + bundle templates), and `imeta.ts` (NIP-92 attachment tags).
      The `editions`/`guestbook`/`rekey`/`community` builders already shipped
      with their helper modules in Phase 1 (see Phase 1 deviation note).
- [x] Dropped redundant barrel-colliding re-exports (`toHex`/`fromHex` from
      invite, `RumorTemplate` from stream).
- [x] Full envelope round-trip anchor: `__tests__/roundtrip.test.ts` — ports
      selftest.ts §1-7 (genesis → wrap/seal → decode → control+guestbook fold →
      cross-member chat decode → invite link round-trip → tamper detection).
- [x] `pnpm --filter applesauce-extra test` green (3 files, 17 tests); build
      green; barrel now 101 exports.
- **Deferred:** parameterizing the invite `RELAY_DICTIONARY`/`STOCK_RELAYS` —
      kept as the CORD-05 §3 stock-set defaults for a faithful lift and to
      preserve interop; making the dictionary injectable is a follow-up that
      would thread a param through the fragment codec.

### Phase 3 — Relay-auth — STATUS: DONE (2026-07-07)
- [x] Merged the app's `stream-auth.ts` (module-global registry) + `relay-auth.ts`
      (module-global drivers + app `pool`) into a single instance-scoped
      `ConcordRelayAuth` class in `concord/relay-auth.ts`. Registry, version
      subject, and per-relay driver map are all instance fields; the `RelayPool`
      is a constructor arg. Two clients/accounts never share stream keys now.
- [x] `registerStreamKeys`/`streamPubkeys`/`streamSigners` are methods;
      `authenticateStreamKeys(relay)` and `autoAuthenticate(signer, pubkey)` keep
      the same driving logic (ref-counted per-relay driver, single-flight
      make-progress loop, user-key challenge answering) against the workspace
      `RelayPool.status$` / `Relay` API.
- [x] Value-imports `PrivateKeySigner`/`RelayPool` from the optional
      `applesauce-signers`/`applesauce-relay` — matches the existing `vertex.ts`
      precedent (it value-imports `Relay` from the same optional dep).
- [x] Test `__tests__/relay-auth.test.ts` — ports selftest §8: registry
      idempotency, one signer per stream key, and a valid signed kind-22242
      carrying the challenge AS each stream pubkey. (Live per-relay driver is
      covered by the Phase 5 puppeteer `drive-auth.mjs`.)
- [x] `pnpm --filter applesauce-extra test` green (4 files, 18 tests); build green.

### Phase 4 — `ConcordClient` — STATUS: DONE (2026-07-07)
- [x] Lifted `client.ts` with constructor DI:
      `new ConcordClient({ signer, pubkey, eventStore, pool, storage?, uploader?, relays? })`
      (`ConcordClientOptions`). Replaced the `../nostr` `eventStore`/`pool`
      globals with injected `IEventStore` + `RelayPool`; `Signer` → `ISigner`;
      `DEFAULT_RELAYS` → injected `relays` (defaults to CORD-05 stock set).
- [x] New `concord/storage.ts`: `ConcordStorage` interface (`memoryStorage()` /
      `defaultStorage()` picks `localStorage` if present) — the decoded-rumor
      cache + materials mirror now go through it (the app's `cache.ts` becomes the
      reference localStorage impl). `ConcordUploader` interface makes Blossom
      media upload injectable; the core client has zero Blossom/`castUser`
      dependency and throws a clear error if a file is sent without an uploader.
- [x] Instantiates its own `ConcordRelayAuth(pool)` (Phase 3) — no module globals.
- [x] RxJS `BehaviorSubject` surface (`communities$`, `getState$`, `getMessages$`)
      and optimistic local-echo (`publishToPlane` → `ingest` before background
      publish) kept intact.
- [x] **Voice (CORD-07) removed per scope decision:** dropped `getVoicePresence$`,
      `voiceKeys`, `joinVoice`/`leaveVoice`, presence fold/heartbeat machinery,
      and the Runtime voice fields; the `ingest` channel branch now drops
      `VOICE_PRESENCE` events. (The `voice` channel-flag on `createChannel` stays —
      it's just an edition property, not the LiveKit layer.)
- [x] Test `__tests__/client.test.ts` — DI over a network-free fake pool + real
      `EventStore`: genesis fold + chat optimistic echo, the no-uploader guard,
      and persistence across a client restart through a shared `memoryStorage`.
- [x] `pnpm --filter applesauce-extra test` green (5 files, 21 tests); build
      green; barrel 106 exports (`ConcordClient`/`ConcordRelayAuth`/storage).

### Phase 5 — Prove it + swap the app back — STATUS: PARTIAL (2026-07-07)
Verification done headlessly; the app cutover is a manual integration step
(separate repo + publish/link + Chrome + live relays).
- [x] **Compiled-artifact round-trip:** ran a full genesis → wrap/seal → decode →
      control fold → cross-member chat decode → invite round-trip against the
      BUILT `dist`, imported exactly as an external consumer would
      (`import { … } from "applesauce-extra/concord"`). All assertions pass —
      proves the published subpath + emitted JS/types work, not just the source.
- [ ] **App cutover (deferred — needs the package published or workspace-linked):**
      `appelsauce-concord-test` is a *separate git repo* pinned to
      `applesauce-*@^6.2.0` from npm; the `concord` subpath isn't published yet,
      so its `src/concord/` can't be deleted/repointed headlessly without breaking
      it. Cutover steps for when the package ships:
      1. Bump + publish `applesauce-extra` (or `pnpm link` the workspace build).
      2. Replace app imports `../concord/*` → `applesauce-extra/concord`; construct
         `new ConcordClient({ signer, pubkey, eventStore, pool, storage, uploader })`
         where `storage` wraps the app's `localStorage` cache and `uploader` wraps
         its Blossom `encryptImageBlob`+`uploadBlob`.
      3. Keep app-only bits: the voice layer (`src/app/voice/`, `voice.ts`),
         the Blossom/image libs (now the reference `ConcordUploader`), and the
         `cache.ts`/`nostr.ts` wiring (now the reference `ConcordStorage`).
      4. Delete the now-duplicated `src/concord/` core.
      5. Run the puppeteer drivers (`drive.mjs`/`drive-auth.mjs`) — real
         end-to-end interop over live relays + Chrome.

## Deferred by decision (stays in the app)
- CORD-07 voice (`voice.ts` + `src/app/voice/`, LiveKit/broker-HTTP).
- `cache.ts` (localStorage decoded-rumor cache) → becomes the reference impl of
  the `ConcordStorage` interface.
- Blossom/image libs → become the reference `uploader`.

## Progress log
- 2026-07-07 — Investigation complete (3 parallel analyses: protocol core,
  client engine, applesauce conventions). Plan written. Phase 0 started.
- 2026-07-07 — Phases 0-4 complete + committed on branch `concord-extraction`
  (one commit each). `applesauce-extra/concord` now ships: `bytes`/`types`,
  `helpers/` (crypto, permissions, control+guestbook folds, community-list CRDT,
  rekey codec, community/edition builders), the `stream` envelope,
  `operations/` (chat, invite, imeta), instance-scoped `ConcordRelayAuth`,
  `ConcordStorage`/`ConcordUploader`, and the DI'd `ConcordClient`. 106 barrel
  exports; 5 test files / 21 tests green; `tsc` build green. Phase 5 verified
  headlessly against the compiled `dist`; app cutover deferred (needs publish +
  Chrome + live relays in the separate app repo). CORD-07 voice deferred by
  decision throughout.
</content>
