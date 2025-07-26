import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import {
  addRelayHintsToPointer,
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  getZapEventPointer,
  getZapPayment,
  getZapSender,
  isFromCache,
  mergeRelaySets,
  ProfileContent,
} from "applesauce-core/helpers";
import { createAddressLoader, createEventLoader } from "applesauce-loaders/loaders";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { Filter, kinds, NostrEvent } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";
import { useEffect, useMemo, useState } from "react";
import { bufferTime, filter, map } from "rxjs";

import RelayPicker from "../../components/relay-picker";

// Setup event store
const eventStore = new EventStore();
const pool = new RelayPool();

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters(cache, filters).then((events) => {
    console.log("loaded events from cache", events.length);
    return events;
  });
}

// Save all new events to the cache
eventStore.insert$
  .pipe(
    // Only select events that are not from the cache
    filter((e) => !isFromCache(e)),
    // Buffer events for 5 seconds
    bufferTime(5_000),
    // Only select buffers with events
    filter((b) => b.length > 0),
  )
  .subscribe((events) => {
    // Save all new events to the cache
    addEvents(cache, events).then(() => {
      console.log("Saved events to cache", events.length);
    });
  });

// Create loaders that load events from relays and cache
const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest,
  lookupRelays: ["wss://purplepag.es/"],
});
const eventLoader = createEventLoader(pool, { eventStore, cacheRequest });

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;
eventStore.eventLoader = eventLoader;

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return useObservableMemo(() => eventStore.profile(user), [user.pubkey, user.relays?.join("|")]);
}

/** A component for rendering user avatars */
function Avatar({ pubkey, relays }: { pubkey: string; relays?: string[] }) {
  const profile = useProfile({ pubkey, relays });

  return (
    <div className="avatar">
      <div className="w-8 rounded-full">
        <img src={getProfilePicture(profile, `https://robohash.org/${pubkey}.png`)} />
      </div>
    </div>
  );
}

/** A component for rendering usernames */
function Username({ pubkey, relays }: { pubkey: string; relays?: string[] }) {
  const profile = useProfile({ pubkey, relays });

  return <>{getDisplayName(profile, "unknown")}</>;
}

function ZapEvent({ event }: { event: NostrEvent }) {
  const pointer = getZapEventPointer(event) ?? undefined;
  const payment = getZapPayment(event);
  const senderPubkey = getZapSender(event);
  const zapAmount = payment?.amount ? Math.round(payment.amount / 1000) : 0; // Convert msats to sats

  // Load the shared event from the pointer
  useEffect(() => {
    if (!pointer) return;
    const sub = eventLoader(
      // Add extra relay hints to the pointer to load
      addRelayHintsToPointer(pointer, getSeenRelays(event)),
    ).subscribe();
    return () => sub.unsubscribe();
  }, [pointer, event]);

  const relays = useMemo(() => mergeRelaySets(getSeenRelays(event), pointer?.relays), [event, pointer]);

  const zappedEvent = useObservableMemo(() => pointer && eventStore.event(pointer.id), [pointer?.id]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Avatar pubkey={senderPubkey} relays={relays} />
        <h2>
          <span className="font-bold">
            <Username pubkey={senderPubkey} relays={relays} />
          </span>
          <span> zapped </span>
          <span className="text-warning font-bold">{zapAmount} sats</span>
        </h2>
        <time className="ms-auto text-sm text-gray-500">{new Date(event.created_at * 1000).toLocaleString()}</time>
      </div>

      {zappedEvent ? (
        <div className="card card-sm bg-base-100 shadow-md">
          <div className="card-body">
            <div className="flex items-center gap-4">
              <Avatar pubkey={zappedEvent.pubkey} relays={relays} />
              <h2 className="card-title">
                <Username pubkey={zappedEvent.pubkey} relays={relays} />
              </h2>
            </div>
            <p>{zappedEvent.content}</p>
          </div>
        </div>
      ) : pointer ? (
        <div className="card card-sm bg-base-200 shadow-md opacity-50">
          <div className="card-body">
            <div className="flex items-center gap-4">
              <span className="loading loading-dots loading-lg" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-mono">Loading event: {pointer.id}</p>
                {pointer.relays && pointer.relays.length > 0 && (
                  <p className="text-xs text-gray-500">Checking relays: {pointer.relays.join(", ")}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card card-sm bg-error text-error-content shadow-md">
          <div className="card-body">
            <p>Invalid zap: no event pointer found</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ZapsTimeline() {
  const [relay, setRelay] = useState<string>("wss://relay.primal.net/");

  const zaps = useObservableMemo(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [kinds.Zap], limit: 20 })
        .pipe(
          onlyEvents(),
          mapEventsToStore(eventStore),
          mapEventsToTimeline(),
          map((events) => [...events]),
        ),
    [relay],
  );

  return (
    <div className="container mx-auto my-8">
      <div className="flex gap-2 mb-4">
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <div className="flex flex-col gap-4">{zaps?.map((event) => <ZapEvent key={event.id} event={event} />)}</div>
    </div>
  );
}
