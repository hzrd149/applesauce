/**
 * Sync a photographer's notes and every reply, reaction and zap around them with NIP-77 from their outboxes and inboxes, then browse the images as a sortable photo grid
 * @tags nip-65, nip-77, nip-57, nip-25, nip-68, sync, negentropy, gallery
 * @related loader/sync-loader, zap/dashboard, outbox/contacts-sync
 */
import { castUser, type User, Zap } from "applesauce-common/casts";
import {
  COMMENT_KIND,
  type FileMetadataFields,
  getCommentReplyPointer,
  getMediaAttachments,
  getNip10References,
  getPicturePostAttachments,
  getProfilePointersFromList,
  getReactionEventPointer,
  PICTURE_POST_KIND,
} from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore, includeMailboxes } from "applesauce-core";
import {
  decodeAddressPointer,
  getDisplayName,
  getOrComputeCachedValue,
  getProfilePicture,
  isImageURL,
  kinds,
  type NostrEvent,
  normalizeToPubkey,
  relaySet,
  selectOptimalRelays,
  Tokens,
  unixNow,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  auditTime,
  combineLatest,
  defer,
  filter,
  map,
  type Observable,
  of,
  shareReplay,
  take,
  throttleTime,
  timeout,
} from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

// Loads profiles, relay lists and contact lists on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

// Zap receipts and public reactions often land on popular relays instead of the author's inboxes
const EXTRA_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

// A NIP-51 follow set of animators, photographers and artists to pick from
const ARTISTS = decodeAddressPointer(
  "naddr1qvzqqqr4xqpzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qg3waehxw309ahx7um5wgh8w6twv5hsqz2pde5k6ct5dae8xgvwe7q",
)!;

// Artists shown before the follow set, the first one is selected by default
const PINNED = (
  [
    "npub17amtesfzwxl8nlr3ke2l8jl7kw52z60n8msnxh7vps3g9xgpmf9qx5nldk",
    "npub1dergggklka99wwrs92yz8wdjs952h2ux2ha2ed598ngwu9w7a6fsh9xzpc",
    "npub1e49nhp86q24g66jp9wahzmerv79dum8y4dpv4dt0snvjwlkynf4qnzsm0m",
  ] as const
).map((npub) => normalizeToPubkey(npub));

/** The pinned artists followed by the people in the follow set, loaded from the relay hints in the naddr */
const artists$ = eventStore.addressable(ARTISTS).pipe(
  map((list) => {
    const members = list ? getProfilePointersFromList(list, "public").map((p) => p.pubkey) : [];
    return [...new Set([...PINNED, ...members])];
  }),
);

const DAY = 86400;
const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "All time", days: 0 },
];

type Audience = "public" | "contacts" | "custom";
type Metric = "sats" | "likes" | "replies";
type Sort = "recent" | Metric | "random";
type Stats = { sats: number; zaps: number; likes: number; dislikes: number; replies: number };
type Photo = { key: string; url: string; note: NostrEvent; meta?: FileMetadataFields };
type Progress = SyncLoaderStatus & { ms: number };

const EMPTY: Stats = { sats: 0, zaps: 0, likes: 0, dislikes: 0, replies: 0 };
const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "sats", label: "Most zapped" },
  { value: "likes", label: "Most liked" },
  { value: "replies", label: "Most commented" },
  { value: "random", label: "Random" },
];

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** Adds the elapsed time since the run started to every status so the sync speed is visible */
const timed = (status$: Observable<SyncLoaderStatus>): Observable<Progress> =>
  defer(() => {
    const start = performance.now();
    return status$.pipe(map((status) => ({ ...status, ms: performance.now() - start })));
  });

/** The author's outboxes, falling back to popular relays when they have no relay list */
const outboxRelays$ = (user: User) =>
  user.outboxes$.pipe(defined(), timeout({ first: 5_000, with: () => of(EXTRA_RELAYS) }));

/** Syncs the author's notes and picture posts in the range from their outboxes */
function syncNotes$(user: User, since?: number): Observable<Progress> {
  // A relay list observable lets the loader follow the user's outboxes if they change
  return timed(
    syncLoader({
      relays: outboxRelays$(user),
      filter: { kinds: [kinds.ShortTextNote, PICTURE_POST_KIND], authors: [user.pubkey], since },
    }).status$,
  );
}

/** The authors whose engagement is counted, null counts everyone */
function audienceAuthors$(user: User, audience: Audience, custom: string[]): Observable<string[] | null> {
  if (audience === "public") return of(null);
  if (audience === "custom") return of(custom);
  return user.contacts$.pipe(
    filter((users) => users.length > 0),
    take(1),
    timeout({ first: 10_000, with: () => of([]) }),
    map((users) => users.map((u) => u.pubkey)),
  );
}

/** The fewest outbox relays that cover a set of authors, re-picked as their relay lists load */
function authorOutboxes$(authors: string[]): Observable<string[]> {
  if (authors.length === 0) return of([]);
  return of(authors.map((pubkey) => ({ pubkey }))).pipe(
    includeMailboxes(eventStore),
    // Relay lists stream in one by one, re-pick the relays at most once a second
    throttleTime(1000, undefined, { leading: true, trailing: true }),
    map((users) => selectOptimalRelays(users, { maxConnections: 20, maxRelaysPerUser: 2 })),
    map((users) => relaySet(...users.map((u) => u.relays))),
  );
}

/** Popular relays to start with, growing to the author's mailboxes and the audience's outboxes as they load */
function engagementRelays$(user: User, authors: string[] | null): Observable<string[]> {
  return combineLatest([user.inboxes$, user.outboxes$, authors ? authorOutboxes$(authors) : of([])]).pipe(
    map(([inboxes, outboxes, theirs]) => relaySet(EXTRA_RELAYS, inboxes, outboxes, theirs)),
    // Both engagement runs follow the same relay list
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}

/** Syncs every reply, reaction and zap that tags the author since the start of the range */
function syncEngagement$(user: User, since: number | undefined, authors: string[] | null) {
  // The loader starts relays as they are added to the list and stops the ones that are removed
  const relays = engagementRelays$(user, authors);
  // No until, engagement arrives after the note. "#p" avoids sending thousands of event ids
  const base = { "#p": [user.pubkey], since };
  const replies = { ...base, kinds: [kinds.ShortTextNote, COMMENT_KIND, kinds.Reaction] };
  // Zap receipts are signed by the LNURL server, the uppercase P tag is the sender
  const zaps = { ...base, kinds: [kinds.Zap] };

  return combineLatest([
    timed(syncLoader({ relays, filter: authors ? { ...replies, authors } : replies }).status$),
    timed(syncLoader({ relays, filter: authors ? { ...zaps, "#P": authors } : zaps }).status$),
  ]);
}

// ---------------------------------------------------------------------------
// Photos and stats
// ---------------------------------------------------------------------------

const PhotosSymbol = Symbol("photo-gallery-photos");

/** Gets the images from imeta tags and image links in the content */
function getPhotos(note: NostrEvent): Photo[] {
  return getOrComputeCachedValue(note, PhotosSymbol, () => {
    const attachments = note.kind === PICTURE_POST_KIND ? getPicturePostAttachments(note) : getMediaAttachments(note);
    const images = new Map<string, FileMetadataFields | undefined>();
    for (const meta of attachments)
      if (meta.url && (meta.type?.startsWith("image/") || isImageURL(meta.url))) images.set(meta.url, meta);

    if (note.kind === kinds.ShortTextNote)
      for (const [url] of note.content.matchAll(Tokens.link))
        if (!images.has(url) && isImageURL(url)) images.set(url, undefined);

    return [...images].map(([url, meta]) => ({ key: `${note.id}:${url}`, url, note, meta }));
  });
}

/** Every photo in the author's notes in the range, newest first */
function photos$(pubkey: string, since?: number): Observable<Photo[]> {
  return eventStore.timeline({ kinds: [kinds.ShortTextNote, PICTURE_POST_KIND], authors: [pubkey], since }).pipe(
    auditTime(250),
    map((notes) => notes.flatMap(getPhotos)),
  );
}

/** Totals the replies, reactions and zaps in the store for each of the author's events */
function stats$(pubkey: string, since: number | undefined, authors: string[] | null): Observable<Map<string, Stats>> {
  const filter = { "#p": [pubkey], since };
  // Filter again locally since the store may still hold events from a previous public sync
  const allowed = authors ? new Set(authors) : null;
  const allow = (pubkey: string) => !allowed || allowed.has(pubkey);

  return combineLatest([
    eventStore.timeline({ ...filter, kinds: [kinds.ShortTextNote, COMMENT_KIND, kinds.Reaction] }),
    eventStore.timeline({ ...filter, kinds: [kinds.Zap] }).pipe(castTimelineStream(Zap, eventStore)),
  ]).pipe(
    auditTime(250),
    map(([events, zaps]) => {
      const stats = new Map<string, Stats>();
      const get = (id: string) => stats.get(id) ?? stats.set(id, { ...EMPTY }).get(id)!;

      for (const event of events) {
        if (!allow(event.pubkey)) continue;
        if (event.kind === kinds.Reaction) {
          const id = getReactionEventPointer(event)?.id;
          if (id) get(id)[event.content === "-" ? "dislikes" : "likes"]++;
        } else if (event.kind === COMMENT_KIND) {
          const parent = getCommentReplyPointer(event);
          if (parent?.type === "event") get(parent.id).replies++;
        } else {
          // Only count direct replies, not every reply in the thread
          const id = getNip10References(event).reply?.e?.id;
          if (id) get(id).replies++;
        }
      }

      for (const zap of zaps) {
        const id = zap.eventPointer?.id;
        if (!id || !allow(zap.sender.pubkey)) continue;
        const s = get(id);
        s.zaps++;
        s.sats += Math.floor(zap.amount / 1000);
      }

      return stats;
    }),
  );
}

/** A stable pseudo-random rank so the random order doesn't reshuffle while events stream in */
function rank(seed: number, key: string) {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Filters and orders the photos by the selected metric */
function arrange(photos: Photo[], stats: Map<string, Stats>, sort: Sort, metric: Metric, min: number, seed: number) {
  const of = (photo: Photo) => stats.get(photo.note.id) ?? EMPTY;
  const list = photos.filter((photo) => of(photo)[metric] >= min);

  if (sort === "random") return list.sort((a, b) => rank(seed, a.key) - rank(seed, b.key));
  if (sort === "recent") return list;
  return list.sort((a, b) => of(b)[sort] - of(a)[sort] || b.note.created_at - a.note.created_at);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const numberFormat = new Intl.NumberFormat();
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact" });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const contentCache = Symbol("photo-gallery-content");
const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a href={node.href} target="_blank" className="link link-primary break-all">
      {node.value}
    </a>
  ),
  mention: ({ node }) => <span className="text-primary">nostr:{node.encoded.slice(0, 16)}…</span>,
  hashtag: ({ node }) => <span className="text-primary">#{node.name}</span>,
  emoji: ({ node }) => <img src={node.url} alt={node.raw} title={node.raw} className="inline-block h-5 w-5" />,
  gallery: () => null,
};

/** Saves the image as a file, hosts that block CORS fall back to opening the image in a new tab */
async function download(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const href = URL.createObjectURL(await res.blob());
    const name = new URL(url).pathname.split("/").pop() || "photo";
    Object.assign(document.createElement("a"), { href, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch {
    window.open(url, "_blank");
  }
}

function NoteContent({ note }: { note: NostrEvent }) {
  const content = useRenderedContent(note, components, { cacheKey: contentCache });
  return <div className="whitespace-pre-wrap break-words">{content}</div>;
}

function Avatar({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}`)}
      className="size-8 rounded-full bg-base-200 shrink-0"
    />
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span>{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>;
}

function StatsRow({ stats }: { stats: Stats }) {
  return (
    <div className="flex gap-3">
      <span className="text-warning" title={`${stats.zaps} zaps`}>
        ⚡{compactFormat.format(stats.sats)}
      </span>
      <span title="Replies">💬 {stats.replies}</span>
      <span title="Likes">👍 {stats.likes}</span>
      {stats.dislikes ? <span title="Dislikes">👎 {stats.dislikes}</span> : null}
    </div>
  );
}

/** A labelled group of header controls */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-base-content/60">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

type Run = { label: string; progress?: Progress };

function SyncButton({ runs, onClick }: { runs: Run[]; onClick: () => void }) {
  const done = runs.every((run) => run.progress?.done);
  const loaded = runs.reduce((sum, run) => sum + (run.progress?.loaded ?? 0), 0);
  return (
    <button className="btn btn-sm btn-ghost" onClick={onClick} title="Show sync progress">
      {done ? <span className="text-success">✓</span> : <span className="loading loading-spinner loading-sm" />}
      {numberFormat.format(loaded)} events
    </button>
  );
}

/** The relay's NIP-11 icon and name, with the url as a tooltip */
function RelayLabel({ url }: { url: string }) {
  const relay = pool.relay(url);
  const icon = use$(relay.icon$);
  const name = use$(relay.name$);
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex flex-1 min-w-0 items-center gap-2" title={url}>
      {icon && !failed ? (
        <img src={icon} className="size-5 rounded bg-base-300 shrink-0" onError={() => setFailed(true)} />
      ) : (
        <span className="size-5 rounded bg-base-300 shrink-0" />
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}

function SyncSection({ label, progress }: Run) {
  if (!progress || (!progress.done && Object.keys(progress.relays).length === 0))
    return (
      <section className="flex items-center gap-2">
        <span className="loading loading-spinner loading-sm" />
        <span className="font-semibold">{label}</span> looking up relays…
      </section>
    );

  const relays = Object.values(progress.relays);
  const finished = relays.filter((r) => r.state === "complete" || r.state === "error").length;
  const negentropy = relays.filter((r) => r.method === "negentropy").length;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {progress.done ? (
          <span className="text-success">✓</span>
        ) : (
          <span className="loading loading-spinner loading-sm" />
        )}
        <span className="font-semibold">{label}</span>
        <span className="text-base-content/60">
          {finished}/{relays.length} relays · {negentropy} negentropy · {numberFormat.format(progress.loaded)} events in{" "}
          {(progress.ms / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="border border-base-300 rounded-box divide-y divide-base-300">
        {relays.map((r) => (
          <div key={r.relay} className="flex items-center gap-3 px-3 py-1">
            <RelayLabel url={r.relay} />
            <span className="w-24" title={r.fallbackReason?.message}>
              {r.method ?? "—"}
              {r.fallbackReason && " (fallback)"}
            </span>
            <span className={`w-20 ${r.state === "error" ? "text-error" : ""}`} title={r.error?.message}>
              {r.state}
            </span>
            <span className="w-16 text-right">{numberFormat.format(r.count)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SyncModal({ runs, summary, onClose }: { runs: Run[]; summary: ReactNode; onClose: () => void }) {
  return (
    <dialog
      className="modal"
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      onClose={onClose}
    >
      <div className="modal-box max-w-3xl border border-base-300 space-y-4">
        <h3 className="text-lg font-semibold">Sync progress</h3>
        <div className="text-base-content/60">{summary}</div>
        {runs.map((run) => (
          <SyncSection key={run.label} {...run} />
        ))}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function Tile({ photo, stats, onOpen }: { photo: Photo; stats: Stats; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      className="group relative aspect-square overflow-hidden border border-base-300 bg-base-200"
      onClick={onOpen}
    >
      {failed ? (
        <span className="text-base-content/60">Image unavailable</span>
      ) : (
        <img
          src={photo.url}
          alt={photo.meta?.alt}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-base-100/80 border-t border-base-300 text-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <StatsRow stats={stats} />
      </div>
    </button>
  );
}

const GAP = 8;
const TILE_WIDTH = 240;

/** Renders only the rows of tiles near the viewport so thousands of photos stay smooth */
function PhotoGrid({
  photos,
  statsOf,
  onOpen,
}: {
  photos: Photo[];
  statsOf: (p: Photo) => Stats;
  onOpen: (key: string) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Track the grid width to pick the number of columns
  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    setScroller(el);
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(2, Math.round(width / TILE_WIDTH));
  const rowHeight = (width - GAP * (columns - 1)) / columns + GAP;
  const virtualizer = useVirtualizer({
    count: Math.ceil(photos.length / columns),
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0 grid"
            style={{
              gap: GAP,
              paddingBottom: GAP,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              transform: `translateY(${row.start}px)`,
            }}
          >
            {photos.slice(row.index * columns, (row.index + 1) * columns).map((photo) => (
              <Tile key={photo.key} photo={photo} stats={statsOf(photo)} onOpen={() => onOpen(photo.key)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Lightbox({
  photo,
  stats,
  onClose,
  onPrev,
  onNext,
}: {
  photo: Photo;
  stats: Stats;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <dialog
      className="modal"
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onPrev?.();
        if (e.key === "ArrowRight") onNext?.();
      }}
    >
      <div className="modal-box max-w-6xl w-full p-0 border border-base-300 grid md:grid-cols-[1fr_20rem]">
        <div className="relative bg-black flex items-center justify-center min-h-64">
          <img src={photo.url} alt={photo.meta?.alt} className="max-h-[80vh] object-contain" />
          <button className="btn btn-circle btn-sm absolute left-2" disabled={!onPrev} onClick={onPrev}>
            ‹
          </button>
          <button className="btn btn-circle btn-sm absolute right-2" disabled={!onNext} onClick={onNext}>
            ›
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto max-h-[80vh]">
          <div className="text-base-content/60">{dateFormat.format(photo.note.created_at * 1000)}</div>
          <StatsRow stats={stats} />
          <div className="text-base-content/60">
            {stats.zaps} zaps · {numberFormat.format(stats.sats)} sats
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => download(photo.url)}>
              Download
            </button>
            <a className="btn btn-sm btn-ghost" href={photo.url} target="_blank">
              Open original
            </a>
          </div>
          <NoteContent note={photo.note} />
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function Gallery({ user }: { user: User }) {
  const [days, setDays] = useState(90);
  const [audience, setAudience] = useState<Audience>("public");
  const [draft, setDraft] = useState("");
  const [custom, setCustom] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("recent");
  const [metric, setMetric] = useState<Metric>("sats");
  const [min, setMin] = useState(0);
  const [seed, setSeed] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [showSync, setShowSync] = useState(false);

  const since = useMemo(() => (days ? unixNow() - days * DAY : undefined), [days]);

  // undefined while the audience loads, null when counting everyone
  const authors = use$(() => audienceAuthors$(user, audience, custom), [user.pubkey, audience, custom]);

  // The syncs write into the store while the gallery renders purely from store queries
  const notes = use$(() => syncNotes$(user, since), [user.pubkey, since]);
  const engagement = use$(
    () => (authors === undefined ? of(undefined) : syncEngagement$(user, since, authors)),
    [user.pubkey, since, authors],
  );

  const photos = use$(() => photos$(user.pubkey, since), [user.pubkey, since]);
  const stats = use$(
    () => (authors === undefined ? of(new Map<string, Stats>()) : stats$(user.pubkey, since, authors)),
    [user.pubkey, since, authors],
  );

  const arranged = useMemo(
    () => arrange(photos ?? [], stats ?? new Map(), sort, metric, min, seed),
    [photos, stats, sort, metric, min, seed],
  );

  const index = arranged.findIndex((p) => p.key === selected);
  const statsOf = (photo: Photo) => stats?.get(photo.note.id) ?? EMPTY;
  const runs: Run[] = [
    { label: "Notes", progress: notes },
    { label: "Replies & reactions", progress: engagement?.[0] },
    { label: "Zaps", progress: engagement?.[1] },
  ];

  return (
    <div className="flex flex-col min-h-0 grow">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 p-3 border-b border-base-300">
        <Field label="Range">
          <select className="select select-sm w-32" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Engagement from">
          <div className="join">
            {(["public", "contacts", "custom"] as const).map((a) => (
              <button
                key={a}
                className={`btn btn-sm join-item ${audience === a ? "btn-active" : ""}`}
                onClick={() => setAudience(a)}
              >
                {a === "public" ? "Everyone" : a === "contacts" ? "Contacts" : "Custom"}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Sort">
          <select className="select select-sm w-40" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {sort === "random" ? (
            <button className="btn btn-sm" onClick={() => setSeed(seed + 1)}>
              Shuffle
            </button>
          ) : null}
        </Field>

        <Field label="Minimum">
          <div className="join">
            <select
              className="select select-sm join-item w-28"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              <option value="sats">Sats</option>
              <option value="likes">Likes</option>
              <option value="replies">Replies</option>
            </select>
            <input
              type="number"
              min={0}
              className="input input-sm join-item w-24"
              value={min}
              onChange={(e) => setMin(Math.max(0, Number(e.target.value)))}
            />
          </div>
        </Field>

        <div className="ms-auto flex items-center gap-2">
          <span className="text-base-content/60">
            {numberFormat.format(arranged.length)} of {numberFormat.format(photos?.length ?? 0)} photos
          </span>
          <SyncButton runs={runs} onClick={() => setShowSync(true)} />
        </div>
      </div>

      {audience === "custom" ? (
        <form
          className="flex gap-2 p-3 border-b border-base-300"
          onSubmit={(e) => {
            e.preventDefault();
            setCustom(
              draft
                .split(/[\s,]+/)
                .map((s) => normalizeToPubkey(s))
                .filter((p): p is string => !!p),
            );
          }}
        >
          <textarea
            className="textarea textarea-sm flex-1"
            rows={2}
            placeholder="npubs or hex pubkeys separated by spaces or new lines"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn-sm btn-primary self-end">Apply ({custom.length})</button>
        </form>
      ) : null}

      {!photos || (photos.length === 0 && !notes?.done) ? (
        <div className="p-6">
          <span className="loading loading-dots" />
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center text-base-content/60 py-12">No images found in this range</div>
      ) : arranged.length === 0 ? (
        <div className="text-center text-base-content/60 py-12">No photos match the filter</div>
      ) : (
        <PhotoGrid photos={arranged} statsOf={statsOf} onOpen={setSelected} />
      )}

      {showSync ? (
        <SyncModal
          runs={runs}
          onClose={() => setShowSync(false)}
          summary={
            <>
              {numberFormat.format(photos?.length ?? 0)} photos · engagement from{" "}
              {authors ? `${numberFormat.format(authors.length)} people` : "everyone"}
            </>
          }
        />
      ) : null}

      {index >= 0 ? (
        <Lightbox
          photo={arranged[index]}
          stats={statsOf(arranged[index])}
          onClose={() => setSelected(undefined)}
          onPrev={index > 0 ? () => setSelected(arranged[index - 1].key) : undefined}
          onNext={index < arranged.length - 1 ? () => setSelected(arranged[index + 1].key) : undefined}
        />
      ) : null}
    </div>
  );
}

function ArtistButton({ pubkey, active, onClick }: { pubkey: string; active: boolean; onClick: () => void }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  return (
    <button
      className={`flex flex-col items-center gap-1 w-20 shrink-0 p-1 rounded-box border ${active ? "border-primary" : "border-transparent hover:border-base-300"}`}
      onClick={onClick}
    >
      <Avatar user={user} />
      <span className="w-full truncate text-sm">
        <Name user={user} />
      </span>
    </button>
  );
}

export default function PhotoGallery() {
  const artists = use$(artists$) ?? PINNED;
  const [pubkey, setPubkey] = useState(PINNED[0]);
  const user = useMemo(() => (pubkey ? castUser(pubkey, eventStore) : undefined), [pubkey]);

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300 space-y-2">
        <PubkeyPicker value={pubkey} onChange={setPubkey} placeholder="Any npub, hex pubkey or NIP-05" />
        <div className="flex gap-1 overflow-x-auto">
          {artists.map((p) => (
            <ArtistButton key={p} pubkey={p} active={p === pubkey} onClick={() => setPubkey(p)} />
          ))}
        </div>
      </div>
      {user ? (
        <Gallery key={user.pubkey} user={user} />
      ) : (
        <div className="p-6 text-center text-base-content/60">Pick an artist to browse their photos</div>
      )}
    </div>
  );
}
