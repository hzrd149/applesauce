import { IAsyncEventStoreActions, IAsyncEventStoreRead, IEventStoreActions, IEventStoreRead } from "applesauce-core";
import { getPublicContacts } from "applesauce-core/helpers";
import { Filter } from "applesauce-core/helpers/filter";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { mapEventsToStore } from "applesauce-core/observable";
import { catchError, EMPTY, filter, firstValueFrom, identity, isObservable, Observable, tap } from "rxjs";
import { makeCacheRequest } from "../helpers/cache.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { wrapGeneratorFunction } from "../operators/generator.js";
import { CacheRequest, UpstreamPool } from "../types.js";

/**
 * A loader that loads the social graph of a user out to a set distance.
 *
 * Pass `since` (unix seconds) to skip follow lists the relay already knows are older.
 * When `since` is set and the relay returns nothing for a user, the loader falls back
 * to `eventStore.getReplaceable(kinds.Contacts, pubkey)` so crawl expansion still
 * happens from the cached copy.
 */
export type SocialGraphLoader = (user: ProfilePointer & { distance: number; since?: number }) => Observable<NostrEvent>;

/** An event store that the social graph loader can both write to and read from */
export type SocialGraphEventStore = (IEventStoreActions | IAsyncEventStoreActions) &
  (IEventStoreRead | IAsyncEventStoreRead);

export type SocialGraphLoaderOptions = Partial<{
  /** An event store to send all the events to and fall back to when the relay returns nothing */
  eventStore?: SocialGraphEventStore;
  /** A method used to load events from a local cache */
  cacheRequest: CacheRequest;
  /** The number of parallel contacts to load at once (default 300) */
  parallel: number;
  /** Extra relays to load from */
  extraRelays?: string[] | Observable<string[]>;
  /** Whether to follow relay hints in contact events */
  hints?: boolean;
}>;

type QueuedProfilePointer = ProfilePointer & { distance: number; since?: number };

/** Create filters for loading contact lists, keeping different since windows separate. */
function createContactsFilters(pointers: QueuedProfilePointer[]): Filter[] {
  const bySince = new Map<number | undefined, string[]>();

  for (const pointer of pointers) {
    const authors = bySince.get(pointer.since);
    if (authors) authors.push(pointer.pubkey);
    else bySince.set(pointer.since, [pointer.pubkey]);
  }

  return Array.from(bySince.entries()).map(([since, authors]) => {
    const filter: Filter = { kinds: [kinds.Contacts], authors };
    if (since !== undefined) filter.since = since;
    return filter;
  });
}

function isRequestedContactsEvent(event: NostrEvent, pointers: QueuedProfilePointer[]) {
  return event.kind === kinds.Contacts && pointers.some((pointer) => pointer.pubkey === event.pubkey);
}

function getBatchRelays(pointers: QueuedProfilePointer[], baseRelays: string[], hints?: boolean) {
  if (hints) return mergeRelaySets(baseRelays, ...pointers.map((pointer) => pointer.relays));
  else return baseRelays;
}

/** Create a social graph loader */
export function createSocialGraphLoader(pool: UpstreamPool, opts?: SocialGraphLoaderOptions): SocialGraphLoader {
  const request = wrapUpstreamPool(pool);

  return wrapGeneratorFunction<[ProfilePointer & { distance: number; since?: number }], NostrEvent>(
    async function* (user) {
      const seen = new Set<string>();
      // Carry `since` on every queue entry so descendants share the same window
      const queue: QueuedProfilePointer[] = [user];
      // Maximum parallel requests (default to 300)
      const maxParallel = opts?.parallel ?? 300;

      // get the relays to load from
      const baseRelays = mergeRelaySets(
        user.relays,
        isObservable(opts?.extraRelays) ? await firstValueFrom(opts?.extraRelays) : opts?.extraRelays,
      );

      // Keep loading while the queue has items
      while (queue.length > 0) {
        // Process up to maxParallel items at once
        const batch = queue.splice(0, maxParallel);
        let remaining = batch;

        // Track the latest contacts event per pubkey so we can expand the queue once
        // the batch observable completes. Using a side-effect here lets us stream every
        // event out to subscribers as it arrives rather than buffering to arrays.
        const latestByPubkey = new Map<string, NostrEvent>();
        const trackLatest = tap<NostrEvent>((event) => {
          const current = latestByPubkey.get(event.pubkey);
          if (!current || event.created_at > current.created_at) latestByPubkey.set(event.pubkey, event);
        });

        if (opts?.cacheRequest) {
          yield makeCacheRequest(opts.cacheRequest, createContactsFilters(batch)).pipe(
            filter((event) => isRequestedContactsEvent(event, batch)),
            // Pass all events to the store if set
            opts?.eventStore ? mapEventsToStore(opts.eventStore) : identity,
            // Remember the newest contacts event per pubkey for queue expansion
            trackLatest,
            // If the cache throws an error, skip it
            catchError(() => EMPTY),
          );

          remaining = batch.filter((pointer) => pointer.since !== undefined || !latestByPubkey.has(pointer.pubkey));
        }

        const relays = getBatchRelays(remaining, baseRelays, opts?.hints);
        if (remaining.length > 0 && relays.length > 0) {
          // Yield the relay observable so every event streams out to subscribers
          // as it arrives from the relay.
          yield request(relays, createContactsFilters(remaining)).pipe(
            filter((event) => isRequestedContactsEvent(event, remaining)),
            // Pass all events to the store if set
            opts?.eventStore ? mapEventsToStore(opts.eventStore) : identity,
            // Remember the newest contacts event per pubkey for queue expansion
            trackLatest,
            // If the relay request throws an error, continue expanding from cache/store
            catchError(() => EMPTY),
          );
        }

        // Batch has completed — expand the queue using the latest contacts event
        // for each pointer, falling back to the event store if the relay returned
        // nothing (typically because `since` let it skip).
        for (const pointer of batch) {
          let latest = latestByPubkey.get(pointer.pubkey);

          if (!latest && opts?.eventStore) {
            const cached = await opts.eventStore.getReplaceable(kinds.Contacts, pointer.pubkey);
            if (cached) latest = cached;
          }

          if (!latest) continue;

          // if the distance is greater than 0, add the contacts to the queue
          if (pointer.distance > 0) {
            const contacts = getPublicContacts(latest);
            for (const contact of contacts) {
              // Dont add any contacts that have already been seen
              if (seen.has(contact.pubkey)) continue;
              seen.add(contact.pubkey);

              // Forward `since` onto descendants so the whole crawl shares the window
              queue.push({ ...contact, distance: pointer.distance - 1, since: pointer.since });
            }
          }
        }
      }
    },
  );
}
