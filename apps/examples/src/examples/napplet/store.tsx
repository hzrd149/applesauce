/**
 * A NIP-5D napplet app store with relay, NIP-50 search, author, contacts, archetype and capability filters
 * @tags nip-5d, napplet, nip-50, search, contacts, blossom
 * @related napplet/browser, search/relay
 */
import {
  castEvent,
  castUser,
  Comment,
  NamedNapplet,
  Napplet,
  NappletSnapshot,
  Reaction,
  RootNapplet,
  User,
} from "applesauce-common/casts";
import {
  COMMENT_KIND,
  getNappletIdentifier,
  getNappletParentPointer,
  NAPPLET_KIND,
  NAPPLET_ROOT_KIND,
  NAPPLET_SNAPSHOT_KIND,
  NappletIcon,
  normalizeBlossomServer,
} from "applesauce-common/helpers";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import {
  AddressPointer,
  buildCommonEventRelationFilters,
  EventPointer,
  Filter,
  getEventUID,
  getReplaceableAddressFromPointer,
  kinds,
  mergeRelaySets,
  NostrEvent,
} from "applesauce-core/helpers";
import { createCountService, createEventLoaderForStore, createZapsLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Heart, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import {
  catchError,
  connect,
  count,
  defer,
  distinctUntilChanged,
  last,
  map,
  merge,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs";
import JsonBlock from "../../components/json-block";
import LoginView from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Load profiles, contact lists and lineage (parent$ / root$) on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });
const zapLoader = createZapsLoader(pool, { eventStore });
// Counts reflect one trusted relay's dataset, independently of the store's search relay.
const counts = createCountService(pool, { relays: ["wss://relay.ditto.pub/", "wss://relay.primal.net/"] });
if (import.meta.hot) import.meta.hot.dispose(() => counts.stop());

/** Opens a napplet by its pointer so the selection survives replaceable revisions */
type Select = (pointer: AddressPointer | EventPointer | null) => void;

type Filters = {
  relay: string;
  query: string;
  author: string;
  contactsOnly: boolean;
  archetype: string;
  domain: string;
};
type Results =
  | { status: "loading" | "ready"; napplets: Napplet[] }
  | { status: "waiting"; message: string; napplets: Napplet[] }
  | { status: "error"; error: string; napplets: Napplet[] };

const DEFAULT_FILTERS: Filters = {
  relay: "wss://relay.ditto.pub/",
  query: "",
  author: "",
  contactsOnly: false,
  archetype: "",
  domain: "",
};

// ---------- Icons ----------

/** Checks the magic bytes so the icon decodes as the declared MIME type, not just any image */
function matchesIconType(bytes: Uint8Array, type: NappletIcon["type"]) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (type === "image/png") return bytes[0] === 0x89 && ascii(1, 4) === "PNG";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

/** Fetches the icon blob from the manifest servers and only renders bytes that match the icon hash (NIP-5D) */
async function fetchVerifiedIcon(icon: NappletIcon, servers: string[]): Promise<string | null> {
  for (const server of servers) {
    try {
      const res = await fetch(new URL(icon.sha256, normalizeBlossomServer(server)));
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytesToHex(sha256(bytes)) !== icon.sha256 || !matchesIconType(bytes, icon.type)) continue;

      const blob = new Blob([bytes], { type: icon.type });
      await createImageBitmap(blob); // throws if the bytes do not decode
      return URL.createObjectURL(blob);
    } catch {
      // try the next server
    }
  }
  return null;
}

// Share one verified object URL per icon hash across every tile and the detail page
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

function NappletIconImage({ napplet, size = "w-14 h-14" }: { napplet: Napplet; size?: string }) {
  const src = use$(() => verifiedIcon$(napplet), [napplet.id]);
  const name = napplet.title || getNappletIdentifier(napplet.event) || "?";

  // Missing, unavailable or unverified icons fall back to generic artwork
  if (!src)
    return (
      <div
        className={`${size} shrink-0 rounded-lg border border-base-300 bg-base-200 flex items-center justify-center text-xl font-bold text-base-content/60`}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  return <img src={src} alt="" className={`${size} shrink-0 rounded-lg border border-base-300 object-cover`} />;
}

// ---------- Shared components ----------

function AuthorName({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="font-medium">{profile?.displayName || user.npub.slice(0, 12)}</span>;
}

/** Shows relay counts without downloading the comments and reactions */
function NappletCounts({ napplet }: { napplet: Napplet }) {
  const comments = use$(
    () => counts.event({ ...napplet.event, address: napplet.coordinate ?? undefined }).comments$,
    [napplet.id],
  );
  const reactions = use$(() => counts.event(napplet.event).reactions$, [napplet.id]);
  return (
    <div className="flex gap-4 text-sm text-base-content/60">
      <span className="inline-flex items-center gap-1" aria-label={`${comments ?? "Loading"} comments`}>
        <MessageCircle size={16} aria-hidden="true" />
        {comments ?? "…"}
      </span>
      <span
        className="inline-flex items-center gap-1"
        aria-label={`${reactions ?? "Loading"} reactions`}
        title="All kind-7 reactions"
      >
        <Heart size={16} aria-hidden="true" />
        {reactions ?? "…"}
      </span>
    </div>
  );
}

function nappletName(napplet: Napplet) {
  return napplet.title || getNappletIdentifier(napplet.event) || (napplet.isSnapshot ? "Snapshot" : "Root napplet");
}

function snapshotLabel(napplet: Napplet) {
  return napplet.isSnapshot ? ` · Snapshot ${napplet.id.slice(0, 8)}` : "";
}

/** Opens the napplet in the kehto paja runtime using its NIP-19 address with outbox relay hints */
function OpenInPaja({ napplet, className = "btn-sm" }: { napplet: Napplet; className?: string }) {
  const address = use$(napplet.address$);

  return (
    <a
      className={`btn btn-primary ${className}`}
      href={`https://kehto.github.io/web/paja/?pointer=${address ?? napplet.address}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      Open in paja
    </a>
  );
}

/** Clickable tag values that apply a filter when a handler is provided */
function TagBadges({ values, onClick }: { values: string[]; onClick?: (value: string) => void }) {
  return values.map((value) =>
    onClick ? (
      <button
        key={value}
        className="badge badge-outline hover:badge-primary"
        onClick={(e) => {
          e.stopPropagation();
          onClick(value);
        }}
      >
        {value}
      </button>
    ) : (
      <span key={value} className="badge badge-outline">
        {value}
      </span>
    ),
  );
}

// ---------- Store listing ----------

/** Builds the relay filter, returning null when the author and contacts filters cannot overlap */
function buildFilter(filters: Filters, contacts: string[] | undefined): Filter | null {
  let authors = filters.author ? [filters.author] : undefined;
  if (filters.contactsOnly && contacts) authors = authors ? authors.filter((a) => contacts.includes(a)) : contacts;
  if (authors?.length === 0) return null;

  // Snapshots are only listed under the napplet they derive from
  const filter: Filter = { kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND], limit: 100 };
  if (authors) filter.authors = authors;
  if (filters.query) filter.search = filters.query;
  if (filters.archetype) filter["#z"] = [filters.archetype];
  if (filters.domain) filter["#R"] = [filters.domain];
  return filter;
}

/** Requests matching manifests from the selected relay and tracks loading, completion and errors */
function searchNapplets(relay: string, filter: Filter): Observable<Results> {
  return pool
    .relay(relay)
    .request(filter)
    .pipe(
      mapEventsToStore(eventStore),
      mapEventsToTimeline(),
      // Keep only the newest revision of each replaceable napplet
      map((events) => [...new Map(events.map((e) => [getEventUID(e), e] as const)).values()]),
      castTimelineStream(Napplet, eventStore),
      connect((napplets$) =>
        merge(
          napplets$.pipe(map((napplets): Results => ({ status: "loading", napplets }))),
          napplets$.pipe(
            last(undefined, [] as Napplet[]),
            map((napplets): Results => ({ status: "ready", napplets })),
          ),
        ),
      ),
      startWith<Results>({ status: "loading", napplets: [] }),
      catchError((error) => of<Results>({ status: "error", error: String(error?.message ?? error), napplets: [] })),
    );
}

function NappletTile({ napplet, select, update }: { napplet: Napplet; select: Select; update: Update }) {
  return (
    <div
      className="border border-base-300 rounded-lg p-4 flex flex-col gap-3 cursor-pointer hover:bg-base-200"
      onClick={() => select(napplet.pointer)}
    >
      <div className="flex gap-3">
        <NappletIconImage napplet={napplet} />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-lg truncate">{nappletName(napplet)}</h3>
          <div className="text-sm text-base-content/60 truncate">
            <AuthorName user={napplet.author} />
          </div>
        </div>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap">{napplet.description}</p>
      <div className="flex flex-wrap gap-1">
        <TagBadges values={napplet.archetypes} onClick={(archetype) => update({ archetype })} />
      </div>
      {napplet.requiredDomains.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="text-base-content/60">Requires</span>
          <TagBadges values={napplet.requiredDomains} onClick={(domain) => update({ domain })} />
        </div>
      )}
      <NappletCounts napplet={napplet} />
      <div className="mt-auto flex justify-end">
        <OpenInPaja napplet={napplet} />
      </div>
    </div>
  );
}

type Update = (changes: Partial<Filters>) => void;

/** Shows the signed-in user and the contacts-only toggle, or a sign in button */
function ContactsFilter(props: {
  account: User | null;
  contacts: string[] | undefined;
  contactsOnly: boolean;
  update: Update;
  login: () => void;
  logout: () => void;
}) {
  const { account, contacts, contactsOnly, update, login, logout } = props;

  if (!account)
    return (
      <button className="btn btn-outline" onClick={login}>
        Sign in to filter by contacts
      </button>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1">
          Signed in as <AuthorName user={account} />
        </span>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          Sign out
        </button>
      </div>
      <label className="label cursor-pointer justify-start gap-2">
        <input
          type="checkbox"
          className="checkbox"
          checked={contactsOnly}
          onChange={(e) => update({ contactsOnly: e.target.checked })}
        />
        <span>Only people I follow ({contacts?.length ?? "…"})</span>
      </label>
    </div>
  );
}

function FilterSidebar(props: {
  filters: Filters;
  query: string;
  setQuery: (query: string) => void;
  update: Update;
  known: { archetypes: string[]; domains: string[] };
  contacts: React.ComponentProps<typeof ContactsFilter>;
}) {
  const { filters, query, setQuery, update, known } = props;

  return (
    <aside className="w-80 shrink-0 border-r border-base-300 overflow-y-auto p-4 flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="font-bold">Relay</h2>
        <RelayPicker value={filters.relay} onChange={(relay) => update({ relay })} />
      </section>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update({ query: query.trim() });
        }}
      >
        <h2 className="font-bold">Search</h2>
        <div className="join">
          <input
            className="input input-bordered join-item flex-1"
            placeholder="NIP-50 search query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn join-item">Search</button>
        </div>
        <p className="text-sm text-base-content/60">Requires a relay that supports NIP-50</p>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">Author</h2>
        <PubkeyPicker value={filters.author} onChange={(author) => update({ author })} placeholder="Any author" />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">Contacts</h2>
        <ContactsFilter {...props.contacts} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">Archetype</h2>
        <input
          className="input input-bordered w-full"
          list="napplet-archetypes"
          placeholder="feed, profile, chat…"
          value={filters.archetype}
          onChange={(e) => update({ archetype: e.target.value.trim() })}
        />
        <datalist id="napplet-archetypes">
          {known.archetypes.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">Requires capability</h2>
        <input
          className="input input-bordered w-full"
          list="napplet-domains"
          placeholder="relay, storage, theme…"
          value={filters.domain}
          onChange={(e) => update({ domain: e.target.value.trim() })}
        />
        <datalist id="napplet-domains">
          {known.domains.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </section>

      <button
        className="btn btn-ghost"
        onClick={() => {
          setQuery("");
          update({ ...DEFAULT_FILTERS, relay: filters.relay });
        }}
      >
        Reset filters
      </button>
    </aside>
  );
}

function ResultsGrid(props: { results?: Results; query: string; select: Select; update: Update }) {
  const { results, query, select, update } = props;
  if (!results || (results.status === "loading" && results.napplets.length === 0))
    return <span className="loading loading-spinner loading-lg self-center my-12" />;
  if (results.status === "waiting") return <p className="text-center py-12 text-base-content/60">{results.message}</p>;
  if (results.status === "error")
    return (
      <p role="alert" className="text-center py-12 text-error">
        {results.error}
      </p>
    );
  if (results.napplets.length === 0)
    return (
      <p className="text-center py-12 text-base-content/60">
        No napplets match these filters.
        {query && " The relay may not index napplets for NIP-50 search, try another relay."}
      </p>
    );

  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
      {results.napplets.map((napplet) => (
        <NappletTile key={napplet.id} napplet={napplet} select={select} update={update} />
      ))}
    </div>
  );
}

// ---------- Napplet details ----------

/** Filters for every event that references a napplet: comments, reactions, zaps, shares, versions and derived snapshots */
function relatedFilters(napplet: Napplet): Filter[] {
  const filters = buildCommonEventRelationFilters(
    { kinds: [COMMENT_KIND, kinds.Reaction, kinds.Zap, kinds.Repost, kinds.GenericRepost] },
    napplet.event,
  );

  if (napplet.coordinate) {
    // NIP-22 root-scoped comments and every snapshot in this napplet's lineage
    filters.push({ kinds: [COMMENT_KIND], "#A": [napplet.coordinate] });
    filters.push({ kinds: [NAPPLET_SNAPSHOT_KIND], "#a": [napplet.coordinate] });
    filters.push({ kinds: [NAPPLET_SNAPSHOT_KIND], "#A": [napplet.coordinate] });
  } else {
    filters.push({ kinds: [COMMENT_KIND], "#E": [napplet.id] });

    // The other versions the parent's author pinned, for the snapshot's version history
    const parent = getNappletParentPointer(napplet.event);
    if (parent)
      filters.push({
        kinds: [NAPPLET_SNAPSHOT_KIND],
        authors: [parent.pubkey],
        "#a": [getReplaceableAddressFromPointer(parent)],
      });
  }

  // The author's other napplets
  filters.push({ kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND], authors: [napplet.event.pubkey] });
  return filters;
}

type RelatedStatus = { loading: boolean; relays: string[]; count: number; error?: string };

/** Loads related events from the selected relay and the author's outboxes */
function loadRelated(napplet: Napplet, relay: string): Observable<RelatedStatus> {
  return napplet.author.outboxes$.pipe(
    startWith(undefined),
    map((outboxes) => mergeRelaySets([relay], outboxes?.slice(0, 4))),
    distinctUntilChanged((a, b) => a.join() === b.join()),
    switchMap((relays) =>
      pool.request(relays, relatedFilters(napplet)).pipe(
        mapEventsToStore(eventStore),
        count(),
        map((count): RelatedStatus => ({ loading: false, relays, count })),
        startWith<RelatedStatus>({ loading: true, relays, count: 0 }),
        catchError((error) => of<RelatedStatus>({ loading: false, relays, count: 0, error: String(error) })),
      ),
    ),
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-base-300 pt-4 flex flex-col gap-2">
      <h2 className="font-bold text-lg">{title}</h2>
      {children}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 border-b border-base-300 last:border-0">
      <span className="text-base-content/60">{label}</span>
      <div className="min-w-0 flex flex-wrap gap-1 break-all">{children}</div>
    </div>
  );
}

/** A detail row of tag values that is hidden when the manifest has none */
function TagRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <DetailRow label={label}>
      <TagBadges values={values} />
    </DetailRow>
  );
}

/** A compact napplet reference used in lineage lists */
function NappletLink({ napplet, select }: { napplet: Napplet; select: Select }) {
  return (
    <button
      className="flex items-center gap-3 border border-base-300 rounded-lg p-2 text-left hover:bg-base-200"
      onClick={() => select(napplet.pointer)}
    >
      <NappletIconImage napplet={napplet} size="w-10 h-10" />
      <div className="min-w-0">
        <div className="font-medium truncate">
          {nappletName(napplet)}
          <span className="text-base-content/60">{snapshotLabel(napplet)}</span>
        </div>
        <div className="text-sm text-base-content/60 truncate">
          <AuthorName user={napplet.author} /> · {napplet.createdAt.toLocaleDateString()}
        </div>
      </div>
    </button>
  );
}

/** Resolves a lineage pointer, showing the address until the referenced napplet loads */
function LineageLink({
  label,
  napplet,
  pointer,
  select,
}: {
  label: string;
  napplet?: Napplet;
  pointer?: AddressPointer;
  select: Select;
}) {
  if (!pointer) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-base-content/60">{label}</span>
      {napplet ? (
        <NappletLink napplet={napplet} select={select} />
      ) : (
        <code className="text-sm break-all">
          {pointer.kind}:{pointer.pubkey}:{pointer.identifier} (not found)
        </code>
      )}
    </div>
  );
}

/** Narrows a napplet to the root or named cast that snapshots derive from */
function addressable(napplet: Napplet): RootNapplet | NamedNapplet | undefined {
  if (napplet.isNamed) return castEvent(napplet.event, NamedNapplet, eventStore);
  if (napplet.isRoot) return castEvent(napplet.event, RootNapplet, eventStore);
}

function VersionRow(props: { version: Napplet; label: string; viewing: boolean; select: Select }) {
  const { version, label, viewing, select } = props;
  return (
    <button
      className={`flex items-center gap-3 border rounded-lg p-2 text-left hover:bg-base-200 ${viewing ? "border-primary" : "border-base-300"}`}
      onClick={() => select(version.pointer)}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {label}
          {viewing && <span className="text-base-content/60"> · Viewing</span>}
        </div>
        <div className="text-sm text-base-content/60 font-mono truncate">{version.artifactHash}</div>
      </div>
      <span className="text-sm text-base-content/60 shrink-0">{version.createdAt.toLocaleString()}</span>
    </button>
  );
}

/** Lists the live manifest and the snapshots its author pinned from it, newest first */
function VersionHistory({
  napplet,
  viewing,
  select,
}: {
  napplet: RootNapplet | NamedNapplet;
  viewing: Napplet;
  select: Select;
}) {
  const snapshots = use$(napplet.snapshots$);
  // Snapshots by other authors are derivations, not versions
  const versions = snapshots?.filter((s) => s.event.pubkey === napplet.event.pubkey);

  return (
    <div className="flex flex-col gap-2">
      <VersionRow version={napplet} label="Latest" viewing={viewing.id === napplet.id} select={select} />
      {versions?.map((version) => (
        <VersionRow
          key={version.id}
          version={version}
          label={version.artifactHash === napplet.artifactHash ? "Snapshot of latest" : "Snapshot"}
          viewing={viewing.id === version.id}
          select={select}
        />
      ))}
      {versions?.length === 0 && <p className="text-base-content/60">The author has not pinned any snapshots yet.</p>}
    </div>
  );
}

/** Shows the version history of the napplet a snapshot was pinned from */
function SnapshotVersionHistory({ snapshot, select }: { snapshot: NappletSnapshot; select: Select }) {
  const parent = use$(snapshot.parent$);

  // Only a snapshot of the author's own napplet is a version of it, others are derivations
  if (snapshot.parentPointer?.pubkey !== snapshot.event.pubkey)
    return <p className="text-base-content/60">This snapshot is not a version of one of its author's napplets.</p>;
  const napplet = parent && addressable(parent);
  if (!napplet) return <p className="text-base-content/60">Loading the napplet this snapshot was pinned from…</p>;

  return <VersionHistory napplet={napplet} viewing={snapshot} select={select} />;
}

function SnapshotLineage({ napplet, select }: { napplet: NappletSnapshot; select: Select }) {
  const parent = use$(napplet.parent$);
  const root = use$(napplet.root$);

  if (!napplet.parentPointer && !napplet.rootPointer)
    return <p className="text-base-content/60">This snapshot does not record its lineage.</p>;

  return (
    <div className="flex flex-col gap-3">
      <LineageLink label="Derived from" napplet={parent} pointer={napplet.parentPointer} select={select} />
      {/* Skip the root when the snapshot derives from it directly */}
      {napplet.rootPointer && parent?.coordinate !== root?.coordinate && (
        <LineageLink label="Lineage root" napplet={root} pointer={napplet.rootPointer} select={select} />
      )}
      <p className="text-sm text-base-content/60">
        Lineage is provenance only, the snapshot is verified against its own artifact hash.
      </p>
    </div>
  );
}

function NappletLineage({ napplet, select }: { napplet: RootNapplet | NamedNapplet; select: Select }) {
  const snapshots = use$(napplet.snapshots$);
  const lineage = use$(napplet.lineage$);
  // The author's own snapshots are listed in the version history
  const derived = snapshots?.filter((s) => s.event.pubkey !== napplet.event.pubkey);
  const indirect = lineage?.filter((s) => !snapshots?.some((d) => d.id === s.id));

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base-content/60">Snapshots derived directly by other authors ({derived?.length ?? 0})</span>
      {derived?.map((snapshot) => (
        <NappletLink key={snapshot.id} napplet={snapshot} select={select} />
      ))}
      {indirect && indirect.length > 0 && (
        <>
          <span className="text-base-content/60">Other snapshots in this lineage ({indirect.length})</span>
          {indirect.map((snapshot) => (
            <NappletLink key={snapshot.id} napplet={snapshot} select={select} />
          ))}
        </>
      )}
    </div>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <div className="border-l-2 border-base-300 pl-3">
      <div className="text-sm text-base-content/60">
        <AuthorName user={comment.author} /> · {comment.createdAt.toLocaleString()}
      </div>
      <p className="whitespace-pre-wrap">{comment.event.content}</p>
    </div>
  );
}

/** Shows a reaction with the reacting user's avatar */
function ReactionItem({ reaction }: { reaction: Reaction }) {
  const profile = use$(reaction.author.profile$);
  const emoji = reaction.emoji;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-base-300 py-0.5 pl-0.5 pr-2"
      title={profile?.displayName || reaction.author.npub}
    >
      <img
        className="w-6 h-6 rounded-full"
        src={profile?.picture || `https://robohash.org/${reaction.author.pubkey}.png`}
        alt=""
      />
      {emoji ? <img className="w-5 h-5" src={emoji.url} alt={`:${emoji.shortcode}:`} /> : reaction.content}
    </span>
  );
}

function Activity({ napplet }: { napplet: Napplet }) {
  const comments = use$(napplet.comments$);
  const reactions = use$(napplet.reactions$);
  const zaps = use$(napplet.zaps$);
  const shares = use$(napplet.shares$);

  use$(() => zapLoader(napplet.event), [napplet.id]);

  const sats = Math.round((zaps?.reduce((sum, zap) => sum + zap.amount, 0) ?? 0) / 1000);

  return (
    <>
      <Section title="Activity">
        <div className="flex flex-wrap gap-4">
          <span>{reactions?.length ?? 0} reactions</span>
          <span>
            {zaps?.length ?? 0} zaps ({sats} sats)
          </span>
          <span>{shares?.length ?? 0} shares</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {reactions?.map((reaction) => (
            <ReactionItem key={reaction.id} reaction={reaction} />
          ))}
        </div>
      </Section>

      <Section title={`Comments (${comments?.length ?? 0})`}>
        {comments?.length === 0 && <p className="text-base-content/60">No comments yet.</p>}
        {comments?.map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </Section>
    </>
  );
}

function MoreFromAuthor({ napplet, select }: { napplet: Napplet; select: Select }) {
  const napplets = use$(napplet.author.napplets$);
  const others = napplets?.filter((n) => n.id !== napplet.id);
  if (!others || others.length === 0) return null;

  return (
    <Section
      title={
        <>
          More from <AuthorName user={napplet.author} />
        </>
      }
    >
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
        {others.map((other) => (
          <NappletLink key={other.id} napplet={other} select={select} />
        ))}
      </div>
    </Section>
  );
}

function NappletDetails({ napplet, relay, select }: { napplet: Napplet; relay: string; select: Select }) {
  const related = use$(() => loadRelated(napplet, relay), [napplet.id, relay]);
  const address = use$(napplet.address$);
  const server = napplet.servers[0];

  return (
    <div className="max-w-4xl w-full mx-auto py-6 px-4 flex flex-col gap-4">
      <button className="btn btn-ghost self-start" onClick={() => select(null)}>
        ← Back to store
      </button>

      <div className="flex items-start gap-4">
        <NappletIconImage napplet={napplet} size="w-24 h-24" />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <h1 className="text-3xl font-bold">{nappletName(napplet)}</h1>
          <div className="text-base-content/60">
            by <AuthorName user={napplet.author} />
            {snapshotLabel(napplet)} · {napplet.createdAt.toLocaleString()}
          </div>
          <NappletCounts napplet={napplet} />
          <div className="flex flex-wrap gap-2 mt-2">
            <OpenInPaja napplet={napplet} className="" />
            {napplet.source && (
              <a className="btn btn-outline" href={napplet.source} target="_blank" rel="noreferrer">
                View source
              </a>
            )}
          </div>
        </div>
      </div>

      <p className="whitespace-pre-wrap">{napplet.description}</p>

      <div className="text-sm text-base-content/60">
        {related?.loading
          ? `Loading related events from ${related.relays.length} relays…`
          : related?.error
            ? `Failed to load related events: ${related.error}`
            : `Loaded ${related?.count ?? 0} related events from ${related?.relays.length ?? 0} relays`}
      </div>

      <Section title="Details">
        <div className="flex flex-col">
          {napplet.isNamed && (
            <DetailRow label="Identifier">
              <code>{getNappletIdentifier(napplet.event)}</code>
            </DetailRow>
          )}
          <DetailRow label="Address">
            <code>{address ?? napplet.address}</code>
          </DetailRow>
          <DetailRow label="Artifact hash">
            {server ? (
              <a
                className="link font-mono"
                href={new URL(napplet.artifactHash, normalizeBlossomServer(server)).href}
                target="_blank"
                rel="noreferrer"
              >
                {napplet.artifactHash}
              </a>
            ) : (
              <code>{napplet.artifactHash}</code>
            )}
          </DetailRow>
          {napplet.source && (
            <DetailRow label="Source">
              <a className="link" href={napplet.source} target="_blank" rel="noreferrer">
                {napplet.source}
              </a>
            </DetailRow>
          )}
          <TagRow label="Blossom servers" values={napplet.servers} />
          <TagRow label="Archetypes" values={napplet.archetypes} />
          <TagRow label="Intents" values={napplet.intents.map((i) => [i.intent, ...i.params].join(" "))} />
          <TagRow label="Requires" values={napplet.requiredDomains} />
          <TagRow label="Optional" values={napplet.optionalDomains} />
        </div>
      </Section>

      {/* Narrow to the per-kind cast for the version and lineage relationships */}
      <Section title="Version history">
        {napplet.isSnapshot ? (
          <SnapshotVersionHistory snapshot={castEvent(napplet.event, NappletSnapshot, eventStore)} select={select} />
        ) : (
          <VersionHistory napplet={addressable(napplet)!} viewing={napplet} select={select} />
        )}
      </Section>

      <Section title="Lineage">
        {napplet.isSnapshot ? (
          <SnapshotLineage napplet={castEvent(napplet.event, NappletSnapshot, eventStore)} select={select} />
        ) : (
          <NappletLineage napplet={addressable(napplet)!} select={select} />
        )}
      </Section>

      <Activity napplet={napplet} />
      <MoreFromAuthor napplet={napplet} select={select} />

      <Section title="Manifest event">
        <details>
          <summary className="cursor-pointer">Show raw event</summary>
          <JsonBlock value={napplet.event as NostrEvent} />
        </details>
      </Section>
    </div>
  );
}

/** Resolves the selected pointer from the store so the details follow new revisions */
function SelectedNapplet(props: { pointer: AddressPointer | EventPointer; relay: string; select: Select }) {
  const { pointer, relay, select } = props;
  const napplet = use$(() => eventStore.event(pointer).pipe(castEventStream(Napplet, eventStore)), [pointer]);

  if (!napplet) return <span className="loading loading-spinner loading-lg self-center my-12" />;
  return <NappletDetails napplet={napplet} relay={relay} select={select} />;
}

// ---------- App ----------

export default function NappletStore() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AddressPointer | EventPointer | null>(null);
  const [login, setLogin] = useState(false);
  const [account, setAccount] = useState<User | null>(null);

  const update: Update = (changes) => setFilters((filters) => ({ ...filters, ...changes }));
  const select: Select = (pointer) => setSelected(pointer);

  // The signed-in user's contact pubkeys, loaded from their outboxes
  const contacts = use$(
    () => (account ? account.contacts$.pipe(map((users) => users.map((u) => u.pubkey))) : of(undefined)),
    [account],
  );

  // Re-run the relay query whenever the filters or contacts change
  const results = use$((): Observable<Results> => {
    if (filters.contactsOnly && !contacts?.length)
      return of({ status: "waiting", message: "Waiting for your contact list…", napplets: [] });

    const filter = buildFilter(filters, contacts);
    if (!filter) return of({ status: "ready", napplets: [] });
    return searchNapplets(filters.relay, filter);
  }, [filters, contacts]);

  // Suggest archetypes and capabilities from the current results
  const known = useMemo(
    () => ({
      archetypes: [...new Set(results?.napplets.flatMap((n) => n.archetypes))].sort(),
      domains: [...new Set(results?.napplets.flatMap((n) => n.requiredDomains))].sort(),
    }),
    [results],
  );

  if (login)
    return (
      <LoginView
        onLogin={(_signer, pubkey) => {
          setLogin(false);
          setAccount(castUser(pubkey, eventStore));
        }}
      />
    );

  return (
    <div className="flex min-h-0 grow overflow-hidden">
      {/* Keep the listing mounted so results and scroll position survive opening a napplet */}
      <div className={selected ? "hidden" : "flex min-h-0 grow overflow-hidden"}>
        <FilterSidebar
          filters={filters}
          query={query}
          setQuery={setQuery}
          update={update}
          known={known}
          contacts={{
            account,
            contacts,
            contactsOnly: filters.contactsOnly,
            update,
            login: () => setLogin(true),
            logout: () => {
              setAccount(null);
              update({ contactsOnly: false });
            },
          }}
        />
        <main className="min-h-0 flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold flex-1">Napplet Store</h1>
            {results?.status === "loading" && <span className="loading loading-spinner" />}
            <span className="text-base-content/60">{results?.napplets.length ?? 0} napplets</span>
          </div>
          <ResultsGrid results={results} query={filters.query} select={select} update={update} />
        </main>
      </div>

      {selected && (
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col">
          <SelectedNapplet pointer={selected} relay={filters.relay} select={select} />
        </div>
      )}
    </div>
  );
}
