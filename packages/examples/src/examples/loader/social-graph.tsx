import { EventStore, Model } from "applesauce-core";
import { getDisplayName, getProfilePicture, persistEventsToCache, ProfileContent } from "applesauce-core/helpers";
import { createAddressLoader, createSocialGraphLoader } from "applesauce-loaders/loaders";
import { useObservableEagerMemo, useObservableMemo } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { SocialGraph } from "nostr-social-graph";
import { Filter, kinds } from "nostr-tools";
import { useMemo, useState } from "react";
import { bufferTime, filter, map, startWith, tap } from "rxjs";
import RelayPicker from "../../components/relay-picker";

const eventStore = new EventStore();
const pool = new RelayPool();

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters(cache, filters);
}

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest,
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

const graphLoader = createSocialGraphLoader(addressLoader, {
  eventStore,
});

/** A model that creates a social graph instance and updates it with the events */
function SocialGraphModel(root: string): Model<SocialGraph> {
  return (events) => {
    const socialGraph = new SocialGraph(root);

    return events.filters({ kinds: [kinds.Contacts, kinds.Mutelist] }).pipe(
      // Add the events to the social graph
      tap((e) => socialGraph.handleEvent(e)),
      // Buffer the events for 1 second
      bufferTime(1000),
      // Only select buffers with events
      filter((b) => b.length > 0),
      // Recalculate the follow distances
      tap(() => socialGraph.recalculateFollowDistances()),
      // Return the social graph
      startWith(socialGraph),
      map(() => socialGraph),
    );
  };
}

/** A model that returns the users at a given follow distance */
function FollowDistanceModel(root: string, distance: number): Model<Set<string>> {
  return (events) => events.model(SocialGraphModel, root).pipe(map((g) => g.getUsersByFollowDistance(distance)));
}

function useProfile(pubkey: string, relays?: string[]): ProfileContent | undefined {
  const user = useMemo(() => ({ pubkey, relays }), [pubkey, relays?.join("|")]);
  return useObservableMemo(() => eventStore.profile(user), [pubkey, relays?.join("|")]);
}

function UserAvatar({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);

  return (
    <div className="avatar placeholder">
      <div className="w-12 rounded-full bg-neutral-focus text-neutral-content">
        <img src={getProfilePicture(profile, `https://robohash.org/${pubkey}.png`)} alt={getDisplayName(profile)} />
      </div>
    </div>
  );
}

function FollowDistanceGroup({ root, distance }: { root: string; distance: number }) {
  const users = useObservableEagerMemo(() => eventStore.model(FollowDistanceModel, root, distance), [root, distance]);
  const preview = Array.from(users).slice(0, 12);

  return (
    <div className="my-6">
      <h2 className="text-2xl font-bold">{distance}</h2>
      <p className="text-gray-500">{users.size}</p>

      {preview.length > 0 ? (
        <div className="flex items-center mt-2">
          <div className="avatar-group -space-x-6">
            {preview.map((pubkey) => (
              <UserAvatar key={pubkey} pubkey={pubkey} />
            ))}
            {users.size > 12 && (
              <div className="avatar placeholder">
                <div className="w-12 bg-neutral-focus text-neutral-content rounded-full">
                  <span>+{users.size - 12}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p>No users at this distance</p>
      )}
    </div>
  );
}

export default function SocialGraphLoader() {
  const [level, setLevel] = useState(2);
  const [root, setRoot] = useState<string | undefined>(undefined);
  const [relay, setRelay] = useState<string>("wss://index.hzrd149.com/");

  // Start loader when root is set
  useObservableMemo(
    () => (root ? graphLoader({ pubkey: root, distance: level, relays: [relay] }) : undefined),
    [root, level, relay],
  );

  return (
    <div className="container mx-auto my-8 p-4 flex flex-col">
      <h1 className="text-xl font-bold mb-4">Social graph loader</h1>

      <div className="join">
        <select
          className="join-item select select-bordered "
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          <option value={1}>1st degree (friends)</option>
          <option value={2}>2nd degree (friends of friends)</option>
          <option value={3}>3rd degree (friends of friends of friends)</option>
        </select>
        <input type="text" readOnly defaultValue={root ?? ""} className="join-item input input-bordered w-sm" />
        <button
          className="btn btn-primary mb-4 join-item"
          onClick={async () => setRoot(await new ExtensionSigner().getPublicKey())}
        >
          From extension
        </button>
      </div>

      <RelayPicker value={relay} onChange={setRelay} />

      {root && (
        <div className="bg-white rounded-lg p-6 shadow-md">
          <FollowDistanceGroup root={root} distance={0} />
          <FollowDistanceGroup root={root} distance={1} />
          <FollowDistanceGroup root={root} distance={2} />
          <FollowDistanceGroup root={root} distance={3} />
        </div>
      )}
    </div>
  );
}
