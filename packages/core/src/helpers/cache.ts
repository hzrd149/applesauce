/**
 * Symbol-keyed properties on events fall into three categories. The categories
 * classify WRITE SITES, not symbols — the question an author must answer at each
 * call site is "must THIS WRITE survive a spread?", not "which category does this
 * symbol belong to?". The same symbol can answer that question differently at
 * different write sites (see the worked example below), so a symbol-to-category
 * lookup table would be wrong on the taxonomy's single most important example.
 *
 * 1. **identity memo** — a derivation of the object's own current fields. A copy
 *    with changed fields MUST recompute, so it must NOT survive a spread. This is
 *    what `setCachedValue`/`getOrComputeCachedValue` write, and why they write
 *    non-enumerable: object spread only copies enumerable own properties, so a
 *    non-enumerable memo is dropped by a spread instead of riding along stale.
 * 2. **carry-forward payload** — deliberately propagated through the factory pipe
 *    into the signed event. MUST survive a spread. `PRESERVE_EVENT_SYMBOLS`
 *    (`helpers/pipeline.ts`) is the allowlist `pipeFromAsyncArray`'s delete loop
 *    consults: after each pipe operation it deletes every symbol-keyed own
 *    property of the result that is NOT listed there. Membership is therefore
 *    NECESSARY but NOT SUFFICIENT for surviving a spread — the loop only
 *    deletes non-listed symbols; it never copies a listed symbol from `prev`
 *    onto `result`. Actually surviving an individual operation's own internal
 *    spread additionally requires either an enumerable write (as
 *    `modifyHiddenTags`'s object-literal return gives `EncryptedContentSymbol`)
 *    or an explicit re-copy by that operation (as `stamp`/`sign` in
 *    `operations/event.ts` do, via `Reflect.has`/`get`/`set`, which are
 *    enumerability-blind).
 * 3. **accumulated state** — mutable, propagated by the event store's merge
 *    rather than by spread. This category has no single defining list; the
 *    propagation mechanism differs per symbol. `FromCacheSymbol` and
 *    `verifiedSymbol` propagate via the symbol merge loop in
 *    `EventStore.copySymbolsToDuplicateEvent`. `SeenRelaysSymbol` propagates
 *    via a SEPARATE, element-wise merge in that same function
 *    (`getSeenRelays`/`addSeenRelay`) and is NOT in that merge loop's list.
 *    applesauce-common's `Seal`/`Rumor`/`GiftWrap` symbols are not merged by
 *    any event store at all (they are unknown to applesauce-core) and
 *    propagate by shared object reference. Mutability of the value is NOT the
 *    test for this category: a memo whose value happens to be a mutable
 *    container (e.g. concord's `ChannelKeysSymbol`, a `Map` written through
 *    `getOrComputeCachedValue` and grown in place by `channelKeyMemo`) is
 *    still an **identity memo** when its validity is bound to the host
 *    object's own fields. The test is whether a copy with changed fields must
 *    recompute.
 *
 * Worked example — `EncryptedContentSymbol` has TWO write sites, BOTH
 * carry-forward payload but for DIFFERENT reasons, proving the taxonomy
 * classifies write sites (not symbols) and that a site's PURPOSE does not
 * decide its category:
 *   - carry-forward payload at `operations/tags.ts`'s `modifyHiddenTags`
 *     return — the write/build path, where the decrypted plaintext is placed
 *     on the draft by an object literal (`{ ...draft, content,
 *     [EncryptedContentSymbol]: plaintext }`) so it survives the pipe's
 *     intermediate spreads into the signed event.
 *   - carry-forward payload at `helpers/encrypted-content.ts`'s
 *     `setEncryptedContentCache` — the read/unlock path. Its PURPOSE is
 *     memoization (avoiding a repeat signer round-trip on an already-signed
 *     event), which is why it looks like a memo. But its write site answers
 *     the same question the build path does: an unlocked event re-entering
 *     the factory pipe hits `operations/tags.ts`'s `modifyPublicTags`
 *     (`{ ...draft, tags }`), which copies only enumerable own properties —
 *     a non-enumerable write here would be dropped there and force a
 *     re-decrypt. "Must THIS WRITE survive a spread?" = yes, so this is
 *     carry-forward payload, not identity memo. That is why it hand-rolls its
 *     own enumerable `Reflect.set` write instead of calling `setCachedValue`.
 *   A site whose purpose is memoization can still be category 2 — purpose
 *   does not decide the category; the spread-survival requirement at the
 *   write site does. This is the exact confusion that produced CR-02.
 *
 * Scope: this helper (`getCachedValue`/`setCachedValue`/`getOrComputeCachedValue`)
 * writes identity memos ONLY — including memos whose value happens to be a
 * mutable container (see category 3's `ChannelKeysSymbol` discriminator above;
 * a container's mutability does not change this) — and writes them
 * non-enumerable so a spread drops them. The write descriptor's other two
 * flags are load-bearing, not stylistic:
 *   - `configurable: true` is required because without it,
 *     `pipeFromAsyncArray`'s delete loop would fail silently instead of
 *     dropping the memo: `Reflect.deleteProperty` does NOT throw on a
 *     non-configurable property, it returns `false`, so a non-configurable
 *     memo would ride through the rest of the pipe as a stale value instead
 *     of being deleted. That silent-stale outcome is materially more
 *     dangerous than a throw, and is the exact shape of CONCORD-H01.
 *   - `writable: true` is NOT required by `setCachedValue` itself:
 *     `setCachedValue` overwrites an existing memo via `Object.defineProperty`,
 *     and `configurable: true` alone permits redefinition regardless of
 *     `writable`. It is kept so an external `event[sym] = x` / `Reflect.set`
 *     on a memo still succeeds instead of silently failing.
 *   - Writing via `Object.defineProperty` (rather than `Reflect.set`) THROWS a
 *     `TypeError` if the event is frozen, sealed, or otherwise non-extensible,
 *     where `Reflect.set` would have returned `false` silently. This is
 *     deliberate (D-02): a silent write failure here means a stale memo is
 *     returned forever, so surfacing the programming error is correct.
 *     Consumers that freeze events (e.g. Redux Toolkit / immer freezing state
 *     in development) will see a throw where they previously saw silent
 *     degradation. `getExpirationTimestamp` routes through
 *     `getOrComputeCachedValue`, and both `EventStore.add` and
 *     `AsyncEventStore.add` call it unconditionally before any kind or
 *     replaceable branching — the throw is therefore NOT limited to
 *     replaceable events; an ordinary regular-kind event (e.g. a kind-1 note)
 *     reaches it on a normal insert. The one carve-out: both stores return
 *     early for `kinds.EventDeletion` before reaching that call, so a
 *     deletion event does not trigger it via this path.
 */
export function getCachedValue<T extends unknown>(event: any, symbol: symbol): T | undefined {
  return Reflect.get(event, symbol);
}

export function setCachedValue<T extends unknown>(event: any, symbol: symbol, value: T) {
  Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true });
}

/** Internal method used to cache computed values on events */
export function getOrComputeCachedValue<T extends unknown>(event: any, symbol: symbol, compute: () => T): T {
  if (Reflect.has(event, symbol)) {
    return Reflect.get(event, symbol);
  } else {
    const value = compute();
    Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true });
    return value;
  }
}
