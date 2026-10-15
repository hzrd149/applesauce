/**
 * Load and display social graph connections (follows, followers) between users
 * @tags loader, social-graph, follows
 * @related loader/parallel-async-loading
 */
import { castUser, User } from "applesauce-common/casts/user";
import { EventStore } from "applesauce-core";
import { kinds } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSocialGraphLoader, type SocialGraphStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import localforage from "localforage";
import { fromBinary, SocialGraph } from "nostr-social-graph";
import { useCallback, useMemo, useState } from "react";
import {
  BehaviorSubject,
  tap,
  map,
  switchMap,
  of,
  scan,
  auditTime,
  concatMap,
  concatWith,
  defer,
  ignoreElements,
  materialize,
  startWith,
  catchError,
  combineLatest,
  Observable,
} from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";
import RelayAddForm from "../../components/add-relay-form";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

const STORAGE_GRAPH = "social-graph";
const STORAGE_ROOT = "social-graph-root";

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

// Create a social graph loader
const graphLoader = createSocialGraphLoader(pool, { eventStore });

// Relays to crawl contact lists from, seeded from the shell's lookup relays
const relays$ = new BehaviorSubject<string[]>(lookupRelays$.value);

// Live social graph instance (mutated by handleEvent as events arrive)
const socialGraph$ = new BehaviorSubject<SocialGraph | undefined>(undefined);

const commands$ = new BehaviorSubject<{ relays: string[]; level: number; since?: number; pubkey: string } | null>(null);

// The current state of persisting the graph to local storage
const saveState$ = new BehaviorSubject<"idle" | "saving" | "saved">("idle");

/** Saves the current social graph and session metadata to local storage */
async function persistGraph() {
  const graph = socialGraph$.value;
  if (!graph) return;

  saveState$.next("saving");
  try {
    const data = await graph.toBinary();
    await localforage.setItem(STORAGE_GRAPH, data);
    await localforage.setItem(STORAGE_ROOT, graph.getRoot());
    saveState$.next("saved");
    setTimeout(() => {
      if (saveState$.value === "saved") saveState$.next("idle");
    }, 2000);
  } catch (err) {
    saveState$.next("idle");
    throw err;
  }
}

/** Starts a new crawler, replacing any previous run */
function startSocialGraphSync(relays: string[], level: number, since?: number) {
  const pubkey = socialGraph$.value?.getRoot();
  if (pubkey) commands$.next({ relays, level, since, pubkey });
}
/** Cancels the current crawler */
function stopSocialGraphSync() {
  commands$.next(null);
}

/** Loads the social graph and session metadata from local storage, returns ms elapsed */
async function loadGraph(): Promise<number | null> {
  const start = performance.now();
  const stored = await localforage.getItem<Uint8Array>(STORAGE_GRAPH);
  const root = await localforage.getItem<string>(STORAGE_ROOT);
  if (!stored || !root) return null;

  const graph = await fromBinary(root, stored);
  socialGraph$.next(graph);
  return performance.now() - start;
}

/** Clears the social graph and session metadata from local storage */
async function clearStorage() {
  await localforage.removeItem(STORAGE_GRAPH);
  await localforage.removeItem(STORAGE_ROOT);
}

/** Simple user avatar component */
function UserAvatar({ user }: { user: User }) {
  const profile = use$(user.profile$);
  const hasContactList = eventStore.hasReplaceable(kinds.Contacts, user.pubkey);

  return (
    <div className="avatar placeholder" title={profile?.displayName ?? user.npub.slice(0, 12) + "..."}>
      <div
        className={`w-10 rounded-full bg-base-300 border-2  ${hasContactList ? "border-success" : "border-base-300"}`}
      >
        <img
          src={profile?.picture ?? `https://robohash.org/${user.pubkey}.png`}
          alt={profile?.displayName ?? user.npub.slice(0, 12) + "..."}
        />
      </div>
    </div>
  );
}

/** Crawl progress from the loader's status$: how many follow lists were found and how each relay is doing */
function CrawlStatus({ status }: { status: SocialGraphStatus }) {
  const percent = status.requested > 0 ? ((status.found / status.requested) * 100).toFixed(1) : "0.0";

  return (
    <div className="border border-base-300 rounded-lg overflow-x-auto">
      <div className="flex flex-wrap gap-4 p-3 text-sm border-b border-base-300">
        <span>
          Found <span className="font-bold">{status.found}</span> / {status.requested} follow lists ({percent}%)
        </span>
        <span>No list: {status.missing}</span>
        <span>Queued: {status.queued}</span>
        <span>Batches loading: {status.inFlight}</span>
        {status.done && <span className="badge badge-success">Done</span>}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Relay</th>
            <th>Requests</th>
            <th>Events</th>
            <th>Retries</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(status.relays).map((relay) => (
            <tr key={relay.relay}>
              <td className="font-mono">{relay.relay}</td>
              <td>{relay.requests}</td>
              <td>{relay.events}</td>
              <td>{relay.retries}</td>
              <td className={relay.errors > 0 ? "text-error" : ""} title={relay.error?.message}>
                {relay.errors}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A row of avatars for a single follow distance */
function DistanceRow({ distance }: { distance: number }) {
  // Walk the distance set once per update to count loaded contact lists and pick a preview
  const stats = use$(
    () =>
      socialGraph$.pipe(
        map((graph) => {
          const pubkeys = graph?.getUsersByFollowDistance(distance) ?? new Set<string>();
          const preview: string[] = [];
          let loaded = 0;
          for (const pubkey of pubkeys) {
            if (preview.length < 24) preview.push(pubkey);
            if (eventStore.hasReplaceable(kinds.Contacts, pubkey)) loaded++;
          }
          return { count: pubkeys.size, loaded, preview };
        }),
      ),
    [distance],
  );
  const count = stats?.count ?? 0;
  const loaded = stats?.loaded ?? 0;
  const previewKey = stats?.preview.join("|") ?? "";
  const users = useMemo(() => (stats?.preview ?? []).map((pubkey) => castUser(pubkey, eventStore)), [previewKey]);

  return (
    <tr>
      <td className="align-top w-16 font-bold text-lg">{distance}</td>
      <td className="align-top w-24 text-base-content/60">{count}</td>
      <td className="align-top w-24 text-base-content/60">
        {loaded} ({count > 0 ? ((loaded / count) * 100).toFixed(2) : "0.00"}%)
      </td>
      <td>
        {users.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {users.map((user) => (
              <UserAvatar key={user.pubkey} user={user} />
            ))}
          </div>
        ) : (
          <span className="text-base-content/50">No users</span>
        )}
      </td>
    </tr>
  );
}

export default function NostrSocialGraphExample() {
  const graph = use$(socialGraph$);
  const operation = use$(
    () =>
      commands$.pipe(
        switchMap((command) => {
          const initial = { loaded: 0, status: undefined as SocialGraphStatus | undefined, running: false, error: "" };
          if (!command) return of(initial);
          const { events$, status$ } = graphLoader({
            pubkey: command.pubkey,
            relays: command.relays,
            distance: command.level,
            since: command.since,
          });
          const loaded$ = events$.pipe(
            // The loader already adds events to the store and only emits the newest list per user
            tap((event) => socialGraph$.value?.handleEvent(event)),
            scan((loaded) => loaded + 1, 0),
            auditTime(500),
            concatMap(async (loaded) => {
              await socialGraph$.value?.recalculateFollowDistances();
              socialGraph$.next(socialGraph$.value);
              return loaded;
            }),
            concatWith(defer(() => persistGraph()).pipe(ignoreElements())),
            startWith(0),
          );
          // Subscribing to both streams together shares one crawl
          return combineLatest([loaded$, status$.pipe(startWith(undefined))]).pipe(
            map(([loaded, status]) => ({ loaded, status, running: true, error: "" })),
            materialize(),
            scan(
              (state, notification) =>
                notification.kind === "N"
                  ? notification.value
                  : { ...state, running: false, error: notification.kind === "E" ? String(notification.error) : "" },
              initial,
            ),
            startWith({ ...initial, running: true }),
          );
        }),
      ),
    [],
  );
  const syncState = operation;
  const saveState = use$(saveState$);
  const isRunning = operation?.running ?? false;

  const relays = use$(relays$);

  // Default to loading root and friends contacts
  const [level, setLevel] = useState(1);
  // Lookback window in seconds, or null for "all time"
  const [sinceSeconds, setSinceSeconds] = useState<number | null>(null);

  const restored = use$(
    () =>
      defer(() => loadGraph()).pipe(
        map((elapsed) => ({ loading: false, elapsed, error: "" })),
        startWith({ loading: true, elapsed: null as number | null, error: "" }),
        catchError((error) => of({ loading: false, elapsed: null, error: String(error.message ?? error) })),
      ),
    [],
  );
  const initializing = restored?.loading ?? true;
  const loadTime = restored?.elapsed;
  use$(() => new Observable<void>(() => () => stopSocialGraphSync()), []);

  const root = graph?.getRoot() ?? "";

  // Update or create the graph when a new root pubkey is picked
  const handleRootChange = useCallback(async (pubkey: string) => {
    if (!pubkey) return;
    const current = socialGraph$.value;
    if (!current) {
      socialGraph$.next(new SocialGraph(pubkey));
    } else if (current.getRoot() !== pubkey) {
      // Stop any running sync before switching roots
      stopSocialGraphSync();
      await current.setRoot(pubkey);
      socialGraph$.next(current);
    }
  }, []);

  const handleStart = useCallback(() => {
    const since = sinceSeconds != null ? Math.floor(Date.now() / 1000) - sinceSeconds : undefined;
    startSocialGraphSync(relays, level, since);
  }, [relays, level, sinceSeconds]);

  const handleSave = useCallback(async () => {
    await persistGraph();
  }, []);

  const handleClear = useCallback(async () => {
    stopSocialGraphSync();
    await clearStorage();
    socialGraph$.next(undefined);
    commands$.next(null);
  }, []);

  return (
    <div className="container mx-auto my-6 p-4 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Nostr Social Graph</h1>
        <p className="text-base-content/60 text-sm">
          Crawl and persist a{" "}
          <a className="link" href="https://github.com/mmalmi/nostr-social-graph" target="_blank" rel="noreferrer">
            nostr-social-graph
          </a>{" "}
          rooted at a pubkey. The graph is saved to local storage so it can be reloaded later.
        </p>
      </div>

      {initializing ? (
        <div className="flex items-center gap-2 text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading graph from storage...</span>
        </div>
      ) : (
        <>
          {/* Root pubkey picker */}
          <div>
            <label className="label pb-1">
              <span className="label-text">Root pubkey</span>
            </label>
            <PubkeyPicker value={root} onChange={handleRootChange} placeholder="Enter an npub or nostr identifier..." />
          </div>

          {/* Sync relays */}
          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="label-text">Sync relays</span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => relays$.next(lookupRelays$.value)}
                disabled={isRunning}
              >
                Reset to lookup relays
              </button>
            </div>
            <ul className="border border-base-300 rounded-box divide-y divide-base-300 mb-2">
              {relays.map((relay) => (
                <li key={relay} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-sm truncate">{relay}</span>
                  <button
                    className="btn btn-sm btn-ghost text-error"
                    onClick={() => relays$.next(relays$.value.filter((r) => r !== relay))}
                    disabled={isRunning}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {relays.length === 0 && <li className="px-3 py-2 text-sm text-base-content/50">No sync relays</li>}
            </ul>
            <RelayAddForm onSubmit={(r) => relays$.value.includes(r) || relays$.next([...relays$.value, r])} />
          </div>

          {/* Distance + start/stop controls */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label pb-1">
                <span className="label-text">Sync depth</span>
              </label>
              <select
                className="select select-bordered"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
                disabled={isRunning}
              >
                <option value={1}>1 (friends)</option>
                <option value={2}>2 (friends of friends)</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </div>

            <div>
              <label className="label pb-1">
                <span className="label-text">Since</span>
              </label>
              <select
                className="select select-bordered"
                value={sinceSeconds ?? ""}
                onChange={(e) => setSinceSeconds(e.target.value === "" ? null : Number(e.target.value))}
                disabled={isRunning}
              >
                <option value="">All time</option>
                <option value={60 * 60 * 24}>Last 24 hours</option>
                <option value={60 * 60 * 24 * 7}>Last 7 days</option>
                <option value={60 * 60 * 24 * 30}>Last 30 days</option>
                <option value={60 * 60 * 24 * 90}>Last 3 months</option>
                <option value={60 * 60 * 24 * 180}>Last 6 months</option>
                <option value={60 * 60 * 24 * 365}>Last year</option>
              </select>
            </div>

            <div className="join">
              {isRunning ? (
                <button className="btn btn-error join-item" onClick={stopSocialGraphSync}>
                  Stop
                </button>
              ) : (
                <button
                  className="btn btn-primary join-item"
                  onClick={handleStart}
                  disabled={!root || relays.length === 0}
                >
                  Start
                </button>
              )}
              <button
                className={`btn join-item ${saveState === "saved" ? "btn-success" : ""}`}
                onClick={handleSave}
                disabled={!graph || saveState !== "idle"}
              >
                {saveState === "saving" && <span className="loading loading-spinner loading-sm" />}
                {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save"}
              </button>
              <button className="btn btn-ghost join-item" onClick={handleClear}>
                Clear
              </button>
            </div>
          </div>

          {/* Running status */}
          <div className="flex items-center gap-3 p-3 border border-base-300 rounded-lg">
            <div className={`badge ${isRunning ? "badge-success" : "badge-ghost"} ${isRunning ? "animate-pulse" : ""}`}>
              {isRunning ? "Running" : "Idle"}
            </div>
            {isRunning && <span className="loading loading-spinner loading-sm" />}
            <span className="text-sm">
              Loaded <span className="font-bold">{syncState?.loaded ?? 0}</span> follow events
            </span>
            {loadTime != null && (
              <span className="text-sm text-base-content/60" title="Time to load graph from local storage">
                Loaded from storage in <span className="font-mono">{loadTime.toFixed(0)}ms</span>
              </span>
            )}
            {graph && (
              <span className="text-sm text-base-content/60 ml-auto">
                Graph size: <span className="font-mono">{graph.size().users}</span> users
              </span>
            )}
          </div>

          {syncState?.status && <CrawlStatus status={syncState.status} />}

          {/* Follow distance table */}
          {graph ? (
            <div className="border border-base-300 rounded-lg overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Distance</th>
                    <th>Count</th>
                    <th>Loaded</th>
                    <th>Users (up to 24)</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4, 5].map((distance) => (
                    <DistanceRow key={distance} distance={distance} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 border border-base-300 rounded-lg text-center text-base-content/60">
              Select a root pubkey above to start building a social graph.
            </div>
          )}
        </>
      )}
    </div>
  );
}
