import { EventStore, mapEventsToStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  getTagValue,
  kinds,
  ProfileContent,
  ProfilePointer,
} from "applesauce-core/helpers";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { npubEncode } from "nostr-tools/nip19";
import { useMemo, useState } from "react";
import { map } from "rxjs";

import RelayPicker from "../../components/relay-picker";

const eventStore = new EventStore();
const pool = new RelayPool();

// Create an address loader to load user profiles
const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

// Add loaders to event store
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

type RecipientStats = {
  pubkey: string;
  count: number;
};

/** Hook to load a user's profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return useObservableMemo(() => eventStore.profile(user), [user.pubkey, user.relays?.join("|")]);
}

/** Component for rendering user avatars */
function Avatar({ pubkey, relays }: { pubkey: string; relays?: string[] }) {
  const profile = useProfile({ pubkey, relays });

  return (
    <div className="avatar">
      <div className="w-10 rounded-full">
        <img
          src={getProfilePicture(profile, `https://robohash.org/${pubkey}.png`)}
          alt={getDisplayName(profile, pubkey)}
        />
      </div>
    </div>
  );
}

/** Component for rendering usernames */
function Username({ pubkey, relays }: { pubkey: string; relays?: string[] }) {
  const profile = useProfile({ pubkey, relays });
  const displayName = getDisplayName(profile, npubEncode(pubkey).slice(0, 5 + 4) + "…" + npubEncode(pubkey).slice(-4));

  return <span className="font-medium">{displayName}</span>;
}

export default function GiftWrapDashboard() {
  const [relay, setRelay] = useState<string>("wss://relay.damus.io/");

  // Query all gift wrap events from the selected relay
  useObservableMemo(
    () =>
      pool.subscription([relay], { kinds: [kinds.GiftWrap] }).pipe(
        // Ignore EOSE
        onlyEvents(),
        // Deduplicate events with the store
        mapEventsToStore(eventStore),
      ),
    [relay],
  );

  // Subscribe to a timeline of gift wrap events
  const giftWrapEvents = useObservableMemo(
    () => eventStore.timeline({ kinds: [kinds.GiftWrap] }).pipe(map((t) => [...t])),
    [],
  );

  // Process events to group by recipient and count
  const recipientStats = useMemo(() => {
    if (!giftWrapEvents) return [];

    // Map to count gift wraps per recipient
    const recipientMap = new Map<string, number>();

    for (const event of giftWrapEvents) {
      // Extract recipient pubkey from #p tag
      const receiver = getTagValue(event, "p");
      if (receiver) recipientMap.set(receiver, (recipientMap.get(receiver) || 0) + 1);
    }

    // Convert to array and sort by count (descending)
    const stats: RecipientStats[] = Array.from(recipientMap.entries())
      .map(([pubkey, count]) => ({ pubkey, count }))
      .sort((a, b) => b.count - a.count);

    return stats;
  }, [giftWrapEvents]);

  // Get unique relays from gift wrap events for profile loading
  const profileRelays = useMemo(() => {
    if (!giftWrapEvents) return [relay];
    // Use the selected relay and any relays where we found events
    return [relay];
  }, [relay, giftWrapEvents]);

  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="card bg-base-100">
        <div className="card-body">
          <h2 className="card-title text-2xl mb-4">Gift Wrap Dashboard</h2>
          <p className="text-sm text-base-content/70 mb-4">
            View all gift wrap events on a relay, grouped by recipient. The table is sorted by the number of gift wrap
            events sent to each recipient.
          </p>

          <div className="mb-6">
            <label className="label">
              <span className="label-text">Select Relay</span>
            </label>
            <RelayPicker value={relay} onChange={setRelay} />
          </div>

          {giftWrapEvents && giftWrapEvents.length === 0 && (
            <div className="alert alert-info">
              <span>No gift wrap events found on this relay.</span>
            </div>
          )}

          {recipientStats.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Recipient</th>
                    <th className="text-right">Gift Wrap Count</th>
                  </tr>
                </thead>
                <tbody>
                  {recipientStats.map((stat, index) => (
                    <tr key={stat.pubkey}>
                      <td className="font-semibold">{index + 1}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar pubkey={stat.pubkey} relays={profileRelays} />
                          <div className="flex flex-col">
                            <Username pubkey={stat.pubkey} relays={profileRelays} />
                            <code className="text-xs font-mono text-base-content/60 break-all">{stat.pubkey}</code>
                          </div>
                        </div>
                      </td>
                      <td className="text-right font-semibold">{stat.count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Total Recipients</th>
                    <th className="text-right">{recipientStats.length}</th>
                  </tr>
                  <tr>
                    <th colSpan={2}>Total Gift Wraps</th>
                    <th className="text-right">{recipientStats.reduce((sum, stat) => sum + stat.count, 0)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {giftWrapEvents && giftWrapEvents.length > 0 && recipientStats.length === 0 && (
            <div className="alert alert-warning">
              <span>Found {giftWrapEvents.length} gift wrap event(s), but none have valid recipient tags.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
