import { EventStore, mapEventsToStore, mapEventsToTimeline, QueryStore } from "applesauce-core";
import {
  addRelayHintsToPointer,
  getDisplayName,
  getProfilePicture,
  getReactionEventPointer,
  getSeenRelays,
} from "applesauce-core/helpers";
import { ProfileQuery } from "applesauce-core/queries";
import { addressPointerLoader, eventPointerLoader } from "applesauce-loaders";
import { useObservable } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { kinds, NostrEvent } from "nostr-tools";
import { useEffect, useMemo, useState } from "react";
import { map } from "rxjs";

import { RelayPicker } from "../components/relay-picker";

const eventStore = new EventStore();
const queryStore = new QueryStore(eventStore);

const pool = new RelayPool();

const addressLoader = addressPointerLoader(pool.request.bind(pool), {
  eventStore,
  lookupRelays: ["wss://purplepag.es/"],
});
const eventLoader = eventPointerLoader(pool.request.bind(pool), { eventStore });

function Avatar({ pubkey }: { pubkey: string }) {
  useEffect(() => {
    const sub = addressLoader({ kind: 0, pubkey }).subscribe();
    return () => sub.unsubscribe();
  }, [pubkey]);

  const profile = useObservable(queryStore.createQuery(ProfileQuery, pubkey));

  return (
    <div className="avatar">
      <div className="w-8 rounded-full">
        <img src={getProfilePicture(profile, `https://robohash.org/${pubkey}.png`)} />
      </div>
    </div>
  );
}

function Username({ pubkey }: { pubkey: string }) {
  // TODO: this isn't clean, need a better solution to "request" events to be loaded
  useEffect(() => {
    const sub = addressLoader({ kind: 0, pubkey }).subscribe();
    return () => sub.unsubscribe();
  }, [pubkey]);

  const profile = useObservable(queryStore.createQuery(ProfileQuery, pubkey));

  return <>{getDisplayName(profile, "unknown")}</>;
}

function ReactionEvent({ event }: { event: NostrEvent }) {
  const pointer = getReactionEventPointer(event);

  // Load the shared event from the pointer
  useEffect(() => {
    if (!pointer) return;
    const sub = eventLoader(
      // Add extra relay hints to the pointer to load
      addRelayHintsToPointer(pointer, getSeenRelays(event)),
    ).subscribe();
    return () => sub.unsubscribe();
  }, [pointer, event]);

  const reactedTo = useObservable(pointer && queryStore.event(pointer.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Avatar pubkey={event.pubkey} />
        <h2>
          <span className="font-bold">
            <Username pubkey={event.pubkey} />
          </span>
          <span> reacted {event.content} to</span>
        </h2>
        <time className="ms-auto text-sm text-gray-500">{new Date(event.created_at * 1000).toLocaleString()}</time>
      </div>

      {reactedTo ? (
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <div className="flex items-center gap-4">
              <Avatar pubkey={event.pubkey} />
              <h2 className="card-title">
                <Username pubkey={event.pubkey} />
              </h2>
            </div>
            <p>{reactedTo.content}</p>
          </div>
        </div>
      ) : pointer ? (
        <div className="card bg-base-200 shadow-md opacity-50">
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
        <div className="card bg-error text-error-content shadow-md">
          <div className="card-body">
            <p>Invalid reaction: no event pointer found</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReactionsTimeline() {
  const [relay, setRelay] = useState<string>("wss://relay.primal.net/");

  const timeline$ = useMemo(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [kinds.Reaction], limit: 20 })
        .pipe(
          onlyEvents(),
          mapEventsToStore(eventStore),
          mapEventsToTimeline(),
          map((events) => [...events]),
        ),
    [relay],
  );
  const reactions = useObservable(timeline$);

  return (
    <div className="container mx-auto">
      <div className="flex gap-2 mb-4">
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <div className="flex flex-col gap-4">
        {reactions?.map((event) => <ReactionEvent key={event.id} event={event} />)}
      </div>
    </div>
  );
}
