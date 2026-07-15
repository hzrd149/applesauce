---
phase: 05-cache-identity-memo-fix
reviewed: 2026-07-15T17:50:00Z
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
  critical: 3
  warning: 10
  info: 3
  total: 16
status: issues_found
supersedes: prior 05-REVIEW.md dated 2026-07-15T13:30:00Z
---

# Phase 05: Code Review Report

**Reviewed:** 2026-07-15T17:50:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

This phase is a comment-accuracy round: plans 05-06 through 05-11 rewrote explanatory comments that a
prior review found to be false of the code beneath them. The review axis applied here was therefore
"is each comment TRUE of the code it describes?", cross-checked against the actual property
descriptors and against the real membership of `EventStore.copySymbolsToDuplicateEvent`'s merge list.
Three findings were confirmed by executing probe tests against the current tree, not by reading alone.

**What holds up.** The per-site sweep across common (`bookmark.ts`, `mute.ts`, `emoji-pack.ts`,
`trusted-assertions.ts`, `lists.ts`, `app-data.ts`) and core (`contacts.ts`, `hidden-tags.ts`,
`filter.ts`, `event.ts#getEventUID`, `casts/cast.ts`) is now accurate: each of those sites really is
a hand-rolled enumerable `Reflect.set`, each really does survive a spread today, and
`pipeFromAsyncArray`'s delete loop really is the only thing scrubbing them. `markEncryptedContentFromCache`'s
merge-list exclusion claim is true (the list is `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]`).
`groups.ts`'s subtle "the enclosing `getOrComputeCachedValue` redefines this non-enumerable after the
callback returns" claim is true. The `concord/keys.ts` CONCORD-H01 narrative is true and its two
"ARM THE MEMO" tests are genuinely non-vacuous. `cache.test.ts`'s enforcement contract holds under
tracing (see IN-03).

**What does not.** Three findings block:

1. The taxonomy's single load-bearing **worked example is factually false**. `cache.ts` states
   `EncryptedContentSymbol` "has TWO write sites, BOTH carry-forward payload". There are **seven**,
   and `event-store.ts`'s own phase-05 comment classifies one of them as *accumulated state* — a
   direct contradiction under an exhaustive "TWO" claim. This is the example the taxonomy cites as
   the thing a symbol-to-category table "would be wrong on"; it is now wrong on its own example.
2. The **frozen-event throw's blast radius is materially understated**, proven wider than both the
   comment and the changeset admit. `cache.ts` says the throw is reachable because `EventStore.add`
   calls `getReplaceableIdentifier` "on every replaceable event". In fact `EventStore.add` calls
   `getExpirationTimestamp` — also a `getOrComputeCachedValue` route — on **every** event, so
   `store.add()` now throws a `TypeError` on any frozen event, regular kinds included.
3. `groups.ts#getHiddenGroups` **permanently poisons its memo with `undefined`**, making
   `unlockHiddenGroups` resolve `undefined` against a `Promise<GroupPointer[]>` signature and making
   `isHiddenGroupsUnlocked`'s type guard lie. The phase's comment sits directly on this site and
   ratifies it as correct.

The "zero behavior change" intent held for the comment plans; the one deliberate runtime change
(05-01's non-enumerable write) is correct in itself, but CR-02 shows its release framing is wrong.

## Narrative Findings (AI reviewer)

_No `<structural_findings>` block was supplied for this review, so there is no fallow-substrate
section. All findings below are narrative._

## Critical Issues

### CR-01: `cache.ts`'s worked example asserts a false, exhaustive write-site count and contradicts `event-store.ts`

**File:** `packages/core/src/helpers/cache.ts:44-66` (worked example), cross-referenced against
`packages/core/src/event-store/event-store.ts:219-228`

**Issue:** The taxonomy's worked example — the passage that justifies the entire "categories classify
WRITE SITES, not symbols" framing — opens with:

> Worked example — `EncryptedContentSymbol` has TWO write sites, BOTH carry-forward payload but for
> DIFFERENT reasons

"TWO" is an exhaustive claim. The actual write sites for `EncryptedContentSymbol` in core + common
are **seven**:

| # | Site | Mechanism | Cited by the example? |
|---|------|-----------|----------------------|
| 1 | `operations/tags.ts:90` (`modifyHiddenTags`) | object literal | yes |
| 2 | `helpers/encrypted-content.ts:125` (`setEncryptedContentCache`) | `Reflect.set` | yes |
| 3 | `operations/encrypted-content.ts:29` (`setEncryptedContent`) | object literal | **no** |
| 4 | `operations/event.ts:143` (`stamp`) | `Reflect.set` | no |
| 5 | `operations/event.ts:180` (`sign`) | `Reflect.set` | no |
| 6 | `event-store/event-store.ts:225` (merge loop) | `Reflect.set` | no |
| 7 | `common/operations/gift-wrap.ts:141` (`wrapSeal`) | `Reflect.set` | no |

Site 3 is the most damaging omission: `setEncryptedContent`'s
`return { ...draft, content: encrypted, [EncryptedContentSymbol]: content }` is structurally
*identical* to site 1, which the example presents as one of only two. Sites 4/5 are described in
`operations/event.ts`'s own phase-05 comments as carry-forward payload, so they are known to the
phase and still uncounted.

Worse, site 6 is classified **differently** by this phase's own comment:

```ts
// packages/core/src/event-store/event-store.ts:222-224
// These three symbols propagate across duplicate events via this loop rather than via
// object spread — accumulated state (see cache.ts taxonomy). SeenRelaysSymbol merges via
// the separate element-wise branch above instead; this loop is not the category's sole definition.
```

`EncryptedContentSymbol` is one of "these three". So `event-store.ts` calls a write site of
`EncryptedContentSymbol` *accumulated state*, while `cache.ts` says that symbol has exactly two write
sites and **both** are *carry-forward payload*. Under the "TWO" claim these two comments cannot both
be true. A reader reconciling them concludes the taxonomy is unreliable — the precise failure mode
05-06 was written to eliminate. The example is not incidentally wrong; it is wrong in exactly the way
it warns the reader about.

**Fix:** Drop the exhaustive count, make the example enumerate-by-contrast rather than by-census, and
reconcile it with the merge-loop site explicitly:

```ts
 * Worked example — `EncryptedContentSymbol` is written at several sites that do NOT share a
 * category, proving the taxonomy classifies write sites (not symbols) and that a site's PURPOSE
 * does not decide its category. Three of them:
 *   - carry-forward payload at `operations/tags.ts`'s `modifyHiddenTags` return — the write/build
 *     path ... (existing text unchanged)
 *   - carry-forward payload at `helpers/encrypted-content.ts`'s `setEncryptedContentCache` — the
 *     read/unlock path ... (existing text unchanged)
 *   - accumulated state at `EventStore.copySymbolsToDuplicateEvent`'s merge loop — the dedup path,
 *     where the write propagates an already-unlocked plaintext onto the surviving instance and
 *     spread survival is not the question being answered.
 *   `operations/encrypted-content.ts`'s `setEncryptedContent` and `operations/event.ts`'s
 *   `stamp`/`sign` are further carry-forward sites; this list is illustrative, not a census.
```

---

### CR-02: The frozen-event throw reaches every insert, not just replaceable ones — and ships as a `patch`

**File:** `packages/core/src/helpers/cache.ts:86-95`; `.changeset/cache-frozen-event-throws.md:1-5`

**Issue:** `cache.ts` scopes the reachability of 05-01's new `TypeError` like this:

> `getReplaceableIdentifier` routes through `getOrComputeCachedValue`, and `EventStore.add` calls it
> on every replaceable event, so this is reachable from a normal insert.

True, but the *narrow* path. `EventStore.add` reaches `getOrComputeCachedValue` earlier and
unconditionally, via `getExpirationTimestamp`:

- `packages/core/src/event-store/event-store.ts:248` — `const expiration = getExpirationTimestamp(event);` — runs for **every** event, before the `isReplaceable` branch at line 255.
- `packages/core/src/helpers/expiration.ts:9` — `return getOrComputeCachedValue(event, ExpirationTimestampSymbol, ...)`.

Verified by executing a probe against the current tree:

```
EventStore.add(Object.freeze(user.event({ kind: 30000, tags: [["d","x"]] })))
  → TypeError                                          (matches the comment)
EventStore.add(Object.freeze(user.note("hi")))         (a regular kind — comment implies safe)
  → TypeError: Cannot define property Symbol(expiration-timestamp), object is not extensible
```

`packages/core/src/event-store/async-event-store.ts:215` has the identical call and the identical
exposure. So "reachable from a normal insert" understates by a wide margin: **no** frozen event can
be inserted into either store any more. The comment names Redux Toolkit / immer as affected consumers
but leaves the reader believing only replaceable kinds are hit, which is precisely the wrong mental
model for someone triaging a `TypeError` on a kind-1 note.

Compounding this, `.changeset/cache-frozen-event-throws.md` declares `"applesauce-core": patch` for
what is a runtime-breaking change for every consumer that freezes events in development. The throw is
unconditional on `EventStore.add`, not opt-in, and there is no escape hatch.

**Fix:** Correct the reachability claim and re-bump the changeset.

```ts
 *     Consumers that freeze events (e.g. Redux Toolkit / immer freezing state
 *     in development) will see a throw where they previously saw silent
 *     degradation, and the exposure is total rather than kind-specific:
 *     `EventStore.add`/`AsyncEventStore.add` call `getExpirationTimestamp`
 *     (which routes through `getOrComputeCachedValue`) on EVERY event before any
 *     kind branching, so no frozen event can be inserted at all. The replaceable
 *     path adds `getReplaceableIdentifier` on top of that.
```

```md
---
"applesauce-core": minor
---

Writing a cached value onto a frozen or otherwise non-extensible event now throws where it previously failed silently; `EventStore.add` therefore rejects frozen events of any kind.
```

---

### CR-03: `getHiddenGroups` permanently caches `undefined`, breaking `unlockHiddenGroups` and lying in its type guard

**File:** `packages/common/src/helpers/groups.ts:93-119` (phase-05 comment at 107-114)

**Issue:** `getHiddenGroups` is the only hidden-list helper in the sweep that wraps its whole body in
`getOrComputeCachedValue`, and its compute callback can return `undefined`:

```ts
return getOrComputeCachedValue(bookmark, GroupsHiddenSymbol, () => {
  const tags = getHiddenTags(bookmark);
  if (!tags) return undefined;   // <-- memoized as a real own property whose value is `undefined`
  ...
});
```

`getOrComputeCachedValue` gates on `Reflect.has`, not on the value, so `undefined` is cached
permanently. Any read before the hidden tags are unlocked poisons the event forever. Verified by
executing a probe against the current tree:

```
getHiddenGroups(lockedEvent)            -> undefined
GroupsHiddenSymbol in lockedEvent       -> true          // poisoned
setHiddenTagsCache(event, [["group", ...]])               // tags now genuinely unlocked
getHiddenGroups(event)                  -> undefined      // still undefined, forever
isHiddenGroupsUnlocked(event)           -> true           // type guard now lies
await unlockHiddenGroups(event, signer) -> undefined      // declared Promise<GroupPointer[]>
```

Three distinct consequences:

- `unlockHiddenGroups` resolves `undefined` while declared `Promise<GroupPointer[]>`. Its
  `if (!groups) throw new Error("Failed to unlock hidden groups")` guard at line 135 is bypassed,
  because line 128's `if (isHiddenGroupsUnlocked(bookmark)) return bookmark[GroupsHiddenSymbol]`
  fires first. Every caller doing `(await unlockHiddenGroups(e, s)).length` gets a `TypeError` at a
  call site the types said was safe.
- `isHiddenGroupsUnlocked` narrows to `T & UnlockedGroups`, so `bookmark[GroupsHiddenSymbol]` is
  typed `GroupPointer[]` and is `undefined`.
- Contrast the siblings: `mute.ts:77-96`, `bookmark.ts:91-110`, `trusted-assertions.ts:82-97` and
  `emoji-pack.ts:96-111` all `return undefined` *before* writing, and are unaffected. Confirmed by
  execution that `getHiddenMutedThings` recovers after unlock where `getHiddenGroups` does not — the
  bug is specific to this one site's use of `getOrComputeCachedValue`.

The phase-05 comment sits directly on this write site and ratifies it — "correctly does not survive a
spread — no `pipeFromAsyncArray` delete-loop mask is needed for this site" — validating the site's
descriptor while its caching semantics are broken. This is exactly the "reviewed and blessed" outcome
an adversarial pass exists to catch: the comment is *true about the descriptor* and blind to the
defect one line above it.

**Fix:** Do not memoize the negative result; mirror the sibling helpers' shape.

```ts
export function getHiddenGroups<T extends NostrEvent>(bookmark: T): GroupPointer[] | undefined {
  if (GroupsHiddenSymbol in bookmark) return bookmark[GroupsHiddenSymbol] as GroupPointer[];

  // get hidden tags — bail BEFORE writing so a locked read cannot poison the memo
  const tags = getHiddenTags(bookmark);
  if (!tags) return undefined;

  const groups = processTags(
    tags.filter((t) => t[0] === "group"),
    getGroupPointerFromGroupTag,
  );

  // identity memo — non-enumerable, dropped by a spread (see cache.ts taxonomy)
  setCachedValue(bookmark, GroupsHiddenSymbol, groups);
  return groups;
}
```

Then rewrite the comment: with `setCachedValue` the "the enclosing `getOrComputeCachedValue`
immediately redefines the same symbol non-enumerable" reasoning no longer applies and must not be
left behind stale.

## Warnings

### WR-01: `getSealRumor`'s `undefined` sentinel makes `unlockSeal`/`unlockGiftWrap` return `undefined` typed as `Rumor`

**File:** `packages/common/src/helpers/gift-wrap.ts:153-164`, `240-254`, `260-278`

**Issue:** The comment on the sentinel write is accurate and self-aware — but it documents a live
correctness bug and defers it:

```ts
Reflect.set(seal, RumorSymbol, undefined);
```

`isSealUnlocked` (line 113) checks `RumorSymbol in seal`, which is now `true`. `unlockSeal` (line 242)
therefore returns `seal[RumorSymbol]` — `undefined` — typed `Rumor`, never reaching its own
`if (!rumor) throw` at line 248. `unlockGiftWrap` (line 262) inherits it via `getGiftWrapRumor`. Any
caller of `(await unlockGiftWrap(g, s)).kind` on a seal whose content failed to parse gets a
`TypeError`. A malformed or hostile seal is an attacker-influenced input arriving over a relay, so
this is reachable from the network, not just from local corruption.

The comment scopes the fix as "out of this phase's comment-only scope", which is a defensible phase
boundary — but a comment is not a tracking mechanism, and the finding will be lost with the phase.

**Fix:** Narrow the presence check to a value check so the sentinel cannot be mistaken for an unlocked
rumor:

```ts
export function isSealUnlocked(seal: NostrEvent): seal is UnlockedSeal {
  return (
    (RumorSymbol in seal && Reflect.get(seal, RumorSymbol) !== undefined) ||
    (isEncryptedContentUnlocked(seal) === true && getSealRumor(seal) !== undefined)
  );
}
```

If it stays deferred, raise a backlog item rather than relying on the in-file comment.

---

### WR-02: Two core sites kept the "not via object spread" phrasing the same sweep corrected elsewhere

**File:** `packages/core/src/helpers/relays.ts:16-18`; `packages/core/src/helpers/event.ts:180-182`

**Issue:** Both writes are enumerable `Reflect.set`, so both values **do** survive an object spread.
Both comments say the opposite-sounding thing:

```ts
// relays.ts — addSeenRelay
// SeenRelaysSymbol is propagated across duplicate events via the element-wise seen-relays
// merge in EventStore.copySymbolsToDuplicateEvent (a separate branch from that function's
// symbol merge list), not via object spread — accumulated state (see cache.ts taxonomy).
```
```ts
// event.ts — markFromCache
// FromCacheSymbol is propagated across duplicate events via the event store's merge list
// (EventStore.copySymbolsToDuplicateEvent), not via object spread — accumulated state (see
// cache.ts taxonomy).
```

Read as mechanism claims ("the store's merge is what propagates these across duplicates") they are
true. Read as descriptor claims ("this does not survive a spread") they are false. That ambiguity is
the exact thing 05-09 removed from the eight common sites, which now read:

> Written here with a plain enumerable `Reflect.set`, so it DOES survive a spread today...

Leaving two core sites on the old phrasing means the codebase now teaches two contradictory readings
of the same words, which is worse than either alone — a reader who learns the common phrasing will
mis-read the core one. Both `FromCacheSymbol` and `SeenRelaysSymbol` surviving a spread is harmless
(that is the point of the category), but the comment should say so rather than leave it to inference.

**Fix:** Align the phrasing and state the descriptor explicitly.

```ts
// relays.ts
// Accumulated state (see cache.ts taxonomy): propagated across duplicate events by the
// element-wise seen-relays merge in EventStore.copySymbolsToDuplicateEvent (a separate branch
// from that function's symbol merge list). This write is a plain enumerable Reflect.set, so the
// Set also rides along on a spread — harmless here, since the value is not bound to the host's
// own fields and a copy is not required to recompute it.
```

Apply the mirror wording to `markFromCache`.

---

### WR-03: `wrapSeal`'s `GiftWrapSymbol` claim credits `PRESERVE_EVENT_SYMBOLS` for something it does not do here

**File:** `packages/common/src/operations/gift-wrap.ts:120-125`

**Issue:**

```ts
// Set the upstream reference on the seal: ... `GiftWrapSymbol` is registered into
// `PRESERVE_EVENT_SYMBOLS` above, which stops `eventPipe`'s delete loop from scrubbing it
// mid-pipe ...
Reflect.set(seal, GiftWrapSymbol, gift);
```

`pipeFromAsyncArray` (`packages/core/src/helpers/pipeline.ts:59-65`) only scrubs `result`, never
`prev`:

```ts
const keys = Reflect.ownKeys(result).filter((key) => typeof key === "symbol");
for (const symbol of keys) if (!preserve.has(symbol)) Reflect.deleteProperty(result, symbol);
```

In `giftWrap = eventPipe(toRumor, sealRumor, wrapSeal)`, `wrapSeal`'s `result` is `gift`; `seal` is
`prev`. The delete loop never inspects `seal` after this write, so `GiftWrapSymbol`'s membership in
`PRESERVE_EVENT_SYMBOLS` is not what protects it — nothing threatens it on this path. The comment
asserts a causal mechanism the code does not exercise. `sealRumor`'s `SealSymbol` write onto `rumor`
(line 94) has the same structure and its comment is correctly silent on preservation, which makes the
inconsistency visible within the same file.

By contrast, `wrapSeal`'s `SealSymbol` and `EncryptedContentSymbol` writes land on `gift` (the
`result`), where the preservation claim *is* load-bearing and correct — so the fix is site-specific,
not file-wide.

**Fix:**

```ts
// Set the upstream reference on the seal: an object-reference link to `gift`, not a value copy.
// This write lands on the pipe's `prev` (the seal), which `eventPipe`'s delete loop never
// inspects — the loop only scrubs each operation's `result` — so PRESERVE_EVENT_SYMBOLS
// membership is not what protects this write. It is NOT carried onto a redelivered duplicate by
// `EventStore.copySymbolsToDuplicateEvent`'s merge list, which has no gift-wrap symbols —
// accumulated state (see cache.ts taxonomy).
```

---

### WR-04: `stamp()` mutates its caller's draft

**File:** `packages/core/src/operations/event.ts:125-130`

**Issue:** Every other operation in this file is pure (`{ ...draft, ... }`). `stamp` is not:

```ts
return async (draft) => {
  if (!signer) throw new Error("Missing signer");

  // Remove old fields from signed nostr event
  Reflect.deleteProperty(draft, "id");
  Reflect.deleteProperty(draft, "sig");

  const pubkey = await signer.getPublicKey();
  const newDraft = { ...draft, pubkey };
```

`draft` is the caller's object. Passing a signed `NostrEvent` into `stamp()` or `sign()` silently
strips `id` and `sig` from the *caller's* event — including an event that is live in an `EventStore`,
where `id` is the memory key. The intent is clearly to build a clean `newDraft`, which the spread on
the next line already achieves for every field except these two, so the mutation buys nothing.

**Fix:**

```ts
return async (draft) => {
  if (!signer) throw new Error("Missing signer");

  const pubkey = await signer.getPublicKey();
  // Copy first, then remove old fields from the copy — never mutate the caller's draft
  const newDraft = { ...draft, pubkey };
  Reflect.deleteProperty(newDraft, "id");
  Reflect.deleteProperty(newDraft, "sig");
```

`sign()` reads `Reflect.has(draft, "pubkey")` at line 164 *after* calling `stamp`; that guard is
unaffected (`pubkey` was never deleted), but re-run the factory suites to confirm nothing depended on
the mutation.

---

### WR-05: `addParentSealReference`'s "same shape as `SeenRelaysSymbol`" analogy contradicts `cache.ts`

**File:** `packages/common/src/helpers/gift-wrap.ts:53-55`

**Issue:**

```ts
// Mutated in place across calls (the Set gains members over time), the same shape as
// applesauce-core's SeenRelaysSymbol — accumulated state (see cache.ts taxonomy), not a memo.
```

`cache.ts:27-36` draws an explicit line between exactly these two:

> `SeenRelaysSymbol` propagates via a SEPARATE, element-wise merge in that same function ...
> applesauce-common's `Seal`/`Rumor`/`GiftWrap` symbols are **not merged by any event store at all**
> (they are unknown to applesauce-core) and propagate by shared object reference.

So the taxonomy's own text says these are *different* propagation mechanisms, and "the same shape as
`SeenRelaysSymbol`" invites the reader to expect the store to merge `SealSymbol` across duplicates,
which it does not. `cache.ts` also warns in the same paragraph that "mutability of the value is NOT
the test for this category" — yet the mutable-`Set` shape is the only thing this analogy rests on, so
the comment leans on precisely the discriminator the taxonomy disallows.

**Fix:** Anchor the analogy on the category test, not on the container:

```ts
// Mutated in place across calls (the Set gains members over time) and never bound to the rumor's
// own fields, so a copy is not required to recompute it — accumulated state (see cache.ts
// taxonomy), not a memo. Unlike core's SeenRelaysSymbol, no event store merges this symbol across
// duplicate events; it propagates only by shared object reference.
```

---

### WR-06: Duplicated category label in `wrapSeal`, plus an over-broad "ONLY" claim

**File:** `packages/common/src/operations/gift-wrap.ts:134-141`

**Issue:** The same site is labelled twice, the second a bare restatement of what the paragraph above
already established at length:

```ts
    // Set the encrypted content on the gift wrap. This is the ONLY carry-forward site in
    // applesauce-common: the plaintext must survive downstream spreads exactly like
    // ... Surrounded by accumulated-state writes above, this is the easiest site in the monorepo
    // for a future cleanup to sweep up by mistake.
    // carry-forward payload (see cache.ts taxonomy).      <-- redundant leftover
    Reflect.set(gift, EncryptedContentSymbol, plaintext);
```

This reads as a merge artifact from the 05-03 → 05-09 rewrites. Separately, "the ONLY carry-forward
site in applesauce-common" is true only under a strict *write-site* reading:
`helpers/encrypted-content-cache.ts:95` and `:127` call `setEncryptedContentCache`, which performs
carry-forward writes on applesauce-common code paths. Given the comment's own stated purpose is to
stop a future cleanup sweeping the site up by mistake, "ONLY" is the wrong word to hand that reader —
it tells them to stop looking.

**Fix:** Delete the duplicate line and qualify the claim:

```ts
    // ... This is the only carry-forward WRITE site in applesauce-common (helpers/
    // encrypted-content-cache.ts also produces carry-forward writes, but through core's
    // setEncryptedContentCache rather than a local Reflect.set). Surrounded by accumulated-state
    // writes above, this is the easiest site in the monorepo for a future cleanup to sweep up by
    // mistake — carry-forward payload (see cache.ts taxonomy).
```

---

### WR-07: `markEncryptedContentFromCache`'s comment ends in an unparseable fragment and misses the real asymmetry

**File:** `packages/common/src/helpers/encrypted-content-cache.ts:37-43`

**Issue:**

```ts
// ... and is only ever read on the instance it was written to. Consequence:
// isEncryptedContentFromCache gates persistEncryptedContent below — assuming provenance survives dedup goes untested.
```

The final sentence does not parse — "Consequence: X gates Y — assuming Z goes untested" has no
coherent subject/predicate — so a reader cannot extract the intended warning at all.

The "only ever read on the instance it was written to" claim is also imprecise, and the real
consequence is sharper than the sentence gestures at: `EventStore.copySymbolsToDuplicateEvent` merges
`EncryptedContentSymbol` onto the stored instance *without* `EncryptedContentFromCacheSymbol` (which
is not in the list). So a cache-restored duplicate's plaintext lands on a stored event that reads
`isEncryptedContentFromCache() === false`, and `persistEncryptedContent` writes content that came from
the cache back to the cache. Idempotent today, but that is the actual asymmetry worth naming.

**Fix:**

```ts
/** Marks the encrypted content as being from a cache */
export function markEncryptedContentFromCache<T extends object>(event: T) {
  // A restore-provenance flag: unlike FromCacheSymbol it is NOT in
  // EventStore.copySymbolsToDuplicateEvent's merge list (see cache.ts taxonomy), so it does not
  // follow its own payload across dedup. EncryptedContentSymbol IS in that list, so a
  // cache-restored duplicate's plaintext can land on a stored instance that reads
  // isEncryptedContentFromCache() === false — causing persistEncryptedContent below to write
  // cache-sourced content back to the cache. Idempotent today, and untested.
  Reflect.set(event, EncryptedContentFromCacheSymbol, true);
}
```

---

### WR-08: `of(null)` returned from a Promise `.catch` in the restore pipeline

**File:** `packages/common/src/helpers/encrypted-content-cache.ts:83-87`

**Issue:**

```ts
getItem(storage, event).catch((error) => {
  log(`Failed to restore encrypted content for ${event.id}`, error);
  return of(null);        // <-- an RxJS Observable, inside a Promise catch
}),
```

The `.catch` handler must resolve to the same shape as the success path (`string | null`) but returns
an `Observable<null>`. `combineLatest` unwraps the promise and emits that `Observable` object as
`content`. It is caught only incidentally by `if (typeof content !== "string") return;` at line 91 —
the widened type is never surfaced because the value flows through `mergeMap`/`combineLatest`
untyped. A future edit that loosens that guard to the more idiomatic `if (!content) return;` would
pass a truthy `Observable` straight into `setEncryptedContentCache`, silently caching an RxJS object
as an event's decrypted plaintext.

**Fix:**

```ts
getItem(storage, event).catch((error) => {
  log(`Failed to restore encrypted content for ${event.id}`, error);
  return null;
}),
```

---

### WR-09: `cache.ts`'s identity-memo definition states an invariant that ~12 documented sites violate, without disclosing it

**File:** `packages/core/src/helpers/cache.ts:9-13`

**Issue:** Category 1 is stated normatively and absolutely:

> **identity memo** — a derivation of the object's own current fields. A copy with changed fields
> MUST recompute, so it must NOT survive a spread.

Every write-site comment this phase produced then documents the opposite for sites it classifies as
identity memos: `hidden-tags.ts:104-108` and `:152-156`, `contacts.ts:94-98`, `filter.ts:23-28`,
`event.ts:128-132`, `casts/cast.ts:56-62`, `lists.ts:47-52`, `bookmark.ts:101-106`, `mute.ts:87-92`,
`emoji-pack.ts:103-108` and `:126-131`, `trusted-assertions.ts:89-94`, `app-data.ts:65-70` — each
says "identity memo ... but it DOES survive a spread today ... known, deliberately-deferred gap".

So the taxonomy's headline definition is contradicted by roughly a dozen sites the same phase
annotated, and `cache.ts` — the document every one of those comments points back to — never mentions
that the invariant currently holds only for the subset routed through this helper. A reader who reads
`cache.ts` alone (the intended entry point) comes away believing identity memos never survive a
spread, then meets `filter.ts`'s `getIndexableTags` and concludes one of the two is lying.

**Fix:** Add the disclosure at the definition so the taxonomy and the sites agree:

```ts
 * 1. **identity memo** — a derivation of the object's own current fields. A copy
 *    with changed fields MUST recompute, so it must NOT survive a spread. This is
 *    what `setCachedValue`/`getOrComputeCachedValue` write ... (existing text unchanged)
 *    NOTE: that invariant currently holds only for memos routed through THIS helper.
 *    Roughly a dozen hand-rolled identity-memo sites across core/common still write
 *    enumerable via a bare `Reflect.set` and DO survive a spread today (each is
 *    annotated in place as a deliberately-deferred gap); only `pipeFromAsyncArray`'s
 *    delete loop masks them, and only on the one call path that runs it.
```

---

### WR-10: `cache.ts` category 3 enumerates two merge-list members where the list has three

**File:** `packages/core/src/helpers/cache.ts:30-33` vs `packages/core/src/event-store/event-store.ts:219-224`

**Issue:**

```ts
// cache.ts
 *    `FromCacheSymbol` and `verifiedSymbol` propagate via the symbol merge loop in
 *    `EventStore.copySymbolsToDuplicateEvent`.
```
```ts
// event-store.ts
const symbols = [FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol];
...
// These three symbols propagate across duplicate events via this loop ...
```

`cache.ts` names two, `event-store.ts` says three. Not strictly false — `cache.ts` does not say
"only" — but the two comments cross-reference each other, and a reader checking one against the other
finds a mismatch in the very list membership the phase set out to make citable. This is also the seam
CR-01 falls through: `EncryptedContentSymbol`'s absence here is what lets the worked example claim two
write sites while the merge loop quietly holds a third. Fixing WR-10 and CR-01 together is what makes
the taxonomy internally consistent.

**Fix:** Name all three, and connect it to the worked example:

```ts
 *    `FromCacheSymbol`, `verifiedSymbol`, and `EncryptedContentSymbol` propagate via the
 *    symbol merge loop in `EventStore.copySymbolsToDuplicateEvent`. (`EncryptedContentSymbol`
 *    appearing here as well as in the worked example below is not a contradiction — it is the
 *    point: the merge-loop WRITE is accumulated state, while its factory-pipe writes are
 *    carry-forward payload.)
```

## Info

### IN-01: Stale-prone line-number citation survives the sweep

**File:** `packages/common/src/helpers/gift-wrap.ts:92-94`

**Issue:** The one remaining `line ~N` citation in the reviewed set:

```ts
// Lazily initializes the same mutable Set addParentSealReference (line ~53) grows over
// time — accumulated state (see cache.ts taxonomy), not a memo.
```

`addParentSealReference` is declared at line 51 and its `Reflect.set` is at line 55; "~53" is already
approximate, and this file gained 27 lines during the phase. Function-name citations are the intended
form everywhere else in the sweep.

**Fix:** `// Lazily initializes the same mutable Set that addParentSealReference grows over time —`

---

### IN-02: `SealSymbol` carries two incompatible value shapes and one wrong type declaration

**File:** `packages/common/src/helpers/gift-wrap.ts:28`, `43-48`, `89-98`, `193`

**Issue:** `SealSymbol` means different things depending on the host:

- on a **gift wrap**: a single seal object (`getGiftWrapSeal`, line 193: `gift[SealSymbol] as UnlockedSeal`)
- on a **rumor**: a `Set<UnlockedSeal>` (`getRumorSeals`, line 90; `addParentSealReference`, line 55)

and `UnlockedSeal` declares it as a third thing entirely — `[SealSymbol]: UnlockedGiftWrapEvent` —
even though the upstream gift wrap is actually read from `GiftWrapSymbol` (`getSealGiftWrap`,
line 85). The doc comment at line 27 acknowledges the overload ("seal event on gift wraps (downstream)
or the seal event on rumors (upstream[])") but the types do not encode it, so nothing stops
`getRumorSeals(giftWrap)` from clobbering a gift wrap's seal reference with an empty `Set`. Not
reachable through the current public API; worth splitting into a distinct `RumorSealsSymbol` if this
area is touched again.

**Fix:** Split the symbol, or at minimum correct `UnlockedSeal[SealSymbol]`'s declared type to match
what `getSealGiftWrap` actually reads.

---

### IN-03: `cache.test.ts`'s enforcement contract is accurate — recorded as a verified negative

**File:** `packages/core/src/helpers/__tests__/cache.test.ts:86-140`

**Issue:** No defect. Recorded because the review focus called it out explicitly. The suite's claim
that `includeAltTag`'s `modifyPublicTags` spread is load-bearing between the write and `sign()` was
traced and holds: `eventPipe(modifyHiddenTags, includeAltTag, sign)` really does place
`{ ...draft, tags }` (`operations/tags.ts:29`) between `modifyHiddenTags`'s
`[EncryptedContentSymbol]: plaintext` literal (`operations/tags.ts:90`) and `sign`'s
enumerability-blind `Reflect.has`/`get`/`set` re-copy (`operations/event.ts:171-180`). A
non-enumerable write at the first would be dropped by the second (`EncryptedContentSymbol`'s
`PRESERVE_EVENT_SYMBOLS` membership stops the delete loop but does not survive a spread), so
`getHiddenTags(signed)` and `getEncryptedContent(signed)` would both fail. The suite is not vacuous.

Its "what this suite does not guard" disclosure (lines 102-106) is correct on both counts:
`setEncryptedContentCache` is not exercised (the fixture's `content: ""` keeps `hasHiddenTags` false
so `modifyHiddenTags` never takes the unlock branch), and `common/operations/gift-wrap.ts` is
cross-package. The `expect(signed.tags).toContainEqual(["alt", altDescription])` assertion correctly
guards against the intervening operation silently no-op'ing. The `concord/keys.ts` "ARM THE MEMO"
tests (`keys.test.ts:198-220`, `channel-rekey.test.ts:92-118`) were checked the same way and are also
non-vacuous: without the priming call, `rollForward`'s spread would have no memo to carry and the
assertion would pass against the pre-05-01 code.

---

_Reviewed: 2026-07-15T17:50:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
