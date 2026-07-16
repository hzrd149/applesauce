import type { EventOperation, Operation, TagOperation } from "../factories/types.js";
import { setCachedValue } from "./cache.js";
import { EncryptedContentSymbol } from "./encrypted-content.js";
import { GiftWrapSymbol, RumorSymbol, SealSymbol } from "./gift-wrap.js";

/** An array of Symbols to preserve when building events with {@link eventPipe} */
export const PRESERVE_EVENT_SYMBOLS = new Set([EncryptedContentSymbol, GiftWrapSymbol, SealSymbol, RumorSymbol]);

export function identity<T>(x: T): T {
  return x;
}

/** The core method that creates a pipeline to build an event */
export function eventPipe(...operations: (EventOperation | undefined)[]): EventOperation {
  return pipeFromAsyncArray(
    operations.filter((o) => !!o),
    // Preserve the encrypted content, gift wrap symbols
    PRESERVE_EVENT_SYMBOLS,
  );
}

/** The core method that creates a pipeline to create or modify an array of tags */
export function tagPipe(...operations: (TagOperation | undefined)[]): TagOperation {
  return pipeFromAsyncArray(operations.filter((o) => !!o));
}

/** A pipeline operation that does nothing */
export function skip<T>(): (value: T) => T {
  return (value) => value;
}

/**
 * Pipe a value through a series of async operations
 * @example
 * ```ts
 * const result = await pipe(
 *   draft,
 *   setContent("hello"),
 *   addTag("p", pubkey),
 *   sign(signer)
 * );
 * ```
 */
export async function pipe<T>(value: T, ...operations: Array<(v: any) => any | Promise<any>>): Promise<any> {
  return operations.reduce(async (prev, op) => op(await prev), Promise.resolve(value));
}

/**
 * @param fns - An array of operations to pipe together
 * @param preserve - If set, an array of symbols to carry forward from the previous value onto
 * the result when a same-kind step's own spread drops a non-enumerable symbol write
 * @internal
 */
export function pipeFromAsyncArray<T, R>(fns: Array<Operation<T, R>>, preserve?: Set<symbol>): Operation<T, R> {
  if (fns.length === 0) return identity as Operation<any, any>;

  return async function piped(input: T): Promise<R> {
    return fns.reduce(async (prev: any, fn: Operation<T, R>) => {
      // Hoist the awaited input into a single local reused for both the operation call and the
      // carry-forward loop below (a Reflect.has on an un-awaited Promise is always false).
      const prevValue = await prev;
      const result = await fn(prevValue);

      // Copy the symbols and fields if result is an object
      if (
        preserve &&
        typeof result === "object" &&
        result !== null &&
        typeof prevValue === "object" &&
        prevValue !== null
      ) {
        // Carry forward: restore any preserved symbol prevValue had that result is missing
        // (an operation's own internal spread — e.g. modifyPublicTags's `{ ...draft, tags }` —
        // drops non-enumerable writes; this explicitly restores them instead of relying on
        // write-site enumerability).
        //
        // Only carry forward when the step MODIFIES the same event in place (same kind). A
        // transform step that builds a new, different-kind event — e.g. gift-wrap's
        // rumor(3313)→seal(13)→wrap(1059) — must NOT inherit the input's symbols: they are
        // accumulated state whose meaning differs per envelope level (SealSymbol is a Set of
        // parent seals on a rumor but the single downstream seal on a wrap), and carrying them
        // across the boundary corrupts the nested event's decode.
        const sameEvent =
          typeof (result as { kind?: unknown }).kind === "number" &&
          (result as { kind?: unknown }).kind === (prevValue as { kind?: unknown }).kind;
        if (sameEvent) {
          for (const symbol of preserve) {
            if (Reflect.has(prevValue, symbol) && !Reflect.has(result, symbol)) {
              // Restore non-enumerably (the one rule) so the carried symbol is not re-enumerated
              // and cannot be copied across a later kind-changing spread.
              setCachedValue(result, symbol, Reflect.get(prevValue, symbol));
            }
          }
        }
      }

      return result;
    }, input as any);
  };
}
