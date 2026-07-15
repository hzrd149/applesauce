---
phase: 05-cache-identity-memo-fix
reviewed: 2026-07-15T13:30:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
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
  warning: 9
  info: 2
  total: 16
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-07-15T13:30:00Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

The one-line runtime change in `packages/core/src/helpers/cache.ts` (`Reflect.set` →
`Object.defineProperty` with `{enumerable: false}`) is correct and does close CONCORD-H01:
`baseKeysFor`/`deriveChannelKeys` memos are now dropped by `rollForward`/`rollForwardChannel`'s
spreads. The concord tests are well-constructed — both arm the memo before asserting, and both
derive the expected value from `crypto.ts` rather than from the implementation, so neither is
vacuous or self-referential. The full `applesauce-core` suite (635 tests) is green.

The problem is everything around it. This phase's deliverable is a *taxonomy* — a body of prose
that future authors will treat as the oracle for "must this write survive a spread?" — and that
taxonomy is not sound. Its two self-declared "machine-readable definitions" are both wrong about
their own cited examples (CR-01); it classifies one write site into a category whose defining
property it then says that site must violate (CR-02); the new test file claims an enforcement
contract it does not implement (CR-03); and thirteen write sites now carry a comment asserting a
property — "must not survive a spread" — that the code beneath them demonstrably does not have
(CR-05). The phase brief states the reason this matters plainly: a false comment is what caused
this bug. These comments are strictly worse than no comments, because the next author will trust
them.

Separately, the write-mechanism change carries an undocumented behavior regression:
`Object.defineProperty` throws on frozen/non-extensible objects where `Reflect.set` silently
returned `false` (WR-03).

All JS-semantics claims below were verified empirically against Node, not asserted from memory.

## Critical Issues

### CR-01: Category 3's "machine-readable definition" is false for every example it cites

**File:** `packages/core/src/helpers/cache.ts:19-23`

**Issue:** The taxonomy defines accumulated state as symbols "propagated by the event store's
merge rather than by spread (e.g. `SeenRelaysSymbol`, and the gift-wrap `Seal`/`Rumor`/`GiftWrap`
symbols)" and then names `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` at
`event-store.ts:219` as "the machine-readable definition of this category". Checked against the
code, the definition both under- and over-includes:

- `SeenRelaysSymbol` is **not** in that list. It is merged separately at `event-store.ts:212-217`
  via `getSeenRelays`/`addSeenRelay`. Verified by grep: `SeenRelaysSymbol` appears in `core/src`
  only in `relays.ts`, `exports.test.ts`, and this very comment.
- `SealSymbol`/`RumorSymbol`/`GiftWrapSymbol` live in **applesauce-common** and are unknown to
  applesauce-core entirely (grep returns zero hits in `packages/core/src`). They are not in the
  list and are not merged by any event store — they are propagated by shared object *reference*,
  which is a different mechanism.
- The list's third member, `EncryptedContentSymbol`, is classified by this same doc as
  carry-forward payload *and* identity memo — i.e. the "definition of category 3" contains a
  symbol the doc says is in categories 1 and 2.

Net: of the four cited members, zero are actually defined by the cited list. An author using
`event-store.ts:219` as the category oracle — exactly as instructed — will misclassify.

**Fix:** Either name the real mechanism per example, or drop the "machine-readable definition"
framing for category 3 (it has no single machine-readable definition):

```ts
 * 3. **accumulated state** — mutable, propagated by an explicit copy rather than by
 *    spread. There is no single list defining this category; the propagation mechanism
 *    differs per symbol:
 *      - `FromCacheSymbol`, `verifiedSymbol` — the merge list at `event-store.ts:219`.
 *      - `SeenRelaysSymbol` — merged element-wise at `event-store.ts:212-217`.
 *      - applesauce-common's `Seal`/`Rumor`/`GiftWrap` symbols — not merged at all;
 *        propagated by shared object reference through `internalGiftWrapEvents`.
```

### CR-02: `setEncryptedContentCache` is classified into a category whose defining property the same sentence says it must violate

**File:** `packages/core/src/helpers/cache.ts:31-38`, `packages/core/src/helpers/encrypted-content.ts:117-123`

**Issue:** The taxonomy's category 1 states an identity memo "must NOT survive a spread"
(`cache.ts:10-11`), and its opening thesis is that categories classify write sites, so the
question at each site is "must THIS WRITE survive a spread?". It then classifies
`encrypted-content.ts:117` as an **identity memo** and, in the next sentence, says "at ITS write
site the value must stay enumerable so it keeps surviving the pipe's spreads." Those cannot both
hold. By the doc's own write-site rule, "must survive a spread" ⇒ **carry-forward payload**.

`encrypted-content.ts:117-122` reproduces the contradiction in a single comment: it justifies the
enumerable write by "preserves that carry-forward half's requirement to survive a spread" and then
concludes "this write site is itself an identity memo."

The underlying enumerability is defensible (a non-enumerable write here would be dropped by
`modifyPublicTags`'s `{ ...draft, tags }` at `tags.ts:29`, costing a signer round-trip to
re-decrypt in the modify-an-unlocked-event path) — but that reason *is* the carry-forward
definition. The classification is what is wrong, and the phase brief names misclassification as a
real bug.

**Fix:** Reclassify the site and state the actual reason:

```ts
 *   - carry-forward payload at `helpers/encrypted-content.ts:123`
 *     (`setEncryptedContentCache`) — the read/unlock path. Although its *purpose* is
 *     memoization (avoiding a repeat signer round-trip), its write must still survive a
 *     spread: an unlocked signed event re-entering the factory pipe hits
 *     `modifyPublicTags`'s `{ ...draft, tags }` (`operations/tags.ts:29`), and a
 *     non-enumerable value would be dropped there and force a re-decrypt. Answering
 *     "must THIS WRITE survive a spread?" = yes ⇒ carry-forward, not memo. That is why
 *     it hand-rolls an enumerable `Reflect.set` instead of calling this helper.
```

### CR-03: The new test file documents an "enforcement contract" it does not enforce

**File:** `packages/core/src/helpers/__tests__/cache.test.ts:88-95`

**Issue:** The comment claims: "if a future cleanup migrates this write site (or
`encrypted-content.ts:117`, `common/operations/gift-wrap.ts:121`) onto `setCachedValue`, this
suite goes red immediately — that is its job." All three claims are false.

1. `encrypted-content.ts` — never executed by this test. The draft is
   `{ kind: kinds.Mutelist, content: "", tags: [] }`, so `hasHiddenTags(draft)` is false
   (`hidden-tags.ts:58-60` requires `content.length > 0`), `modifyHiddenTags` takes the
   `else hidden = []` branch at `tags.ts:72`, and no unlock/`setEncryptedContentCache` path runs.
2. `common/operations/gift-wrap.ts` — a different package that this test file does not import.
   It cannot go red.
3. `operations/tags.ts` — **would still pass.** After `modifyHiddenTags` returns, `sign` runs
   with no intervening spread. `stamp` (`operations/event.ts:133-137`) does
   `Reflect.has(draft, EncryptedContentSymbol)` → `Reflect.get` → `Reflect.set(newDraft, ...)`,
   and `sign` (`operations/event.ts:165-169`) repeats it onto `signed`. `Reflect.has`/`get`/`set`
   are all **enumerability-blind**, so a non-enumerable write at `tags.ts:90` still reaches
   `signed`, and both `getHiddenTags(signed)` and `getEncryptedContent(signed)` still resolve.

The suite is a valid smoke test that the pipe preserves plaintext. It is not the guard it says it
is — and the comment's confidence is precisely what would let a future cleanup break the site
unnoticed.

**Fix:** Either delete the enforcement claim, or make the test actually exercise the spread that
enumerability protects — insert a public-tag operation *after* the hidden-tag operation so
`modifyPublicTags`'s `{ ...draft, tags }` sits between the write and `sign`'s explicit copy:

```ts
const signed = await eventPipe(
  modifyHiddenTags(user, (tags) => [...tags, ["p", "friend-pubkey"]]),
  // This spread is what enumerability protects — sign()'s Reflect.* copy is blind to it.
  includeAltTag("a mute list"),
  sign(user),
)({ kind: kinds.Mutelist, content: "", tags: [], created_at: unixNow() });
```

### CR-04: `markEncryptedContentFromCache` comment cites a merge list that does not contain its symbol

**File:** `packages/common/src/helpers/encrypted-content-cache.ts:38-40`

**Issue:** The comment states the flag is "propagated across duplicate events the same way
`FromCacheSymbol` is (applesauce-core's `event-store.ts:219` merge list)". It is not.
`EncryptedContentFromCacheSymbol` is `Symbol.for("encrypted-content-from-cache")`
(`encrypted-content-cache.ts:28`); the merge list at `event-store.ts:219` is
`[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]`, and grep confirms this symbol appears
nowhere in `packages/core`. It is propagated by **nothing**.

This is not academic: `isEncryptedContentFromCache` gates the `persist` pipeline
(`encrypted-content-cache.ts:141-146`). An author who trusts this comment will assume restore
provenance survives event-store dedup and will not think to test the path where it doesn't.

**Fix:**

```ts
export function markEncryptedContentFromCache<T extends object>(event: T) {
  // A restore-provenance flag. NOTE: unlike FromCacheSymbol, this symbol is NOT in
  // applesauce-core's duplicate-merge list (event-store.ts:219) and is not propagated
  // across duplicate events at all — it is only ever read on the instance it was written
  // to. Accumulated state (see cache.ts taxonomy).
  Reflect.set(event, EncryptedContentFromCacheSymbol, true);
}
```

### CR-05: Thirteen sites are annotated "must not survive a spread" over code that makes them survive a spread

**File:** `packages/core/src/casts/cast.ts:57`, `packages/core/src/helpers/filter.ts:24`,
`packages/core/src/helpers/event.ts:129`, `packages/core/src/helpers/hidden-tags.ts:105`,
`packages/core/src/helpers/hidden-tags.ts:150`, `packages/core/src/helpers/contacts.ts:95`,
`packages/common/src/helpers/app-data.ts:66`, `packages/common/src/helpers/bookmark.ts:102`,
`packages/common/src/helpers/emoji-pack.ts:104`, `packages/common/src/helpers/emoji-pack.ts:123`,
`packages/common/src/helpers/groups.ts:108`, `packages/common/src/helpers/lists.ts:48`,
`packages/common/src/helpers/mute.ts:88`, `packages/common/src/helpers/trusted-assertions.ts:90`

**Issue:** Every one of these comments asserts some variant of "this must not survive a spread —
identity memo", and every one sits directly above a `Reflect.set(...)` — which creates an
**enumerable** own property, which **does** survive a spread. The comments state intent; the code
implements the opposite. These are unremediated CONCORD-H01 instances that this phase has now
annotated as though they were correct.

The classifications themselves are right — that is what makes this dangerous. A reader who greps
for `identity memo` finds fourteen sites and concludes the invariant holds at all of them. It holds
at zero.

Two concrete consequences, not hypotheticals:

- **`casts/cast.ts:56-58`** — the comment says "a copy must not inherit a stale cast bound to a
  different instance". Because `Reflect.set(event, CASTS_SYMBOL, new Map([[cls, cast]]))` is
  enumerable, `{ ...event }` inherits **the same `Map` by reference**. `performCast(copy, cls)`
  then returns at line 47 the cast constructed against the **original** event object, and line 59's
  `casts.set(cls, cast)` mutates a `Map` shared by both objects. This is worse than a stale value —
  it is aliased mutable state.
- **`helpers/filter.ts:23-25`** — `getIndexableTags`'s memo rides onto `{ ...event, tags: newTags }`,
  so filter matching on the copy evaluates the **original's** tags. The `if (!indexable)` guard at
  line 13 never recomputes because the copy has an inherited `Set`.

The remaining sites (`hidden-tags`, `contacts`, `bookmark`, `mute`, `groups`, `emoji-pack`,
`app-data`, `trusted-assertions`, `lists`) are the same shape: a parse of the object's own hidden
tags, memoized enumerably, carried onto copies with different tags. Inside `eventPipe` these are
incidentally scrubbed by `pipeFromAsyncArray`'s delete loop (`pipeline.ts:59-65`), which is why
they have not surfaced — but that is a coincidence of one call path, not the invariant the comments
claim.

**Fix:** Either route these through the helper that actually implements the classification —

```ts
// packages/core/src/helpers/filter.ts
import { getOrComputeCachedValue } from "./cache.js";

export function getIndexableTags<E extends StoreEvent = NostrEvent>(event: E): Set<string> {
  return getOrComputeCachedValue(event, EventIndexableTagsSymbol, () => {
    const tags = new Set<string>();
    for (const tag of event.tags)
      if (tag.length >= 2 && tag[0].length === 1 && INDEXABLE_TAGS.has(tag[0]))
        tags.add(tag[0] + ":" + tag[1]);
    return tags;
  });
}
```

— or, if migrating them is deliberately deferred, say so instead of asserting a false invariant:

```ts
// KNOWN GAP (CONCORD-H01, deferred): classified as an identity memo — it SHOULD NOT survive a
// spread — but this Reflect.set writes an enumerable property, so today it does. Only
// eventPipe's delete loop (pipeline.ts:59-65) masks it. Migrate to setCachedValue.
Reflect.set(event, EventIndexableTagsSymbol, tags);
```

The second form is acceptable; the current form is not.

## Warnings

### WR-01: `writable: true` rationale is factually wrong

**File:** `packages/core/src/helpers/cache.ts:45-46`

**Issue:** "`writable: true` is required because `setCachedValue` overwrites an existing memo." It
is not. `setCachedValue` overwrites via `Object.defineProperty`, and with `configurable: true` a
property can be redefined regardless of `writable`. Verified:

```
Object.defineProperty(b, s, {value:1, writable:false, configurable:true});
Object.defineProperty(b, s, {value:2, writable:false, configurable:true});
b[s] // → 2   (redefine succeeded)
```

`writable: true` only matters for a plain `event[sym] = x` assignment or a `Reflect.set`, which
this helper never performs.

**Fix:** `writable: true` is defensible as future-proofing for external assignment; say that, or
drop the flag. Do not state a requirement that does not exist:

```ts
 * `writable: true` is not strictly required by this helper (`configurable: true` already
 * permits redefinition via `defineProperty`); it is kept so that an external
 * `event[sym] = x` / `Reflect.set` on a memo still works rather than silently failing.
```

### WR-02: `configurable: true` rationale inverts the actual failure mode

**File:** `packages/core/src/helpers/cache.ts:43-45`

**Issue:** "`configurable: true` is required because `pipeFromAsyncArray`'s
`Reflect.deleteProperty` (`pipeline.ts:63`) throws on a non-configurable property."
`Reflect.deleteProperty` **never throws** — it returns `false`. Verified:

```
Object.defineProperty(a, s, {value:1, configurable:false});
Reflect.deleteProperty(a, s) // → false   (no throw)
```

(The `delete` operator throws in strict mode; `Reflect.deleteProperty` is the non-throwing form,
which is presumably why `pipeline.ts` uses it.) The flag *is* required — but the failure mode is
a **silent** delete failure that leaves a stale memo riding through the pipe, which is materially
more dangerous than a throw and is the exact shape of CONCORD-H01. Stating it as a throw teaches
the wrong lesson.

**Fix:**

```ts
 * `configurable: true` is required because `pipeFromAsyncArray`'s
 * `Reflect.deleteProperty` (`pipeline.ts:63`) returns `false` — SILENTLY, without
 * throwing — on a non-configurable property, leaving a stale memo to ride through the
 * rest of the pipe.
```

### WR-03: `Object.defineProperty` throws on frozen events where `Reflect.set` degraded silently

**File:** `packages/core/src/helpers/cache.ts:53`, `packages/core/src/helpers/cache.ts:62`

**Issue:** The write-mechanism change is not semantics-preserving for non-extensible objects.
Verified:

```
const c = Object.freeze({k: 1});
Reflect.set(c, s, 1);                                  // → false  (no throw)
Object.defineProperty(c, s, {value: 1, ...});          // → TypeError: Cannot define
                                                       //    property Symbol(x), object
                                                       //    is not extensible
```

`getReplaceableIdentifier` (`helpers/event.ts:202`) and `getReplaceableAddress`
(`helpers/event.ts:140`) both route through `getOrComputeCachedValue`, and `EventStore.add` calls
`getReplaceableIdentifier` on every replaceable event (`event-store.ts:255`). Any consumer holding
frozen events — Redux Toolkit and immer freeze state by default in development — previously
degraded gracefully (memo silently not written, value recomputed each call) and now throws on
insert. No test covers this, and the changeset
(`.changeset/cache-identity-memo-non-enumerable.md`) describes only the enumerability change, so
a downstream reader has no signal that a new precondition was introduced.

**Fix:** Preserve the old graceful degradation, and mention it in the changeset either way:

```ts
export function setCachedValue<T extends unknown>(event: any, symbol: symbol, value: T) {
  // Match the pre-existing Reflect.set behavior on frozen/sealed events: degrade to
  // "no memo, recompute each call" rather than throwing.
  if (!Object.isExtensible(event) && !Object.prototype.hasOwnProperty.call(event, symbol)) return;
  Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true });
}
```

### WR-04: Every intra-repo line citation added by this phase points at a pre-diff line number

**File:** `packages/core/src/helpers/cache.ts:27`, `packages/core/src/helpers/cache.ts:31`,
`packages/core/src/helpers/encrypted-content.ts:119`,
`packages/core/src/helpers/relays.ts:17`, `packages/concord/src/helpers/keys.ts:107`,
`packages/concord/src/helpers/keys.ts:563`,
`packages/core/src/helpers/__tests__/cache.test.ts:87`,
`packages/core/src/helpers/__tests__/cache.test.ts:93`

**Issue:** The comments were authored against the files' pre-comment line numbers, and the comment
insertions themselves shifted every target. Verified against HEAD:

| Citation | Cited line actually contains | Real location |
|---|---|---|
| `operations/tags.ts:87` | a comment line | write at `tags.ts:90` |
| `helpers/encrypted-content.ts:117` | a comment line | write at `:123` |
| `operations/event.ts:134` | a comment line | write at `:137` |
| `operations/event.ts:163` | a blank line | write at `:169` |
| `common/operations/gift-wrap.ts:121` | a comment line | write at `:131` |
| `concord/keys.ts` `(:249-255)` | `readRekey`'s body | `rollForward`'s spread at `:265-271` |
| `concord/keys.ts` `(:508-515)` | `readRekeyScoped`'s body | `rollForwardChannel` at `:524-531` |
| `relays.ts` → `event-store.ts:219` | the `[FromCache, verified, ECS]` array | `SeenRelaysSymbol` merges at `:212-217` |

`operations/tags.ts:87` is cited four times across three files as the taxonomy's "canonical worked
example" anchor. Line-number citations in comments rot regardless; when the same commit that writes
them invalidates them, they were never right.

**Fix:** Cite symbols/functions, not line numbers — `operations/tags.ts`'s `modifyHiddenTags`
return, `encrypted-content.ts`'s `setEncryptedContentCache`, `operations/event.ts`'s `stamp`/`sign`.
Names survive edits; line numbers did not survive this commit.

### WR-05: The helper documented as writing identity memos "ONLY" is used to write mutable accumulated state

**File:** `packages/concord/src/helpers/keys.ts:147`

**Issue:** `cache.ts:40-42` states the helper "writes identity memos ONLY", and `cache.ts:19`
defines accumulated state as **mutable**. `channelKeyMemo` uses `getOrComputeCachedValue` to write
a `Map` that is then grown in place across calls (`cache.set(sig, ...)` at `keys.ts:153`) — mutable
state by the taxonomy's own criterion. It is arguably still a memo (the Map is keyed on `material`'s
identity, so it dies with the material), but the taxonomy gives no way to reach that conclusion; a
reader applying the "mutable ⇒ category 3" rule will reclassify this site and make it enumerable,
reintroducing CONCORD-H01 in the exact function it was found in.

**Fix:** Add the missing discriminator to `cache.ts` — what matters is whether the value's *validity*
is bound to the host object's fields, not whether the value is mutable:

```ts
 * 3. **accumulated state** — mutable AND meaningful independently of the host object's
 *    own fields (e.g. which relays served an event). A memo whose VALUE happens to be a
 *    mutable container is still category 1 when its validity is bound to the host's fields
 *    (e.g. concord's `ChannelKeysSymbol` Map, keyed on `material`'s identity) — mutability
 *    of the value is not the test; "must a copy with changed fields recompute?" is.
```

### WR-06: `EventStoreSymbol` exclusion comment inverts source and dest

**File:** `packages/core/src/event-store/event-store.ts:294-296`, `packages/core/src/event-store/async-event-store.ts:264-266`

**Issue:** The comment says excluding `EventStoreSymbol` from the merge list means "a duplicate
event keeps its own store reference rather than inheriting the source's." Both call sites pass the
**incoming duplicate** as `source` and the **stored** event as `dest`:
`copySymbolsToDuplicateEvent(event, winner)` (`event-store.ts:275`) and
`copySymbolsToDuplicateEvent(event, existing)` (`event-store.ts:287`). The incoming duplicate is
discarded immediately after (`return winner` / `return existing`), so it "keeps" nothing. What the
exclusion protects is the **stored** event from acquiring the incoming duplicate's store reference.
The comment also overstates the effect: the `!(symbol in dest)` guard at `event-store.ts:221`
already prevents overwriting any symbol `dest` already has.

**Fix:**

```ts
// Set the event store on the event. EventStoreSymbol is excluded from the merge list above
// (~line 219): in that merge, `source` is the INCOMING duplicate (discarded) and `dest` is the
// STORED event, so copying it would only ever hand a stored event a foreign store reference.
// Accumulated state (see cache.ts taxonomy).
```

### WR-07: New comment ratifies a latent `undefined`-as-`Rumor` return as intentional design

**File:** `packages/common/src/helpers/gift-wrap.ts:154-157`

**Issue:** The comment defends the `Reflect.set(seal, RumorSymbol, undefined)` sentinel: "which is
why callers check presence (`RumorSymbol in seal`) rather than truthiness". The presence check is
real but it does not make the design sound — it is what breaks it. Trace:

1. `getSealRumor` fails to parse → writes the `undefined` sentinel (`:157`).
2. `isSealUnlocked` (`:113`) is `RumorSymbol in seal || (...)` → now returns **`true`** for a seal
   whose content never parsed.
3. `unlockSeal` (`:236-237`): `if (isSealUnlocked(seal)) return seal[RumorSymbol];` → returns
   `undefined`, typed `Promise<Rumor>`. The `if (!rumor) throw new Error("Failed to read rumor in
   gift wrap")` guard at `:243` is bypassed entirely.

The bug predates this phase, but the new comment declares the pattern deliberate and coherent,
which will deter the next reader from fixing it.

**Fix:** Use a dedicated sentinel that presence checks can distinguish, or narrow `isSealUnlocked`:

```ts
export function isSealUnlocked(seal: NostrEvent): seal is UnlockedSeal {
  // Presence alone is not enough: getSealRumor writes an `undefined` sentinel on parse
  // failure, and a seal that failed to parse is NOT unlocked.
  if (RumorSymbol in seal) return seal[RumorSymbol] !== undefined;
  return isEncryptedContentUnlocked(seal) === true && getSealRumor(seal) !== undefined;
}
```

### WR-08: The sweep missed a hand-rolled symbol-write site in the package CONCORD-H01 came from

**File:** `packages/concord/src/helpers/gift-wrap.ts:119`

**Issue:** Plan 05-03 classified "every hand-rolled symbol-write site" against the taxonomy.
`decodeWrapCached` was missed:

```ts
const cached = Reflect.get(wrap, DecodedWrapSymbol) as DecodedEvent | null | undefined;
if (cached !== undefined) return cached;
const decoded = decodeWrap(wrap, convKey);
Reflect.set(wrap, DecodedWrapSymbol, decoded);   // ← unclassified
```

It is a textbook identity memo — derived from the wrap's own `content`/`pubkey` — written
enumerably, in the very package the bug originated in, and carrying no classification comment while
fourteen less-relevant sites in other packages got one. Its file header (`:100-106`) even
advertises "we mirror applesauce's pattern with our own symbol", which is exactly the pattern that
broke. A completeness claim that misses the home package's own instance is not a completeness claim.

(Also worth a look while there, though out of this phase's scope: the memo is keyed on `wrap` alone
and ignores `convKey`, so a second decode of the same wrap under a different plane key returns the
first result.)

**Fix:** Classify it, and migrate it — it is a clean `getOrComputeCachedValue` fit except for the
`null` sentinel, which the helper's `Reflect.has` presence check handles correctly:

```ts
export function decodeWrapCached(wrap: RawEvent, convKey: Uint8Array): DecodedEvent | null {
  // Derived from the wrap's own content; a copy with different content must re-decode, so
  // this must not survive a spread — identity memo (see cache.ts taxonomy).
  return getOrComputeCachedValue(wrap, DecodedWrapSymbol, () => decodeWrap(wrap, convKey));
}
```

### WR-09: `baseKeysFor` never "hand-rolled" anything

**File:** `packages/concord/src/helpers/keys.ts:110-111`

**Issue:** "Before `cache.ts` wrote non-enumerable, this memo hand-rolled a plain enumerable
`Reflect.set`". It did not. `baseKeysFor` has always called `getOrComputeCachedValue`
(`keys.ts:129`); the `Reflect.set` was inside the shared helper. This matters because "hand-rolled"
is a load-bearing term of art the taxonomy introduces three files away — `cache.ts:35` uses it for
precisely the opposite thing ("`setEncryptedContentCache` hand-rolls its own enumerable
`Reflect.set` write **instead of calling this helper**"). Using it for a site that always called
the helper collapses the only distinction the taxonomy has for locating unmigrated sites.

**Fix:**

```ts
 * It was NOT true before that fix — this is CONCORD-H01. Until then `getOrComputeCachedValue`
 * itself wrote enumerable, so the PRIOR epoch's cached keys rode along on `rollForward`'s
 * spread and `baseKeysFor` silently kept returning the old epoch's keys after every Refounding.
```

## Info

### IN-01: `getOrComputeCachedValue` uses `Reflect.has`, which walks the prototype chain

**File:** `packages/core/src/helpers/cache.ts:58`

**Issue:** `Reflect.has(event, symbol)` is the `in` operator and consults the prototype chain,
whereas `Object.defineProperty` at line 62 writes an **own** property. With `Symbol.for()` keys and
plain object literals this is unreachable today, but the read and write are now asymmetric in a way
`Reflect.set`/`Reflect.get` were not (`Reflect.set` also walked the chain). Pre-existing; noted
because the phase's new prose makes strong claims about this function's exact semantics.

**Fix:** `Object.prototype.hasOwnProperty.call(event, symbol)` — or `Object.getOwnPropertyDescriptor`,
which pairs naturally with the `defineProperty` write.

### IN-02: `copySymbolsToDuplicateEvent` reports `changed = true` for no-op relay merges

**File:** `packages/core/src/event-store/event-store.ts:213-217`

**Issue:** `if (relays) { for (const relay of relays) addSeenRelay(dest, relay); changed = true; }`
sets `changed` unconditionally whenever `source` has any seen relays, even when every relay is
already present on `dest`. Callers use the return value to gate `this.update(winner)`
(`event-store.ts:275`, `:287`), so every duplicate delivery of an already-seen event emits a
spurious `update$`. Pre-existing and out of this phase's scope; flagged because the merge loop
directly below it was just declared "the canonical/executable definition of the category", which
invites readers to treat this function as exemplary.

**Fix:** `changed ||= addSeenRelay(dest, relay).size !== before;` — or track set size around the
loop.

---

_Reviewed: 2026-07-15T13:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
