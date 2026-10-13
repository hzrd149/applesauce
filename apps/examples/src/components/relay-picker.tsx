import { relayTimeline } from "../extra/relay-timeline";
import { castTimelineStream } from "applesauce-common/observable";
import { castUser, RelayMonitor, RelayDiscovery } from "applesauce-common/casts";
import {
  isValidRelayDiscovery,
  isValidRelayMonitorAnnouncement,
  RELAY_DISCOVERY_KIND,
  RELAY_MONITOR_ANNOUNCEMENT_KIND,
} from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  isSafeRelayURL,
  ProfileContent,
  relaySet,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { useMemo, useId } from "react";

import { BehaviorSubject, map, of } from "rxjs";
import { lookupRelays$ } from "../settings";

// Common relay URLs that users might want to use
export const COMMON_RELAYS = relaySet([
  "wss://relay.damus.io",
  "wss://relay.snort.social",
  "wss://relay.ditto.pub",
  "wss://relay.primal.net",
  "wss://nos.lol",
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
  lookupRelays: lookupRelays$,
});

// Default monitor pubkey for relay discovery
const DEFAULT_DISCOVERY_MONITOR = "9ba6484003e8e88600f97ebffd897b2fe82753082e8e0cd8ea19aac0ff2b712b";
const DEFAULT_DISCOVERY_RELAY = "wss://relay.nostr.watch/";

function storedPreference(key: string, fallback: string) {
  try {
    const stored = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
    return typeof stored === "string" ? stored : fallback;
  } catch {
    return fallback;
  }
}
const preferences$ = new BehaviorSubject({
  monitor: storedPreference("relay-picker-discovery-monitor", DEFAULT_DISCOVERY_MONITOR),
  relay: storedPreference("relay-picker-discovery-relay", DEFAULT_DISCOVERY_RELAY),
});
function updatePreferences(patch: Partial<typeof preferences$.value>) {
  const value = { ...preferences$.value, ...patch };
  localStorage.setItem("relay-picker-discovery-monitor", JSON.stringify(value.monitor));
  localStorage.setItem("relay-picker-discovery-relay", JSON.stringify(value.relay));
  preferences$.next(value);
}

/** Create a hook for loading a user's profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return use$(() => castUser(user, eventStore).profile$, [user.pubkey, user.relays?.join("|")]);
}

/** Create a hook for loading a user's mailboxes */
function useMailboxes(user: ProfilePointer): { inboxes: string[]; outboxes: string[] } | undefined {
  return use$(() => castUser(user, eventStore).mailboxes$, [user.pubkey, user.relays?.join("|")]);
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
  const state$ = useMemo(() => new BehaviorSubject({ selecting: false, manualPubkey: "", manual: false }), []);
  const state = use$(state$);
  const update = (patch: Partial<typeof state>) => state$.next({ ...state$.value, ...patch });
  const isSelecting = state.selecting;
  const manualPubkey = state.manualPubkey;
  const showManual = state.manual;
  // Load mailboxes for manual entry to get first outbox
  const manualMailboxes = use$(
    () =>
      /^[a-f0-9]{64}$/i.test(manualPubkey)
        ? castUser({ pubkey: manualPubkey, relays: [discoveryRelay] }, eventStore).mailboxes$
        : undefined,
    [manualPubkey, discoveryRelay],
  );
  const manualOutbox = manualMailboxes?.outboxes?.[0] || discoveryRelay;

  const profile = useProfile(
    useMemo(() => ({ pubkey: monitorPubkey, relays: [discoveryRelay] }), [monitorPubkey, discoveryRelay]),
  );

  const feed = use$(
    () =>
      relayTimeline(eventStore, discoveryPool, isSelecting && isSafeRelayURL(discoveryRelay) ? [discoveryRelay] : [], {
        kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND],
        limit: 1000,
      }),
    [isSelecting, discoveryRelay],
  );
  const validMonitors =
    use$(
      () =>
        of(feed?.events.filter(isValidRelayMonitorAnnouncement) ?? []).pipe(
          castTimelineStream(RelayMonitor, eventStore),
        ),
      [feed],
    ) ?? [];

  if (isSelecting) {
    return (
      <div className="border border-base-300 bg-base-200">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2 mb-3">
            <button className="btn btn-sm btn-ghost" onClick={() => update({ selecting: false })}>
              ← Back
            </button>
            <h4 className="font-semibold flex-1">Select Monitor</h4>
            <button className="btn btn-sm" onClick={() => update({ manual: true })}>
              Manual Entry
            </button>
          </div>

          {feed?.errors.map((error) => (
            <p key={error} role="alert" className="text-error">
              {error}
            </p>
          ))}
          {feed?.status === "loading" && <p>Loading monitors…</p>}
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
                        update({ selecting: false });
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
                  onChange={(e) => update({ manualPubkey: e.target.value })}
                />
              </div>
              {manualPubkey && <div className="text-sm text-base-content/70">Discovery relay: {manualOutbox}</div>}
              <div className="flex gap-2">
                <button
                  className="btn btn-sm btn-primary flex-1"
                  onClick={() => {
                    if (/^[a-f0-9]{64}$/i.test(manualPubkey) && isSafeRelayURL(manualOutbox)) {
                      onSelect(manualPubkey, manualOutbox);
                      update({ selecting: false, manual: false, manualPubkey: "" });
                    }
                  }}
                >
                  Use Monitor
                </button>
                <button className="btn btn-sm" onClick={() => update({ manual: false })}>
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
    <div className="border border-base-300 bg-base-200">
      <div className="flex flex-col gap-4 p-2">
        <div className="flex items-center gap-3">
          <div className="avatar">
            <div className="w-10 rounded-full">
              <img src={getProfilePicture(profile, `https://robohash.org/${monitorPubkey}.png`)} alt="Profile" />
            </div>
          </div>
          <div className="flex-1">
            <div className="font-medium">{getDisplayName(profile, monitorPubkey)}</div>
            <div className="text-sm text-base-content/70">{discoveryRelay}</div>
          </div>
          <button className="btn btn-sm" onClick={() => update({ selecting: true })}>
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
  event: RelayMonitor;
  discoveryRelay: string;
  onSelect: (pubkey: string, relay: string) => void;
}) {
  const profile = useProfile(
    useMemo(() => ({ pubkey: event.author.pubkey, relays: relaySet(getSeenRelays(event.event)) }), [event]),
  );

  // Load mailboxes to get the first outbox relay
  const mailboxes = useMailboxes(
    useMemo(() => ({ pubkey: event.author.pubkey, relays: relaySet(getSeenRelays(event.event)) }), [event]),
  );

  const firstOutbox = mailboxes?.outboxes?.[0] || discoveryRelay;

  return (
    <li className="list-row">
      <div>
        <img
          className="size-10 rounded-box"
          src={getProfilePicture(profile, `https://robohash.org/${event.author.pubkey}.png`)}
          alt="Profile"
        />
      </div>
      <div>
        <div>{getDisplayName(profile, event.author.pubkey)}</div>
        <div className="text-sm font-mono">{firstOutbox}</div>
      </div>
      <button
        className="btn  btn-ghost"
        onClick={() => onSelect(event.author.pubkey, firstOutbox)}
        title="Select monitor"
      >
        Select
      </button>
    </li>
  );
}

function RelayListItem({ relay, onSelect }: { relay: string; onSelect: () => void }) {
  const icon = use$(() => infoPool.relay(relay).icon$, [relay]);

  return (
    <button className="btn btn-sm btn-ghost w-full justify-start text-left font-mono text-sm" onClick={onSelect}>
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
  onUpdateDiscovery,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectRelay: (relay: string) => void;
  availableRelays: string[];
  discoveryMonitor: string;
  discoveryRelay: string;
  onUpdateDiscovery: (pubkey: string, relay: string) => void;
}) {
  const search$ = useMemo(() => new BehaviorSubject(""), []);
  const searchQuery = use$(search$);
  const filteredRelays = availableRelays.filter((relay) =>
    relay.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

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
              onUpdateDiscovery(pubkey, relay);
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
              onChange={(e) => search$.next(e.target.value)}
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

type RelayPickerProps = {
  value: string;
  onChange: (relay: string) => void;
  common?: string[];
  className?: string;
  supportedNips?: string[];
};
export default function RelayPicker(props: RelayPickerProps) {
  return <RelayPickerInput key={props.value} {...props} />;
}
function RelayPickerInput({ value, onChange, common = COMMON_RELAYS, className, supportedNips }: RelayPickerProps) {
  const input$ = useMemo(() => new BehaviorSubject(value), []);
  const inputValue = use$(input$);
  const modal$ = useMemo(() => new BehaviorSubject(false), []);
  const isModalOpen = use$(modal$);
  const preference = use$(preferences$);
  const monitorValue = preference.monitor;
  const relayValue = preference.relay;
  const inputId = useId();

  const discovery = use$(
    () =>
      relayTimeline(
        eventStore,
        discoveryPool,
        supportedNips?.length && monitorValue && isSafeRelayURL(relayValue) ? [relayValue] : [],
        { kinds: [RELAY_DISCOVERY_KIND], authors: [monitorValue], limit: 1000 },
      ),
    [supportedNips?.join(","), monitorValue, relayValue],
  );
  const discoveryRelays =
    use$(
      () =>
        of(discovery?.events.filter(isValidRelayDiscovery) ?? []).pipe(
          castTimelineStream(RelayDiscovery, eventStore),
          map((events) =>
            relaySet(
              events
                .filter((event) => supportedNips?.every((nip) => event.supportedNIPs.includes(nip)))
                .map((event) => event.url)
                .filter((url): url is string => !!url && isSafeRelayURL(url)),
            ),
          ),
        ),
      [discovery, supportedNips?.join(",")],
    ) ?? [];

  // Combine common relays with discovery relays
  const allRelayOptions = useMemo(() => {
    const combined = relaySet(common || [], discoveryRelays);
    if (inputValue && isSafeRelayURL(inputValue) && !combined.includes(inputValue)) {
      return [inputValue, ...combined];
    }
    return combined;
  }, [common, discoveryRelays, inputValue]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => input$.next(event.target.value);

  const handleInputBlur = () => {
    // Only call onChange if the input value is a valid relay URL
    if (inputValue && isSafeRelayURL(inputValue)) {
      onChange(inputValue);
    } else {
      // Reset to current value if invalid
      input$.next(value);
    }
  };

  const handleModalSelect = (relay: string) => {
    onChange(relay);
    input$.next(relay);
  };

  return (
    <>
      <div className={`join ${className}`}>
        <div className="join-item flex-1">
          <input
            id={inputId}
            type="text"
            list={`${inputId}-datalist`}
            placeholder="wss://relay.example.com"
            className="input input-bordered w-full"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
          />
          <datalist id={`${inputId}-datalist`}>
            {allRelayOptions.map((relay) => (
              <option key={relay} value={relay} />
            ))}
          </datalist>
        </div>
        <button className="btn join-item" onClick={() => modal$.next(true)}>
          More
        </button>
      </div>

      {isModalOpen && (
        <RelaySettingsModal
          isOpen={isModalOpen}
          onClose={() => modal$.next(false)}
          onSelectRelay={handleModalSelect}
          availableRelays={allRelayOptions}
          discoveryMonitor={monitorValue}
          discoveryRelay={relayValue}
          onUpdateDiscovery={(monitor, relay) => updatePreferences({ monitor, relay })}
        />
      )}
    </>
  );
}
