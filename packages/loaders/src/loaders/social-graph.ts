import { IAsyncEventStoreActions, IAsyncEventStoreRead, IEventStoreActions, IEventStoreRead } from "applesauce-core";
import { getPublicContacts } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { mapEventsToStore } from "applesauce-core/observable";
import { firstValueFrom, identity, isObservable, merge, Observable, tap } from "rxjs";
import { wrapGeneratorFunction } from "../operators/generator.js";
import { AddressPointerLoader, LoadableAddressPointer } from "./address-loader.js";

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
  /** The number of parallel requests to make (default 300) */
  parallel: number;
  /** Extra relays to load from */
  extraRelays?: string[] | Observable<string[]>;
  /** Whether to follow relay hints in contact events */
  hints?: boolean;
}>;

/** Create a social graph loader */
export function createSocialGraphLoader(
  addressLoader: AddressPointerLoader,
  opts?: SocialGraphLoaderOptions,
): SocialGraphLoader {
  return wrapGeneratorFunction<[ProfilePointer & { distance: number; since?: number }], NostrEvent>(
    async function* (user) {
      const seen = new Set<string>();
      // Carry `since` on every queue entry so descendants share the same window
      const queue: (ProfilePointer & { distance: number; since?: number })[] = [user];
      // Maximum parallel requests (default to 300)
      const maxParallel = opts?.parallel ?? 300;

      // get the relays to load from
      const relays = mergeRelaySets(
        user.relays,
        isObservable(opts?.extraRelays) ? await firstValueFrom(opts?.extraRelays) : opts?.extraRelays,
      );

      // Keep loading while the queue has items
      while (queue.length > 0) {
        // Process up to maxParallel items at once
        const batch = queue.splice(0, maxParallel);

        // Track the latest contacts event per pubkey so we can expand the queue once
        // the batch observable completes. Using a side-effect here lets us stream every
        // event out to subscribers as it arrives rather than buffering to arrays.
        const latestByPubkey = new Map<string, NostrEvent>();

        const batchObservable = merge(
          ...batch.map((pointer) => {
            const address: LoadableAddressPointer = {
              kind: kinds.Contacts,
              pubkey: pointer.pubkey,
              relays: opts?.hints ? mergeRelaySets(pointer.relays, relays) : relays,
              since: pointer.since,
            };

            return addressLoader(address).pipe(
              // Pass all events to the store if set
              opts?.eventStore ? mapEventsToStore(opts.eventStore) : identity,
              // Remember the newest contacts event per pubkey for queue expansion
              tap((event) => {
                const current = latestByPubkey.get(pointer.pubkey);
                if (!current || event.created_at > current.created_at) {
                  latestByPubkey.set(pointer.pubkey, event);
                }
              }),
            );
          }),
        );

        // Yield the merged observable so every event streams out to subscribers
        // as it arrives from the relay.
        yield batchObservable;

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
