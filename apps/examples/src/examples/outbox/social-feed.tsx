/**
 * Display a social feed using outbox relays for optimal event distribution
 * @tags nip-02, nip-65, outbox, feed, social
 * @related outbox/relay-selection, feed/relay-timeline
 */
import NoteContent from "../../components/note-content";

import { castUser, Note as NoteCast, castEvent } from "applesauce-common/casts";

import {
  defined,
  EventStore,
  filterOptimalRelays,
  includeFallbackRelays,
  includeMailboxes,
  mapEventsToStore,
} from "applesauce-core";
import {
  createOutboxMap,
  Filter,
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  NostrEvent,
  persistEventsToCache,
  relaySet,
  unixNow,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, loadBlocksFromOutboxMap, TimelineWindow } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { ignoreUnhealthyRelaysOnPointers, Relay, RelayHealthState, RelayLiveness, RelayPool } from "applesauce-relay";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import localforage from "localforage";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import pastellifyModule from "pastellify";
import { memo, useMemo, useState } from "react";
import { SubmitHandler } from "react-hook-form";

import {
  auditTime,
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  defer,
  distinctUntilChanged,
  filter,
  finalize,
  ignoreElements,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  throttleTime,
  timer,
} from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

// pastellify ships CommonJS with exports.default, so unwrap it when the bundler returns the module object
const pastellify: typeof pastellifyModule = (pastellifyModule as any).default ?? pastellifyModule;

const pubkey$ = new BehaviorSubject<string | null>(null);

const pool = new RelayPool({
  informationCache: new Keyv({ store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "nip11" }) }),
});
const eventStore = new EventStore();

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters<NostrEvent>(cache, filters);
}

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: lookupRelays$,
});

// Create a liveness tracker and connect to the pool
const liveness = new RelayLiveness({
  storage: localforage.createInstance({ name: "liveness" }),
});
await liveness.load();
liveness.connectToPool(pool);

// A list of extra relays to always use
const fallbacks$ = new BehaviorSubject<string[]>([]);

// The maximum number of connections to make
const maxConnections$ = new BehaviorSubject(30);

// The maximum number of relays to select per user
const maxRelaysPerUser$ = new BehaviorSubject(4);

/** An observable of the users contacts */
const contacts$ = pubkey$.pipe(
  // Wait for user to login
  switchMap((pubkey) => (pubkey ? castUser(pubkey, eventStore).contacts$.pipe(startWith(undefined)) : of(undefined))),
);

/** An observable of contacts with outboxes and unhealthy relays filtered out */
const contactsWithOutboxes$ = contacts$.pipe(
  // Wait for contacts to be fetched
  defined(),
  // Convert user casts to plain pointers before adding relay hints
  map((users) => users.map((user) => user.pointer)),
  // Load the NIP-65 outboxes for all contacts
  includeMailboxes(eventStore),
  // Ignore unhealthy relays from the liveness tracker
  ignoreUnhealthyRelaysOnPointers(liveness),
  // Only calculate it once
  shareReplay({ bufferSize: 1, refCount: true }),
);

// Create an observable of contacts -> contacts with relay selection / fallbacks
const selection$ = contactsWithOutboxes$.pipe(
  // First include fallback relays
  includeFallbackRelays(fallbacks$),
  // Debounce recalculations for performance
  debounceTime(200),
  // Select the best relays for the contacts
  filterOptimalRelays(maxConnections$, maxRelaysPerUser$),
  // Keep the last value so reconnection works
  shareReplay({ bufferSize: 1, refCount: true }),
);

// Create an observable that converts selection to an outbox map
const outboxMap$ = selection$.pipe(map(createOutboxMap));

// Whether to keep a live subscription open to the selected relays
const live$ = new BehaviorSubject(true);

// When live was last turned off, so turning it back on fills the gap
let liveSince = unixNow() - 60;

// Create a live subscription for users feeds that emits an error if every selected relay fails
const liveError$ = live$.pipe(
  // Turning live off unsubscribes, which closes the REQs and lets idle relays disconnect after their keepAlive
  switchMap((live) =>
    live
      ? defer(() => pool.outboxSubscription(outboxMap$, { kinds: [1], since: liveSince })).pipe(
          // Add events to the event store
          mapEventsToStore(eventStore),
          // Events are rendered from the store, so only keep the failure
          ignoreElements(),
          // Report the failure instead of throwing it into render
          catchError((error: Error) => of(error)),
          // Remember where to resume from
          finalize(() => (liveSince = unixNow())),
        )
      : of(undefined),
  ),
);

// The timestamp of the bottom-most note on screen
// Initialize with -Infinity to force loading the first block of events
const cursor$ = new BehaviorSubject(-Infinity);

// Elements with a `data-created-at` timestamp that are currently on screen
const visible = new Set<HTMLElement>();
const scrollObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const el = entry.target as HTMLElement;
    if (entry.isIntersecting) visible.add(el);
    else visible.delete(el);
  }

  // Move the cursor to the oldest visible timestamp
  if (visible.size > 0) cursor$.next(Math.min(...Array.from(visible, (el) => Number(el.dataset.createdAt))));
});

/** Ref callback that tracks an element with a `data-created-at` timestamp as the feed scrolls */
function trackScroll(el: HTMLElement | null) {
  if (!el) return;
  scrollObserver.observe(el);
  return () => {
    visible.delete(el);
    scrollObserver.unobserve(el);
  };
}

// Create a timeline loader and add events to the event store
const timeline$ = cursor$.pipe(
  // Throttle how fast the cursor changes while scrolling
  throttleTime(1000, undefined, { leading: true, trailing: true }),
  // Relays whose loaded range ends after the cursor load their next block
  map((since): TimelineWindow => ({ since })),
  // When the timeline window changes, load missing events
  loadBlocksFromOutboxMap(
    pool,
    outboxMap$,
    // Base filter to use for blocks of events
    { kinds: [1] },
    // Load 100 events at a time
    { limit: 100 },
  ),
  // Add events to the event store
  mapEventsToStore(eventStore),
);

// Track the connection state and number of open requests for the relays selected for the feed
const relayActivity$ = outboxMap$.pipe(
  // Order relays by the number of users they cover
  map((outboxMap) =>
    Object.entries(outboxMap)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([url]) => url),
  ),
  // Only resubscribe when the selected relays change
  distinctUntilChanged((a, b) => a.join() === b.join()),
  switchMap((urls) =>
    urls.length === 0
      ? of([])
      : combineLatest(
          urls
            .map((url) => pool.relay(url))
            .map((relay) =>
              combineLatest({
                relay: of(relay),
                connected: relay.connected$,
                ready: relay.ready$,
                reqs: relay.reqs$.pipe(map((reqs) => Object.keys(reqs).length)),
              }),
            ),
        ),
  ),
  // Limit re-renders while many requests open and close during loading
  auditTime(100),
);

// Global state for previewing user
const preview$ = new BehaviorSubject<ProfilePointer | null>(null);

// A shared clock so every relative time on the page updates together
const now$ = timer(0, 30_000).pipe(
  map(() => unixNow()),
  shareReplay({ bufferSize: 1, refCount: true }),
);

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Formats a timestamp relative to now within a week, then as a date */
function formatRelative(unix: number, now: number) {
  const seconds = unix - now;
  if (Math.abs(seconds) > 7 * 86400) return dateFormat.format(new Date(unix * 1000));
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

// Only this element re-renders when the clock ticks
function RelativeTime({ timestamp }: { timestamp: number }) {
  const now = use$(now$) ?? unixNow();
  return (
    <time className="text-sm text-base-content/60" title={new Date(timestamp * 1000).toLocaleString()}>
      {formatRelative(timestamp, now)}
    </time>
  );
}

function NoteRelay({ relay }: { relay: string }) {
  const icon = use$(() => pool.relay(relay).icon$, [relay]);
  const name = use$(() => pool.relay(relay).name$, [relay]);
  const color = useMemo(() => pastellify(relay, { toCSS: true }), [relay]);

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

      <div className="truncate text-sm">{name}</div>
    </div>
  );
}

// Memoized so new events only render new notes instead of the whole feed
const Note = memo(function Note({ note, selection }: { note: NostrEvent; selection?: string[] }) {
  const cast = useMemo(() => castEvent(note, NoteCast, eventStore), [note]);
  // Subscribe to the request and wait for the profile event
  const profile = use$(cast.author.profile$);
  const mailboxes = use$(cast.author.mailboxes$);

  const displayName = getDisplayName(profile, note.pubkey.slice(0, 8) + "...");
  const avatarUrl = getProfilePicture(profile, `https://robohash.org/${note.pubkey}.png`);

  // Re-read the seen relays when the store merges a duplicate of this note from another relay
  const relays = use$(
    () =>
      eventStore.update$.pipe(
        filter((event) => event.id === note.id),
        startWith(note),
        map(() => Array.from(getSeenRelays(note) ?? []).sort()),
      ),
    [note],
  );

  return (
    <div
      ref={trackScroll}
      data-created-at={note.created_at}
      // Skip layout and paint for notes that are off screen
      className="border-b border-base-300 px-2 py-4 [content-visibility:auto] [contain-intrinsic-size:auto_200px]"
    >
      <div className="flex items-start gap-3">
        <div className="avatar">
          <div className="w-12 h-12 rounded-full">
            <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <a className="font-semibold text-sm link" onClick={() => preview$.next({ pubkey: note.pubkey })}>
              {displayName}
            </a>
            <RelativeTime timestamp={note.created_at} />
            <span className="text-sm text-base-content/60 ms-auto">
              From {selection?.length ?? 0} of {mailboxes?.outboxes.length ?? 0} outboxes
            </span>
          </div>
          <NoteContent event={note} />
        </div>
      </div>
      <div className="flex gap-4 mt-4">
        {relays?.map((relay) => (
          <NoteRelay key={relay} relay={relay} />
        ))}
      </div>
    </div>
  );
});

function RelayActivityItem({
  relay,
  connected,
  ready,
  reqs,
}: {
  relay: Relay;
  connected: boolean;
  ready: boolean;
  reqs: number;
}) {
  const icon = use$(relay.icon$);
  const name = use$(relay.name$);

  // Not ready means the relay is waiting to reconnect, disconnected with requests means it is connecting
  const status = !ready
    ? "status-error"
    : connected
      ? "status-success"
      : reqs > 0
        ? "status-warning"
        : "status-neutral";

  return (
    <div className="flex items-center gap-2 shrink-0 border border-base-300 rounded px-2 py-1" title={relay.url}>
      <div className={`status ${status}`} />
      <img src={icon} className="w-5 h-5 rounded-full object-cover" />
      <span className="text-sm max-w-40 truncate">{name}</span>
      <span className={`text-sm ${reqs > 0 ? "text-primary" : "text-base-content/60"}`}>{reqs}</span>
    </div>
  );
}

// Horizontal status bar showing relay activity
function RelayStatusBar() {
  const activity = use$(relayActivity$);

  const connected = activity?.filter((a) => a.connected).length ?? 0;
  const reqs = activity?.reduce((sum, a) => sum + a.reqs, 0) ?? 0;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-base-300 p-2">
      <span className="text-sm text-base-content/60 shrink-0">
        {connected}/{activity?.length ?? 0} connected • {reqs} requests
      </span>
      <div className="flex gap-2 overflow-x-auto">
        {activity?.map((a) => (
          <RelayActivityItem key={a.relay.url} {...a} />
        ))}
      </div>
    </div>
  );
}

// User Avatar Component for sidebar
function UserAvatar({ user }: { user: ProfilePointer }) {
  const profile = use$(() => castUser(user, eventStore).profile$, [user]);
  use$(() => castUser(user, eventStore).mailboxes$, [user]);

  const displayName = getDisplayName(profile, user.pubkey.slice(0, 8) + "...");
  const avatarUrl = getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`);

  return (
    <div
      className="flex flex-col items-center gap-1 hover:bg-base-200 cursor-pointer"
      onClick={() => preview$.next(user)}
    >
      <div className="avatar">
        <div className="rounded-full w-8 h-8">
          <img src={avatarUrl} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className="text-sm max-w-16 overflow-hidden truncate">{displayName}</div>
    </div>
  );
}

// User Issues Component for sidebar
function UserIssuesSection({
  selection,
  contacts,
}: {
  selection: any[] | null | undefined;
  contacts: any[] | null | undefined;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Calculate missing relays users - users who never had any relays (no NIP-65 relay list)
  const missingRelaysUsers = useMemo(() => {
    if (!contacts || !selection) return [];

    const originalMap = new Map(contacts.map((user) => [user.pubkey, user]));

    return selection.filter((selectedUser) => {
      const originalUser = originalMap.get(selectedUser.pubkey);
      const hasNoRelaysInOriginal = !originalUser?.relays || originalUser.relays.length === 0;
      const hasNoRelaysInSelected = !selectedUser.relays || selectedUser.relays.length === 0;

      return hasNoRelaysInOriginal && hasNoRelaysInSelected;
    });
  }, [contacts, selection]);

  // Calculate orphaned users - users who had relays originally but have none after selection
  const orphanedUsers = useMemo(() => {
    if (!contacts || !selection) return [];

    const selectedMap = new Map(selection.map((user) => [user.pubkey, user]));

    return contacts.filter((originalUser) => {
      const hasOriginalRelays = originalUser.relays && originalUser.relays.length > 0;
      const selectedUser = selectedMap.get(originalUser.pubkey);
      const hasSelectedRelays = selectedUser?.relays && selectedUser.relays.length > 0;

      return hasOriginalRelays && !hasSelectedRelays;
    });
  }, [contacts, selection]);

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const totalIssues = missingRelaysUsers.length + orphanedUsers.length;

  if (totalIssues === 0) return null;

  return (
    <div className="border-b border-base-300 py-4">
      <div className="flex items-center justify-between mx-4">
        <h3 className="text-lg font-semibold">User Issues</h3>
      </div>

      {/* Missing Relays Section */}
      {missingRelaysUsers.length > 0 && (
        <div>
          <button
            className="w-full hover:bg-base-200 text-left py-2 px-4"
            onClick={() => toggleSection("missing-relays")}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-sm">{expandedSections.has("missing-relays") ? "▼" : "▶"}</div>
                <div className="font-medium text-warning">Missing Relays</div>
              </div>
              <div className="badge badge-warning badge-md">{missingRelaysUsers.length}</div>
            </div>
            <div className="text-sm text-base-content/60 ml-6">Users without any relays (no NIP-65 published)</div>
          </button>

          {expandedSections.has("missing-relays") && (
            <div className="mx-2">
              <div className="max-h-96 overflow-y-auto">
                <div className="grid grid-cols-3 gap-1">
                  {missingRelaysUsers.map((user) => (
                    <UserAvatar key={user.pubkey} user={user} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Orphaned Users Section */}
      {orphanedUsers.length > 0 && (
        <div>
          <button
            className="w-full hover:bg-base-200 text-left py-2 px-4"
            onClick={() => toggleSection("orphaned-users")}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-sm">{expandedSections.has("orphaned-users") ? "▼" : "▶"}</div>
                <div className="font-medium text-error">Orphaned Users</div>
              </div>
              <div className="badge badge-error badge-md">{orphanedUsers.length}</div>
            </div>
            <div className="text-sm text-base-content/60 ml-6">Users who lost all relays after selection</div>
          </button>

          {expandedSections.has("orphaned-users") && (
            <div className="mx-2">
              <div className="max-h-32 overflow-y-auto">
                <div className="grid grid-cols-3 gap-1">
                  {orphanedUsers.map((user) => (
                    <UserAvatar key={user.pubkey} user={user} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// User Preview Modal Component
function UserPreviewModal({ selection }: { selection?: ProfilePointer[] }) {
  const previewUser = use$(preview$);

  const profile = use$(() => (previewUser ? castUser(previewUser, eventStore).profile$ : undefined), [previewUser]);
  const mailboxes = use$(() => (previewUser ? castUser(previewUser, eventStore).mailboxes$ : undefined), [previewUser]);

  // get the selected user
  const selected = selection?.find((user) => user.pubkey === previewUser?.pubkey);

  const displayName = profile ? getDisplayName(profile, previewUser?.pubkey.slice(0, 8) + "...") : "";
  const avatarUrl = profile ? getProfilePicture(profile, `https://robohash.org/${previewUser?.pubkey}.png`) : "";

  // Get relays that where explicitly selected for this user
  const manual =
    mailboxes &&
    selected?.relays?.filter((relay) => !mailboxes?.inboxes.includes(relay) && !mailboxes?.outboxes.includes(relay));

  const closeModal = () => {
    preview$.next(null);
  };

  if (!previewUser) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <form method="dialog">
          <button className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={closeModal}>
            ✕
          </button>
        </form>

        <div className="flex flex-col items-center gap-4">
          {/* User Avatar and Name */}
          <div className="flex flex-col items-center gap-2">
            <div className="avatar">
              <div className="w-24 h-24 rounded-full">
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              </div>
            </div>
            <h3 className="font-bold text-lg">{displayName}</h3>
            <div className="text-sm text-base-content/60 font-mono">{previewUser.pubkey.slice(0, 16)}...</div>
          </div>

          {/* Refresh Button */}
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => {
                pubkey$.next(previewUser.pubkey);
                closeModal();
              }}
            >
              Set pubkey
            </button>
          </div>

          {/* Selected Relays */}
          <div className="w-full">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <span>Selected Relays ({selected?.relays?.length || 0})</span>
            </h4>
            <div className="space-y-1">
              {selected?.relays && selected.relays.length > 0 ? (
                selected.relays.map((relay) => (
                  <div
                    key={relay}
                    className={`text-sm bg-base-200 rounded px-2 py-1 font-mono ${selected?.relays?.includes(relay) ? "text-primary" : ""}`}
                  >
                    {relay}
                  </div>
                ))
              ) : (
                <div className="text-sm text-base-content/60">No selected relays found</div>
              )}
            </div>
          </div>

          {/* Manual Relays */}
          {manual && manual.length > 0 && (
            <div className="w-full">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <span>Manual Relays ({manual?.length || 0})</span>
              </h4>
              <div className="space-y-1">
                {manual.map((relay) => (
                  <div
                    key={relay}
                    className={`text-sm bg-base-200 rounded px-2 py-1 font-mono ${selected?.relays?.includes(relay) ? "text-primary" : ""}`}
                  >
                    {relay}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inbox Relays */}
          <div className="w-full">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <span>Inbox Relays ({mailboxes?.inboxes.length || 0})</span>
            </h4>
            <div className="space-y-1">
              {mailboxes?.inboxes && mailboxes.inboxes.length > 0 ? (
                mailboxes.inboxes.map((relay) => (
                  <div
                    key={relay}
                    className={`text-sm bg-base-200 rounded px-2 py-1 font-mono ${selected?.relays?.includes(relay) ? "text-primary" : ""}`}
                  >
                    {relay}
                  </div>
                ))
              ) : (
                <div className="text-sm text-base-content/60">No inbox relays found</div>
              )}
            </div>
          </div>

          {/* Outbox Relays */}
          <div className="w-full">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <span>Outbox Relays ({mailboxes?.outboxes.length || 0})</span>
            </h4>
            <div className="space-y-1">
              {mailboxes?.outboxes && mailboxes.outboxes.length > 0 ? (
                mailboxes.outboxes.map((relay) => (
                  <div
                    key={relay}
                    className={`text-sm bg-base-200 rounded px-2 py-1 font-mono ${selected?.relays?.includes(relay) ? "text-primary" : ""}`}
                  >
                    {relay}
                  </div>
                ))
              ) : (
                <div className="text-sm text-base-content/60">No outbox relays found</div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop" onClick={closeModal}></div>
    </div>
  );
}

function RelayManager({ relays, onChange }: { relays: string[]; onChange: (relays: string[]) => void }) {
  const [input, setInput] = useState<string>("");

  const addRelay: SubmitHandler<any> = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add the relay
    let url = input;
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) url = `wss://${input}`;

    onChange(relaySet(relays, url));
    setInput("");
  };

  const removeRelay = (relay: string) => {
    onChange(relays.filter((r) => r !== relay));
  };

  return (
    <div className="flex flex-col gap-2">
      {relays.map((relay) => (
        <div key={relay} className="flex gap-2 items-center justify-between">
          <div className="text-sm font-mono truncate">{relay}</div>
          <button className="btn btn-square btn-warning btn-soft btn-sm text-lg" onClick={() => removeRelay(relay)}>
            -
          </button>
        </div>
      ))}
      <form className="flex gap-2" onSubmit={addRelay}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} className="input input-sm flex-1" />
        <button className="btn btn-square btn-primary btn-soft btn-sm text-lg" type="submit" disabled={!input}>
          +
        </button>
      </form>
    </div>
  );
}

// Component to show relay connection and coverage
function RelayConnection({ relay, userCount, totalUsers }: { relay: string; userCount: number; totalUsers: number }) {
  const relayDisplayName = use$(() => pool.relay(relay).name$, [relay]);
  const coveragePercentage = totalUsers > 0 ? Math.round((userCount / totalUsers) * 100) : 0;

  const instance = useMemo(() => pool.relay(relay), [relay]);
  const connected = use$(() => instance.connected$, [instance]);

  const color = useMemo(() => pastellify(relay, { toCSS: true }), [relay]);
  const icon = use$(() => pool.relay(relay).icon$, [relay]);

  return (
    <div
      className={`flex items-center gap-2 justify-between p-2 hover:bg-base-100 border-l-2 ${connected ? "border-l-success" : " border-l-warning"}`}
    >
      <div className="avatar">
        <div className="w-6 h-6 rounded-full">
          <img src={icon} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color }}>
          {relayDisplayName}
        </div>
        <div className="text-sm text-base-content/60 truncate">{relay}</div>
      </div>
      <div className="flex flex-col items-end ml-2">
        <div className="text-sm font-medium">{userCount}</div>
        <div className="text-sm text-base-content/60">{coveragePercentage}%</div>
      </div>
    </div>
  );
}

// Component to show unhealthy relay information
function UnhealthyRelay({ relay }: { relay: string }) {
  const relayDisplayName = relay.replace("wss://", "").replace("ws://", "");

  // Get state information from liveness tracker observable
  const state = use$(() => liveness.state(relay), [relay]);

  const color = useMemo(() => pastellify(relay, { toCSS: true }), [relay]);

  const getStateBadge = (state?: RelayHealthState | "unknown") => {
    switch (state) {
      case "dead":
        return "badge-error";
      case "offline":
        return "badge-warning";
      case "online":
        return "badge-success";
      default:
        return "badge-neutral";
    }
  };

  const formatBackoffTime = (ms: number) => {
    if (ms === 0) return "";
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const handleRevive = () => {
    liveness.revive(relay);
  };

  // Calculate derived state from the relay state
  const isInBackoff = state?.backoffUntil ? Date.now() < state.backoffUntil : false;
  const backoffRemaining = state?.backoffUntil ? Math.max(0, state.backoffUntil - Date.now()) : 0;

  return (
    <div className="flex items-center gap-2 justify-between p-2 hover:bg-base-100 border-l-2 border-l-error">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color }}>
          {relayDisplayName}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className={`badge badge-md ${getStateBadge(state?.state || "unknown")}`}>
            {state?.state || "unknown"}
          </div>
          {isInBackoff && backoffRemaining > 0 && (
            <div className="text-sm text-base-content/60">Backoff: {formatBackoffTime(backoffRemaining)}</div>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end ml-2">
        {state?.state === "dead" && (
          <button className="btn btn-sm btn-outline btn-error" onClick={handleRevive} title="Revive this relay">
            Revive
          </button>
        )}
        {state?.failureCount && <div className="text-sm text-base-content/60 mt-1">{state.failureCount} failures</div>}
      </div>
    </div>
  );
}

// Main Social Feed Component
export default function SocialFeedExample() {
  const pubkey = use$(pubkey$);
  const maxConnections = use$(maxConnections$);
  const maxRelaysPerUser = use$(maxRelaysPerUser$);
  const live = use$(live$);

  // Start live and timeline subscriptions on mount (and stop them on unmount)
  const liveError = use$(liveError$);
  use$(timeline$);

  // Select the best relays for the contacts
  const outboxes = use$(contactsWithOutboxes$);
  const selection = use$(() => selection$, [selection$]);
  const outboxMap = use$(() => selection$.pipe(map(createOutboxMap)), [selection$]);

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

  // Sort relays by popularity (number of users) in descending order
  const sortedRelays = outboxMap ? Object.entries(outboxMap).sort(([, a], [, b]) => b.length - a.length) : [];

  const fallbacks = use$(fallbacks$);

  // Get unhealthy relays from liveness tracker
  const unhealthyRelays = use$(liveness.unhealthy$);

  // Get the timeline from the event store
  const feedEvents = use$(
    () =>
      selection
        ? eventStore
            .timeline({ kinds: [1], authors: selection.map((s) => s.pubkey) })
            // Events are already stored, so batch renders while blocks of events are arriving
            .pipe(throttleTime(250, undefined, { leading: true, trailing: true }))
        : of([]),
    [selection],
  );

  return (
    <div className="flex min-h-0 grow">
      {/* User Preview Modal */}
      <UserPreviewModal selection={selection} />

      {/* Main Content Area */}
      <div className="flex flex-1 min-w-0 flex-col bg-base-50">
        {/* Relay Activity */}
        <RelayStatusBar />

        {/* Scrollable Feed */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto">
            {pubkey ? (
              <div>
                {liveError && (
                  <div className="alert alert-warning m-2">Live updates unavailable: {liveError.message}</div>
                )}

                {/* Feed Content */}
                <div className="bg-base-100 border border-base-300 rounded-lg">
                  {feedEvents && feedEvents.length > 0 ? (
                    <div className="divide-y divide-base-300">
                      {feedEvents.map((event) => (
                        <Note key={event.id} note={event} selection={byPubkey?.[event.pubkey]} />
                      ))}
                      {/* Scrolling past the last note moves the cursor beyond it, keyed so it re-triggers after each block */}
                      <div
                        key={feedEvents[feedEvents.length - 1].created_at}
                        ref={trackScroll}
                        data-created-at={feedEvents[feedEvents.length - 1].created_at - 1}
                        className="flex justify-center py-4"
                      >
                        <span className="loading loading-dots loading-md" />
                      </div>
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
      </div>

      {/* Sidebar */}
      <div className="w-80 shrink-0 bg-base-100 border-l border-base-300 flex flex-col overflow-y-auto">
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
            {/* Live subscription */}
            <label className="label cursor-pointer justify-between w-full">
              <span className="label-text">Live updates</span>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={live}
                onChange={(e) => live$.next(e.target.checked)}
              />
            </label>

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
                onChange={(e) => maxConnections$.next(Number(e.target.value))}
                className="range range-primary range-sm"
              />
              <div className="w-full flex justify-between text-sm px-2 text-base-content/60">
                <span>1</span>
                <span>100</span>
                <span>200</span>
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
                onChange={(e) => maxRelaysPerUser$.next(Number(e.target.value))}
                className="range range-primary range-sm"
              />
              <div className="w-full flex justify-between text-sm px-2 text-base-content/60">
                <span>0</span>
                <span>15</span>
                <span>30</span>
              </div>
            </div>
          </div>
        </div>

        {/* User Issues Section */}
        <UserIssuesSection selection={selection} contacts={outboxes} />

        {/* Selected Relays */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Selected Relays</h3>
            <div className="badge badge-outline">{sortedRelays.length}</div>
          </div>

          <div className="space-y-1 max-h-96 overflow-y-auto">
            {sortedRelays.length === 0 ? (
              <div className="text-center py-4 text-base-content/60">
                {pubkey ? "Loading relays..." : "Enter your npub to view relays"}
              </div>
            ) : (
              sortedRelays.map(([relay, pubkeys]) => (
                <RelayConnection
                  key={relay}
                  relay={relay}
                  userCount={pubkeys.length}
                  totalUsers={selection?.length || 0}
                />
              ))
            )}
          </div>
        </div>

        {/* Extra relays */}
        <div className="p-4">
          <h3 className="text-lg font-semibold mb-4">Fallback Relays</h3>
          <p className="text-base-content/60 text-sm mb-4">Used when no relays are available for a user</p>
          <RelayManager relays={fallbacks} onChange={(relays) => fallbacks$.next(relays)} />
        </div>

        {/* Unhealthy Relays Section */}
        {unhealthyRelays && unhealthyRelays.length > 0 && (
          <div className="p-4 border-b border-base-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-error">Unhealthy Relays</h3>
              <div className="badge badge-error">{unhealthyRelays.length}</div>
            </div>

            <div className="space-y-1 max-h-96 overflow-y-auto">
              {unhealthyRelays.map((relay) => (
                <UnhealthyRelay key={relay} relay={relay} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
