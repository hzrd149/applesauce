/**
 * One rule: every symbol write on an event-like object is non-enumerable (via
 * `setCachedValue`/`getOrComputeCachedValue` below). Nothing survives an
 * object copy implicitly — spread only copies enumerable own properties.
 * Carry-forward across factory-pipe operations is performed EXPLICITLY by the
 * pipe (`pipeFromAsyncArray` / `EventFactory.chain`), which copies every
 * symbol in `PRESERVE_EVENT_SYMBOLS` (`helpers/pipeline.ts`) from each step's
 * input to its output after the operation runs. `stamp()`/`sign()`
 * additionally re-copy `EncryptedContentSymbol` via `Reflect.has`/`get`/`set`
 * so a standalone `sign(signer)(draft)` call (outside any pipe) still
 * preserves plaintext.
 *
 * This replaces the three-category taxonomy this doc comment used to carry
 * (superseded — see `05.1-symbol-propagation-redesign` D-05/D-06): the
 * memo-vs-carry-forward distinction that taxonomy existed to document is now
 * met structurally by the one rule above plus the pipe's explicit carry, not
 * by a hand-maintained category system an author had to keep in sync.
 *
 * Scope: this helper (`getCachedValue`/`setCachedValue`/`getOrComputeCachedValue`)
 * writes non-enumerable so a spread drops the write unless the pipe carries it
 * forward. The write descriptor's other two flags are load-bearing, not
 * stylistic:
 *   - `configurable: true` is required because `setCachedValue` may be called
 *     again on the same event/symbol to overwrite a previous memo via
 *     `Object.defineProperty` — redefining a non-configurable property throws
 *     a `TypeError` instead of updating the value.
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
