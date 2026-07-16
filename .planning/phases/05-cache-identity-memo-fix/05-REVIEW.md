---
phase: 05-cache-identity-memo-fix
reviewed: 2026-07-16T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - .changeset/cache-frozen-event-throws.md
  - .changeset/cache-identity-memo-non-enumerable.md
  - packages/common/src/helpers/app-data.ts
  - packages/common/src/helpers/bookmark.ts
  - packages/common/src/helpers/emoji-pack.ts
  - packages/common/src/helpers/encrypted-content-cache.ts
  - packages/common/src/helpers/gift-wrap.ts
  - packages/common/src/helpers/groups.ts
  - packages/common/src/helpers/lists.ts
  - packages/common/src/helpers/mute.ts
  - packages/common/src/helpers/trusted-assertions.ts
  - packages/common/src/operations/gift-wrap.ts
  - packages/concord/src/helpers/keys.ts
  - packages/concord/src/helpers/__tests__/channel-rekey.test.ts
  - packages/concord/src/helpers/__tests__/keys.test.ts
  - packages/core/src/casts/cast.ts
  - packages/core/src/event-store/async-event-store.ts
  - packages/core/src/event-store/event-store.ts
  - packages/core/src/helpers/cache.ts
  - packages/core/src/helpers/contacts.ts
  - packages/core/src/helpers/encrypted-content.ts
  - packages/core/src/helpers/event.ts
  - packages/core/src/helpers/filter.ts
  - packages/core/src/helpers/hidden-tags.ts
  - packages/core/src/helpers/relays.ts
  - packages/core/src/helpers/__tests__/cache.test.ts
  - packages/core/src/operations/event.ts
  - packages/core/src/operations/tags.ts
findings:
  critical: 5
  warning: 11
  info: 0
  total: 16
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-07-16
**Depth:** standard
**Status:** issues_found

> **Numbering note:** IDs below are fresh for this round (`CR-01…CR-05`, `WR-01…WR-11`) and have
> **no continuity** with any earlier review's `CR-`/`WR-` numbering. Do not cross-reference by ID.

## Summary

The one runtime change this phase actually made — `setCachedValue`/`getOrComputeCachedValue`
writing memos non-enumerable via `Object.defineProperty` — is correct, and I verified its
downstream claims by tracing the mechanism rather than accepting the prose: `Reflect.deleteProperty`
does return `false` (not throw) on a non-configurable property, so `configurable: true` really is
load-bearing; `configurable: true` alone really does permit redefinition regardless of `writable`;
`getOrComputeCachedValue`'s post-compute `Object.defineProperty` really does override the enumerable
descriptor that `groups.ts`'s in-callback `Reflect.set` creates; and `cache.test.ts`'s carry-forward
half really is non-vacuous (a non-enumerable write at `modifyHiddenTags`'s return would be dropped
by `includeAltTag` → `modifyPublicTags`'s `{ ...draft, tags }` before `sign`'s enumerability-blind
re-copy could rescue it, turning the suite red). The concord CONCORD-H01 narrative also checks out
against `rollForward`'s and `rollForwardChannel`'s spreads.

The comment corpus is nevertheless wrong in two places I can disprove: one is repeated verbatim
across **twelve** write sites (WR-01), and one is self-contradictory within a single sentence and
was introduced by *this round's* diff (WR-02). Both are exactly the defect class this phase exists
to eliminate.

Separately, reading the submitted files surfaced five genuine correctness defects that outrank the
comment issues, none of which appear in STATE.md's Deferred Items table: an unlock-guard family that
hands back `undefined` typed as an array (CR-01, CR-02), a `lock*` function that does not lock
(CR-03), a validation guard that fails open on the wrong boolean operator (CR-04), and an event
operation that mutates its caller's input (CR-05).

## Critical Issues

### CR-01: `unlockHiddenContacts` returns `undefined` typed as `ProfilePointer[]`

**File:** `packages/core/src/helpers/contacts.ts:72-75` (guard), `packages/core/src/helpers/contacts.ts:106` (consumer)
**Issue:** `isHiddenContactsUnlocked` is declared `event is T & UnlockedContacts` — i.e. it asserts
`HiddenContactsSymbol` is present — but its body only checks `isHiddenTagsUnlocked(event)`. Hidden
tags being unlocked does **not** imply the contacts were ever parsed and cached. The comment above
it ("No need for try catch or proactivly parsing here since it only depends on hidden tags") states
the false premise directly.

`unlockHiddenContacts` then trusts the guard:

```ts
if (isHiddenContactsUnlocked(event)) return event[HiddenContactsSymbol]; // undefined
```

Reachable on a plain call: unlock the hidden tags by any path (`unlockHiddenTags`,
`unlockHiddenBookmarks`, `unlockHiddenMutes`, …), then call `unlockHiddenContacts` — the guard is
true, `HiddenContactsSymbol` was never written, and the function resolves to `undefined` against a
`Promise<ProfilePointer[]>` signature, bypassing its own `if (!contacts) throw` guard further down.
Callers doing `(await unlockHiddenContacts(e, signer)).map(...)` get a TypeError.

`bookmark.ts:82-86` and `groups.ts:146-148` already implement the correct pattern; contacts is the
outlier.

**Fix:**
```ts
export function isHiddenContactsUnlocked<T extends NostrEvent>(event: T): event is T & UnlockedContacts {
  return (
    isHiddenTagsUnlocked(event) &&
    (HiddenContactsSymbol in event || getHiddenContacts(event) !== undefined)
  );
}
```

### CR-02: `unlockHiddenFavoriteEmojiPacks` returns `undefined` for `packPointers`

**File:** `packages/common/src/helpers/emoji-pack.ts:137-159`
**Issue:** `isHiddenFavoriteEmojiPacksUnlocked` ORs four disjuncts and asserts
`list is T & UnlockedFavoriteEmojiPacks` — a type that requires **both**
`FavoriteEmojiPacksHiddenSymbol` **and** `FavoriteEmojiPacksHiddenPointersSymbol`. Any single
disjunct satisfies it. `unlockHiddenFavoriteEmojiPacks` then reads both symbols:

```ts
if (isHiddenFavoriteEmojiPacksUnlocked(list)) {
  return {
    emojis: list[FavoriteEmojiPacksHiddenSymbol],
    packPointers: list[FavoriteEmojiPacksHiddenPointersSymbol], // undefined
  };
}
```

This fires on the **first** call against a list whose hidden tags are already unlocked: disjunct 3
(`getHiddenFavoriteEmojis(list) !== undefined`) is true and short-circuits before disjunct 4 ever
runs, so `FavoriteEmojiPacksHiddenPointersSymbol` is never written and `packPointers` resolves to
`undefined` typed as `AddressPointer[]`. The `if (!emojis || !packPointers) throw` guard below is
skipped entirely.

Same class as CR-01. `mute.ts:69-72` (`MuteHiddenSymbol in mute || isHiddenTagsUnlocked(mute)`) and
`trusted-assertions.ts:100-102` (`TrustedProvidersHiddenSymbol in event || isHiddenTagsUnlocked(event)`)
carry the identical guard lie; their own `unlock*` functions happen to re-check the symbol directly
so they are safe internally, but both guards are exported and will mislead consumers the same way.
Fix all four together.

**Fix:** require both symbols in the guard, and derive them if absent:
```ts
export function isHiddenFavoriteEmojiPacksUnlocked<T extends NostrEvent>(
  list: T,
): list is T & UnlockedFavoriteEmojiPacks {
  return (
    isHiddenTagsUnlocked(list) &&
    getHiddenFavoriteEmojis(list) !== undefined &&
    getHiddenFavoriteEmojiPackPointers(list) !== undefined
  );
}
```

### CR-03: `lockAppData` does not lock — decrypted app data stays readable

**File:** `packages/common/src/helpers/app-data.ts:98-100` (with `app-data.ts:52-53`, `app-data.ts:71`)
**Issue:** `getAppDataContent` memoizes the **decrypted, parsed** app data on
`AppDataContentSymbol` (line 71) — including on the encrypted branch, where `data` comes from
`getHiddenContent(event)`. `lockAppData` only calls `lockHiddenContent(event)`, which deletes
`HiddenContentSymbol` (= `EncryptedContentSymbol`) and nothing else. `AppDataContentSymbol`
survives, and `getAppDataContent`'s first line
(`const cached = Reflect.get(event, AppDataContentSymbol); if (cached) return cached;`) keeps
returning the plaintext after the "lock".

This is the same shape as `lockHiddenTags` (`hidden-tags.ts:164-167`), which correctly deletes
`HiddenTagsSymbol` *and* locks the content. `lockAppData` is missing the first half. A caller that
locks app data to drop plaintext from memory (e.g. on sign-out / account switch) does not get it.

**Fix:**
```ts
export function lockAppData<T extends object>(event: T): void {
  Reflect.deleteProperty(event, AppDataContentSymbol);
  lockHiddenContent(event);
}
```

### CR-04: `copySymbolsToDuplicateEvent`'s replaceable guard uses `&&` where `||` is required

**File:** `packages/core/src/event-store/event-store.ts:200-205`
**Issue:**
```ts
if (
  isReplaceable(source.kind) &&
  source.pubkey !== dest.pubkey &&
  getReplaceableIdentifier(source) !== getReplaceableIdentifier(dest)
)
  throw new Error("Source and destination events must have the same pubkey and replaceable identifier");
```
The error message states the intended invariant: same pubkey **and** same identifier. The condition
only throws when **both** differ. Two replaceable events with the same pubkey but different `d`
identifiers (or different pubkeys but the same `d`) sail through the guard, and the function then
merges `SeenRelaysSymbol`, `FromCacheSymbol`, `verifiedSymbol` and `EncryptedContentSymbol` — i.e.
it can stamp one event's `verifiedSymbol` and decrypted plaintext onto a structurally unrelated
event. The guard fails open in exactly the direction that matters.

This is a public `static` on an exported class; the two internal call sites in `add()` happen to
pass consistent pairs, so the defect is currently only reachable via the public API — but the guard
exists precisely to police that.

**Fix:**
```ts
if (
  isReplaceable(source.kind) &&
  (source.pubkey !== dest.pubkey || getReplaceableIdentifier(source) !== getReplaceableIdentifier(dest))
)
  throw new Error("Source and destination events must have the same pubkey and replaceable identifier");
```

### CR-05: `stamp()` mutates its caller's draft object

**File:** `packages/core/src/operations/event.ts:122-130`
**Issue:**
```ts
return async (draft) => {
  if (!signer) throw new Error("Missing signer");
  Reflect.deleteProperty(draft, "id");   // mutates the INPUT
  Reflect.deleteProperty(draft, "sig");  // mutates the INPUT
  const pubkey = await signer.getPublicKey();
  const newDraft = { ...draft, pubkey };
```
The deletes land on `draft` — the caller's object — before the copy is taken. Every other operation
in this file (`stripSignature:26-30`, `stripStamp:38-43`) copies first and deletes from the copy;
`stamp` is the outlier. `sign()` calls `stamp()` on the pipe's input, so
`eventPipe(sign(user))(someSignedEvent)` silently strips `id` and `sig` off the caller's
`someSignedEvent` — an event that may still be live in an `EventStore` (`EventMemory` indexes it by
`event.id`, so an event whose `id` has been deleted can no longer be located or removed). That is
destructive data loss on an object the operation does not own.

It also quietly undermines the phase's own spread-semantics reasoning: the comment block directly
below (lines 132-143) reasons carefully about what `{ ...draft, pubkey }` copies, while the two
lines above it have already mutated `draft`.

**Fix:**
```ts
const pubkey = await signer.getPublicKey();
const newDraft = { ...draft, pubkey };
// Remove old fields from the copy, not the caller's draft
Reflect.deleteProperty(newDraft, "id");
Reflect.deleteProperty(newDraft, "sig");
```

## Warnings

### WR-01: "only pipeFromAsyncArray's delete loop" is false — there is a second delete loop, and 12 sites assert otherwise

**File:** `packages/common/src/helpers/app-data.ts:67-69`, `packages/common/src/helpers/bookmark.ts:103-105`, `packages/common/src/helpers/emoji-pack.ts:105-107` and `:128-130`, `packages/common/src/helpers/lists.ts:49-51`, `packages/common/src/helpers/mute.ts:89-91`, `packages/common/src/helpers/trusted-assertions.ts:91-93`, `packages/core/src/casts/cast.ts:61-62`, `packages/core/src/helpers/contacts.ts:97-98`, `packages/core/src/helpers/event.ts:131-132`, `packages/core/src/helpers/filter.ts:27-28`, `packages/core/src/helpers/hidden-tags.ts:107-108` and `:155-156`
**Issue:** All twelve sites assert some variant of "**only** pipeFromAsyncArray's delete loop
(helpers/pipeline.ts) masks it, **on the one call path that runs it** — a coincidence of one code
path, not an invariant."

That is disprovable. `EventFactory.chain` (`packages/core/src/factories/event.ts:80-84`) runs a
second, structurally identical delete loop over the same `PRESERVE_EVENT_SYMBOLS` allowlist, on a
different call path, with a comment that says so explicitly ("matching the behaviour of eventPipe /
pipeFromAsyncArray so stale caches (e.g. `HiddenTagsSymbol` set by a previous `modifyHiddenTags`
step) never leak into subsequent chain operations"). `cache.ts:22-26` inherits the same singular
framing ("`PRESERVE_EVENT_SYMBOLS` … is the allowlist `pipeFromAsyncArray`'s delete loop consults").

This matters beyond pedantry. The comments' stated justification for deferring the migration is that
the masking is a one-path coincidence; there are in fact two independent maskers, which changes the
risk assessment the deferral rests on. And a future cleanup grepping for "the delete loop" will find
and update one of them.

**Fix:** Amend the shared sentence at all twelve sites (and `cache.ts:22-26`) to name both
consumers, e.g. "…masked by the two delete loops that consult `PRESERVE_EVENT_SYMBOLS`
(`helpers/pipeline.ts`'s `pipeFromAsyncArray` and `factories/event.ts`'s `EventFactory.chain`), and
only on the call paths that run them."

### WR-02: `cache.ts`'s "unconditionally before any kind or replaceable branching" contradicts its own next sentence and omits a second early return

**File:** `packages/core/src/helpers/cache.ts:106-114`
**Issue:** This claim was introduced by this round's diff (it replaced the previous, narrower
`getReplaceableIdentifier` framing) and is wrong twice over:

1. "both `EventStore.add` and `AsyncEventStore.add` call it **unconditionally before any kind or
   replaceable branching**" is contradicted three lines later by "The one carve-out: both stores
   return early for `kinds.EventDeletion` before reaching that call". A call that a kind branch can
   skip is not made "before any kind branching". `event-store.ts:236` and `async-event-store.ts:203`
   are kind branches; `getExpirationTimestamp` is at `event-store.ts:245` /
   `async-event-store.ts:212`, after them.
2. "The one carve-out" is not the only one. Both stores also return early at `event-store.ts:242` /
   `async-event-store.ts:209` (`if (this.deletes.check(event)) return event`) — a previously-deleted
   event never reaches `getExpirationTimestamp` either, so a frozen deleted event does not throw via
   this path.

The load-bearing part of the claim (the throw is *not* limited to replaceable events; a kind-1 note
reaches it on a normal insert) is correct and worth keeping — I verified it at `event-store.ts:245`.

**Fix:**
```
 *     degradation. `getExpirationTimestamp` routes through
 *     `getOrComputeCachedValue`, and both `EventStore.add` and
 *     `AsyncEventStore.add` call it on every event that survives their two
 *     early returns — before any *replaceable* branching, so the throw is NOT
 *     limited to replaceable events; an ordinary regular-kind event (e.g. a
 *     kind-1 note) reaches it on a normal insert. Two carve-outs: both stores
 *     return early for `kinds.EventDeletion`, and both return early for an
 *     already-deleted event (`deletes.check`), before reaching that call.
```

### WR-03: `PRESERVE_EVENT_SYMBOLS` is a shared mutable Set widened globally at import time

**File:** `packages/common/src/operations/gift-wrap.ts:24-26`, `packages/core/src/helpers/pipeline.ts:5`
**Issue:** Importing anything from `applesauce-common/operations/gift-wrap` executes three
`PRESERVE_EVENT_SYMBOLS.add(...)` calls as a module side effect, permanently widening
applesauce-core's allowlist process-wide. From that moment, **both** delete loops (see WR-01) stop
scrubbing `SealSymbol`, `RumorSymbol` and `GiftWrapSymbol` from **every** event build in the
process — including pipes and factory chains that have nothing to do with gift wraps. Those symbols
hold live object references to decrypted rumors and their parent wraps, so unrelated drafts can
carry a graph of plaintext-bearing objects through the pipeline and retain them from GC. The effect
is also import-order-dependent and irreversible within a process.

The three comments that reason about this (`gift-wrap.ts:83-86`, `:121-124`, `:128-131`) each
describe the registration as buying survival of "`eventPipe`'s delete loop", which understates it:
it is a global mutation of another package's exported state affecting every consumer.

**Fix:** Give the pipeline an explicit per-pipe preserve list, or expose a scoped registration API
(e.g. `eventPipe({ preserve: [...] }, ...ops)`), rather than mutating a module-level `Set` at import
time.

### WR-04: `copySymbolsToDuplicateEvent` reports `changed = true` when nothing changed

**File:** `packages/core/src/event-store/event-store.ts:209-214`
**Issue:**
```ts
const relays = getSeenRelays(source);
if (relays) {
  for (const relay of relays) addSeenRelay(dest, relay);
  changed = true;
}
```
`changed` is set whenever `source` has a `SeenRelaysSymbol` at all — including an empty `Set`
(truthy), and including the common case where every relay in `source` is already in `dest`. The
symbol-merge loop immediately below correctly gates on `!(symbol in dest)`; the relay branch does
not.

All callers use the return value to decide whether to emit:
`if (EventStore.copySymbolsToDuplicateEvent(event, existing)) this.update(existing)`
(`event-store.ts:269`, `:284`, `:304`; same in `async-event-store.ts:236`, `:251`, `:271`). So every
duplicate delivery of an already-known event from an already-known relay fires `update$` with no
change — on a stream whose own doc comment warns it is "very noisy". Subscribers that are not
`distinct`-gated (model recomputation, UI re-render) do redundant work per duplicate.

**Fix:**
```ts
const relays = getSeenRelays(source);
if (relays) {
  const before = getSeenRelays(dest)?.size ?? 0;
  for (const relay of relays) addSeenRelay(dest, relay);
  if ((getSeenRelays(dest)?.size ?? 0) !== before) changed = true;
}
```

### WR-05: Comments that say "not via object spread" for writes that do survive a spread

**File:** `packages/core/src/helpers/relays.ts:16-18`, `packages/core/src/helpers/event.ts:180-182`, `packages/common/src/helpers/gift-wrap.ts:181-182` and `:215-216` and `:220-221`, `packages/common/src/operations/gift-wrap.ts:82-86`
**Issue:** Each of these describes an **enumerable** `Reflect.set` as propagating "not via object
spread" / "rather than by spread". Enumerable own symbol-keyed properties *are* copied by object
spread — that asymmetry is the entire subject of `concord/helpers/keys.ts:115-120`'s CONCORD-H01
note and of `cache.ts`'s category 1. The twelve sites in WR-01 handle this correctly by explicitly
disclosing "this write is a plain enumerable `Reflect.set`, so the value **does** survive a spread
today". This cluster does not, and reads as an assertion that spread does not carry them.

Charitably these sentences mean "the mechanism this code *relies on* is not spread". Given this
phase's stated purpose, the distinction between "does not propagate by spread" and "does not rely on
spread to propagate" is precisely the one that must not be left to the reader — and the corpus
already proves the authors know how to state it unambiguously.

**Fix:** Adopt the WR-01 sites' disclosure form, e.g. "…propagated across duplicate events by
`EventStore.copySymbolsToDuplicateEvent`'s element-wise seen-relays merge. (This write is a plain
enumerable `Reflect.set`, so it also rides a spread — that is not the mechanism relied on here.)"

### WR-06: "This is the ONLY carry-forward site in applesauce-common" is not established

**File:** `packages/common/src/operations/gift-wrap.ts:134-141`
**Issue:** `packages/common/src/helpers/encrypted-content-cache.ts:102` and `:134` both call
`setEncryptedContentCache`, which `cache.ts:60-70`'s worked example explicitly classifies as a
**carry-forward payload** write site ("That is why it hand-rolls its own enumerable `Reflect.set`
write instead of calling `setCachedValue`"). Those are carry-forward writes performed from
applesauce-common onto applesauce-common's own restored events and seals. Whether "site" means "the
lexical `Reflect.set`" or "the place carry-forward happens" is exactly the ambiguity that makes an
absolute like "ONLY" unsafe — and the comment leans on that absolute to justify a warning about
future cleanup sweeps.

**Fix:** Narrow the claim to what is checkable, e.g. "This is the only direct
`EncryptedContentSymbol` write in applesauce-common; `helpers/encrypted-content-cache.ts` reaches
the same category indirectly through `setEncryptedContentCache`."

### WR-07: Dead branches in `modifyHiddenTags`

**File:** `packages/core/src/operations/tags.ts:56-75`
**Issue:** Two unreachable paths:
```ts
if (hasHiddenTags(draft)) {          // line 56 — outer guard
  hidden = getHiddenTags(draft);
  if (hidden === undefined) {
    if (hasHiddenTags(draft)) {      // line 62 — always true; line 56 proved it
      pubkey = await signer.getPublicKey();
      hidden = await unlockHiddenTags({ ...draft, pubkey }, signer);
    }
    else hidden = [];                // line 68 — UNREACHABLE
  }
}
else hidden = [];

if (hidden === undefined) throw new Error("Failed to find hidden tags"); // line 75 — UNREACHABLE
```
Line 62's re-check is redundant with line 56, making line 68 dead. And every path through the block
assigns `hidden` a non-`undefined` value (`unlockHiddenTags` throws rather than returning
`undefined`), making the line-75 throw dead. Dead defensive branches around a signer/decrypt path
invite a future reader to assume a failure mode is handled when it is not.

**Fix:** Collapse the nested re-check and drop the dead `else` and dead throw:
```ts
let hidden: string[][] = [];
if (hasHiddenTags(draft)) {
  hidden = getHiddenTags(draft) ?? (await unlockHiddenTags({ ...draft, pubkey: (pubkey = await signer.getPublicKey()) }, signer));
}
```

### WR-08: Redundant `Reflect.set` inside `getHiddenGroups`'s compute callback

**File:** `packages/common/src/helpers/groups.ts:139` (comment at `:107-114`)
**Issue:** The comment is accurate — I confirmed that `getOrComputeCachedValue` redefines the same
symbol non-enumerable via `Object.defineProperty` once the callback returns, and that
`configurable: true` from the preceding `Reflect.set` permits that redefinition. But that accuracy
*is* the finding: the write is provably a no-op whose only effect is a transiently-enumerable
descriptor, and it takes eight lines of comment to explain why it is harmless. It is also the sole
reason this site diverges from its seven siblings and needs a bespoke comment at all.

**Fix:** Delete line 139 — `return groups;` on the next line already feeds
`getOrComputeCachedValue`'s `Object.defineProperty` — and delete the now-unnecessary lines 107-114
explaining it. The deferred-defect note (lines 116-138) should stay.

### WR-09: `getAppDataContent`'s truthiness checks lose falsy payloads and defeat the cache

**File:** `packages/common/src/helpers/app-data.ts:52-53`, `:59`, `:63`
**Issue:** `if (cached) return cached;` and `if (!data) return undefined;` test truthiness, not
presence. App data is `unknown`-typed and JSON-parsed, so `0`, `""`, `false` and `null` are all
legitimate decrypted payloads. Each of them: (a) is never served from the cache even once written,
so every call re-runs `getAppDataEncryption` + `safeParse` + `getHiddenContent`; and (b) hits
`if (!data) return undefined` at line 63, so a stored `false` reads back as "no data" — the function
silently converts a valid payload into `undefined`. The `if (!data)` at line 59 likewise sends a
falsy *plaintext* payload down the encrypted branch.

**Fix:** Gate on presence:
```ts
if (Reflect.has(event, AppDataContentSymbol)) return Reflect.get(event, AppDataContentSymbol) as R;
...
let data = getAppDataEncryption(event) ? undefined : safeParse<R>(event.content);
if (data === undefined) {
  const decrypted = getHiddenContent(event);
  if (decrypted) data = safeParse<R>(decrypted);
}
if (data === undefined) return undefined;
```

### WR-10: `UnlockedSeal`'s `SealSymbol` field contradicts the code, and `SealSymbol` carries two incompatible types

**File:** `packages/common/src/helpers/gift-wrap.ts:43-48` (type), `:55`/`:95` (rumor: `Set`), `:222` (gift wrap: single seal), `:85` (reader)
**Issue:** `UnlockedSeal` declares `[SealSymbol]: UnlockedGiftWrapEvent` ("Upstream gift wrap
event"), but nothing writes the gift wrap under `SealSymbol` — `getGiftWrapSeal:217` writes it under
`GiftWrapSymbol`, and `getSealGiftWrap:85` reads `GiftWrapSymbol`. The declared field is a fiction
that `isSealUnlocked`'s `seal is UnlockedSeal` predicate hands to callers as fact: `seal[SealSymbol]`
type-checks as `UnlockedGiftWrapEvent` and is `undefined` at runtime.

Compounding it, `SealSymbol` legitimately holds two different types depending on host: a
`Set<UnlockedSeal>` on rumors (`:55`, `:95`, read by `getRumorSeals:90`) and a single seal object on
gift wraps (`:222`, declared at `:39`). `removeParentSealReference:62` calls `parents.delete(seal)`
on whatever it finds — a `Set` method a plain seal object does not have — so a host mix-up is a
runtime TypeError rather than a type error.

**Fix:** Drop `[SealSymbol]: UnlockedGiftWrapEvent` from `UnlockedSeal` (the upstream link is
`GiftWrapSymbol`, already reachable via `getSealGiftWrap`), and split the rumor-side parent set onto
its own symbol (e.g. `ParentSealsSymbol: Set<UnlockedSeal>`) so one symbol has one type.

### WR-11: Unverified hedge shipped as an explanatory comment, and its premise is narrower than stated

**File:** `packages/common/src/helpers/encrypted-content-cache.ts:38-48`, `:53-55`
**Issue:** The comment ends with "Whether that is reachable is unverified here … but
replaceable-history and cross-store paths were not traced as part of this comment-only fix." A
comment whose job is to explain a write site instead records the author's unfinished work; it is not
actionable and will not age into being actionable.

Its checkable premise is also incomplete. "EventMemory.add keeps the originally-tracked object for a
same-id duplicate and discards the newcomer entirely" is true (`event-memory.ts:78-81`:
`const current = this.events.get(id); if (current) return current;`) — but only while the id is
*still tracked*. `EventStore.prune()` (`event-store.ts:473`) and `EventStore.remove()`
(`event-store.ts:334`) both evict from `memory`, after which a re-delivered logically-identical
event becomes a new distinct object with no `EncryptedContentFromCacheSymbol`. That is precisely the
"filter fails open and re-persists already-cached content" scenario the comment describes, reachable
without touching replaceable-history or cross-store paths.

Separately, `isEncryptedContentFromCache:54` uses `Reflect.has`, which walks the prototype chain and
ignores the value — it returns `true` for a flag explicitly set to `false`. The writer only ever
sets `true`, so this is latent, but it is inconsistent with `isFromCache` (`event.ts:188`), which
checks `Reflect.get(...) === true`.

**Fix:** Replace the hedge with the traced conclusion (prune/remove evict, so the flag *is* lost on
re-delivery of an evicted event), or drop the paragraph and file the question in STATE.md's Deferred
Items. Change `isEncryptedContentFromCache` to
`Reflect.get(event, EncryptedContentFromCacheSymbol) === true` to match `isFromCache`.

---

## Verified — claims I tried to break and could not

Recorded so a later round does not re-litigate them:

- `cache.ts:88-94` — `configurable: true` rationale. `pipeline.ts:63` uses `Reflect.deleteProperty`,
  which returns `false` rather than throwing on a non-configurable property. Claim holds.
- `cache.ts:95-99` — `writable: true` is not required for `setCachedValue`'s own overwrite.
  `Object.defineProperty` + `configurable: true` permits redefinition regardless. Claim holds.
- `cache.ts:100-105` — `Object.defineProperty` throws on frozen/sealed/non-extensible where
  `Reflect.set` returns `false`. Claim holds; the "not limited to replaceable events" half is also
  correct (see WR-02 for the part that isn't).
- `groups.ts:107-114` — the in-callback `Reflect.set` is overridden non-enumerable by the enclosing
  `getOrComputeCachedValue`. Claim holds (the write is redundant, see WR-08).
- `groups.ts:116-138` — the deferred `undefined`-memoization narrative, including the
  `isHiddenGroupsUnlocked` / `unlockHiddenGroups` reachability analysis and the "direct call on a
  poisoned-but-locked bookmark does not hit this" carve-out. Traced; accurate. Deferred per STATE.md.
- `cache.test.ts:86-109` — the carry-forward half is non-vacuous: `includeAltTag` →
  `modifyPublicTags`'s `{ ...draft, tags }` sits between the write and `sign`'s enumerability-blind
  re-copy, so a non-enumerable write at `modifyHiddenTags`'s return would fail the suite. Claim holds.
- `concord/keys.ts:94-121` and `:558-568` — the CONCORD-H01 narrative against `rollForward`'s
  `{ ...keys.material, ... }` and `rollForwardChannel`'s `{ ...channel, ... }` spreads, and the
  `JSON.stringify`-skips-symbols / spread-copies-symbols asymmetry. Claims hold.
- `encrypted-content.ts:117-124` — `setEncryptedContentCache`'s enumerable write is required because
  `modifyPublicTags`'s `{ ...draft, tags }` would drop a non-enumerable one. Claim holds.
- `operations/event.ts:132-143`, `:170-180` — `stamp`/`sign`'s `Reflect.has/get/set` copies are
  enumerability-blind and independent of `PRESERVE_EVENT_SYMBOLS`. Claims hold.
- `.changeset/*` — both files are single-sentence, single-change, per CLAUDE.md. The `minor` (throw)
  vs `patch` (non-enumerable) split is defensible: both derive from one edit but are two distinct
  observable changes, and the throw is the more visible break.

---

_Reviewed: 2026-07-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
