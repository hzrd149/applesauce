import { mapEventsToStore } from "applesauce-core/observable";
import { getProfilePointersFromList } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { firstValueFrom, identity, isObservable, lastValueFrom, Observable, toArray } from "rxjs";
import { wrapGeneratorFunction } from "../operators/generator.js";
import { AddressPointerLoader, LoadableAddressPointer } from "./address-loader.js";

/** A loader that loads the social graph of a user out to a set distance */
export type SocialGraphLoader = (user: ProfilePointer & { distance: number }) => Observable<NostrEvent>;

export type SocialGraphLoaderOptions = Partial<{
  /** An event store to send all the events to */
  eventStore?: Parameters<typeof mapEventsToStore>[0];
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
  return wrapGeneratorFunction<[ProfilePointer & { distance: number }], NostrEvent>(async function* (user) {
    const seen = new Set<string>();
    const queue: (ProfilePointer & { distance: number })[] = [user];
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

      const promises = batch.map(async (pointer) => {
        const address: LoadableAddressPointer = {
          kind: kinds.Contacts,
          pubkey: pointer.pubkey,
          relays: opts?.hints ? mergeRelaySets(pointer.relays, relays) : relays,
        };

        // load the contacts events
        const events = await lastValueFrom(
          addressLoader(address).pipe(
            // Pass all events to the store if set
            opts?.eventStore ? mapEventsToStore(opts.eventStore) : identity,
            // Conver to array
            toArray(),
          ),
        );

        if (events.length === 0) return;
        const contacts = getProfilePointersFromList(events[events.length - 1]);

        // if the distance is greater than 0, add the contacts to the queue
        if (pointer.distance > 0) {
          for (const contact of contacts) {
            // Dont add any contacts that have already been seen
            if (seen.has(contact.pubkey)) continue;
            seen.add(contact.pubkey);

            // Add to queue
            queue.push({ ...contact, distance: pointer.distance - 1 });
          }
        }
      });

      // Wait for all parallel operations to complete
      await Promise.all(promises);
    }
  });
}
