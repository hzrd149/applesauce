/**
 * Sync the reports and mute lists published by a user and their contacts to see who their social graph mutes and reports
 * @tags nip-56, nip-51, nip-65, nip-77, moderation, reports, mutes, contacts, sync, negentropy, outbox
 * @related moderation/reported-users, mutes/manager, outbox/photo-gallery
 */
import { castUser, Mutes, Report } from "applesauce-common/casts";
import { REPORT_KIND, ReportReason } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, includeMailboxes } from "applesauce-core";
import {
  type EventPointer,
  kinds,
  type NostrEvent,
  relaySet,
  selectOptimalRelays,
  unixNow,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncRelayStatus } from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useMemo, useState } from "react";
import {
  BehaviorSubject,
  combineLatest,
  filter,
  ignoreElements,
  map,
  merge,
  type Observable,
  of,
  take,
  throttleTime,
  timeout,
} from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

// Popular relays that are always synced, many contacts have no relay list
const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const DEFAULT_PUBKEY = "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5";

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

// Loads contact lists, relay lists, profiles and reported notes on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

/** How profile images and reported content are shown, hidden by default because muted and reported users often post explicit or illegal content */
type Preview = "hidden" | "blurred" | "visible";
const PREVIEW_ICONS: Record<Preview, string> = { hidden: "🙈", blurred: "🌫️", visible: "👁️" };

// Shared by every avatar, banner and reported note so one switch controls all sensitive content
const preview$ = new BehaviorSubject<Preview>("hidden");

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

/** The user followed by their contacts, the user alone if their contact list can't be found */
function socialGraph$(pubkey: string): Observable<string[]> {
  return castUser(pubkey, eventStore).contacts$.pipe(
    filter((contacts) => contacts.length > 0),
    take(1),
    timeout({ first: 10_000, with: () => of([]) }),
    map((contacts) => [...new Set([pubkey, ...contacts.map((c) => c.pubkey)])]),
  );
}

/** The fewest outboxes that cover the graph plus the fallback relays, re-picked as relay lists load */
function graphRelays$(authors: string[]): Observable<string[]> {
  return of(authors.map((pubkey) => ({ pubkey }))).pipe(
    includeMailboxes(eventStore),
    // Relay lists stream in one by one, re-pick the relays at most once every two seconds
    throttleTime(2000, undefined, { leading: true, trailing: true }),
    map((users) => selectOptimalRelays(users, { maxConnections: 20, maxRelaysPerUser: 2 })),
    map((users) => relaySet(FALLBACK_RELAYS, ...users.map((u) => u.relays))),
  );
}

/** Syncs every report and mute list the graph has published, events go into the store and the stream emits the status */
function syncGraph(authors: string[]) {
  // The loader starts relays as they are added to the list and stops the ones that are removed
  const { status$, events$ } = syncLoader({
    relays: graphRelays$(authors),
    filter: { kinds: [REPORT_KIND, kinds.Mutelist], authors },
  });
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

/** A user the graph mutes or reports, with who in the graph did it */
type Target = {
  pubkey: string;
  muters: Set<string>;
  reporters: Set<string>;
  reports: Report[];
  reasons: ReasonCounts;
  last: number;
};

/** A muted hashtag or word with the graph members that mute it */
type Topic = { value: string; muters: Set<string> };

/** Joins the graph's public mutes and reports into one entry per targeted user, plus the muted hashtags and words */
function collect(mutes: Mutes[], reports: Report[]) {
  const targets = new Map<string, Target>();
  const target = (pubkey: string) => {
    let t = targets.get(pubkey);
    if (!t)
      targets.set(pubkey, (t = { pubkey, muters: new Set(), reporters: new Set(), reports: [], reasons: {}, last: 0 }));
    return t;
  };
  const hashtags = new Map<string, Topic>();
  const words = new Map<string, Topic>();
  const topic = (topics: Map<string, Topic>, value: string, muter: string) => {
    let t = topics.get(value);
    if (!t) topics.set(value, (t = { value, muters: new Set() }));
    t.muters.add(muter);
  };

  for (const list of mutes) {
    for (const pubkey of list.pubkeys) target(pubkey).muters.add(list.event.pubkey);
    for (const tag of list.hashtags) topic(hashtags, tag.replace(/^#+/, "").toLowerCase(), list.event.pubkey);
    for (const word of list.words) topic(words, word.toLowerCase(), list.event.pubkey);
  }
  for (const report of reports) {
    for (const [pubkey, reason] of reportedUsersOf(report)) {
      const t = target(pubkey);
      t.reporters.add(report.event.pubkey);
      t.reports.push(report);
      t.reasons[reason] = (t.reasons[reason] ?? 0) + 1;
      t.last = Math.max(t.last, report.event.created_at);
    }
  }

  const byMuters = (a: Topic, b: Topic) => b.muters.size - a.muters.size;
  return {
    targets: [...targets.values()],
    hashtags: [...hashtags.values()].sort(byMuters),
    words: [...words.values()].sort(byMuters),
    lists: mutes.length,
    hidden: mutes.filter((m) => m.hasHidden).length,
    reports: reports.length,
  };
}

/** Watches the graph's mute lists and reports in the store and collects them at most twice a second */
function graphModeration$(authors: string[]) {
  const throttle = <T,>(source: Observable<T>) =>
    source.pipe(throttleTime(500, undefined, { leading: true, trailing: true }));
  return combineLatest([
    throttle(eventStore.timeline({ kinds: [kinds.Mutelist], authors })).pipe(castTimelineStream(Mutes, eventStore)),
    throttle(eventStore.timeline({ kinds: [REPORT_KIND], authors })).pipe(castTimelineStream(Report, eventStore)),
  ]).pipe(map(([mutes, reports]) => collect(mutes, reports)));
}

const short = (relay: string) => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
const ago = (created: number) => {
  const s = unixNow() - created;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  return s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};

type Show = "all" | "muted" | "reported" | "both";
type View = "users" | "topics";

const SORTS = {
  total: (t: Target) => new Set([...t.muters, ...t.reporters]).size,
  muters: (t: Target) => t.muters.size,
  reporters: (t: Target) => t.reporters.size,
  last: (t: Target) => t.last,
};
type SortKey = keyof typeof SORTS;

export default function SocialGraphModeration() {
  const [pubkey, setPubkey] = useState(DEFAULT_PUBKEY);
  const [view, setView] = useState<View>("users");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<SortKey>("total");
  const [minGraph, setMinGraph] = useState(1);
  const [reason, setReason] = useState<ReportReason>();
  const [selected, setSelected] = useState<string>();

  // The graph is emitted once per pubkey, so the sync and the aggregation share one stable array
  const graph = use$(() => (pubkey ? socialGraph$(pubkey) : undefined), [pubkey]);
  const status = use$(() => graph && syncGraph(graph), [graph]);
  const moderation = use$(() => graph && graphModeration$(graph), [graph]);

  const members = useMemo(() => new Set(graph), [graph]);
  const targets = moderation?.targets ?? [];
  const shown = useMemo(
    () =>
      targets
        .filter(
          (t) =>
            SORTS.total(t) >= minGraph &&
            (!reason || t.reasons[reason]) &&
            (show === "all" ||
              (show === "muted" && t.muters.size > 0) ||
              (show === "reported" && t.reporters.size > 0) ||
              (show === "both" && t.muters.size > 0 && t.reporters.size > 0)),
        )
        .sort((a, b) => SORTS[sort](b) - SORTS[sort](a) || b.muters.size - a.muters.size),
    [targets, minGraph, reason, show, sort],
  );
  const current = targets.find((t) => t.pubkey === selected);
  const syncing = !!graph && !status?.done;

  return (
    <div className="flex min-h-0 grow flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <PubkeyPicker
          value={pubkey}
          onChange={(pk) => {
            setPubkey(pk);
            setSelected(undefined);
          }}
          className="max-w-xl"
        />
        <PreviewToggle />
        <RelayStatus statuses={status?.relays ?? {}} syncing={syncing} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Stat label="👥 Graph" value={graph?.length} />
        <Stat
          label="🔇 Mute lists"
          value={moderation?.lists}
          detail={moderation?.hidden && `${moderation.hidden} 🔒`}
        />
        <Stat label="🚩 Reports" value={moderation?.reports} />
        <Stat label="🎯 Muted users" value={targets.filter((t) => t.muters.size > 0).length} />
        <Stat label="🎯 Reported users" value={targets.filter((t) => t.reporters.size > 0).length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="join">
          {(["users", "topics"] as const).map((v) => (
            <button key={v} className={`btn join-item ${view === v ? "btn-primary" : ""}`} onClick={() => setView(v)}>
              {v === "users" ? "👤 Users" : "# Topics"}
            </button>
          ))}
        </div>
        {view === "users" && (
          <>
            <div className="join">
              {(
                [
                  ["all", "All"],
                  ["muted", "🔇"],
                  ["reported", "🚩"],
                  ["both", "🔇+🚩"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={`btn join-item ${show === value ? "btn-primary" : ""}`}
                  title={value === "both" ? "Muted and reported" : value}
                  onClick={() => setShow(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              className="select w-48"
              value={minGraph}
              onChange={(e) => setMinGraph(Number(e.target.value))}
              aria-label="Minimum graph members"
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}+ graph members
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
              <strong>{shown.length.toLocaleString()}</strong> of {targets.length.toLocaleString()} users
            </span>
          </>
        )}
      </div>

      {view === "users" ? (
        <div className="flex min-h-0 flex-1 gap-3">
          <TargetTable
            targets={shown}
            members={members}
            sort={sort}
            onSort={setSort}
            selected={selected}
            onSelect={setSelected}
          />
          {current && <TargetDetails key={current.pubkey} target={current} onClose={() => setSelected(undefined)} />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <TopicList title="# Muted hashtags" prefix="#" topics={moderation?.hashtags ?? []} />
          <TopicList title="🔤 Muted words" topics={moderation?.words ?? []} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value?: number; detail?: string | number }) {
  return (
    <div className="flex min-w-36 flex-col border border-base-300 px-3 py-2">
      <span className="text-sm opacity-60">{label}</span>
      <span className="text-xl font-semibold tabular-nums">
        {value === undefined ? <span className="loading loading-dots loading-sm" /> : value.toLocaleString()}
      </span>
      {detail ? <span className="text-sm opacity-60">{detail}</span> : null}
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

/** The graph's outboxes picked for the sync with the state of each, collapsed to a summary */
function RelayStatus({ statuses, syncing }: { statuses: Record<string, SyncRelayStatus>; syncing: boolean }) {
  const relays = Object.values(statuses);
  const complete = relays.filter((r) => r.state === "complete").length;

  return (
    <details className="flex-1">
      <summary className="btn">
        {syncing ? <span className="loading loading-spinner loading-sm" /> : "✓"}
        📡 {complete} / {relays.length}
        <span className="tabular-nums opacity-70">↓ {relays.reduce((n, r) => n + r.count, 0).toLocaleString()}</span>
      </summary>
      <div className="mt-2 flex flex-wrap gap-1">
        {relays.map((status) => (
          <span
            key={status.relay}
            className={`badge badge-outline gap-1 ${status.state === "error" ? "badge-error" : status.state === "complete" ? "badge-success" : "badge-ghost"}`}
            title={[status.relay, status.method && `via ${status.method}`, status.error?.message]
              .filter(Boolean)
              .join("\n")}
          >
            {STATE_ICONS[status.state]}
            {status.method === "negentropy" && "⇄"}
            {short(status.relay)}
            <span className="tabular-nums opacity-70">{status.count}</span>
          </span>
        ))}
      </div>
    </details>
  );
}

/** A modal warning about sensitive content that must be accepted before anything is revealed */
function SensitiveWarning({
  action,
  onAccept,
  onCancel,
}: {
  action: string;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <dialog
      className="modal"
      ref={(dialog) => {
        if (dialog && !dialog.open) dialog.showModal();
      }}
      onClose={onCancel}
    >
      <div className="modal-box rounded-none border border-warning">
        <h3 className="text-lg font-bold">⚠️ Sensitive content</h3>
        <p className="py-3">
          Muted and reported users can have profile pictures, banners, bios and notes showing nudity, violence or
          illegal material.
        </p>
        <div className="modal-action">
          <button className="btn" onClick={onCancel}>
            Keep hidden
          </button>
          <button className="btn btn-warning" onClick={onAccept}>
            {action}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Switches how sensitive content is shown, warning the user before leaving hidden */
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
            title={`${p} images and content`}
            onClick={() => pick(p)}
          >
            {PREVIEW_ICONS[p]}
          </button>
        ))}
      </div>
      {pending && (
        <SensitiveWarning
          action={`${PREVIEW_ICONS[pending]} Show ${pending}`}
          onAccept={() => {
            preview$.next(pending);
            setPending(undefined);
          }}
          onCancel={() => setPending(undefined)}
        />
      )}
    </>
  );
}

/** Hides sensitive text behind a warning, or blurs it, until the user reveals it */
function Sensitive({ children }: { children: ReactNode }) {
  const preview = use$(preview$);
  const [revealed, setRevealed] = useState(false);
  const [warning, setWarning] = useState(false);

  if (preview === "visible" || revealed) return children;
  // Blurred means the user already accepted the warning, a click reveals one item
  if (preview === "blurred")
    return (
      <div className="cursor-pointer blur-sm select-none" title="Click to reveal" onClick={() => setRevealed(true)}>
        {children}
      </div>
    );
  return (
    <>
      <button className="btn btn-ghost btn-sm justify-start" onClick={() => setWarning(true)}>
        ⚠️ Sensitive
      </button>
      {warning && (
        <SensitiveWarning action="👁️ Show this" onAccept={() => setRevealed(true)} onCancel={() => setWarning(false)} />
      )}
    </>
  );
}

/** A profile picture, a placeholder while previews are hidden */
function Avatar({ pubkey, className = "size-8" }: { pubkey: string; className?: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  const preview = use$(preview$);

  // Don't request the image at all while hidden
  if (preview === "hidden")
    return (
      <span
        title={profile?.displayName}
        className={`flex shrink-0 items-center justify-center rounded-full bg-base-300 ${className}`}
      >
        👤
      </span>
    );
  return (
    <img
      src={profile?.picture ?? `https://robohash.org/${pubkey}.png`}
      title={profile?.displayName}
      className={`shrink-0 rounded-full object-cover ${preview === "blurred" ? "blur-sm" : ""} ${className}`}
      loading="lazy"
    />
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

/** The muted and reported users in a virtualized table, click a header to sort and a row to open the user */
function TargetTable({
  targets,
  members,
  sort,
  onSort,
  selected,
  onSelect,
}: {
  targets: Target[];
  members: Set<string>;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  selected?: string;
  onSelect: (pubkey: string) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: targets.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => targets[index].pubkey,
    estimateSize: () => 49,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);
  const header = (key: SortKey, label: string, title: string) => (
    <th className="text-right" title={title}>
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
            {header("total", "👥", "Graph members that muted or reported")}
            {header("muters", "🔇", "Muted by")}
            {header("reporters", "🚩", "Reported by")}
            <th className="w-48">Reasons</th>
            {header("last", "Last", "Newest report")}
          </tr>
        </thead>
        <tbody>
          {before > 0 && <tr style={{ height: before }} />}
          {items.map((item) => {
            const target = targets[item.index];
            return (
              <tr
                key={item.key}
                className={`cursor-pointer hover:bg-base-200 ${selected === target.pubkey ? "bg-base-200" : ""}`}
                onClick={() => onSelect(target.pubkey)}
              >
                <td className="opacity-60 tabular-nums">{item.index + 1}</td>
                <td className="max-w-64">
                  <span className="flex items-center gap-1">
                    <UserName pubkey={target.pubkey} />
                    {members.has(target.pubkey) && <span title="In the graph">🤝</span>}
                  </span>
                </td>
                <td className="text-right tabular-nums">{SORTS.total(target)}</td>
                <td className="text-right tabular-nums">{target.muters.size || ""}</td>
                <td className="text-right tabular-nums">{target.reporters.size || ""}</td>
                <td>
                  <ReasonStrip reasons={target.reasons} />
                </td>
                <td className="text-right tabular-nums">{target.last ? ago(target.last) : ""}</td>
              </tr>
            );
          })}
          {after > 0 && <tr style={{ height: after }} />}
        </tbody>
      </table>
      {targets.length === 0 && <div className="p-6 text-center opacity-60">No users</div>}
    </div>
  );
}

/** The selected user with the graph members that muted them and every report the graph made about them */
function TargetDetails({ target, onClose }: { target: Target; onClose: () => void }) {
  const user = castUser(target.pubkey, eventStore);
  const profile = use$(() => castUser(target.pubkey, eventStore).profile$, [target.pubkey]);
  const preview = use$(preview$);
  const reports = useMemo(
    () => [...target.reports].sort((a, b) => b.event.created_at - a.event.created_at),
    [target.reports],
  );

  return (
    <aside className="w-[28rem] shrink-0 overflow-y-auto border border-base-300">
      {profile?.banner && preview !== "hidden" && (
        <img src={profile.banner} className={`h-24 w-full object-cover ${preview === "blurred" ? "blur-md" : ""}`} />
      )}
      <div className="flex items-start gap-3 p-3">
        <Avatar pubkey={target.pubkey} className="size-14" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-lg font-semibold">{profile?.displayName ?? user.npub.slice(0, 16)}</span>
          {profile?.dnsIdentity && <span className="truncate text-sm opacity-60">{profile.dnsIdentity}</span>}
          <span className="truncate font-mono text-sm opacity-60">{user.npub}</span>
        </div>
        <button className="btn btn-square btn-ghost btn-sm" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {profile?.about && (
        <div className="px-3 pb-3">
          <Sensitive>
            <p className="line-clamp-4 whitespace-pre-wrap opacity-80">{profile.about}</p>
          </Sensitive>
        </div>
      )}

      {target.muters.size > 0 && (
        <div className="border-t border-base-300 p-3">
          <div className="mb-2 font-semibold">🔇 Muted by {target.muters.size}</div>
          <div className="flex flex-wrap gap-1">
            {[...target.muters].map((pubkey) => (
              <Avatar key={pubkey} pubkey={pubkey} />
            ))}
          </div>
        </div>
      )}

      {reports.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-base-300 p-3">
          <div className="font-semibold">🚩 Reported by {target.reporters.size}</div>
          <ReasonStrip reasons={target.reasons} className="h-3" />
          {reports.map((report) => (
            <ReportItem key={report.id} report={report} pubkey={target.pubkey} />
          ))}
        </div>
      )}
    </aside>
  );
}

/** One report by a graph member with its reason, comment and the first reported event */
function ReportItem({ report, pubkey }: { report: Report; pubkey: string }) {
  const reason = reportedUsersOf(report).get(pubkey) ?? reasonOf(report);
  const pointer = report.reportedEventPointers[0];

  return (
    <div className="flex flex-col gap-1 border border-base-300 p-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex min-w-0 flex-1">
          <UserName pubkey={report.event.pubkey} />
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS[reason] }} />
          {reason}
        </span>
        <span className="opacity-60">{ago(report.event.created_at)}</span>
      </div>
      {report.comment && <p className="whitespace-pre-wrap break-words opacity-80">“{report.comment}”</p>}
      {pointer && <ReportedEvent pointer={pointer} />}
    </div>
  );
}

/** A reported event loaded on demand through the unified event loader */
function ReportedEvent({ pointer }: { pointer: EventPointer }) {
  const event = use$(() => eventStore.event(pointer), [pointer.id]);

  return (
    <div className="border-s-2 border-base-300 ps-2">
      {event ? (
        <Sensitive>
          <NoteContent event={event} maxLength={300} />
        </Sensitive>
      ) : (
        <span className="flex items-center gap-2 font-mono text-sm opacity-60">
          <span className="loading loading-dots loading-sm" />
          {pointer.id.slice(0, 16)}…
        </span>
      )}
    </div>
  );
}

/** Muted hashtags or words ranked by how many graph members mute them */
function TopicList({ title, topics, prefix = "" }: { title: string; topics: Topic[]; prefix?: string }) {
  const max = topics[0]?.muters.size ?? 1;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border border-base-300">
      <div className="border-b border-base-300 p-3 font-semibold">
        {title} <span className="opacity-60">{topics.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {topics.slice(0, 200).map((topic) => (
          <div key={topic.value} className="flex items-center gap-2 px-3 py-1">
            <span className="w-40 truncate" title={topic.value}>
              {prefix}
              {topic.value}
            </span>
            <div className="h-2 flex-1">
              <div className="h-full rounded bg-primary" style={{ width: `${(topic.muters.size / max) * 100}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums">{topic.muters.size}</span>
            <span className="flex -space-x-2">
              {[...topic.muters].slice(0, 5).map((pubkey) => (
                <Avatar key={pubkey} pubkey={pubkey} className="size-6" />
              ))}
            </span>
          </div>
        ))}
        {topics.length === 0 && <div className="p-6 text-center opacity-60">Nothing muted</div>}
      </div>
    </div>
  );
}
