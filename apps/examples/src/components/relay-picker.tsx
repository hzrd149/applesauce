import {
  getRelayDiscoverySupportedNIPs,
  getRelayDiscoveryURL,
  isValidRelayDiscovery,
  isValidRelayMonitorAnnouncement,
  RELAY_DISCOVERY_KIND,
  RELAY_MONITOR_ANNOUNCEMENT_KIND,
} from "applesauce-common/helpers";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import {
  Filter,
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  isSafeRelayURL,
  ProfileContent,
  relaySet,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { ProfilePointer } from "nostr-tools/nip19";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "react-use";
import { map } from "rxjs";

// Common relay URLs that users might want to use
export const COMMON_RELAYS = relaySet([
  "wss://relay.damus.io",
  "wss://relay.snort.social",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nostr.wine",
  "wss://nostr-pub.wellorder.net/",
]);

// Create a relay pool instance for querying NIP-66 events
const discoveryPool = new RelayPool();
// Create a relay pool instance for fetching relay information documents
const infoPool = new RelayPool();
const eventStore = new EventStore();

// Create unified event loader for the store
createEventLoaderForStore(eventStore, discoveryPool, {
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Default monitor pubkey for relay discovery
const DEFAULT_DISCOVERY_MONITOR = "9ba6484003e8e88600f97ebffd897b2fe82753082e8e0cd8ea19aac0ff2b712b";
const DEFAULT_DISCOVERY_RELAY = "wss://relay.nostr.watch/";

/** Create a hook for loading a user's profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return use$(() => eventStore.profile(user), [user.pubkey, user.relays?.join("|")]);
}

/** Create a hook for loading a user's mailboxes */
function useMailboxes(user: ProfilePointer): { inboxes: string[]; outboxes: string[] } | undefined {
  return use$(() => eventStore.mailboxes(user), [user.pubkey, user.relays?.join("|")]);
}

function MonitorCard({
  monitorPubkey,
  discoveryRelay,
  onSelect,
}: {
  monitorPubkey: string;
  discoveryRelay: string;
  onSelect: (pubkey: string, relay: string) => void;
}) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [manualPubkey, setManualPubkey] = useState("");
  const [showManual, setShowManual] = useState(false);

  // Load mailboxes for manual entry to get first outbox
  const manualMailboxes = useMailboxes(
    useMemo(() => ({ pubkey: manualPubkey, relays: [discoveryRelay] }), [manualPubkey, discoveryRelay]),
  );
  const manualOutbox = manualMailboxes?.outboxes?.[0] || discoveryRelay;

  const profile = useProfile(
    useMemo(() => ({ pubkey: monitorPubkey, relays: [discoveryRelay] }), [monitorPubkey, discoveryRelay]),
  );

  // Query monitor announcements from discovery relay
  const monitorAnnouncements = use$(() => {
    if (!isSelecting || !discoveryRelay || !isSafeRelayURL(discoveryRelay)) return undefined;

    const filter: Filter = {
      kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND],
      limit: 1000,
    };

    return discoveryPool
      .relay(discoveryRelay)
      .subscription(filter)
      .pipe(
        onlyEvents(),
        mapEventsToStore(eventStore),
        mapEventsToTimeline(),
        map((events) => [...events]),
      );
  }, [isSelecting, discoveryRelay]);

  // Filter to only valid monitor announcements
  const validMonitors = useMemo(() => {
    if (!monitorAnnouncements) return [];
    return monitorAnnouncements.filter((event) => isValidRelayMonitorAnnouncement(event));
  }, [monitorAnnouncements]);

  if (isSelecting) {
    return (
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <div className="flex items-center gap-2 mb-3">
            <button className="btn btn-sm btn-ghost" onClick={() => setIsSelecting(false)}>
              ← Back
            </button>
            <h4 className="font-semibold flex-1">Select Monitor</h4>
            <button className="btn btn-sm" onClick={() => setShowManual(true)}>
              Manual Entry
            </button>
          </div>

          {!showManual ? (
            <>
              {validMonitors.length > 0 ? (
                <ul className="list max-h-96 overflow-y-auto">
                  {validMonitors.map((event) => (
                    <MonitorListItem
                      key={event.id}
                      event={event}
                      discoveryRelay={discoveryRelay}
                      onSelect={(pubkey, relay) => {
                        onSelect(pubkey, relay);
                        setIsSelecting(false);
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-base-content/70">No monitors found</p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="label">
                  <span className="label-text">Monitor Pubkey</span>
                </label>
                <input
                  type="text"
                  placeholder="9ba6484003e8e88600f97ebffd897b2fe82753082e8e0cd8ea19aac0ff2b712b"
                  className="input input-bordered w-full font-mono text-sm"
                  value={manualPubkey}
                  onChange={(e) => setManualPubkey(e.target.value)}
                />
              </div>
              {manualPubkey && <div className="text-xs text-base-content/70">Discovery relay: {manualOutbox}</div>}
              <div className="flex gap-2">
                <button
                  className="btn btn-sm btn-primary flex-1"
                  onClick={() => {
                    if (manualPubkey && isSafeRelayURL(manualOutbox)) {
                      onSelect(manualPubkey, manualOutbox);
                      setIsSelecting(false);
                      setShowManual(false);
                      setManualPubkey("");
                    }
                  }}
                >
                  Use Monitor
                </button>
                <button className="btn btn-sm" onClick={() => setShowManual(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-200">
      <div className="card-body p-2">
        <div className="flex items-center gap-3">
          <div className="avatar">
            <div className="w-10 rounded-full">
              <img src={getProfilePicture(profile, `https://robohash.org/${monitorPubkey}.png`)} alt="Profile" />
            </div>
          </div>
          <div className="flex-1">
            <div className="font-medium">{getDisplayName(profile, monitorPubkey)}</div>
            <div className="text-xs text-base-content/70">{discoveryRelay}</div>
          </div>
          <button className="btn btn-sm" onClick={() => setIsSelecting(true)}>
            Change
          </button>
        </div>
      </div>
    </div>
  );
}

function MonitorListItem({
  event,
  discoveryRelay,
  onSelect,
}: {
  event: any;
  discoveryRelay: string;
  onSelect: (pubkey: string, relay: string) => void;
}) {
  const profile = useProfile(
    useMemo(() => ({ pubkey: event.pubkey, relays: relaySet(getSeenRelays(event)) }), [event]),
  );

  // Load mailboxes to get the first outbox relay
  const mailboxes = useMailboxes(
    useMemo(() => ({ pubkey: event.pubkey, relays: relaySet(getSeenRelays(event)) }), [event]),
  );

  const firstOutbox = mailboxes?.outboxes?.[0] || discoveryRelay;

  return (
    <li className="list-row">
      <div>
        <img
          className="size-10 rounded-box"
          src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}.png`)}
          alt="Profile"
        />
      </div>
      <div>
        <div>{getDisplayName(profile, event.pubkey)}</div>
        <div className="text-xs font-mono">{firstOutbox}</div>
      </div>
      <button className="btn  btn-ghost" onClick={() => onSelect(event.pubkey, firstOutbox)} title="Select monitor">
        Select
      </button>
    </li>
  );
}

function RelayListItem({ relay, onSelect }: { relay: string; onSelect: () => void }) {
  const info = use$(() => infoPool.relay(relay).information$, [relay]);
  const icon =
    info?.icon || new URL("/favicon.ico", relay.replace("wss://", "https://").replace("ws://", "https://")).toString();

  return (
    <button className="btn btn-sm btn-ghost w-full justify-start text-left font-mono text-xs" onClick={onSelect}>
      <div className="avatar mr-2">
        <div className="w-4 h-4 rounded-full">
          <img src={icon} className="w-full h-full object-cover" alt="" />
        </div>
      </div>
      {relay}
    </button>
  );
}

function RelaySettingsModal({
  isOpen,
  onClose,
  onSelectRelay,
  availableRelays,
  discoveryMonitor,
  discoveryRelay,
  onUpdateDiscoveryMonitor,
  onUpdateDiscoveryRelay,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectRelay: (relay: string) => void;
  availableRelays: string[];
  discoveryMonitor: string;
  discoveryRelay: string;
  onUpdateDiscoveryMonitor: (pubkey: string) => void;
  onUpdateDiscoveryRelay: (relay: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter relays based on search query
  const filteredRelays = useMemo(() => {
    if (!searchQuery.trim()) return availableRelays;
    const query = searchQuery.toLowerCase();
    return availableRelays.filter((relay) => relay.toLowerCase().includes(query));
  }, [availableRelays, searchQuery]);

  // Reset local state when modal opens/closes or props change
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
    }
  }, [isOpen]);

  return (
    <dialog className={`modal ${isOpen ? "modal-open" : ""}`}>
      <div className="modal-box max-w-2xl w-full">
        <h3 className="font-bold text-lg mb-4">Relay Settings</h3>

        <div className="space-y-6">
          {/* Monitor Card */}
          <MonitorCard
            monitorPubkey={discoveryMonitor}
            discoveryRelay={discoveryRelay}
            onSelect={(pubkey, relay) => {
              onUpdateDiscoveryMonitor(pubkey);
              onUpdateDiscoveryRelay(relay);
            }}
          />

          {/* Relay Search */}
          <div className="space-y-3">
            <h4 className="font-semibold text-base">Search Relays</h4>
            <input
              type="text"
              placeholder="Search relays..."
              className="input input-bordered w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto">
              {filteredRelays.length > 0 ? (
                <div className="space-y-1">
                  {filteredRelays.map((relay) => (
                    <RelayListItem
                      key={relay}
                      relay={relay}
                      onSelect={() => {
                        onSelectRelay(relay);
                        onClose();
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-base-content/70">No relays found</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}

export default function RelayPicker({
  value,
  onChange,
  common = COMMON_RELAYS,
  className,
  supportedNips,
}: {
  value: string;
  onChange: (relay: string) => void;
  common?: string[];
  className?: string;
  supportedNips?: string[];
}) {
  const [inputValue, setInputValue] = useState(value);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [discoveryMonitor, setDiscoveryMonitor] = useLocalStorage(
    "relay-picker-discovery-monitor",
    DEFAULT_DISCOVERY_MONITOR,
  );
  const [discoveryRelay, setDiscoveryRelay] = useLocalStorage("relay-picker-discovery-relay", DEFAULT_DISCOVERY_RELAY);
  const inputIdRef = useRef(`relay-picker-${Math.random().toString(36).substring(7)}`);

  // Ensure we have valid values (useLocalStorage can return undefined)
  const monitorValue = discoveryMonitor ?? DEFAULT_DISCOVERY_MONITOR;
  const relayValue = discoveryRelay ?? DEFAULT_DISCOVERY_RELAY;

  // Query NIP-66 relay discovery events when supportedNips is provided
  const discoveryEvents = use$(() => {
    if (!supportedNips || supportedNips.length === 0) return undefined;
    if (!monitorValue || !relayValue || !isSafeRelayURL(relayValue)) return undefined;

    const filter: Filter = {
      kinds: [RELAY_DISCOVERY_KIND],
      authors: [monitorValue],
      limit: 1000,
    };

    return discoveryPool
      .relay(relayValue)
      .subscription(filter)
      .pipe(
        onlyEvents(),
        mapEventsToTimeline(),
        map((events) => [...events]),
      );
  }, [supportedNips?.join(","), monitorValue, relayValue]);

  // Extract relay URLs from discovery events that support the requested NIPs
  const discoveryRelays = useMemo(() => {
    if (!discoveryEvents || !supportedNips || supportedNips.length === 0) return [];

    const relayUrls = new Set<string>();

    for (const event of discoveryEvents) {
      if (!isValidRelayDiscovery(event)) continue;

      const eventNips = getRelayDiscoverySupportedNIPs(event);
      const eventNipsSet = new Set(eventNips);

      // Check if event supports all requested NIPs
      const supportsAllNips = supportedNips.every((nip) => eventNipsSet.has(nip));

      if (supportsAllNips) {
        const relayUrl = getRelayDiscoveryURL(event);
        if (relayUrl && isSafeRelayURL(relayUrl)) {
          relayUrls.add(relayUrl);
        }
      }
    }

    return Array.from(relayUrls);
  }, [discoveryEvents, supportedNips?.join(",")]);

  // Combine common relays with discovery relays
  const allRelayOptions = useMemo(() => {
    const combined = relaySet(common || [], discoveryRelays);
    if (inputValue && isSafeRelayURL(inputValue) && !combined.includes(inputValue)) {
      return [inputValue, ...combined];
    }
    return combined;
  }, [common, discoveryRelays, inputValue]);

  // Update input value when prop value changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    // Only call onChange if the input value is a valid relay URL
    if (inputValue && isSafeRelayURL(inputValue)) {
      onChange(inputValue);
    } else {
      // Reset to current value if invalid
      setInputValue(value);
    }
  };

  const handleModalSelect = (relay: string) => {
    onChange(relay);
    setInputValue(relay);
  };

  return (
    <>
      <div className={`join ${className}`}>
        <div className="join-item flex-1">
          <input
            id={inputIdRef.current}
            type="text"
            list={`${inputIdRef.current}-datalist`}
            placeholder="wss://relay.example.com"
            className="input input-bordered w-full"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
          />
          <datalist id={`${inputIdRef.current}-datalist`}>
            {allRelayOptions.map((relay) => (
              <option key={relay} value={relay} />
            ))}
          </datalist>
        </div>
        <button className="btn join-item" onClick={() => setIsModalOpen(true)}>
          More
        </button>
      </div>

      <RelaySettingsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelectRelay={handleModalSelect}
        availableRelays={allRelayOptions}
        discoveryMonitor={monitorValue}
        discoveryRelay={relayValue}
        onUpdateDiscoveryMonitor={setDiscoveryMonitor}
        onUpdateDiscoveryRelay={setDiscoveryRelay}
      />
    </>
  );
}
