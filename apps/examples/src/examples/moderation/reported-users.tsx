/**
 * Sync every NIP-56 report from a set of relays and rank the most reported users and the most active reporters
 * @tags nip-56, nip-77, moderation, reports, users, sync, negentropy, loader, dashboard
 * @related moderation/reports, moderation/reported-media, loader/sync-loader
 */
import { castUser, Report } from "applesauce-common/casts";
import { REPORT_KIND, ReportReason } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import { type EventPointer, normalizeToPubkey, relaySet, unixNow, type NostrEvent } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncRelayStatus } from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useState } from "react";
import { BehaviorSubject, ignoreElements, map, merge, throttleTime } from "rxjs";

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

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// The relays to sync, a subject so the sync loader starts added relays and stops removed ones without restarting
const relays$ = new BehaviorSubject<string[]>(PRESET_RELAYS.slice(0, 4));

// The unified loader resolves profiles and reported notes on demand from hints, the synced relays and lookup relays
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

/** The users a report is about with the reason for each, the author of a reported event takes the report's reason */
function reportedUsersOf(report: Report): Map<string, ReportReason> {
  const users = new Map(report.targets.filter((t) => t.type === "user").map((t) => [t.value, t.reason]));
  if (report.reportedPubkey && !users.has(report.reportedPubkey)) users.set(report.reportedPubkey, reasonOf(report));
  return users;
}

type ReasonCounts = Partial<Record<ReportReason, number>>;
const countReason = (counts: ReasonCounts, reason: ReportReason) => (counts[reason] = (counts[reason] ?? 0) + 1);

const short = (relay: string) => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
const ago = (created: number) => {
  const s = unixNow() - created;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  return s < DAY ? `${Math.round(s / 3600)}h` : `${Math.round(s / DAY)}d`;
};

/** Which side of a report to rank users by */
type Mode = "reported" | "reporters";

/** One user with every report on their side of the ranking */
type UserSummary = {
  pubkey: string;
  reports: Report[];
  /** The distinct users on the other side, reporters for a reported user and targets for a reporter */
  others: Set<string>;
  reasons: ReasonCounts;
  notes: number;
  media: number;
  last: number;
};

/** Groups reports by every reported user or by the reporter */
function summarize(reports: Report[], mode: Mode): UserSummary[] {
  const users = new Map<string, UserSummary>();
  const add = (pubkey: string, report: Report, reason: ReportReason, others: string[]) => {
    let user = users.get(pubkey);
    if (!user)
      users.set(pubkey, (user = { pubkey, reports: [], others: new Set(), reasons: {}, notes: 0, media: 0, last: 0 }));
    user.reports.push(report);
    for (const other of others) user.others.add(other);
    countReason(user.reasons, reason);
    if (report.isBlobReport) user.media++;
    else if (report.isEventReport) user.notes++;
    user.last = Math.max(user.last, report.event.created_at);
  };

  for (const report of reports) {
    const reported = reportedUsersOf(report);
    if (mode === "reporters") add(report.event.pubkey, report, reasonOf(report), [...reported.keys()]);
    else for (const [pubkey, reason] of reported) add(pubkey, report, reason, [report.event.pubkey]);
  }
  return [...users.values()];
}

const SORTS = {
  reports: (u: UserSummary) => u.reports.length,
  others: (u: UserSummary) => u.others.size,
  last: (u: UserSummary) => u.last,
};
type SortKey = keyof typeof SORTS;

export default function ReportedUsersDashboard() {
  const [span, setSpan] = useState<number>(30 * DAY);
  const [refresh, setRefresh] = useState(0);
  const [mode, setMode] = useState<Mode>("reported");
  const [sort, setSort] = useState<SortKey>("others");
  const [minOthers, setMinOthers] = useState(1);
  const [reason, setReason] = useState<ReportReason>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();

  // A new window or a refresh starts a new sync, negentropy only downloads what the store is missing
  const since = useMemo(() => unixNow() - span, [span, refresh]);
  const status = use$(() => syncReports(since), [since]);
  const relays = use$(relays$);

  // Group the reports at most twice a second while thousands of them arrive
  const users = use$(
    () =>
      eventStore.timeline({ kinds: [REPORT_KIND], since }).pipe(
        throttleTime(500, undefined, { leading: true, trailing: true }),
        castTimelineStream(Report, eventStore),
        map((reports) => summarize(reports, mode)),
      ),
    [since, mode],
  );

  const searchPubkey = useMemo(() => {
    try {
      return search.trim() ? normalizeToPubkey(search.trim()) : undefined;
    } catch {
      return undefined;
    }
  }, [search]);

  const ranked = useMemo(
    () =>
      (users ?? [])
        .filter(
          (u) =>
            u.others.size >= minOthers &&
            (!reason || u.reasons[reason]) &&
            (!searchPubkey || u.pubkey === searchPubkey || u.others.has(searchPubkey)),
        )
        .sort((a, b) => SORTS[sort](b) - SORTS[sort](a) || b.last - a.last),
    [users, minOthers, reason, searchPubkey, sort],
  );
  const syncing = !status?.done;
  const otherLabel = mode === "reported" ? "Reporters" : "Targets";

  return (
    <div className="flex min-h-0 grow flex-col gap-3 p-3">
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="join">
          {(["reported", "reporters"] as const).map((m) => (
            <button
              key={m}
              className={`btn join-item ${mode === m ? "btn-primary" : ""}`}
              onClick={() => {
                setMode(m);
                setSelected(undefined);
              }}
            >
              {m === "reported" ? "🎯 Reported" : "🚩 Reporters"}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="input w-72"
          placeholder="npub or hex pubkey"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select w-48"
          value={minOthers}
          onChange={(e) => setMinOthers(Number(e.target.value))}
          aria-label={`Minimum ${otherLabel.toLowerCase()}`}
        >
          {[1, 2, 3, 5, 10].map((n) => (
            <option key={n} value={n}>
              {n}+ {otherLabel.toLowerCase()}
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
          <strong>{ranked.length.toLocaleString()}</strong> of {(users?.length ?? 0).toLocaleString()} users
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <UserTable users={ranked} mode={mode} sort={sort} onSort={setSort} selected={selected} onSelect={setSelected} />
        {selected && (
          <UserDetails
            key={selected}
            pubkey={selected}
            mode={mode}
            onSelect={setSelected}
            onClose={() => setSelected(undefined)}
          />
        )}
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

function Avatar({ pubkey, className = "size-8" }: { pubkey: string; className?: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return <SafeImage src={profile?.picture} className={`rounded-full ${className}`} />;
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
      <Avatar pubkey={pubkey} className="size-6" />
      <span className="truncate">{profile?.displayName ?? user.npub.slice(0, 16)}</span>
    </span>
  );
}

/** A thin stacked bar of a user's report reasons */
function ReasonStrip({ reasons, className = "h-2" }: { reasons: ReasonCounts; className?: string }) {
  return (
    <div
      className={`flex gap-px ${className}`}
      title={REASONS.filter((r) => reasons[r])
        .map((r) => `${r} ${reasons[r]}`)
        .join("\n")}
    >
      {REASONS.filter((r) => reasons[r]).map((r) => (
        <div
          key={r}
          className="first:rounded-s last:rounded-e"
          style={{ flexGrow: reasons[r], backgroundColor: COLORS[r] }}
        />
      ))}
    </div>
  );
}

/** The ranked users in a virtualized table, click a header to sort and a row to open the user */
function UserTable({
  users,
  mode,
  sort,
  onSort,
  selected,
  onSelect,
}: {
  users: UserSummary[];
  mode: Mode;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  selected?: string;
  onSelect: (pubkey: string) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => users[index].pubkey,
    estimateSize: () => 49,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);
  const header = (key: SortKey, label: string) => (
    <th className="text-right">
      <button className="link link-hover" onClick={() => onSort(key)}>
        {label}
        {sort === key && " ↓"}
      </button>
    </th>
  );

  return (
    <div ref={setScroller} className="min-h-96 min-w-0 flex-1 overflow-auto border border-base-300">
      <table className="table table-pin-rows">
        <thead>
          <tr>
            <th>#</th>
            <th>User</th>
            {header("reports", "Reports")}
            {header("others", mode === "reported" ? "Reporters" : "Targets")}
            <th className="w-48">Reasons</th>
            <th className="text-right">📝 / 🖼️</th>
            {header("last", "Last")}
          </tr>
        </thead>
        <tbody>
          {before > 0 && <tr style={{ height: before }} />}
          {items.map((item) => {
            const user = users[item.index];
            return (
              <tr
                key={item.key}
                className={`cursor-pointer hover:bg-base-200 ${selected === user.pubkey ? "bg-base-200" : ""}`}
                onClick={() => onSelect(user.pubkey)}
              >
                <td className="opacity-60 tabular-nums">{item.index + 1}</td>
                <td className="max-w-64">
                  <UserName pubkey={user.pubkey} />
                </td>
                <td className="text-right tabular-nums">{user.reports.length}</td>
                <td className="text-right tabular-nums">{user.others.size}</td>
                <td>
                  <ReasonStrip reasons={user.reasons} />
                </td>
                <td className="text-right tabular-nums opacity-70">
                  {user.notes} / {user.media}
                </td>
                <td className="text-right tabular-nums">{ago(user.last)}</td>
              </tr>
            );
          })}
          {after > 0 && <tr style={{ height: after }} />}
        </tbody>
      </table>
      {users.length === 0 && <div className="p-6 text-center opacity-60">No users</div>}
    </div>
  );
}

/** The selected user's profile and every report about them or by them through the user cast relationships */
function UserDetails({
  pubkey,
  mode,
  onSelect,
  onClose,
}: {
  pubkey: string;
  mode: Mode;
  onSelect: (pubkey: string) => void;
  onClose: () => void;
}) {
  const user = castUser(pubkey, eventStore);
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  // Every synced report in the store, including reports of the user's events since they carry the author's p tag
  const reports = use$(() => (mode === "reported" ? user.reports$ : user.reportsSent$), [pubkey, mode]) ?? [];

  // The reason counts and the users on the other side of the reports
  const { reasons, others } = useMemo(() => {
    const reasons: ReasonCounts = {};
    const others = new Map<string, number>();
    for (const report of reports) {
      const reported = reportedUsersOf(report);
      countReason(reasons, mode === "reported" ? (reported.get(pubkey) ?? reasonOf(report)) : reasonOf(report));
      for (const other of mode === "reported" ? [report.event.pubkey] : reported.keys())
        others.set(other, (others.get(other) ?? 0) + 1);
    }
    return { reasons, others: [...others].sort((a, b) => b[1] - a[1]) };
  }, [reports, mode, pubkey]);

  // One report per reported event, newest first
  const events = useMemo(() => {
    const seen = new Set<string>();
    return [...reports]
      .sort((a, b) => b.event.created_at - a.event.created_at)
      .flatMap((report) => report.reportedEventPointers.map((pointer) => ({ report, pointer })))
      .filter(({ pointer }) => !seen.has(pointer.id) && seen.add(pointer.id));
  }, [reports]);

  return (
    <aside className="w-[28rem] shrink-0 overflow-y-auto border border-base-300">
      {profile?.banner && <SafeImage src={profile.banner} className="h-24 w-full" />}
      <div className="flex items-start gap-3 p-3">
        <Avatar pubkey={pubkey} className="size-14" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-lg font-semibold">{profile?.displayName ?? user.npub.slice(0, 16)}</span>
          {profile?.dnsIdentity && <span className="truncate text-sm opacity-60">{profile.dnsIdentity}</span>}
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-sm opacity-60">{user.npub}</span>
            <CopyButton value={user.npub} />
          </span>
        </div>
        <button className="btn btn-square btn-ghost btn-sm" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {profile?.about && <p className="line-clamp-4 px-3 pb-3 whitespace-pre-wrap opacity-80">{profile.about}</p>}

      <div className="flex flex-col gap-2 border-t border-base-300 p-3">
        <div className="flex gap-4">
          <span>
            <strong>{reports.length}</strong> reports
          </span>
          <span>
            <strong>{others.length}</strong> {mode === "reported" ? "reporters" : "targets"}
          </span>
        </div>
        <ReasonStrip reasons={reasons} className="h-3" />
        <div className="flex flex-wrap gap-2 text-sm">
          {REASONS.filter((r) => reasons[r]).map((r) => (
            <span key={r} className="flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS[r] }} />
              {r} {reasons[r]}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-base-300 p-3">
        <div className="mb-2 font-semibold">{mode === "reported" ? "🚩 Reported by" : "🎯 Reported"}</div>
        {others.slice(0, 20).map(([other, count]) => (
          <button
            key={other}
            className="flex w-full cursor-pointer items-center gap-2 py-1 hover:bg-base-200"
            onClick={() => onSelect(other)}
            title="Open user"
          >
            <span className="flex min-w-0 flex-1">
              <UserName pubkey={other} />
            </span>
            <span className="tabular-nums">{count}</span>
          </button>
        ))}
      </div>

      {events.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-base-300 p-3">
          <div className="font-semibold">📝 Reported events</div>
          {events.slice(0, 20).map(({ report, pointer }) => (
            <ReportedEvent key={pointer.id} report={report} pointer={pointer} />
          ))}
        </div>
      )}
    </aside>
  );
}

/** A reported event loaded on demand through the unified event loader, using the report's relays as hints */
function ReportedEvent({ report, pointer }: { report: Report; pointer: EventPointer }) {
  const event = use$(() => eventStore.event(pointer), [pointer.id]);
  const reason = report.targets.find((t) => t.value === pointer.id)?.reason ?? reasonOf(report);

  return (
    <div className="border border-base-300 p-2">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS[reason] }} />
          {reason}
        </span>
        {event && (
          <span className="opacity-60">
            kind {event.kind} · {ago(event.created_at)} ago
          </span>
        )}
      </div>
      {event ? (
        <NoteContent event={event} maxLength={300} />
      ) : (
        <span className="flex items-center gap-2 font-mono text-sm opacity-60">
          <span className="loading loading-dots loading-sm" />
          {pointer.id.slice(0, 16)}…
        </span>
      )}
    </div>
  );
}
