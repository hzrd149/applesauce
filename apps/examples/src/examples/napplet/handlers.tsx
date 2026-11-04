/**
 * Sync a napplet store to discover archetypes and intents, then pick the napplets that handle each of them with public or private kind 31129 preferences
 * @tags nip-5d, napplet, nap-intent, handlers, sync, negentropy, actions
 * @related napplet/store, napplet/loader, app-handlers/recommendations
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import {
  AddNappletHandler,
  AddNappletIntentHandler,
  ClearNappletHandlers,
  RemoveNappletHandler,
  RemoveNappletIntentHandler,
  SetNappletHandler,
  SetNappletIntentHandler,
} from "applesauce-actions/actions";
import { castUser, Napplet, NappletHandlers, NappletSnapshot, User } from "applesauce-common/casts";
import {
  getNappletHandlerRefKey,
  getNappletHandlersFilter,
  getNappletIdentifier,
  NAPPLET_HANDLERS_KIND,
  NAPPLET_KIND,
  NAPPLET_ROOT_KIND,
  NappletHandlerEntries,
  NappletHandlerRef,
  NappletIcon,
  normalizeBlossomServer,
  parseNappletConvention,
} from "applesauce-common/helpers";
import { RecommendedNappletHandlersModel } from "applesauce-common/models";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import { addRelayHintsToPointer, AddressPointer, Filter, mergeRelaySets } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Eraser, Lock, LockOpen, LogIn, LogOut, Plus, RefreshCw, Trash2, Unlock } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defer,
  EMPTY,
  endWith,
  ignoreElements,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  take,
  timeout,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import RelayPicker from "../../components/relay-picker";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

const DEFAULT_STORE_RELAY = "wss://relay.ditto.pub/";
const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

// Discover current manifests; pinned snapshots are loaded directly from preference references
const NAPPLETS_FILTER: Filter = { kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND] };

// Login state
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));
const signer = new ProxySigner(signer$.pipe(defined()));

// Shared infrastructure
const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

// NIP-77 negentropy sync with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

// Actions publish the preferences to the user's outboxes
const actions = new ActionRunner(eventStore, signer, async (event, relays) => {
  const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
  if (!responses.some((r) => r.ok)) throw new Error("No relay accepted the event");
});

type LoadStatus = { loading: boolean; error?: string };

/** Requests events into the store and reports when the request finishes */
function requestIntoStore$(relays: string[], filter: Filter): Observable<LoadStatus> {
  return pool.request(relays, filter).pipe(
    mapEventsToStore(eventStore),
    ignoreElements(),
    endWith<LoadStatus>({ loading: false }),
    startWith<LoadStatus>({ loading: true }),
    catchError((err) => of<LoadStatus>({ loading: false, error: err instanceof Error ? err.message : String(err) })),
  );
}

/** Loads every handler preference of the user from their outboxes, so actions modify the latest version */
function loadPreferences$(user: User): Observable<LoadStatus> {
  return user.outboxes$.pipe(
    defined(),
    timeout({ first: 5_000, with: () => of([]) }),
    take(1),
    switchMap((outboxes) =>
      requestIntoStore$(mergeRelaySets(outboxes, FALLBACK_RELAYS), {
        kinds: [NAPPLET_HANDLERS_KIND],
        authors: [user.pubkey],
      }),
    ),
    startWith<LoadStatus>({ loading: true }),
  );
}

// ---------- Catalog ----------

/** The napplets advertising an archetype, and the napplets accepting each of its intents */
type ArchetypeCatalog = { napplets: Napplet[]; intents: Map<string, Napplet[]> };

/** Groups napplets by archetype and convention identity, ignoring intents for archetypes the napplet doesn't advertise */
function buildCatalog(napplets: Napplet[]): Map<string, ArchetypeCatalog> {
  const catalog = new Map<string, ArchetypeCatalog>();

  for (const napplet of napplets) {
    for (const archetype of napplet.archetypes) {
      const entry: ArchetypeCatalog = catalog.get(archetype) ?? { napplets: [], intents: new Map() };
      entry.napplets.push(napplet);
      catalog.set(archetype, entry);
    }

    for (const { intent: identity } of napplet.intents) {
      const convention = parseNappletConvention(identity);
      if (!convention || !napplet.archetypes.includes(convention.archetype)) continue;

      const intents = catalog.get(convention.archetype)!.intents;
      intents.set(identity, [...(intents.get(identity) ?? []), napplet]);
    }
  }

  return catalog;
}

const catalog$ = eventStore
  .timeline(NAPPLETS_FILTER)
  .pipe(castTimelineStream(Napplet, eventStore), map(buildCatalog), shareReplay({ bufferSize: 1, refCount: true }));

// ---------- Preferences ----------

/** A handler entry with the group it is stored in */
type Entry = { ref: NappletHandlerRef; hidden: boolean };

/** Lists alternative handlers with their visibility, preserving order within each list */
function listEntries(
  publicEntries: NappletHandlerEntries | undefined,
  hiddenEntries: NappletHandlerEntries | undefined,
  identity?: string,
): Entry[] {
  const pick = (entries?: NappletHandlerEntries) =>
    (identity ? entries?.intents.get(identity) : entries?.handlers) ?? [];

  return [
    ...pick(publicEntries).map((ref) => ({ ref, hidden: false })),
    ...pick(hiddenEntries).map((ref) => ({ ref, hidden: true })),
  ];
}

function hasEntries(entries?: NappletHandlerEntries): boolean {
  return !!entries && (entries.handlers.length > 0 || entries.intents.size > 0);
}

/** Watches saved archetypes, including locked private preferences until they can be inspected */
function preferredArchetypes$(user: User): Observable<string[]> {
  return user.nappletHandlers$.pipe(
    switchMap((preferences) =>
      preferences.length === 0
        ? of([])
        : combineLatest(
            preferences.map((handlers) =>
              handlers.hiddenEntries$.pipe(
                map((hidden) =>
                  hasEntries(handlers.publicEntries) || hasEntries(hidden) || (handlers.hasHidden && !hidden)
                    ? handlers.archetype
                    : undefined,
                ),
              ),
            ),
          ),
    ),
    map((archetypes) => archetypes.filter((archetype): archetype is string => archetype !== undefined).sort()),
  );
}

/** Subscribes to the napplet a handler reference points to; a pin only resolves to its snapshot */
function handlerNapplet$(ref: NappletHandlerRef): Observable<Napplet | undefined> {
  return ref.type === "snapshot"
    ? eventStore.event(ref.pointer).pipe(castEventStream(NappletSnapshot, eventStore))
    : eventStore.replaceable(ref.pointer).pipe(castEventStream(Napplet, eventStore));
}

/** Contacts recommending each handler, keyed by handler reference */
type Recommenders = Map<string, string[]>;

/** Ranks the napplets the user's contacts publicly recommend for an archetype or intent */
function recommenders$(archetype: string, contacts: string[], identity?: string): Observable<Recommenders> {
  if (contacts.length === 0) return of(new Map());

  return eventStore
    .model(RecommendedNappletHandlersModel, archetype, contacts, identity)
    .pipe(map((handlers) => new Map(handlers.map((h) => [getNappletHandlerRefKey(h.ref), h.recommenders]))));
}

// ---------- Icons ----------

/** Checks the magic bytes so the icon decodes as the declared MIME type */
function matchesIconType(bytes: Uint8Array, type: NappletIcon["type"]) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (type === "image/png") return bytes[0] === 0x89 && ascii(1, 4) === "PNG";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

/** Fetches the icon from the manifest servers and only renders bytes that match the icon hash (NIP-5D) */
async function fetchVerifiedIcon(icon: NappletIcon, servers: string[]): Promise<string | null> {
  for (const server of servers) {
    try {
      const res = await fetch(new URL(icon.sha256, normalizeBlossomServer(server)));
      if (!res.ok) continue;

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytesToHex(sha256(bytes)) !== icon.sha256 || !matchesIconType(bytes, icon.type)) continue;

      return URL.createObjectURL(new Blob([bytes], { type: icon.type }));
    } catch {
      // try the next server
    }
  }

  return null;
}

// One verified object URL per icon hash, shared by every row and picker
const icons = new Map<string, Observable<string | null>>();
function verifiedIcon$(napplet: Napplet): Observable<string | null> {
  const icon = napplet.icon;
  if (!icon || napplet.servers.length === 0) return of(null);

  let icon$ = icons.get(icon.sha256);
  if (!icon$) {
    icon$ = defer(() => fetchVerifiedIcon(icon, napplet.servers)).pipe(startWith(null), shareReplay(1));
    icons.set(icon.sha256, icon$);
  }

  return icon$;
}

function nappletName(napplet: Napplet) {
  return napplet.title || getNappletIdentifier(napplet.event) || (napplet.isSnapshot ? "Snapshot" : "Root napplet");
}

/** The coordinate handler entries use for root and named napplets */
function nappletKey(napplet: Napplet) {
  return napplet.coordinate ?? napplet.id;
}

function NappletIconImage({ napplet }: { napplet: Napplet }) {
  const src = use$(() => verifiedIcon$(napplet), [napplet.id]);

  if (!src)
    return (
      <div className="w-10 h-10 shrink-0 rounded-lg border border-base-300 bg-base-200 flex items-center justify-center font-bold text-base-content/60">
        {nappletName(napplet).slice(0, 1).toUpperCase()}
      </div>
    );

  return <img src={src} alt="" className="w-10 h-10 shrink-0 rounded-lg border border-base-300 object-cover" />;
}

// ---------- Shared components ----------

function Avatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);

  return (
    <img
      src={profile?.picture || `https://robohash.org/${pubkey}.png`}
      title={profile?.displayName || pubkey.slice(0, 8)}
      alt=""
      className="w-6 h-6 rounded-full border-2 border-base-100 object-cover"
    />
  );
}

/** Stacked avatars of the contacts recommending a handler */
function RecommenderAvatars({ pubkeys }: { pubkeys?: string[] }) {
  if (!pubkeys?.length) return null;

  return (
    <div className="flex items-center -space-x-2" title={`${pubkeys.length} contacts recommend this`}>
      {pubkeys.slice(0, 4).map((pubkey) => (
        <Avatar key={pubkey} pubkey={pubkey} />
      ))}
      {pubkeys.length > 4 && <span className="pl-3 text-sm text-base-content/60">+{pubkeys.length - 4}</span>}
    </div>
  );
}

function AuthorName({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span>{profile?.displayName || user.npub.slice(0, 12)}</span>;
}

/** Runs an action with local busy and error state */
function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);

    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, run };
}

// ---------- Handler options ----------

/** The archetype and optional convention identity a handler preference applies to */
type HandlerTarget = { archetype: string; identity?: string };

/** Moves a handler to the public or private group */
function setHandlerVisibility({ archetype, identity }: HandlerTarget, ref: NappletHandlerRef, hidden: boolean) {
  return identity
    ? actions.run(SetNappletIntentHandler, identity, ref.pointer, hidden)
    : actions.run(SetNappletHandler, archetype, ref.pointer, hidden);
}

/** Adds an alternative preferred handler */
function addHandler({ archetype, identity }: HandlerTarget, pointer: AddressPointer, hidden: boolean) {
  return identity
    ? actions.run(AddNappletIntentHandler, identity, pointer, hidden)
    : actions.run(AddNappletHandler, archetype, pointer, hidden);
}

/** Removes a handler from both visibility groups */
function removeHandler({ archetype, identity }: HandlerTarget, ref: NappletHandlerRef) {
  return identity
    ? actions.run(RemoveNappletIntentHandler, identity, ref.pointer)
    : actions.run(RemoveNappletHandler, archetype, ref.pointer);
}

function HandlerRow(props: { target: HandlerTarget; entry: Entry; recommenders?: string[]; canWrite: boolean }) {
  const { target, entry, recommenders, canWrite } = props;
  const napplet = use$(() => handlerNapplet$(entry.ref), [entry.ref]);
  const { busy, error, run } = useOperation();
  const disabled = !canWrite || busy;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-base-300 last:border-b-0">
      {napplet ? (
        <>
          <NappletIconImage napplet={napplet} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">
              {nappletName(napplet)}
              {napplet.isSnapshot && <span className="badge badge-outline ml-2">pinned</span>}
            </div>
            <div className="text-sm text-base-content/60 truncate">
              <AuthorName user={napplet.author} />
            </div>
          </div>
        </>
      ) : (
        <div className="min-w-0 flex-1 font-mono text-sm text-base-content/60 truncate">
          {getNappletHandlerRefKey(entry.ref)}
        </div>
      )}
      <RecommenderAvatars pubkeys={recommenders} />
      {error && (
        <span className="badge badge-error" title={error}>
          failed
        </span>
      )}
      {busy && <span className="loading loading-spinner loading-sm" />}
      <button
        className={`btn btn-sm btn-square ${entry.hidden ? "btn-warning" : "btn-ghost"}`}
        title={entry.hidden ? "Private, make public" : "Public, make private"}
        disabled={disabled}
        onClick={() => run(() => setHandlerVisibility(target, entry.ref, !entry.hidden))}
      >
        {entry.hidden ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
      </button>
      <button
        className="btn btn-sm btn-ghost btn-square"
        title="Remove from public and private preferences"
        disabled={disabled}
        onClick={() => run(() => removeHandler(target, entry.ref))}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Picks an alternative handler, listing contact recommendations first */
function AddHandler(props: {
  target: HandlerTarget;
  options: Napplet[];
  storeRelay: string;
  recommenders: Recommenders;
  canWrite: boolean;
}) {
  const { target, options, storeRelay, recommenders, canWrite } = props;
  const [selected, setSelected] = useState("");
  const [hidden, setHidden] = useState(false);
  const { busy, error, run } = useOperation();

  const count = (napplet: Napplet) => recommenders.get(nappletKey(napplet))?.length ?? 0;
  const ranked = useMemo(() => [...options].sort((a, b) => count(b) - count(a)), [options, recommenders]);
  const napplet = ranked.find((option) => nappletKey(option) === selected);

  const add = () => {
    if (!napplet) return;

    // The store relay is where the napplet was synced from, so it is a useful relay hint
    const pointer = addRelayHintsToPointer(napplet.pointer as AddressPointer, [storeRelay]);
    return run(async () => {
      await addHandler(target, pointer, hidden);
      setSelected("");
    });
  };

  if (ranked.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-base-300">
      <select
        className="select select-sm flex-1"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={!canWrite}
      >
        <option value="">Add a napplet…</option>
        {ranked.map((option) => (
          <option key={nappletKey(option)} value={nappletKey(option)}>
            {nappletName(option)}
            {count(option) > 0 ? ` (${count(option)} contacts)` : ""}
          </option>
        ))}
      </select>
      <button
        className={`btn btn-sm btn-square ${hidden ? "btn-warning" : "btn-ghost"}`}
        title={hidden ? "Add privately" : "Add publicly"}
        onClick={() => setHidden(!hidden)}
      >
        {hidden ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
      </button>
      <button className="btn btn-sm btn-primary" disabled={!canWrite || !napplet || busy} onClick={add}>
        {busy ? <span className="loading loading-spinner loading-sm" /> : <Plus className="w-4 h-4" />}
      </button>
      {error && (
        <span className="badge badge-error" title={error}>
          failed
        </span>
      )}
    </div>
  );
}

/** Alternative preferred handlers for an archetype or an exact convention identity */
function HandlerOptions(props: {
  target: HandlerTarget;
  label: string;
  options: Napplet[];
  handlers?: NappletHandlers;
  hiddenEntries?: NappletHandlerEntries;
  contacts: string[];
  storeRelay: string;
  canWrite: boolean;
}) {
  const { target, label, options, handlers, hiddenEntries, contacts, storeRelay, canWrite } = props;
  const recommenders =
    use$(
      () => recommenders$(target.archetype, contacts, target.identity),
      [target.archetype, target.identity, contacts],
    ) ?? new Map();
  const { busy, error, run } = useOperation();

  const entries = listEntries(handlers?.publicEntries, hiddenEntries, target.identity);
  const chosen = new Set(entries.map((entry) => getNappletHandlerRefKey(entry.ref)));
  const available = options.filter((napplet) => !chosen.has(nappletKey(napplet)));

  return (
    <section className="border border-base-300 rounded-lg">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-base-300 bg-base-200">
        <h3 className="font-semibold font-mono truncate flex-1">{label}</h3>
        <span className="badge badge-outline" title="Napplets that support this">
          {options.length}
        </span>
        {error && (
          <span className="badge badge-error" title={error}>
            failed
          </span>
        )}
        {target.identity && entries.length === 0 && !handlers?.hasHidden && (
          <span className="badge badge-ghost" title="Use usable archetype-wide handlers, then normal shell resolution">
            archetype handlers
          </span>
        )}
        {target.identity && entries.length > 0 && (
          <button
            className="btn btn-sm btn-ghost btn-square"
            title="Remove intent-specific preferences"
            disabled={!canWrite || busy}
            onClick={() => run(() => actions.run(RemoveNappletIntentHandler, target.identity!))}
          >
            <Eraser className="w-4 h-4" />
          </button>
        )}
      </header>
      {entries.map((entry) => (
        <HandlerRow
          key={`${entry.hidden}:${getNappletHandlerRefKey(entry.ref)}`}
          target={target}
          entry={entry}
          recommenders={recommenders.get(getNappletHandlerRefKey(entry.ref))}
          canWrite={canWrite}
        />
      ))}
      <AddHandler
        target={target}
        options={available}
        storeRelay={storeRelay}
        recommenders={recommenders}
        canWrite={canWrite}
      />
    </section>
  );
}

// ---------- Archetype ----------

function ArchetypeSettings(props: {
  archetype: string;
  catalog: ArchetypeCatalog;
  user?: User;
  storeRelay: string;
  preferences?: LoadStatus;
}) {
  const { archetype, catalog, user, storeRelay, preferences } = props;
  const handlers = use$(() => user?.nappletHandlers(archetype), [user, archetype]);
  // Emits again once the private entries are unlocked
  const hiddenEntries = use$(() => handlers?.hiddenEntries$, [handlers]);
  const contactUsers = use$(() => user?.contacts$, [user]);
  const { busy, error, run } = useOperation();

  const contacts = useMemo(
    () => (contactUsers ?? []).map((contact) => contact.pubkey).filter((pubkey) => pubkey !== user?.pubkey),
    [contactUsers, user],
  );

  // Load the contacts' public preferences for this archetype as recommendations
  use$(
    () =>
      contacts.length > 0
        ? requestIntoStore$(
            mergeRelaySets([storeRelay], FALLBACK_RELAYS),
            getNappletHandlersFilter(archetype, contacts),
          )
        : EMPTY,
    [archetype, contacts, storeRelay],
  );

  // Writes wait for the user's existing preferences so actions never publish over an unloaded event
  const canWrite = !!user && preferences?.loading === false && !preferences.error && !busy;
  const locked = !!handlers?.hasHidden && !hiddenEntries;
  const intents = [
    ...new Set([
      ...catalog.intents.keys(),
      ...(handlers?.publicEntries.intents.keys() ?? []),
      ...(hiddenEntries?.intents.keys() ?? []),
    ]),
  ].sort();

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold flex-1">{archetype}</h2>
        {preferences?.loading && <span className="loading loading-spinner loading-sm" title="Loading preferences" />}
        {error && (
          <span className="badge badge-error" title={error}>
            failed
          </span>
        )}
        {locked && (
          <button
            className="btn btn-sm btn-warning"
            disabled={busy}
            onClick={() => run(() => handlers!.unlock(signer).then(() => {}))}
          >
            <Unlock className="w-4 h-4" /> Unlock
          </button>
        )}
        {handlers && (
          <button
            className="btn btn-sm btn-ghost"
            title="Clear every preference for this archetype"
            disabled={!canWrite}
            onClick={() => run(() => actions.run(ClearNappletHandlers, archetype))}
          >
            <Trash2 className="w-4 h-4" /> Clear
          </button>
        )}
      </div>

      <HandlerOptions
        target={{ archetype }}
        label="Archetype handlers"
        options={catalog.napplets}
        handlers={handlers}
        hiddenEntries={hiddenEntries}
        contacts={contacts}
        storeRelay={storeRelay}
        canWrite={canWrite}
      />

      {intents.map((identity) => (
        <HandlerOptions
          key={identity}
          target={{ archetype, identity }}
          label={parseNappletConvention(identity)?.intent ?? identity}
          options={catalog.intents.get(identity) ?? []}
          handlers={handlers}
          hiddenEntries={hiddenEntries}
          contacts={contacts}
          storeRelay={storeRelay}
          canWrite={canWrite}
        />
      ))}
    </div>
  );
}

// ---------- Page ----------

function SyncBadge({ relay, status }: { relay: string; status?: SyncLoaderStatus }) {
  if (!status) return null;

  const relayStatus = status.relays[relay];
  if (relayStatus?.error)
    return (
      <span className="badge badge-error" title={relayStatus.error.message}>
        error
      </span>
    );

  return (
    <span className={`badge ${status.done ? "badge-success" : "badge-info"}`} title={relayStatus?.method}>
      {!status.done && <span className="loading loading-spinner loading-sm" />}
      {status.loaded}
    </span>
  );
}

function Account({ user, onLogin }: { user?: User; onLogin: () => void }) {
  const profile = use$(() => user?.profile$, [user]);

  const logout = () => {
    forgetActiveAccount();
    signer$.next(null);
    pubkey$.next(null);
  };

  if (!user)
    return (
      <button className="btn btn-sm" onClick={onLogin}>
        <LogIn className="w-4 h-4" /> Login
      </button>
    );

  return (
    <div className="flex items-center gap-2">
      <img
        className="w-6 h-6 rounded-full"
        src={profile?.picture || `https://robohash.org/${user.pubkey}.png`}
        alt=""
      />
      <span className="truncate max-w-40">{profile?.displayName || user.npub.slice(0, 12)}</span>
      <button aria-label="Logout" title="Logout" className="btn btn-sm btn-ghost btn-square" onClick={logout}>
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

function HandlerSettingsPage({ user }: { user?: User }) {
  const [storeRelay, setStoreRelay] = useState(DEFAULT_STORE_RELAY);
  const [syncRun, setSyncRun] = useState(0);
  const [selected, setSelected] = useState<string>();
  const login = useRef<HTMLDialogElement>(null);

  const catalog = use$(catalog$);
  // Restarting the sync is cheap when negentropy only transfers the napplets missing from the store
  const sync = use$(() => syncLoader({ relays: [storeRelay], filter: NAPPLETS_FILTER }).status$, [storeRelay, syncRun]);
  const preferences = use$(() => (user ? loadPreferences$(user) : undefined), [user, syncRun]);
  const preferred = use$(() => (user ? preferredArchetypes$(user) : undefined), [user]) ?? [];

  const archetypes = useMemo(
    () => [...(catalog?.entries() ?? [])].sort(([, a], [, b]) => b.napplets.length - a.napplets.length),
    [catalog],
  );
  const discovered = archetypes.filter(([name]) => !preferred.includes(name));
  const archetype = selected ?? preferred[0];
  const archetypeCatalog = (archetype ? catalog?.get(archetype) : undefined) ?? { napplets: [], intents: new Map() };

  const archetypeButton = (name: string) => {
    const entry = catalog?.get(name);

    return (
      <button
        key={name}
        className={`flex w-full items-center gap-2 px-3 py-2 border-b border-base-300 text-left hover:bg-base-200 ${
          name === archetype ? "bg-base-200 font-semibold" : ""
        }`}
        aria-pressed={name === archetype}
        onClick={() => setSelected(name)}
      >
        <span className="flex-1 truncate">{name}</span>
        {!preferred.includes(name) && (
          <span className="badge badge-outline" title="Discovered napplets">
            {entry?.napplets.length ?? 0}
          </span>
        )}
      </button>
    );
  };

  const handleLogin = (newSigner: ISigner, pubkey: string) => {
    signer$.next(newSigner);
    pubkey$.next(pubkey);
    login.current?.close();
  };

  return (
    <div className="flex flex-col min-h-0 grow">
      <div className="flex items-center gap-2 p-2 border-b border-base-300">
        <RelayPicker className="w-72" value={storeRelay} onChange={setStoreRelay} />
        <button className="btn btn-sm" title="Reload store and preferences" onClick={() => setSyncRun(syncRun + 1)}>
          <RefreshCw className="w-4 h-4" />
        </button>
        <SyncBadge relay={storeRelay} status={sync} />
        {preferences?.error && (
          <span className="badge badge-error" title={preferences.error}>
            Preferences failed to load
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex flex-col min-h-0 w-72 shrink-0 border-e border-base-300">
          <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Archetypes">
            <div className="flex items-center gap-2 p-3 font-semibold">
              <span className="flex-1">Your preferences</span>
              {preferences?.loading && <span className="loading loading-spinner loading-sm" />}
            </div>
            {preferred.map(archetypeButton)}
            {preferred.length === 0 && !preferences?.loading && (
              <div className="p-3 text-base-content/60">
                {!user
                  ? "Log in to load preferences"
                  : preferences?.error
                    ? "Preferences unavailable"
                    : "No preferences"}
              </div>
            )}
            <details className="border-b border-base-300">
              <summary className="cursor-pointer p-3 font-semibold">
                Explore archetypes <span className="badge badge-outline ml-2">{discovered.length}</span>
              </summary>
              {discovered.map(([name]) => archetypeButton(name))}
              {discovered.length === 0 && (
                <div className="p-3 text-base-content/60">
                  {sync?.done ? "No other archetypes" : "Discovering archetypes…"}
                </div>
              )}
            </details>
          </nav>
          <div className="p-3 border-t border-base-300">
            <Account user={user} onLogin={() => login.current?.showModal()} />
          </div>
        </aside>

        <main className="min-w-0 min-h-0 flex-1 overflow-y-auto">
          {archetype ? (
            <ArchetypeSettings
              key={archetype}
              archetype={archetype}
              catalog={archetypeCatalog}
              user={user}
              storeRelay={storeRelay}
              preferences={preferences}
            />
          ) : (
            <div className="p-4 text-base-content/60">
              {preferences?.loading ? "Loading preferences…" : "Select an archetype to explore"}
            </div>
          )}
        </main>
      </div>

      <dialog className="modal" ref={login}>
        <div className="modal-box max-w-sm overflow-hidden border border-base-300 bg-base-200 p-0 shadow-none">
          <LoginView onLogin={handleLogin} />
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}

export default function NappletHandlerSettings() {
  const user = use$(user$);

  return <HandlerSettingsPage key={user?.pubkey ?? "anonymous"} user={user} />;
}
