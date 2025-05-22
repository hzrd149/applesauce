import { EventStore, mapEventsToStore, mapEventsToTimeline, QueryStore } from "applesauce-core";
import {
  addRelayHintsToPointer,
  getDisplayName,
  getProfilePicture,
  getZapEventPointer,
  getSeenRelays,
  getZapPayment,
  getZapSender,
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
  useEffect(() => {
    const sub = addressLoader({ kind: 0, pubkey }).subscribe();
    return () => sub.unsubscribe();
  }, [pubkey]);

  const profile = useObservable(queryStore.createQuery(ProfileQuery, pubkey));

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

  const zappedEvent = useObservable(pointer && queryStore.event(pointer.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Avatar pubkey={senderPubkey} />
        <h2>
          <span className="font-bold">
            <Username pubkey={senderPubkey} />
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
              <Avatar pubkey={zappedEvent.pubkey} />
              <h2 className="card-title">
                <Username pubkey={zappedEvent.pubkey} />
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

  const timeline$ = useMemo(
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
  const zaps = useObservable(timeline$);

  return (
    <div className="container mx-auto">
      <div className="flex gap-2 mb-4">
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <div className="flex flex-col gap-4">{zaps?.map((event) => <ZapEvent key={event.id} event={event} />)}</div>
    </div>
  );
}
