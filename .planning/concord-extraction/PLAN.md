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

### Phase 1 — Pure helpers (cleanest wins) — STATUS: TODO
Move the zero-coupling reducers/derivations into `concord/helpers/`:
`crypto.ts`, `permissions.ts`, `control.ts` (`foldControl`), `guestbook.ts`
(`foldMembers`), `community-list.ts`, `rekey.ts`, the pure subset of
`community.ts` (`deriveKeys`/`channelKeyFor`/`verifyOwner`), and
`editions.ts computeEditionHash`.
- [ ] Port `scripts/selftest.ts` as the vitest correctness anchor (derivation +
      fold parity vs armada).
- [ ] `pnpm --filter applesauce-extra test` green.

### Phase 2 — Envelope + operations — STATUS: TODO
- [ ] Lift `stream.ts`, swap local `Signer` iface → applesauce `ISigner`.
- [ ] Lift rumor builders into `operations/`: `chat.ts` (already applesauce-idiomatic),
      `editions.ts`, `invite.ts`, `guestbook buildSnapshotRumors`,
      `rekey buildRekeyRumors`, `community createCommunity`.
- [ ] Parameterize app-specific invite `RELAY_DICTIONARY`/`STOCK_RELAYS` as inputs.

### Phase 3 — Relay-auth — STATUS: TODO
- [ ] Lift `stream-auth.ts` + `relay-auth.ts`; refactor module-global stream-key
      registry → instance state; take a `RelayPool` param instead of app `pool`.
- [ ] Model auto-auth after extra's existing `Vertex` class
      (`combineLatest([challenge$, authenticated$])`).

### Phase 4 — `ConcordClient` — STATUS: TODO
- [ ] Lift `client.ts` with constructor DI:
      `new ConcordClient({ signer, pubkey, eventStore, pool, storage, uploader? })`.
- [ ] Replace `../nostr` globals with injected deps.
- [ ] Abstract `localStorage` behind `ConcordStorage` (localStorage-backed default).
- [ ] Make Blossom media upload an optional injected `uploader` (core client has
      no Blossom dep).
- [ ] Keep RxJS `BehaviorSubject` surface + optimistic local-echo intact.

### Phase 5 — Prove it + swap the app back — STATUS: TODO
- [ ] Point `appelsauce-concord-test` at `applesauce-extra/concord`; delete its
      duplicated `src/concord/`, keeping only app-only bits (cache adapter,
      blossom uploader impl, voice, React UI).
- [ ] Run the puppeteer drivers (`drive.mjs`/`drive-auth.mjs`) against the
      extracted package — real end-to-end interop check.

## Deferred by decision (stays in the app)
- CORD-07 voice (`voice.ts` + `src/app/voice/`, LiveKit/broker-HTTP).
- `cache.ts` (localStorage decoded-rumor cache) → becomes the reference impl of
  the `ConcordStorage` interface.
- Blossom/image libs → become the reference `uploader`.

## Progress log
- 2026-07-07 — Investigation complete (3 parallel analyses: protocol core,
  client engine, applesauce conventions). Plan written. Phase 0 started.
</content>
