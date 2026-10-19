import { EventMemory } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { filterDuplicateEvents, mapEventsToStore } from "applesauce-core/observable";
import {
  bufferTime,
  catchError,
  defer,
  EMPTY,
  identity,
  merge,
  Observable,
  takeUntil,
  timer,
  throwError,
  mergeMap,
  from,
  isObservable,
  take,
  map,
  of,
  distinct,
} from "rxjs";
import { unique } from "../helpers/array.js";
import { makeCacheRequest } from "../helpers/cache.js";
import { batchLoader, Loader } from "../helpers/loaders.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, NostrRequest, UpstreamPool } from "../types.js";

/** A tag value and relay hints to load */
export type TagValuePointer = {
  /** The value of the tag to load */
  value: string;
  /** The relays to load from */
  relays?: string[];
  /** Skips cache queries and receives only relay results */
  force?: boolean;
};

/** The source of a failed tag value request */
export type TagValueLoaderErrorSource =
  | { /** The failed cache source */ source: "cache" }
  | { /** The failed extra relay discovery source */ source: "routing" }
  | { /** The failed relay source */ source: "relay"; /** The relay URL */ relay: string };

/** Options for batching and fetching events by tag value */
export type TagValueLoaderOptions = {
  /** Time interval to buffer requests in ms ( default 200 ) */
  bufferTime?: number;
  /** Max buffer size ( default 200 ) */
  bufferSize?: number;
  /** Shares queued or running requests with matching force mode and covered static relay hints ( default true ) */
  shareInflight?: boolean;
  /** Maximum running batches ( default 4 ) */
  maxConcurrentBatches?: number;
  /** Maximum running relay requests per batch ( default 8 ) */
  relayConcurrency?: number;
  /** Maximum cache, relay, or relay discovery lifetime in ms ( default 10000, Infinity disables ) */
  requestTimeout?: number;
  /** Restrict queries to specific kinds */
  kinds?: number[];
  /** Restrict queries to specific authors */
  authors?: string[];
  /** Restrict queries since */
  since?: number;
  /** Method used to load from the cache */
  cacheRequest?: CacheRequest;
  /** A callback for cache, relay discovery, and individual relay failures that are skipped while other sources continue */
  onError?: (error: unknown, source: TagValueLoaderErrorSource) => void;
  /** An array of relays to always fetch from */
  extraRelays?: string[] | Observable<string[]>;
  /** An event store used to deduplicate events. Set to null to disable deduplication */
  eventStore?: Parameters<typeof filterDuplicateEvents>[0] | null;
  /** An {@link AbortSignal} that tears down the loader when aborted */
  signal?: AbortSignal;
};

/** A batched loader for events matching a tag value */
export type TagValueLoader = Loader<TagValuePointer, NostrEvent>;

function validateOptions(opts?: TagValueLoaderOptions) {
  for (const [name, value] of [
    ["maxConcurrentBatches", opts?.maxConcurrentBatches ?? 4],
    ["relayConcurrency", opts?.relayConcurrency ?? 8],
  ] as const) {
    if (value !== Infinity && (!Number.isInteger(value) || value <= 0))
      throw new RangeError(`${name} must be a positive integer or Infinity`);
  }
  const duration = opts?.requestTimeout ?? 10000;
  if (duration !== Infinity && (!Number.isFinite(duration) || duration <= 0 || duration > 2147483647))
    throw new RangeError("requestTimeout must be positive and at most 2147483647 ms, or Infinity");
}

function isolateSource<T>(
  load: () => Observable<T>,
  source: TagValueLoaderErrorSource,
  opts?: TagValueLoaderOptions,
): Observable<T> {
  const duration = opts?.requestTimeout ?? 10000;
  return defer(load).pipe(
    // A total lifetime deadline, independent of how frequently events arrive.
    takeUntil(
      duration === Infinity
        ? EMPTY
        : timer(duration).pipe(mergeMap(() => throwError(() => new Error("Tag value request timed out")))),
    ),
    catchError((error) => {
      opts?.onError?.(error, source);
      return EMPTY;
    }),
  );
}

/**
 * Creates a loader that gets tag values from the cache
 * @throws {RangeError} If concurrency or timeout options are invalid
 */
export function cacheTagValueLoader(
  request: CacheRequest,
  tagName: string,
  opts?: TagValueLoaderOptions,
): (pointers: TagValuePointer[]) => Observable<NostrEvent> {
  validateOptions(opts);
  return (pointers) => {
    pointers = pointers.filter((pointer) => !pointer.force);
    if (pointers.length === 0) return EMPTY;

    const baseFilter: Filter = {};
    if (opts?.kinds) baseFilter.kinds = opts.kinds;
    if (opts?.authors) baseFilter.authors = opts.authors;
    if (opts?.since !== undefined) baseFilter.since = opts.since;

    const filterTag: `#${string}` = `#${tagName}`;
    const filter = { ...baseFilter, [filterTag]: unique(pointers.map((p) => p.value)) };

    return isolateSource(() => makeCacheRequest(request, [filter]), { source: "cache" }, opts);
  };
}

/**
 * Creates a loader that gets tag values from relays
 * @throws {RangeError} If concurrency or timeout options are invalid
 */
export function relaysTagValueLoader(
  request: NostrRequest,
  tagName: string,
  opts?: TagValueLoaderOptions,
): (pointers: TagValuePointer[]) => Observable<NostrEvent> {
  validateOptions(opts);
  const filterTag: `#${string}` = `#${tagName}`;

  return (pointers) =>
    defer(() => {
      const baseFilter: Filter = {};
      if (opts?.kinds) baseFilter.kinds = opts.kinds;
      if (opts?.authors) baseFilter.authors = opts.authors;
      if (opts?.since !== undefined) baseFilter.since = opts.since;

      // Coverage belongs to this subscription, including relay requests still queued.
      const covered = new Map<string, Set<string>>();
      const tasks = (extraRelays?: string[], hints = true) => {
        const filters = new Map<string, Set<string>>();
        for (const pointer of pointers) {
          for (const relay of mergeRelaySets(hints ? pointer.relays : undefined, extraRelays)) {
            let values = covered.get(relay);
            if (!values) covered.set(relay, (values = new Set()));
            if (values.has(pointer.value)) continue;
            values.add(pointer.value);
            let pending = filters.get(relay);
            if (!pending) filters.set(relay, (pending = new Set()));
            pending.add(pointer.value);
          }
        }
        return Array.from(filters, ([relay, values]) =>
          isolateSource(
            () => request([relay], [{ ...baseFilter, [filterTag]: [...values] }]),
            { source: "relay", relay },
            opts,
          ),
        );
      };

      const extraRelays = opts?.extraRelays;
      const requests = isObservable(extraRelays)
        ? merge(
            from(tasks()),
            isolateSource(() => extraRelays.pipe(take(1)), { source: "routing" }, opts).pipe(
              mergeMap((relays) => from(tasks(relays, false))),
            ),
          )
        : from(tasks(extraRelays));

      // Hints and discovered relays share the same concurrency budget.
      return requests.pipe(mergeMap(identity, opts?.relayConcurrency ?? 8));
    });
}

/**
 * Creates a tag value loader that supports batching, caching, and relay hints
 * @throws {RangeError} If concurrency or timeout options are invalid
 */
export function createTagValueLoader(
  pool: UpstreamPool,
  tagName: string,
  opts?: TagValueLoaderOptions,
): TagValueLoader {
  validateOptions(opts);
  const request = wrapUpstreamPool(pool);

  type Result = { event: NostrEvent; cache: boolean; values?: Set<string> };
  const store = opts?.eventStore === null ? null : (opts?.eventStore ?? new EventMemory<NostrEvent>());
  const loader = batchLoader<TagValuePointer, Result>(
    bufferTime(opts?.bufferTime ?? 200, undefined, opts?.bufferSize ?? 200),
    (pointers) =>
      merge(
        opts?.cacheRequest
          ? cacheTagValueLoader(
              opts.cacheRequest,
              tagName,
              opts,
            )(pointers).pipe(map((event) => ({ event, cache: true })))
          : EMPTY,
        relaysTagValueLoader(request, tagName, opts)(pointers).pipe(map((event) => ({ event, cache: false }))),
      ),
    (pointer, result) =>
      (!pointer.force || !result.cache) &&
      (result.values ??= new Set(result.event.tags.filter((tag) => tag[0] === tagName).map((tag) => tag[1]))).has(
        pointer.value,
      ),
    (source) =>
      source.pipe(
        // Preserve arrival provenance even when the store returns the same canonical event.
        store
          ? mergeMap((result) =>
              of(result.event).pipe(
                mapEventsToStore(store, false),
                map((event) => ({ ...result, event })),
              ),
            )
          : identity,
        store ? distinct((result) => JSON.stringify([result.cache, result.event.id])) : identity,
      ),
    {
      signal: opts?.signal,
      maxConcurrentBatches: opts?.maxConcurrentBatches ?? 4,
      inflight:
        (opts?.shareInflight ?? true) && !isObservable(opts?.extraRelays)
          ? {
              key: (pointer) => JSON.stringify([pointer.value, !!pointer.force]),
              covers: (running, pointer) => {
                const extra = opts?.extraRelays as string[] | undefined;
                const covered = new Set(mergeRelaySets(running.relays, extra));
                return mergeRelaySets(pointer.relays, extra).every((relay) => covered.has(relay));
              },
            }
          : undefined,
    },
  );

  const load = (pointer: TagValuePointer) =>
    loader(pointer).pipe(
      map((result) => result.event),
      // Deduplicate after matching so a cache arrival cannot hide a relay arrival from forced callers.
      store ? distinct((event) => event.id) : identity,
    );
  return Object.assign(load, { stop: loader.stop, [Symbol.dispose]: loader[Symbol.dispose] });
}
