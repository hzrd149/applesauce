/**
 * Sync every NIP-56 report from a set of relays and get an overview of reasons, activity, reporters and targets
 * @tags nip-56, nip-77, moderation, reports, sync, negentropy, loader, dashboard
 * @related moderation/reported-users, moderation/reported-media, loader/sync-loader
 */
import { castUser, Report } from "applesauce-common/casts";
import { REPORT_KIND, ReportReason, type ReportTarget } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import { getTagValue, normalizeToPubkey, relaySet, unixNow, type NostrEvent } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncRelayStatus } from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useMemo, useState } from "react";
import { BehaviorSubject, ignoreElements, merge, throttleTime } from "rxjs";

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

type Target = ReportTarget["type"];
const TARGET_ICONS: Record<Target, string> = { user: "👤", event: "📝", blob: "🖼️" };

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// The relays to sync, a subject so the sync loader starts added relays and stops removed ones without restarting
const relays$ = new BehaviorSubject<string[]>(PRESET_RELAYS.slice(0, 4));

// The unified loader resolves reported notes and profiles on demand from hints, the synced relays and lookup relays
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: relays$ });

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

// The cast only accepts reports with at least one target that has a standard reason
const reasonOf = (report: Report) => report.reason ?? report.targets[0].reason;
// The most specific thing a report is about, a blob report also names its note and author
const targetOf = (report: Report): Target => (report.isBlobReport ? "blob" : report.isEventReport ? "event" : "user");
const targetsOf = (reports: Report[], type: Target) =>
  new Set(reports.flatMap((r) => r.targets.filter((t) => t.type === type).map((t) => t.value))).size;

/** The users a report is about, explicit user targets plus the author of a reported event */
const reportedUsersOf = (report: Report): string[] => [
  ...new Set([...report.reportedUsers.map((u) => u.pubkey), report.reportedPubkey].filter((p): p is string => !!p)),
];

/** Builds a file URL from a report server tag, which may be a server root or a direct file URL */
const blobUrl = (server: string, sha256: string) =>
  server.includes(sha256) ? server : new URL(sha256, server).toString();

const short = (relay: string) => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
const ago = (created: number) => {
  const s = unixNow() - created;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  return s < DAY ? `${Math.round(s / 3600)}h` : `${Math.round(s / DAY)}d`;
};

/** Counts items by key, sorted by count descending */
function countBy<T>(items: T[], key: (item: T) => string | undefined): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** Buckets reports into equal time slices with a count per reason */
function histogram(reports: Report[], since: number, until: number) {
  const size = until - since <= 2 * DAY ? 3600 : DAY;
  const buckets = Array.from({ length: Math.max(1, Math.round((until - since) / size)) }, (_, i) => ({
    start: since + i * size,
    size,
    counts: {} as Partial<Record<ReportReason, number>>,
    total: 0,
  }));
  for (const report of reports) {
    const bucket = buckets[Math.min(buckets.length - 1, Math.floor((report.event.created_at - since) / size))];
    if (!bucket) continue;
    const reason = reasonOf(report);
    bucket.counts[reason] = (bucket.counts[reason] ?? 0) + 1;
    bucket.total++;
  }
  return buckets;
}

export default function ReportsDashboard() {
  const [span, setSpan] = useState<number>(7 * DAY);
  const [refresh, setRefresh] = useState(0);
  const [reasons, setReasons] = useState<ReportReason[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [reporter, setReporter] = useState<string>();
  const [search, setSearch] = useState("");

  // A new window or a refresh starts a new sync, negentropy only downloads what the store is missing
  const since = useMemo(() => unixNow() - span, [span, refresh]);
  const status = use$(() => syncReports(since), [since]);
  const relays = use$(relays$);

  // Throttle the store timeline so thousands of arriving reports re-render at most twice a second
  const reports = use$(
    () =>
      eventStore
        .timeline({ kinds: [REPORT_KIND], since })
        .pipe(throttleTime(500, undefined, { leading: true, trailing: true }), castTimelineStream(Report, eventStore)),
    [since],
  );

  const all = reports ?? [];
  const query = search.trim().toLowerCase();
  const queryPubkey = useMemo(() => {
    try {
      return query ? normalizeToPubkey(query) : undefined;
    } catch {
      return undefined;
    }
  }, [query]);

  const filtered = useMemo(
    () =>
      all.filter(
        (r) =>
          (reasons.length === 0 || reasons.includes(reasonOf(r))) &&
          (targets.length === 0 || targets.includes(targetOf(r))) &&
          (!reporter || r.event.pubkey === reporter) &&
          (!query ||
            (queryPubkey
              ? r.event.pubkey === queryPubkey || reportedUsersOf(r).includes(queryPubkey)
              : r.comment?.toLowerCase().includes(query) || r.targets.some((t) => t.value.startsWith(query)))),
      ),
    [all, reasons, targets, reporter, query, queryPubkey],
  );

  const reasonCounts = useMemo(() => Object.fromEntries(countBy(all, reasonOf)), [all]);
  const stats = useMemo(
    () => ({
      reporters: new Set(filtered.map((r) => r.event.pubkey)).size,
      users: new Set(filtered.flatMap(reportedUsersOf)).size,
      events: targetsOf(filtered, "event"),
      blobs: targetsOf(filtered, "blob"),
    }),
    [filtered],
  );
  const buckets = useMemo(() => histogram(filtered, since, unixNow()), [filtered, since]);
  const topReporters = useMemo(() => countBy(filtered, (r) => r.event.pubkey).slice(0, 8), [filtered]);
  const clients = useMemo(
    () => countBy(filtered, (r) => getTagValue(r.event, "client") ?? "unknown").slice(0, 8),
    [filtered],
  );

  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const relayStatus = Object.values(status?.relays ?? {});
  const syncing = !status?.done;

  return (
    <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RelayList relays={relays ?? []} statuses={status?.relays ?? {}} />
        <PreviewToggle />
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
        <Stat label="Reports" value={filtered.length} detail={`${status?.loaded ?? 0} synced`} />
        <Stat label="Reporters" value={stats.reporters} />
        <Stat label="👤 Users" value={stats.users} />
        <Stat label="📝 Events" value={stats.events} />
        <Stat label="🖼️ Blobs" value={stats.blobs} />
      </div>

      <ReasonBar
        counts={reasonCounts}
        total={all.length}
        picked={reasons}
        onToggle={(r) => setReasons(toggle(reasons, r))}
      />
      <ActivityChart buckets={buckets} />

      <div className="grid gap-3 md:grid-cols-2">
        <Ranking title="Top reporters" rows={topReporters} total={filtered.length} picked={reporter}>
          {(pubkey) => (
            <button
              className="flex min-w-0 flex-1 cursor-pointer"
              onClick={() => setReporter(reporter === pubkey ? undefined : pubkey)}
            >
              <UserName pubkey={pubkey} />
            </button>
          )}
        </Ranking>
        <Ranking title="Clients" rows={clients} total={filtered.length}>
          {(client) => <span className="flex-1 truncate">{client}</span>}
        </Ranking>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="input w-80"
          placeholder="npub, pubkey, event id, hash or comment"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="join">
          {(Object.keys(TARGET_ICONS) as Target[]).map((target) => (
            <button
              key={target}
              className={`btn join-item ${targets.includes(target) ? "btn-primary" : ""}`}
              title={`${target} reports`}
              onClick={() => setTargets(toggle(targets, target))}
            >
              {TARGET_ICONS[target]}
            </button>
          ))}
        </div>
        {reporter && (
          <button className="badge badge-primary gap-1" onClick={() => setReporter(undefined)}>
            by <UserName pubkey={reporter} /> ✕
          </button>
        )}
        <span className="ms-auto">
          <strong>{filtered.length.toLocaleString()}</strong> of {all.length.toLocaleString()}
          {relayStatus.length > 0 &&
            ` from ${relayStatus.filter((r) => r.state === "complete").length}/${relayStatus.length} relays`}
        </span>
      </div>

      <ReportTable reports={filtered} />
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
  const title = [
    relay,
    status?.method &&
      `via ${status.method}${status.fallbackReason ? ` (fallback: ${status.fallbackReason.message})` : ""}`,
    status?.error?.message,
  ]
    .filter(Boolean)
    .join("\n");

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

/** A stacked bar of every reason, the segments double as the legend and the reason filter */
function ReasonBar({
  counts,
  total,
  picked,
  onToggle,
}: {
  counts: Record<string, number>;
  total: number;
  picked: ReportReason[];
  onToggle: (reason: ReportReason) => void;
}) {
  const present = REASONS.filter((r) => counts[r]);
  const dim = (r: ReportReason) => picked.length > 0 && !picked.includes(r);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-4 gap-0.5">
        {present.map((r) => (
          <button
            key={r}
            className="h-full cursor-pointer first:rounded-s last:rounded-e"
            style={{ flexGrow: counts[r], backgroundColor: COLORS[r], opacity: dim(r) ? 0.25 : 1 }}
            title={`${r}: ${counts[r]} (${Math.round((counts[r] / total) * 100)}%)`}
            onClick={() => onToggle(r)}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {present.map((r) => (
          <button
            key={r}
            className={`flex cursor-pointer items-center gap-1 ${dim(r) ? "opacity-40" : ""}`}
            onClick={() => onToggle(r)}
          >
            <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS[r] }} />
            {r}
            <span className="tabular-nums opacity-60">{counts[r].toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Reports over time as stacked columns per reason */
function ActivityChart({ buckets }: { buckets: ReturnType<typeof histogram> }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const label = (b: (typeof buckets)[number]) =>
    new Date(b.start * 1000).toLocaleString(
      undefined,
      b.size < DAY ? { hour: "numeric", weekday: "short" } : { month: "short", day: "numeric" },
    );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-32 items-end gap-0.5 border-b border-base-300">
        {buckets.map((b) => (
          <div
            key={b.start}
            className="flex h-full flex-1 flex-col-reverse gap-px hover:bg-base-200"
            title={[
              `${label(b)}: ${b.total}`,
              ...REASONS.filter((r) => b.counts[r]).map((r) => `${r} ${b.counts[r]}`),
            ].join("\n")}
          >
            {REASONS.filter((r) => b.counts[r]).map((r, i, list) => (
              <div
                key={r}
                className={i === list.length - 1 ? "rounded-t" : ""}
                style={{ height: `${((b.counts[r] ?? 0) / max) * 100}%`, backgroundColor: COLORS[r] }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-sm opacity-60">
        <span>{buckets[0] && label(buckets[0])}</span>
        <span>peak {max.toLocaleString()}</span>
        <span>{buckets.length > 0 && label(buckets[buckets.length - 1])}</span>
      </div>
    </div>
  );
}

/** A ranked list with a proportional bar behind each row */
function Ranking({
  title,
  rows,
  total,
  picked,
  children,
}: {
  title: string;
  rows: [string, number][];
  total: number;
  picked?: string;
  children: (key: string) => ReactNode;
}) {
  return (
    <div className="border border-base-300">
      <div className="border-b border-base-300 px-3 py-2 font-semibold">{title}</div>
      {rows.map(([key, count]) => (
        <div key={key} className={`relative flex items-center gap-2 px-3 py-1 ${picked === key ? "bg-base-200" : ""}`}>
          <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${(count / total) * 100}%` }} />
          <div className="relative flex min-w-0 flex-1">{children(key)}</div>
          <span className="relative tabular-nums">{count.toLocaleString()}</span>
        </div>
      ))}
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

/** Every matching report in a virtualized table, click a row to see what was reported */
function ReportTable({ reports }: { reports: Report[] }) {
  const [open, setOpen] = useState<string>();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: reports.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => reports[index].id,
    estimateSize: () => 45,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);

  return (
    <div ref={setScroller} className="h-[36rem] shrink-0 overflow-auto border border-base-300">
      <table className="table table-pin-rows">
        <thead>
          <tr>
            <th>When</th>
            <th>Reporter</th>
            <th>Reason</th>
            <th>Reported</th>
            <th>Comment</th>
          </tr>
        </thead>
        {before > 0 && (
          <tbody>
            <tr style={{ height: before }} />
          </tbody>
        )}
        {items.map((item) => {
          const report = reports[item.index];
          return (
            <tbody key={item.key} data-index={item.index} ref={virtualizer.measureElement}>
              <ReportRow
                report={report}
                open={open === report.id}
                onOpen={() => setOpen(open === report.id ? undefined : report.id)}
              />
            </tbody>
          );
        })}
        {after > 0 && (
          <tbody>
            <tr style={{ height: after }} />
          </tbody>
        )}
      </table>
      {reports.length === 0 && <div className="p-6 text-center opacity-60">No reports</div>}
    </div>
  );
}

function ReasonBadge({ reason }: { reason: ReportReason }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: COLORS[reason] }} />
      {reason}
    </span>
  );
}

function ReportRow({ report, open, onOpen }: { report: Report; open: boolean; onOpen: () => void }) {
  const target = targetOf(report);
  const users = reportedUsersOf(report);

  return (
    <>
      <tr className="cursor-pointer hover:bg-base-200" onClick={onOpen}>
        <td className="tabular-nums" title={report.createdAt.toLocaleString()}>
          {ago(report.event.created_at)}
        </td>
        <td className="max-w-56">
          <UserName pubkey={report.event.pubkey} />
        </td>
        <td>
          <ReasonBadge reason={reasonOf(report)} />
        </td>
        <td className="max-w-56">
          <span className="flex items-center gap-2" title={target}>
            {TARGET_ICONS[target]}
            {users[0] && <UserName pubkey={users[0]} />}
            {users.length > 1 && <span className="opacity-60">+{users.length - 1}</span>}
          </span>
        </td>
        <td className="max-w-md truncate">{report.comment}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-base-200/50">
            <ReportDetails report={report} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Every target of the report, with the reported events loaded through the unified event loader */
function ReportDetails({ report }: { report: Report }) {
  const events = use$(report.reportedEvents$);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1" title="Reporter">
          🚩 <UserName pubkey={report.event.pubkey} />
          <CopyButton value={report.author.npub} />
        </span>
        {reportedUsersOf(report).map((pubkey) => (
          <span key={pubkey} className="flex items-center gap-1" title="Reported user">
            🎯 <UserName pubkey={pubkey} />
            <CopyButton value={castUser(pubkey, eventStore).npub} />
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {report.targets.map((target) => (
          <span key={target.type + target.value} className="flex items-center gap-1 font-mono text-sm">
            {TARGET_ICONS[target.type]} {target.value.slice(0, 12)}… <ReasonBadge reason={target.reason} />
          </span>
        ))}
      </div>
      {report.comment && <blockquote className="border-l-4 border-base-300 pl-3">{report.comment}</blockquote>}
      {report.reportedEventPointers.map((pointer, i) =>
        events?.[i] ? (
          <div key={pointer.id} className="border border-base-300 bg-base-100 p-3">
            <div className="mb-2 flex items-center gap-2">
              <UserName pubkey={events[i].pubkey} />
              <span className="opacity-60">kind {events[i].kind}</span>
              <span className="opacity-60">{ago(events[i].created_at)} ago</span>
            </div>
            <NoteContent event={events[i]} maxLength={600} />
          </div>
        ) : (
          <div key={pointer.id} className="flex items-center gap-2 font-mono text-sm opacity-60">
            <span className="loading loading-dots loading-sm" />
            {pointer.id.slice(0, 16)}…
          </div>
        ),
      )}
      {report.blobs?.map((sha256) => (
        <div key={sha256} className="flex flex-wrap items-center gap-2 font-mono text-sm">
          🖼️ {sha256.slice(0, 16)}…
          {report.servers.map((server) => (
            <a key={server} className="link" href={blobUrl(server, sha256)} target="_blank" rel="noreferrer">
              {new URL(server).hostname}
            </a>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-1 text-sm opacity-60">
        {[...(report.seen ?? [])].map((relay) => (
          <span key={relay} className="badge badge-ghost">
            {short(relay)}
          </span>
        ))}
      </div>
    </div>
  );
}
