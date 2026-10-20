/**
 * Sync every NIP-56 report from a set of relays, load the reported events in bulk and review the reported images and videos
 * @tags nip-56, nip-77, nip-92, blossom, moderation, reports, media, sync, negentropy, loader, dashboard
 * @related moderation/reports, moderation/reported-users, loader/sync-loader
 */
import { castUser, Report } from "applesauce-common/casts";
import { getMediaAttachments, getSha256FromURL, REPORT_KIND, ReportReason } from "applesauce-common/helpers";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import { isImageURL, isVideoURL, type NostrEvent, relaySet, unixNow } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncRelayStatus } from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  defaultIfEmpty,
  distinct,
  filter,
  from,
  ignoreElements,
  map,
  merge,
  mergeMap,
  of,
  scan,
  startWith,
  switchMap,
  take,
  throttleTime,
} from "rxjs";

import RelayPicker from "../../components/relay-picker";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

const PRESET_RELAYS = [
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.primal.net/",
  "wss://nostr.wine/",
  "wss://relay.ditto.pub/",
  "wss://nostr.mom/",
  "wss://relay.nostr.net/",
  "wss://offchain.pub/",
];

const DAY = 24 * 60 * 60;
const WINDOWS = [
  ["24 hours", DAY],
  ["7 days", 7 * DAY],
  ["30 days", 30 * DAY],
  ["90 days", 90 * DAY],
] as const;

// NIP-56 reasons in a fixed color order
const COLORS: Record<ReportReason, string> = {
  [ReportReason.spam]: "#2a78d6",
  [ReportReason.illegal]: "#eb6834",
  [ReportReason.nudity]: "#1baf7a",
  [ReportReason.impersonation]: "#eda100",
  [ReportReason.profanity]: "#e87ba4",
  [ReportReason.malware]: "#008300",
  [ReportReason.other]: "#6250d6",
};
const REASONS = Object.keys(COLORS) as ReportReason[];

const PAGE = 60;

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// The relays to sync, a subject so the sync loader starts added relays and stops removed ones without restarting
const relays$ = new BehaviorSubject<string[]>(PRESET_RELAYS.slice(0, 4));

// The unified loader batches event pointers into a few REQs per relay, trying hints, the synced relays and lookup relays
const loader = createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: relays$ });

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

// Mentions render as plain text so the dashboard never links out to a pubkey
const contentCache = Symbol("moderation-content");
const contentComponents: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => <span className="break-all opacity-70">{node.value}</span>,
  mention: ({ node }) => <span className="break-all font-mono">nostr:{node.encoded.slice(0, 20)}…</span>,
  hashtag: ({ node }) => <span>#{node.name}</span>,
  gallery: ({ node }) => <span className="break-all opacity-70">{node.links.join(" ")}</span>,
};

/** Renders reported note text without media or outbound links */
function NoteContent({ event, maxLength }: { event: NostrEvent; maxLength?: number }) {
  const content = useRenderedContent(event, contentComponents, { cacheKey: contentCache, maxLength });
  return <div className="whitespace-pre-wrap break-words">{content}</div>;
}

/** How images are shown, reported profiles and media are often explicit or illegal so they start hidden */
type Preview = "hidden" | "blurred" | "visible";
const PREVIEW_ICONS: Record<Preview, string> = { hidden: "🙈", blurred: "🌫️", visible: "👁️" };

// Shared by every avatar, banner and media preview on the page, hidden images are never requested
const preview$ = new BehaviorSubject<Preview>("hidden");

/** Switches how images are shown, warning about sensitive content before leaving hidden */
function PreviewToggle() {
  const preview = use$(preview$);
  const [pending, setPending] = useState<Preview>();
  const pick = (next: Preview) => (preview === "hidden" && next !== "hidden" ? setPending(next) : preview$.next(next));

  return (
    <>
      <div className="join">
        {(Object.keys(PREVIEW_ICONS) as Preview[]).map((p) => (
          <button
            key={p}
            className={`btn join-item ${preview === p ? "btn-primary" : ""}`}
            title={`${p} images`}
            onClick={() => pick(p)}
          >
            {PREVIEW_ICONS[p]}
          </button>
        ))}
      </div>
      {pending && (
        <dialog
          className="modal"
          ref={(dialog) => {
            if (dialog && !dialog.open) dialog.showModal();
          }}
          onClose={() => setPending(undefined)}
        >
          <div className="modal-box rounded-none border border-warning">
            <h3 className="text-lg font-bold">⚠️ Sensitive content</h3>
            <p className="py-3">
              Reported profile pictures, banners and media can show nudity, violence or illegal material.
            </p>
            <div className="modal-action">
              <button className="btn" onClick={() => setPending(undefined)}>
                Keep hidden
              </button>
              <button
                className="btn btn-warning"
                onClick={() => {
                  preview$.next(pending);
                  setPending(undefined);
                }}
              >
                {PREVIEW_ICONS[pending]} Show {pending}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

/** An image that follows the preview setting, rendering a blank placeholder until the user accepts the warning */
function SafeImage({ src, className }: { src?: string; className: string }) {
  const preview = use$(preview$);
  const [failed, setFailed] = useState(false);

  return (
    <span className={`block shrink-0 overflow-hidden bg-base-300 ${className}`}>
      {src && !failed && preview !== "hidden" && (
        <img
          src={src}
          className={`size-full object-cover ${preview === "blurred" ? "blur-md" : ""}`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/** Syncs every report since a timestamp, events go into the store and the stream emits the sync status */
function syncReports(since: number) {
  const { status$, events$ } = syncLoader({ relays: relays$, filter: { kinds: [REPORT_KIND], since } });
  // Subscribing to events$ stops the loader buffering them, the store already has every event
  return merge(events$.pipe(ignoreElements()), status$);
}

type EventProgress = { requested: number; loaded: number; missing: number };

/** Loads each reported event once as its reports arrive, the unified loader adds them to the store */
function loadReportedEvents(since: number) {
  return eventStore.filters({ kinds: [REPORT_KIND], since }).pipe(
    castEventStream(Report, eventStore),
    filter((report): report is Report => !!report),
    // Pointers to every reported event and blob context event, with the report's relays as hints
    mergeMap((report) => report.reportedEventPointers),
    distinct((pointer) => pointer.id),
    mergeMap((pointer) =>
      merge(
        of("requested" as const),
        loader(pointer).pipe(
          take(1),
          map(() => "loaded" as const),
          defaultIfEmpty("missing" as const),
        ),
      ),
    ),
    scan((progress, key) => ({ ...progress, [key]: progress[key] + 1 }), {
      requested: 0,
      loaded: 0,
      missing: 0,
    } as EventProgress),
    startWith({ requested: 0, loaded: 0, missing: 0 } as EventProgress),
  );
}

type MediaType = "image" | "video" | "unknown";

/** One image or video with every report that points at it */
type Media = {
  /** The sha256 when known, otherwise the url */
  key: string;
  sha256?: string;
  urls: string[];
  type: MediaType;
  /** Whether a report named the blob with an x tag rather than only the note that contains it */
  blob: boolean;
  owner?: string;
  note?: NostrEvent;
  /** Every report about the file with the reason it gives for the file or its note */
  reports: { report: Report; reason: ReportReason }[];
  reasons: Partial<Record<ReportReason, number>>;
  last: number;
};

// The cast only accepts reports with at least one target that has a standard reason
const reasonOf = (report: Report) => report.reason ?? report.targets[0].reason;
// The reason a report gives for one target, falling back to the report's main reason
const reasonFor = (report: Report, value: string) =>
  report.targets.find((t) => t.value === value)?.reason ?? reasonOf(report);

/** Builds a file URL from a report server tag, which may be a server root or a direct file URL */
const blobUrl = (server: string, sha256: string) =>
  server.includes(sha256) ? server : new URL(sha256, server).toString();
const typeOf = (url: string, mime?: string): MediaType =>
  mime?.startsWith("video/") || isVideoURL(url)
    ? "video"
    : mime?.startsWith("image/") || isImageURL(url)
      ? "image"
      : "unknown";

/** Every image and video url in a note, from imeta tags and from the content */
function noteMedia(note: NostrEvent) {
  const attachments = getMediaAttachments(note)
    .filter((a) => a.url)
    .map((a) => ({ url: a.url!, sha256: a.sha256, type: typeOf(a.url!, a.type) }));
  const inline = (note.content.match(/https?:\/\/\S+/g) ?? [])
    .filter((url) => isImageURL(url) || isVideoURL(url))
    .map((url) => ({ url, sha256: getSha256FromURL(url), type: typeOf(url) }));
  return [...attachments, ...inline];
}

/** Collects the media of every report from its blob targets and from the reported events */
function collectMedia(reports: Report[], events: Map<string, NostrEvent>): Media[] {
  const media = new Map<string, Media>();
  const add = (
    key: string,
    report: Report,
    reason: ReportReason,
    init: () => Omit<Media, "reports" | "reasons" | "last">,
  ) => {
    let item = media.get(key);
    if (!item) media.set(key, (item = { ...init(), reports: [], reasons: {}, last: 0 }));
    if (item.reports.some((r) => r.report === report)) return item;
    item.reports.push({ report, reason });
    item.reasons[reason] = (item.reasons[reason] ?? 0) + 1;
    item.last = Math.max(item.last, report.event.created_at);
    return item;
  };

  for (const report of reports) {
    const notes = report.reportedEventPointers.map((p) => events.get(p.id)).filter((e): e is NostrEvent => !!e);
    const inNotes = notes.flatMap((note) => noteMedia(note).map((m) => ({ ...m, note })));

    for (const blob of report.targets.filter((t) => t.type === "blob")) {
      const known = inNotes.find((m) => m.sha256 === blob.value);
      const item = add(blob.value, report, blob.reason, () => ({
        key: blob.value,
        sha256: blob.value,
        urls: [],
        type: known?.type ?? "unknown",
        blob: true,
        owner: report.reportedPubkey,
        note: known?.note ?? notes[0],
      }));
      item.blob = true;
      for (const url of [known?.url, ...report.servers.map((s) => blobUrl(s, blob.value))])
        if (url && !item.urls.includes(url)) item.urls.push(url);
    }

    for (const m of inNotes) {
      const item = add(m.sha256 ?? m.url, report, reasonFor(report, m.note.id), () => ({
        key: m.sha256 ?? m.url,
        sha256: m.sha256,
        urls: [],
        type: m.type,
        blob: false,
        owner: m.note.pubkey,
        note: m.note,
      }));
      if (!item.urls.includes(m.url)) item.urls.unshift(m.url);
      if (item.type === "unknown") item.type = m.type;
    }
  }
  return [...media.values()];
}

const hostOf = (url: string) => new URL(url).hostname;
const short = (relay: string) => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
const ago = (created: number) => {
  const s = unixNow() - created;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  return s < DAY ? `${Math.round(s / 3600)}h` : `${Math.round(s / DAY)}d`;
};

const SORTS = {
  reports: (m: Media) => m.reports.length,
  reporters: (m: Media) => new Set(m.reports.map((r) => r.report.event.pubkey)).size,
  last: (m: Media) => m.last,
};
type SortKey = keyof typeof SORTS;

export default function ReportedMediaDashboard() {
  const [span, setSpan] = useState<number>(30 * DAY);
  const [refresh, setRefresh] = useState(0);
  const [reason, setReason] = useState<ReportReason>();
  const [source, setSource] = useState<"blob" | "note">();
  const [host, setHost] = useState<string>();
  const [sort, setSort] = useState<SortKey>("reports");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string>();

  // A new window or a refresh starts a new sync, negentropy only downloads what the store is missing
  const since = useMemo(() => unixNow() - span, [span, refresh]);
  const status = use$(() => syncReports(since), [since]);
  const eventsProgress = use$(() => loadReportedEvents(since), [since]);
  const relays = use$(relays$);

  // Join the reports with the reported events in the store, re-collecting at most twice a second
  const media = use$(
    () =>
      eventStore.timeline({ kinds: [REPORT_KIND], since }).pipe(
        throttleTime(500, undefined, { leading: true, trailing: true }),
        castTimelineStream(Report, eventStore),
        switchMap((reports) => {
          const ids = [...new Set(reports.flatMap((r) => r.reportedEventPointers.map((p) => p.id)))];
          return eventStore.timeline({ ids }).pipe(
            throttleTime(500, undefined, { leading: true, trailing: true }),
            map((events) => collectMedia(reports, new Map(events.map((e) => [e.id, e])))),
          );
        }),
      ),
    [since],
  );

  const all = media ?? [];
  const hosts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of all) for (const h of new Set(m.urls.map(hostOf))) counts.set(h, (counts.get(h) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const shown = useMemo(
    () =>
      all
        .filter(
          (m) =>
            (!reason || m.reasons[reason]) &&
            (!source || (source === "blob") === m.blob) &&
            (!host || m.urls.some((u) => hostOf(u) === host)),
        )
        .sort((a, b) => SORTS[sort](b) - SORTS[sort](a) || b.last - a.last),
    [all, reason, source, host, sort],
  );
  const current = all.find((m) => m.key === selected);
  const syncing = !status?.done;

  return (
    <div className="flex min-h-0 grow flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RelayList relays={relays ?? []} statuses={status?.relays ?? {}} />
        <select
          className="select w-40"
          value={span}
          onChange={(e) => setSpan(Number(e.target.value))}
          aria-label="Time window"
        >
          {WINDOWS.map(([label, value]) => (
            <option key={value} value={value}>
              last {label}
            </option>
          ))}
        </select>
        <button
          className="btn btn-square"
          title="Sync again"
          disabled={syncing}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {syncing ? <span className="loading loading-spinner" /> : "⟳"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Stat label="🖼️ Media" value={all.length} />
        <Stat label="🧷 Reported blobs" value={all.filter((m) => m.blob).length} />
        <Stat label="👤 Owners" value={new Set(all.map((m) => m.owner).filter(Boolean)).size} />
        <Stat label="🌐 Hosts" value={hosts.length} />
        <Stat
          label="📝 Reported events"
          value={eventsProgress?.loaded ?? 0}
          detail={eventsProgress && `of ${eventsProgress.requested} · ${eventsProgress.missing} missing`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PreviewToggle />
        <div className="join">
          {(
            [
              [undefined, "All"],
              ["blob", "🧷"],
              ["note", "📝"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              className={`btn join-item ${source === value ? "btn-primary" : ""}`}
              title={
                value === "blob" ? "Blobs named by reports" : value === "note" ? "Media in reported notes" : "All media"
              }
              onClick={() => setSource(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="select w-44"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort"
        >
          <option value="reports">most reports</option>
          <option value="reporters">most reporters</option>
          <option value="last">newest report</option>
        </select>
        <select
          className="select w-56"
          value={host ?? ""}
          onChange={(e) => setHost(e.target.value || undefined)}
          aria-label="Host"
        >
          <option value="">🌐 any host</option>
          {hosts.map(([h, count]) => (
            <option key={h} value={h}>
              {h} ({count})
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          {REASONS.map((r) => (
            <button
              key={r}
              className={`badge cursor-pointer gap-1 ${reason === r ? "badge-neutral" : "badge-ghost"}`}
              onClick={() => setReason(reason === r ? undefined : r)}
            >
              <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS[r] }} />
              {r}
            </button>
          ))}
        </div>
        <span className="ms-auto">
          <strong>{shown.length.toLocaleString()}</strong> of {all.length.toLocaleString()}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-96 min-w-0 flex-1 overflow-y-auto border border-base-300 p-2">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
            {shown.slice(0, limit).map((m) => (
              <MediaTile
                key={m.key}
                media={m}
                active={selected === m.key}
                onSelect={() => setSelected(selected === m.key ? undefined : m.key)}
              />
            ))}
          </div>
          {shown.length > limit && (
            <button className="btn btn-block mt-2" onClick={() => setLimit(limit + PAGE)}>
              {shown.length - limit} more
            </button>
          )}
          {shown.length === 0 && <div className="p-6 text-center opacity-60">{syncing ? "Syncing…" : "No media"}</div>}
        </div>
        {current && <MediaDetails key={current.key} media={current} onClose={() => setSelected(undefined)} />}
      </div>
    </div>
  );
}

/** The synced relays as removable badges with their sync state, plus the shared picker to add more */
function RelayList({ relays, statuses }: { relays: string[]; statuses: Record<string, SyncRelayStatus> }) {
  const add = (url: string) => relays$.next(relaySet(relays, url));
  const remove = (url: string) => relays$.next(relays.filter((r) => r !== url));

  return (
    <div className="flex flex-1 flex-wrap items-center gap-1">
      {relays.map((relay) => (
        <RelayBadge key={relay} relay={relay} status={statuses[relay]} onRemove={() => remove(relay)} />
      ))}
      {/* Remount after each add so the picker clears */}
      <RelayPicker key={relays.join()} value="" onChange={add} common={PRESET_RELAYS} className="w-80" />
    </div>
  );
}

const STATE_ICONS: Record<SyncRelayStatus["state"], string> = {
  pending: "…",
  checking: "?",
  loading: "↓",
  complete: "✓",
  error: "✕",
  skipped: "–",
};

function RelayBadge({ relay, status, onRemove }: { relay: string; status?: SyncRelayStatus; onRemove: () => void }) {
  const state = status?.state ?? "pending";
  const color = state === "error" ? "badge-error" : state === "complete" ? "badge-success" : "badge-ghost";
  const title = [relay, status?.method && `via ${status.method}`, status?.error?.message].filter(Boolean).join("\n");

  return (
    <span className={`badge badge-outline gap-1 ${color}`} title={title}>
      {STATE_ICONS[state]}
      {status?.method === "negentropy" && "⇄"}
      {short(relay)}
      <span className="tabular-nums opacity-70">{status?.count ?? 0}</span>
      <button className="cursor-pointer opacity-60 hover:opacity-100" title="Remove relay" onClick={onRemove}>
        ✕
      </button>
    </span>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="min-w-40 flex-1 border border-base-300 p-3">
      <div className="text-sm opacity-60">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      {detail && <div className="text-sm opacity-60">{detail}</div>}
    </div>
  );
}

/** Copies a value to the clipboard, pubkeys are copied rather than linked to an external site */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-square btn-ghost btn-sm"
      title={copied ? "Copied" : `Copy ${value}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

function UserName({ pubkey }: { pubkey: string }) {
  const user = castUser(pubkey, eventStore);
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <SafeImage src={profile?.picture} className="size-6 rounded-full" />
      <span className="truncate">{profile?.displayName ?? user.npub.slice(0, 16)}</span>
    </span>
  );
}

/** Renders an image or video following the preview setting, a blurred file can be revealed on its own */
function MediaPreview({ media, revealed, className }: { media: Media; revealed?: boolean; className: string }) {
  const setting = use$(preview$);
  const preview = revealed && setting === "blurred" ? "visible" : setting;
  // Reported files are often already deleted from their hosts
  const [failed, setFailed] = useState(false);

  if (preview === "hidden" || failed)
    return (
      <div
        className={`flex items-center justify-center bg-base-200 text-4xl ${className}`}
        title={failed ? "Failed to load" : undefined}
      >
        {failed ? "⚠️" : media.type === "video" ? "🎬" : "🖼️"}
      </div>
    );

  const blur = preview === "blurred" ? "blur-xl" : "";
  return media.type === "video" ? (
    <video
      src={media.urls[0]}
      className={`bg-base-200 ${blur} ${className}`}
      muted
      preload="metadata"
      onError={() => setFailed(true)}
    />
  ) : (
    <img
      src={media.urls[0]}
      className={`bg-base-200 ${blur} ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** A square preview with the report count and a strip of reason colors */
function MediaTile({ media, active, onSelect }: { media: Media; active: boolean; onSelect: () => void }) {
  return (
    <button
      className={`relative aspect-square cursor-pointer overflow-hidden border ${active ? "border-primary" : "border-base-300"}`}
      title={[
        media.sha256 ?? media.urls[0],
        ...REASONS.filter((r) => media.reasons[r]).map((r) => `${r} ${media.reasons[r]}`),
      ].join("\n")}
      onClick={onSelect}
    >
      <MediaPreview media={media} className="size-full object-cover" />
      <span className="badge badge-neutral absolute top-1 right-1 tabular-nums">🚩 {media.reports.length}</span>
      <span className="absolute top-1 left-1 flex gap-1">
        {media.blob && (
          <span className="badge badge-neutral" title="Blob named by a report">
            🧷
          </span>
        )}
        {media.type === "video" && <span className="badge badge-neutral">🎬</span>}
      </span>
      <span className="absolute inset-x-0 bottom-0 flex h-2 gap-px">
        {REASONS.filter((r) => media.reasons[r]).map((r) => (
          <span key={r} style={{ flexGrow: media.reasons[r], backgroundColor: COLORS[r] }} />
        ))}
      </span>
    </button>
  );
}

/** Asks a host whether it still serves the file without downloading it */
function UrlStatus({ url }: { url: string }) {
  const status = use$(
    () =>
      from(fetch(url, { method: "HEAD" })).pipe(
        map((res) => (res.ok ? "✅" : `❌ ${res.status}`)),
        catchError(() => of("⚠️")),
        startWith("…"),
      ),
    [url],
  );

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0" title="HEAD request result">
        {status}
      </span>
      <a className="link truncate font-mono" href={url} target="_blank" rel="noreferrer">
        {hostOf(url)}
      </a>
    </div>
  );
}

function MediaDetails({ media, onClose }: { media: Media; onClose: () => void }) {
  const preview = use$(preview$);
  // A blurred file can be revealed on its own once the sensitive content warning is accepted
  const [revealed, setRevealed] = useState(false);

  return (
    <aside className="w-[28rem] shrink-0 overflow-y-auto border border-base-300">
      <div className="relative">
        <MediaPreview media={media} revealed={revealed} className="max-h-96 w-full object-contain" />
        <div className="absolute top-2 right-2 flex gap-1">
          {preview === "blurred" && (
            <button className="btn btn-sm" title={revealed ? "Hide" : "Reveal"} onClick={() => setRevealed(!revealed)}>
              {revealed ? "🙈" : "👁️"}
            </button>
          )}
          <button className="btn btn-square btn-sm" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-base-300 p-3">
        {media.sha256 && <div className="truncate font-mono text-sm opacity-60">{media.sha256}</div>}
        {media.urls.map((url) => (
          <UrlStatus key={url} url={url} />
        ))}
      </div>

      {media.owner && (
        <div className="flex items-center gap-2 border-t border-base-300 p-3">
          <span title="Owner">👤</span>
          <span className="min-w-0 flex-1">
            <UserName pubkey={media.owner} />
          </span>
          <CopyButton value={castUser(media.owner, eventStore).npub} />
        </div>
      )}

      <div className="border-t border-base-300 p-3">
        {media.reports.map(({ report, reason }) => (
          <div key={report.id} className="flex flex-col gap-1 py-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <UserName pubkey={report.event.pubkey} />
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS[reason] }} />
                {reason}
              </span>
              <span className="w-10 text-right tabular-nums opacity-60">{ago(report.event.created_at)}</span>
            </div>
            {report.comment && <div className="pl-8 text-sm opacity-80">{report.comment}</div>}
          </div>
        ))}
      </div>

      {media.note && (
        <div className="border-t border-base-300 p-3">
          <div className="mb-1 text-sm opacity-60">
            📝 kind {media.note.kind} · {ago(media.note.created_at)} ago
          </div>
          <NoteContent event={media.note} maxLength={400} />
        </div>
      )}
    </aside>
  );
}
