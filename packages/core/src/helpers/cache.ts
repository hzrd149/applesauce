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
 *    (`pipeline.ts:5`) is the machine-readable definition of this category: any
 *    symbol listed there is explicitly kept across `eventPipe`'s intermediate
 *    spreads.
 * 3. **accumulated state** — mutable, propagated by the event store's merge
 *    rather than by spread (e.g. `SeenRelaysSymbol`, and the gift-wrap
 *    `Seal`/`Rumor`/`GiftWrap` symbols). The `[FromCacheSymbol, verifiedSymbol,
 *    EncryptedContentSymbol]` merge list at `event-store.ts:219` is the
 *    machine-readable definition of this category.
 *
 * Worked example — `EncryptedContentSymbol` has two lifecycles with OPPOSITE
 * semantics, proving the taxonomy classifies write sites, not symbols:
 *   - carry-forward payload at `operations/tags.ts:87` — the write/build path,
 *     where the decrypted plaintext is spread onto the draft (`{ ...draft,
 *     content, [EncryptedContentSymbol]: plaintext }`) so it survives the
 *     pipe's intermediate spreads into the signed event.
 *   - identity memo at `helpers/encrypted-content.ts:117`
 *     (`setEncryptedContentCache`) — the read/unlock path, where the same
 *     symbol memoizes decrypted content on an already-signed, immutable event
 *     to avoid a repeat signer round-trip.
 *   That is why `setEncryptedContentCache` hand-rolls its own enumerable
 *   `Reflect.set` write instead of calling this helper: at ITS write site the
 *   value must stay enumerable so it keeps surviving the pipe's spreads, even
 *   though its own read-path usage would otherwise be safe non-enumerable.
 *
 * Scope: this helper (`getCachedValue`/`setCachedValue`/`getOrComputeCachedValue`)
 * writes identity memos ONLY, and writes them non-enumerable so a spread drops
 * them. The write descriptor's other two flags are load-bearing, not stylistic:
 * `configurable: true` is required because `pipeFromAsyncArray`'s
 * `Reflect.deleteProperty` (`pipeline.ts:63`) throws on a non-configurable
 * property, and `writable: true` is required because `setCachedValue` overwrites
 * an existing memo.
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
