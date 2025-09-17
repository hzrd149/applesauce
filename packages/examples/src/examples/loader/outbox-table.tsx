import { defined, EventStore } from "applesauce-core";
import { Filter, getDisplayName, getProfilePicture, persistEventsToCache } from "applesauce-core/helpers";
import { AddressPointerLoader, createAddressLoader } from "applesauce-loaders/loaders";
import {
  groupPubkeysByRelay,
  ignoreBlacklistedRelays,
  includeLegacyWriteRelays,
  includeOutboxes,
  sortRelaysByPopularity,
} from "applesauce-loaders/operators";
import { selectOptimalRelays } from "applesauce-loaders/operators/outbox-selection";
import { useObservableMemo, useObservableState } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { npubEncode, ProfilePointer } from "nostr-tools/nip19";
import React, { useEffect, useMemo, useState } from "react";
import { BehaviorSubject, EMPTY, map, shareReplay, switchMap, timeout } from "rxjs";

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
  lookupRelays: [
    "wss://purplepag.es/",
    "wss://index.hzrd149.com/",
    "wss://indexer.coracle.social/",
    "wss://relay.primal.net/",
    "wss://relay.damus.io/",
  ],
});

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

/** Keep a list of relays to never connect to */
const blacklist$ = new BehaviorSubject<string[]>([]);

// Listen for relay errors and add them to the blacklist
const listeners = new Map();
pool.add$.subscribe((relay) => {
  const sub = relay.error$.pipe(defined()).subscribe((error) => {
    console.error("Relay error", error);
    if (blacklist$.value.includes(relay.url)) return;

    console.error(`Adding ${relay.url} to blacklist`);
    blacklist$.next([...blacklist$.value, relay.url]);
  });
  listeners.set(relay, sub);
});
pool.remove$.subscribe((relay) => {
  const sub = listeners.get(relay);
  if (sub) sub.unsubscribe();
  listeners.delete(relay);
});

/** A list of users contacts */
const contacts$ = pubkey$.pipe(
  defined(),
  switchMap((pubkey) => eventStore.contacts(pubkey)),
);

const loader: AddressPointerLoader = (p) =>
  eventStore.replaceable(p).pipe(
    defined(),
    // Timeout the request if it takes too long
    timeout({ first: 2_000, with: () => EMPTY }),
  );

/** Add outbox relays to contacts */
const outboxes$ = contacts$.pipe(
  defined(),
  // Load the NIP-65 outboxes for all contacts
  includeOutboxes(loader),
  // Load the legacy write relays for contacts missing the NIP-65 outboxes
  includeLegacyWriteRelays(loader),
  // Ignore blacklisted relays
  ignoreBlacklistedRelays(blacklist$),
  // Prioritize relays by popularity
  sortRelaysByPopularity(),
  // Only calculate it once
  shareReplay(1),
);

// User Avatar Component
function UserAvatar({ user }: { user: ProfilePointer }) {
  const profile = useObservableMemo(() => eventStore.profile(user.pubkey), [user.pubkey]);

  const displayName = getDisplayName(profile, user.pubkey.slice(0, 8) + "...");
  const avatarUrl = getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`);

  const mailboxes = useObservableMemo(() => eventStore.mailboxes(user.pubkey), [user.pubkey]);

  return (
    <a
      className="flex flex-col items-center gap-1 p-2 hover:bg-base-200 rounded-lg transition-colors"
      href={`https://njump.me/${npubEncode(user.pubkey)}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="avatar">
        <div className="w-10 h-10 rounded-full">
          <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className="text-xs max-w-16 overflow-hidden flex items-center justify-center gap-1">
        <div className="truncate">{displayName}</div>
        <div className="text-base-content/60">({mailboxes?.outboxes.length || 0})</div>
      </div>
    </a>
  );
}

// Relay Row Component
function RelayRow({ relay, users, totalUsers }: { relay: string; users: ProfilePointer[]; totalUsers: number }) {
  const [expanded, setExpanded] = useState(false);
  const [infoLoadAttempted, setInfoLoadAttempted] = useState(false);
  const info = useObservableMemo(() => pool.relay(relay).information$, [relay]);

  // Attempt to load relay information when component mounts or when info is null
  useEffect(() => {
    if (!infoLoadAttempted && info === null) {
      setInfoLoadAttempted(true);

      const relayInstance = pool.relay(relay);

      // Try to get relay information with timeout
      Promise.race([
        relayInstance.getInformation(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000)),
      ])
        .then((relayInfo) => {
          console.log(`✅ Relay ${relay} responded:`, relayInfo?.name || "No name");
        })
        .catch((error) => {
          console.error(`❌ Relay ${relay} failed to load information:`, error);

          // Add to blacklist if not already there
          const currentBlacklist = blacklist$.value;
          if (!currentBlacklist.includes(relay)) {
            console.log(`Adding ${relay} to blacklist due to info loading failure`);
            blacklist$.next([...currentBlacklist, relay]);
          }
        });
    }
  }, [relay, info, infoLoadAttempted]);

  const relayDisplayName = info?.name || relay.replace("wss://", "").replace("ws://", "");
  const icon =
    info?.icon || new URL("/favicon.ico", relay.replace("wss://", "https://").replace("ws://", "https://")).toString();

  return (
    <tr>
      <td colSpan={3} className="p-0">
        <div className="w-full">
          {/* Relay header row */}
          <div
            className="flex items-center justify-between p-4 hover:bg-base-100 cursor-pointer transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-3">
              <div className="text-lg">{expanded ? "▼" : "▶"}</div>
              <div className="avatar">
                <div className="w-10 h-10 rounded-full">
                  <img src={icon} className="w-full h-full object-cover" />
                </div>
              </div>
              <div>
                <div className="font-medium">{relayDisplayName}</div>
                <div className="text-sm text-base-content/60">{relay}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="badge badge-primary">{users.length} users</div>
              <div className="badge badge-outline">
                {totalUsers > 0 ? Math.round((users.length / totalUsers) * 100) : 0}%
              </div>
            </div>
          </div>

          {/* Expanded user avatars */}
          {expanded && (
            <div className="px-4 pb-4">
              <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
                {users.map((user) => (
                  <UserAvatar key={user.pubkey} user={user} />
                ))}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// Settings Panel Component
function SettingsPanel({
  pubkey,
  setPubkey,
  maxRelaysPerUser,
  setMaxRelaysPerUser,
  minRelaysPerUser,
  setMinRelaysPerUser,
  maxConnections,
  setMaxConnections,
  maxRelayCoverage,
  setMaxRelayCoverage,
}: {
  pubkey: string;
  setPubkey: (value: string) => void;
  maxRelaysPerUser: number;
  setMaxRelaysPerUser: (value: number) => void;
  maxRelayCoverage: number;
  setMaxRelayCoverage: (value: number) => void;
  maxConnections: number;
  setMaxConnections: (value: number) => void;
  minRelaysPerUser: number;
  setMinRelaysPerUser: (value: number) => void;
}) {
  const handlePubkeyChange = (normalizedPubkey: string) => {
    setPubkey(normalizedPubkey);
    pubkey$.next(normalizedPubkey);
  };

  return (
    <div className="space-y-4">
      <PubkeyPicker
        value={pubkey}
        onChange={handlePubkeyChange}
        label="Pubkey (hex, npub, or nprofile)"
        placeholder="Enter pubkey or nostr identifier..."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col w-full">
          <label className="label pb-1">
            <span className="label-text">Max connections: {maxConnections}</span>
          </label>
          <input
            type="range"
            min="1"
            max="200"
            step="1"
            value={maxConnections}
            onChange={(e) => setMaxConnections(Number(e.target.value))}
            className="range range-primary range-sm w-full"
          />
          <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
            <span>1</span>
            <span>100</span>
            <span>200</span>
          </div>
        </div>

        <div className="flex flex-col w-full">
          <label className="label pb-1">
            <span className="label-text">Max relay coverage: {maxRelayCoverage}%</span>
          </label>
          <input
            type="range"
            min="10"
            max="100"
            value={maxRelayCoverage}
            onChange={(e) => setMaxRelayCoverage(Number(e.target.value))}
            className="range range-primary range-sm w-full"
          />
          <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
            <span>10%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="flex flex-col w-full">
          <label className="label pb-1">
            <span className="label-text">Min relays per user: {minRelaysPerUser}</span>
          </label>
          <input
            type="range"
            min="0"
            max="10"
            value={minRelaysPerUser}
            onChange={(e) => setMinRelaysPerUser(Number(e.target.value))}
            className="range range-primary range-sm w-full"
          />
          <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        <div className="flex flex-col w-full">
          <label className="label pb-1">
            <span className="label-text">Max relays per user: {maxRelaysPerUser}</span>
          </label>
          <input
            type="range"
            min="0"
            max="30"
            value={maxRelaysPerUser}
            onChange={(e) => setMaxRelaysPerUser(Number(e.target.value))}
            className="range range-primary range-sm w-full"
          />
          <div className="w-full flex justify-between text-xs px-2 text-base-content/60">
            <span>0</span>
            <span>15</span>
            <span>30</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Users by Relay Count Component
function UsersByRelayCount({
  contacts,
  originalContacts,
}: {
  contacts: ProfilePointer[] | null | undefined;
  originalContacts: ProfilePointer[] | null | undefined;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Calculate missing relays users - users who never had any relays (no NIP-65 relay list)
  const missingRelaysUsers = useMemo(() => {
    if (!originalContacts || !contacts) return [];

    const originalMap = new Map(originalContacts.map((user) => [user.pubkey, user]));

    return contacts.filter((selectedUser) => {
      const originalUser = originalMap.get(selectedUser.pubkey);
      const hasNoRelaysInOriginal = !originalUser?.relays || originalUser.relays.length === 0;
      const hasNoRelaysInSelected = !selectedUser.relays || selectedUser.relays.length === 0;

      return hasNoRelaysInOriginal && hasNoRelaysInSelected;
    });
  }, [originalContacts, contacts]);

  // Calculate orphaned users - users who had relays originally but have none after selection
  const orphanedUsers = useMemo(() => {
    if (!originalContacts || !contacts) return [];

    const selectedMap = new Map(contacts.map((user) => [user.pubkey, user]));

    return originalContacts.filter((originalUser) => {
      const hasOriginalRelays = originalUser.relays && originalUser.relays.length > 0;
      const selectedUser = selectedMap.get(originalUser.pubkey);
      const hasSelectedRelays = selectedUser?.relays && selectedUser.relays.length > 0;

      return hasOriginalRelays && !hasSelectedRelays;
    });
  }, [originalContacts, contacts]);

  // Group users by relay count - always call this hook
  const usersByRelayCount = useMemo(() => {
    if (!contacts) return {};

    const groups: { [relayCount: number]: ProfilePointer[] } = {};

    contacts.forEach((user) => {
      const relayCount = user.relays?.length || 0;
      if (!groups[relayCount]) groups[relayCount] = [];

      groups[relayCount].push(user);
    });

    // Sort users within each group by pubkey for consistent ordering
    Object.values(groups).forEach((group) => {
      group.sort((a, b) => a.pubkey.localeCompare(b.pubkey));
    });

    return groups;
  }, [contacts]);

  // Sort relay counts ascending (users with least relays first) - always call this hook
  const sortedRelayCounts = useMemo(() => {
    return Object.keys(usersByRelayCount)
      .map(Number)
      .sort((a, b) => a - b);
  }, [usersByRelayCount]);

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  if (!contacts) {
    return (
      <div className="mt-8">
        <h2 className="text-xl font-bold mb-4">Users by Relay Count</h2>
        <p className="text-base-content/60">No data available</p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-xl font-bold mb-4">Users by Relay Count</h2>
      <p className="text-base-content/60 mb-6">
        All users grouped by how many relays have been selected for them. Click rows to expand and see users.
      </p>

      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Relay Count</th>
              <th>Users</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {sortedRelayCounts.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-12 text-base-content/60">
                  No relay count data available
                </td>
              </tr>
            ) : (
              <>
                {/* Missing Relays Section */}
                {missingRelaysUsers.length > 0 && (
                  <React.Fragment>
                    <tr className="hover:bg-base-200 cursor-pointer" onClick={() => toggleSection("missing-relays")}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="text-lg">{expandedSections.has("missing-relays") ? "▼" : "▶"}</div>
                          <span className="font-medium text-warning">Missing Relays</span>
                        </div>
                      </td>
                      <td>
                        <div className="badge badge-warning">{missingRelaysUsers.length}</div>
                      </td>
                      <td>
                        <span className="text-sm text-base-content/80">
                          Users without any relays (no NIP-65 relay list published)
                        </span>
                      </td>
                    </tr>

                    {expandedSections.has("missing-relays") && (
                      <tr>
                        <td colSpan={3} className="p-0">
                          <div className="bg-base-100 p-4">
                            <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
                              {missingRelaysUsers.map((user) => (
                                <UserAvatar key={user.pubkey} user={user} />
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )}

                {/* Orphaned Users Section */}
                {orphanedUsers.length > 0 && (
                  <React.Fragment>
                    <tr className="hover:bg-base-200 cursor-pointer" onClick={() => toggleSection("orphaned-users")}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="text-lg">{expandedSections.has("orphaned-users") ? "▼" : "▶"}</div>
                          <span className="font-medium text-error">Orphaned Users</span>
                        </div>
                      </td>
                      <td>
                        <div className="badge badge-error">{orphanedUsers.length}</div>
                      </td>
                      <td>
                        <span className="text-sm text-base-content/80">
                          Users who lost all relays after selection process
                        </span>
                      </td>
                    </tr>

                    {expandedSections.has("orphaned-users") && (
                      <tr>
                        <td colSpan={3} className="p-0">
                          <div className="bg-base-100 p-4">
                            <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
                              {orphanedUsers.map((user) => (
                                <UserAvatar key={user.pubkey} user={user} />
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )}

                {/* Regular Relay Count Sections */}
                {sortedRelayCounts
                  .filter((relayCount) => relayCount > 0) // Exclude 0 relay count since we handle it separately
                  .map((relayCount) => {
                    const users = usersByRelayCount[relayCount];
                    const sectionId = `relay-count-${relayCount}`;
                    const isExpanded = expandedSections.has(sectionId);

                    const getDescription = (count: number): string => {
                      if (count === 1) return "High risk - single point of failure";
                      if (count <= 3) return "Limited redundancy - may have connectivity issues";
                      if (count <= 5) return "Good coverage with reasonable redundancy";
                      return "Excellent coverage with high redundancy";
                    };

                    return (
                      <React.Fragment key={relayCount}>
                        <tr className="hover:bg-base-200 cursor-pointer" onClick={() => toggleSection(sectionId)}>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="text-lg">{isExpanded ? "▼" : "▶"}</div>
                              <span className="font-medium">
                                {relayCount === 1 ? "1 Relay" : `${relayCount} Relays`}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="badge badge-neutral">{users.length}</div>
                          </td>
                          <td>
                            <span className="text-sm text-base-content/80">{getDescription(relayCount)}</span>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr>
                            <td colSpan={3} className="p-0">
                              <div className="bg-base-100 p-4">
                                <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
                                  {users.map((user) => (
                                    <UserAvatar key={user.pubkey} user={user} />
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Summary at the bottom */}
      <div className="mt-6 p-4 bg-base-200 rounded-lg">
        <div className="text-sm text-base-content/70">
          <strong>{contacts.length}</strong> total users distributed across relay count groups
        </div>
        {(missingRelaysUsers.length > 0 || orphanedUsers.length > 0) && (
          <div className="text-xs text-base-content/60 mt-2">
            <div className="flex flex-wrap gap-4">
              {missingRelaysUsers.length > 0 && (
                <span className="text-warning">
                  <strong>{missingRelaysUsers.length}</strong> users missing relays (no NIP-65 published)
                </span>
              )}
              {orphanedUsers.length > 0 && (
                <span className="text-error">
                  <strong>{orphanedUsers.length}</strong> users orphaned (lost relays after selection)
                </span>
              )}
            </div>
          </div>
        )}
        {sortedRelayCounts.length > 0 && (
          <div className="text-xs text-base-content/60 mt-1">
            Active relay range: {Math.min(...sortedRelayCounts.filter((c) => c > 0))} - {Math.max(...sortedRelayCounts)}{" "}
            relays per user
          </div>
        )}
      </div>
    </div>
  );
}

// Main Component
export default function OutboxTable() {
  const [pubkey, setPubkey] = useState<string>("");
  const [maxConnections, setMaxConnections] = useState(30);
  const [maxRelaysPerUser, setMaxRelaysPerUser] = useState(8);
  const [minRelaysPerUser, setMinRelaysPerUser] = useState(2);
  const [maxRelayCoverage, setMaxRelayCoverage] = useState(35);

  // Get original outboxes data (before selection)
  const originalOutboxes = useObservableState(outboxes$, []);

  // Get grouped outbox data
  const selection = useObservableMemo(
    () =>
      outboxes$.pipe(
        // Select outboxes
        map((users) => selectOptimalRelays(users, { maxConnections, maxRelayCoverage, maxRelaysPerUser })),
      ),
    [maxConnections, maxRelayCoverage, maxRelaysPerUser],
  );

  const outboxMap = useMemo(() => selection && groupPubkeysByRelay(selection), [selection]);

  // Sort relays by popularity (number of users) in descending order
  const sortedRelays = outboxMap ? Object.entries(outboxMap).sort(([, a], [, b]) => b.length - a.length) : [];

  return (
    <div className="min-h-screen p-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Outbox Relay Table</h1>
        <p className="text-base-content/60 text-lg">Relays sorted by popularity with expandable user lists</p>
      </div>

      {/* Settings */}
      <SettingsPanel
        pubkey={pubkey}
        setPubkey={setPubkey}
        maxRelaysPerUser={maxRelaysPerUser}
        setMaxRelaysPerUser={setMaxRelaysPerUser}
        minRelaysPerUser={minRelaysPerUser}
        setMinRelaysPerUser={setMinRelaysPerUser}
        maxConnections={maxConnections}
        setMaxConnections={setMaxConnections}
        maxRelayCoverage={maxRelayCoverage}
        setMaxRelayCoverage={setMaxRelayCoverage}
      />

      {/* Table */}
      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th colSpan={3} className="text-left text-lg">
                Relays ({sortedRelays.length})
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRelays.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-12 text-base-content/60">
                  {pubkey ? "Loading..." : "Enter a pubkey to view relay data"}
                </td>
              </tr>
            ) : (
              sortedRelays.map(([relay, pubkeys]) => (
                <RelayRow
                  key={relay}
                  relay={relay}
                  users={pubkeys.map((pubkey) => ({ pubkey }))}
                  totalUsers={selection?.length || 0}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Users by Relay Count Report */}
      <UsersByRelayCount contacts={selection} originalContacts={originalOutboxes} />
    </div>
  );
}
