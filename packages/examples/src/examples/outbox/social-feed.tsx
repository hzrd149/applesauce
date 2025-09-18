import { defined, EventStore, ignoreBlacklistedRelays, includeMailboxes, mapEventsToStore } from "applesauce-core";
import {
  Filter,
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  groupPubkeysByRelay,
  persistEventsToCache,
  sortRelaysByPopularity,
} from "applesauce-core/helpers";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { selectOptimalRelays } from "applesauce-loaders/operators/outbox-selection";
import { useObservableEagerState, useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { NostrEvent } from "nostr-tools";
import pastellify from "pastellify";
import { useMemo, useState } from "react";
import { BehaviorSubject, map, merge, of, shareReplay, switchMap, throttleTime } from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";

// Extend Window interface to include nostr property
declare global {
  interface Window {
    nostr?: any;
  }
}

const pubkey$ = new BehaviorSubject<string | null>(null);

const pool = new RelayPool();
const eventStore = new EventStore();

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters(cache, filters);
}

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Create some loaders using the cache method and the event store
const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest,
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/", "wss://indexer.coracle.social/"],
});

// Add loaders to event store
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

// Keep a global list of blacklisted relays
const blacklist$ = new BehaviorSubject<string[]>([]);

// Add relays to blacklisted if they fail to connect
pool.add$.subscribe((relay) => {
  relay.error$.subscribe((error) => {
    if (error && !blacklist$.value.includes(relay.url)) {
      console.info(`${relay.url} failed to connect. Adding to blacklist`);
      blacklist$.next([...blacklist$.value, relay.url]);
    }
  });
});

/** A list of users contacts */
const contacts$ = pubkey$.pipe(
  defined(),
  switchMap((pubkey) => eventStore.contacts(pubkey)),
);

/** Contacts with outboxes */
const outboxes$ = contacts$.pipe(
  defined(),
  // Load the NIP-65 outboxes for all contacts
  includeMailboxes(eventStore),
  // Watch the blacklist and ignore relays
  ignoreBlacklistedRelays(blacklist$),
  // Prioritize relays by popularity
  map(sortRelaysByPopularity),
  // Only recalculate every 200ms
  throttleTime(200),
  // Only calculate it once
  shareReplay(1),
);

function NoteRelay({ relay }: { relay: string }) {
  const info = useObservableMemo(() => pool.relay(relay).information$, [relay]);
  const icon =
    info?.icon || new URL("/favicon.ico", relay.replace("wss://", "https://").replace("ws://", "https://")).toString();
  const name = info?.name || relay.replace("wss://", "").replace("ws://", "");
  const color = pastellify(relay, { toCSS: true });

  return (
    <div
      className="w-32 gap-2 relative flex items-end overflow-y-visible overflow-x-hidden border-b-1 pb-1"
      style={{ borderBottomColor: color }}
    >
      <div className="avatar">
        <div className="w-5 h-5 rounded-full">
          <img src={icon} className="w-full h-full object-cover" />
        </div>
      </div>

      <div className="truncate text-xs">{name}</div>
    </div>
  );
}

function Note({ note, selection }: { note: NostrEvent; selection?: string[] }) {
  // Subscribe to the request and wait for the profile event
  const profile = useObservableMemo(() => eventStore.profile(note.pubkey), [note.pubkey]);
  const mailboxes = useObservableMemo(() => eventStore.mailboxes(note.pubkey), [note.pubkey]);

  const displayName = getDisplayName(profile, note.pubkey.slice(0, 8) + "...");
  const avatarUrl = getProfilePicture(profile, `https://robohash.org/${note.pubkey}.png`);

  const relays = Array.from(getSeenRelays(note) ?? []).sort();

  return (
    <div className="border-b border-base-300 px-2 py-4">
      <div className="flex items-start gap-3">
        <div className="avatar">
          <div className="w-12 h-12 rounded-full">
            <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm">{displayName}</span>
            <span className="text-xs text-base-content/60">
              {new Date(note.created_at * 1000).toLocaleTimeString()}
            </span>
            <span className="text-xs text-base-content/60 ms-auto">
              From {selection?.length ?? 0} of {mailboxes?.outboxes.length ?? 0} outboxes
            </span>
          </div>
          <p className="text-sm leading-relaxed break-words">{note.content}</p>
        </div>
      </div>
      <div className="flex gap-4 mt-4">
        {relays.map((relay) => (
          <NoteRelay key={relay} relay={relay} />
        ))}
      </div>
    </div>
  );
}

// Relay Item Component for sidebar
function RelayItem({ relay, userCount, totalUsers }: { relay: string; userCount: number; totalUsers: number }) {
  const info = useObservableMemo(() => pool.relay(relay).information$, [relay]);
  const relayDisplayName = info?.name || relay.replace("wss://", "").replace("ws://", "");
  const coveragePercentage = totalUsers > 0 ? Math.round((userCount / totalUsers) * 100) : 0;

  const color = useMemo(() => pastellify(relay, { toCSS: true }), [relay]);
  const icon =
    info?.icon || new URL("/favicon.ico", relay.replace("wss://", "https://").replace("ws://", "https://")).toString();

  return (
    <div className="flex items-center gap-2 justify-between p-2 hover:bg-base-100 rounded">
      <div className="avatar">
        <div className="w-6 h-6 rounded-full">
          <img src={icon} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color }}>
          {relayDisplayName}
        </div>
        <div className="text-xs text-base-content/60 truncate">{relay}</div>
      </div>
      <div className="flex flex-col items-end ml-2">
        <div className="text-sm font-medium">{userCount}</div>
        <div className="text-xs text-base-content/60">{coveragePercentage}%</div>
      </div>
    </div>
  );
}

// Main Social Feed Component
export default function SocialFeedExample() {
  const pubkey = useObservableEagerState(pubkey$);
  const [maxConnections, setMaxConnections] = useState(30);
  const [maxRelaysPerUser, setMaxRelaysPerUser] = useState(8);
  const [minRelaysPerUser, setMinRelaysPerUser] = useState(2);
  const [maxRelayCoverage, setMaxRelayCoverage] = useState(35);

  // Get grouped outbox data
  const selection = useObservableMemo(
    () =>
      outboxes$.pipe(
        // Select outboxes
        map((users) => {
          console.log("Selecting optimal relays");
          return selectOptimalRelays(users, { maxConnections, maxRelayCoverage, maxRelaysPerUser });
        }),
      ),
    [maxConnections, maxRelayCoverage, maxRelaysPerUser],
  );

  const byPubkey = useMemo(
    () =>
      selection?.reduce(
        (acc, user) => {
          acc[user.pubkey] = user.relays || [];
          return acc;
        },
        {} as Record<string, string[]>,
      ),
    [selection],
  );

  const outboxMap = useMemo(() => selection && groupPubkeysByRelay(selection), [selection]);

  // Sort relays by popularity (number of users) in descending order
  const sortedRelays = outboxMap ? Object.entries(outboxMap).sort(([, a], [, b]) => b.length - a.length) : [];

  // Create feed subscription for selected relays and contacts
  useObservableMemo(() => {
    if (!outboxMap || Object.keys(outboxMap).length === 0) return undefined;

    console.log("Creating relay subscriptions");

    // Create subscriptions for each relay with the pubkeys that use it
    const relaySubscriptions = Object.entries(outboxMap).map(([relayUrl, pubkeys]) =>
      pool.relay(relayUrl).subscription({
        kinds: [1], // Text notes
        authors: pubkeys,
        limit: pubkeys.length, // get at least one event for each pubkey
      }),
    );

    // Merge all relay subscriptions into one stream
    return merge(...relaySubscriptions).pipe(
      // Only get events from relay (ignore EOSE)
      onlyEvents(),
      // deduplicate events using the event store
      mapEventsToStore(eventStore),
    );
  }, [outboxMap]);

  // Get the timeline from the event store
  const feedEvents = useObservableMemo(
    () => (selection ? eventStore.timeline({ kinds: [1], authors: selection?.map((s) => s.pubkey) }) : of([])),
    [selection],
  );

  return (
    <div className="min-h-screen flex">
      {/* Main Content Area */}
      <div className="flex-1 bg-base-50">
        <div className="max-w-2xl mx-auto">
          {pubkey ? (
            <div className="min-h-screen">
              {/* Feed Header */}
              <div className="sticky top-0 bg-base-50/95 backdrop-blur-sm border-b border-base-300 p-2 mb-4 z-10">
                <h1 className="text-2xl font-bold mb-2">Social Feed</h1>
                <p className="text-base-content/60 text-sm">
                  Connected to {sortedRelays.length} relays • {selection?.length || 0} contacts
                </p>
              </div>

              {/* Feed Content */}
              <div className="bg-base-100 border border-base-300 rounded-lg">
                {feedEvents && feedEvents.length > 0 ? (
                  <div className="divide-y divide-base-300">
                    {feedEvents.map((event) => (
                      <Note key={event.id} note={event} selection={byPubkey?.[event.pubkey]} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="text-base-content/60 mb-4">
                      {feedEvents === undefined ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="loading loading-spinner loading-md"></div>
                          <span>Loading feed...</span>
                        </div>
                      ) : (
                        "No posts found. Try adjusting your relay settings or wait for new posts."
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-20">
              <h1 className="text-3xl font-bold mb-4">Welcome to Social Feed</h1>
              <p className="text-base-content/60 text-lg">Enter your npub in the sidebar to get started</p>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-80 bg-base-100 border-r border-base-300 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-base-300">
          <h2 className="text-xl font-bold mb-4">Social Feed</h2>

          {/* Pubkey Picker */}
          <div className="mb-4">
            <label className="label">
              <span className="label-text">Your npub</span>
            </label>
            <PubkeyPicker
              value={pubkey || ""}
              onChange={(p) => pubkey$.next(p)}
              placeholder="Enter your npub or nostr identifier..."
            />
          </div>
        </div>

        {/* Relay Selection Controls */}
        <div className="p-4 border-b border-base-300">
          <h3 className="text-lg font-semibold mb-4">Relay Settings</h3>

          <div className="space-y-4">
            {/* Max Connections */}
            <div>
              <label className="label">
                <span className="label-text">Max connections</span>
                <span className="label-text-alt">{maxConnections}</span>
              </label>
              <input
                type="range"
                min="1"
                max="200"
                step="1"
                value={maxConnections}
                onChange={(e) => setMaxConnections(Number(e.target.value))}
                className="range range-primary range-sm"
              />
              <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
                <span>1</span>
                <span>100</span>
                <span>200</span>
              </div>
            </div>

            {/* Max Coverage */}
            <div>
              <label className="label">
                <span className="label-text">Max coverage</span>
                <span className="label-text-alt">{maxRelayCoverage}%</span>
              </label>
              <input
                type="range"
                min="10"
                max="100"
                value={maxRelayCoverage}
                onChange={(e) => setMaxRelayCoverage(Number(e.target.value))}
                className="range range-primary range-sm"
              />
              <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
                <span>10%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Min Relays per User */}
            <div>
              <label className="label">
                <span className="label-text">Min per user</span>
                <span className="label-text-alt">{minRelaysPerUser}</span>
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={minRelaysPerUser}
                onChange={(e) => setMinRelaysPerUser(Number(e.target.value))}
                className="range range-primary range-sm"
              />
              <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
                <span>0</span>
                <span>5</span>
                <span>10</span>
              </div>
            </div>

            {/* Max Relays per User */}
            <div>
              <label className="label">
                <span className="label-text">Max per user</span>
                <span className="label-text-alt">{maxRelaysPerUser}</span>
              </label>
              <input
                type="range"
                min="0"
                max="30"
                value={maxRelaysPerUser}
                onChange={(e) => setMaxRelaysPerUser(Number(e.target.value))}
                className="range range-primary range-sm"
              />
              <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
                <span>0</span>
                <span>15</span>
                <span>30</span>
              </div>
            </div>
          </div>
        </div>

        {/* Selected Relays */}
        <div className="flex-1 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Selected Relays</h3>
            <div className="badge badge-outline">{sortedRelays.length}</div>
          </div>

          <div className="space-y-1 max-h-96 overflow-y-auto">
            {sortedRelays.length === 0 ? (
              <div className="text-center py-8 text-base-content/60">
                {pubkey ? "Loading relays..." : "Enter your npub to view relays"}
              </div>
            ) : (
              sortedRelays.map(([relay, pubkeys]) => (
                <RelayItem key={relay} relay={relay} userCount={pubkeys.length} totalUsers={selection?.length || 0} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
