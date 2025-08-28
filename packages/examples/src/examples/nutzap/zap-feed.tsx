import { EventStore, mapEventsToStore, mapEventsToTimeline, Model } from "applesauce-core";
import { addRelayHintsToPointer, getDisplayName, getProfilePicture, getSeenRelays } from "applesauce-core/helpers";
import { createAddressLoader, createEventLoader } from "applesauce-loaders/loaders";
import { useObservableEagerMemo, useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import {
  getNutzapAmount,
  getNutzapComment,
  getNutzapEventPointer,
  getNutzapMint,
  getNutzapRecipient,
  isValidNutzap,
  NUTZAP_KIND,
} from "applesauce-wallet/helpers";
import { NostrEvent } from "nostr-tools";
import { EventPointer } from "nostr-tools/nip19";
import { useMemo, useState } from "react";
import { EMPTY, ignoreElements, iif, map, mergeWith } from "rxjs";

import RelayPicker from "../../components/relay-picker";

// Setup event store
const eventStore = new EventStore();

// Create a relay pool for connections
const pool = new RelayPool();

// Create an address loader
const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: ["wss://purplepag.es/"],
});
const eventLoader = createEventLoader(pool, { eventStore });

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

function EventQuery(pointer: EventPointer): Model<NostrEvent | undefined> {
  return (events) =>
    iif(() => !events.hasEvent(pointer.id), eventLoader(pointer), EMPTY).pipe(
      ignoreElements(),
      mergeWith(events.event(pointer.id)),
    );
}

/** A component for rendering user avatars */
function Avatar({ pubkey, relays }: { pubkey: string; relays?: string[] }) {
  const profile = useObservableEagerMemo(() => eventStore.profile({ pubkey, relays }), [pubkey, relays?.join("|")]);

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
  const profile = useObservableEagerMemo(() => eventStore.profile({ pubkey, relays }), [pubkey, relays?.join("|")]);

  return <>{getDisplayName(profile, "unknown")}</>;
}

function NutzapEvent({ event }: { event: NostrEvent }) {
  const recipient = getNutzapRecipient(event);
  const eventPointer = getNutzapEventPointer(event);
  const amount = getNutzapAmount(event);
  const comment = getNutzapComment(event);
  const mint = getNutzapMint(event);
  const isValid = isValidNutzap(event);
  const relays = useMemo(() => Array.from(getSeenRelays(event) ?? []), [event]);

  const zappedEvent = useObservableMemo(
    () => (eventPointer ? eventStore.model(EventQuery, addRelayHintsToPointer(eventPointer, relays)) : undefined),
    [eventPointer, relays],
  );

  if (!isValid) {
    return (
      <div className="card bg-error text-error-content shadow-md">
        <div className="card-body">
          <p>Invalid nutzap event</p>
          <pre>
            <code>{JSON.stringify(event, null, 2)}</code>
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Avatar pubkey={event.pubkey} relays={relays} />
        <h2>
          <span className="font-bold">
            <Username pubkey={event.pubkey} relays={relays} />
          </span>
          <span> nutzapped {amount} sats</span>
          {recipient && (
            <span>
              {" "}
              to <Username pubkey={recipient} relays={relays} />
            </span>
          )}
        </h2>
        <time className="ms-auto text-sm text-gray-500">{new Date(event.created_at * 1000).toLocaleString()}</time>
      </div>

      <div className="flex gap-2 items-center text-sm text-gray-600">
        <span className="badge badge-primary badge-sm">{amount} sats</span>
        {mint && (
          <span className="badge badge-secondary badge-sm" title={mint}>
            {new URL(mint).hostname}
          </span>
        )}
      </div>

      {comment && (
        <div className="bg-base-200 rounded-lg p-3">
          <p className="text-sm">{comment}</p>
        </div>
      )}

      {zappedEvent ? (
        <div className="card bg-base-100 shadow-md">
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
      ) : eventPointer ? (
        <div className="card bg-base-200 shadow-md opacity-50">
          <div className="card-body">
            <div className="flex items-center gap-4">
              <span className="loading loading-dots loading-lg" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-mono">
                  Loading event: {eventPointer.id} from {eventPointer.relays?.join(", ")}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ZapSummary {
  totalAmount: number;
  totalZaps: number;
  uniqueMints: number;
}

function ZapSummaryCard({ summary }: { summary: ZapSummary }) {
  return (
    <div className="card bg-primary text-primary-content shadow-lg">
      <div className="card-body">
        <div className="flex justify-between items-center">
          <div>
            <div className="stat-title text-primary-content opacity-80">Total Zapped</div>
            <div className="stat-value text-2xl">{summary.totalAmount.toLocaleString()} sats</div>
          </div>
          <div className="text-center">
            <div className="stat-title text-primary-content opacity-80">Total Zaps</div>
            <div className="stat-value text-2xl">{summary.totalZaps}</div>
          </div>
          <div className="text-center">
            <div className="stat-title text-primary-content opacity-80">Unique Mints</div>
            <div className="stat-value text-2xl">{summary.uniqueMints}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ZapFeed() {
  const [relay, setRelay] = useState<string>("wss://relay.primal.net/");

  const nutzaps = useObservableMemo(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [NUTZAP_KIND] })
        .pipe(
          onlyEvents(),
          mapEventsToStore(eventStore),
          mapEventsToTimeline(),
          map((events) => [...events]),
        ),
    [relay],
  );

  const summary = useMemo(() => {
    if (!nutzaps) return { totalAmount: 0, totalZaps: 0, uniqueMints: 0 };

    const validNutzaps = nutzaps.filter(isValidNutzap);
    const totalAmount = validNutzaps.reduce((sum, event) => sum + getNutzapAmount(event), 0);
    const mints = validNutzaps.map(getNutzapMint).filter((mint): mint is string => mint !== undefined);
    const uniqueMints = new Set(mints).size;

    return {
      totalAmount,
      totalZaps: validNutzaps.length,
      uniqueMints,
    };
  }, [nutzaps]);

  return (
    <div className="container mx-auto my-8">
      <div className="flex gap-2 mb-4">
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <div className="mb-6">
        <ZapSummaryCard summary={summary} />
      </div>

      <div className="flex flex-col gap-4">
        {nutzaps?.map((event) => (
          <NutzapEvent key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
