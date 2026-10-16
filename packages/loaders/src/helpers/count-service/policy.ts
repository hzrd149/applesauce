import { normalizeURL } from "applesauce-core/helpers/url";
import {
  catchError,
  concat,
  defaultIfEmpty,
  distinctUntilChanged,
  isObservable,
  NEVER,
  Observable,
  of,
  ReplaySubject,
  share,
} from "rxjs";
import type { CountList } from "../../loaders/count-sources/types.js";

const lists = new WeakMap<object, Observable<readonly unknown[]>>();

/** Shares configuration observation and preserves completed lists */
export function listStream<T>(input: CountList<T>): Observable<readonly T[]> {
  if (!isObservable(input)) return concat(of(input), NEVER);
  let shared = lists.get(input);
  if (!shared) {
    const finite = input.pipe(
      defaultIfEmpty([] as readonly T[]),
      catchError(() => of([] as readonly T[])),
      share({
        connector: () => new ReplaySubject<readonly T[]>(1),
        resetOnComplete: false,
        resetOnError: true,
        resetOnRefCountZero: true,
      }),
    );
    shared = concat(finite, NEVER);
    lists.set(input, shared);
  }
  return shared as Observable<readonly T[]>;
}

/** Normalizes and deduplicates usable websocket routes in priority order */
export function relays(input: readonly string[]): string[] {
  const output: string[] = [];
  for (const value of input) {
    try {
      const url = new URL(value);
      if (url.protocol !== "wss:" && url.protocol !== "ws:") continue;
      url.hash = "";
      const relay = normalizeURL(url.toString());
      if (!output.includes(relay)) output.push(relay);
    } catch {
      /* Invalid routes cannot be dispatched. */
    }
  }
  return output;
}

/** Suppresses equivalent effective policy revisions */
export const distinctPolicy = () => distinctUntilChanged<string>();
