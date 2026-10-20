/**
 * Look up any user and sync every zap they sent with NIP-77 to see who they zapped, which events they zapped and their zapping activity over time
 * @tags nip-57, nip-77, nip-65, zap, dashboard, sync, negentropy, chart.js, react-chartjs-2
 * @related zap/zap-history, notifications/zaps, loader/sync-loader
 */
import { castUser, type User, Zap } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore } from "applesauce-core";
import {
  type AddressPointer,
  type EventPointer,
  getDisplayName,
  getProfilePicture,
  getReplaceableAddressFromPointer,
  getSeenRelays,
  kinds,
  type NostrEvent,
  relaySet,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from "chart.js";
import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  auditTime,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  type Observable,
  of,
  switchMap,
  take,
  timeout,
} from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Loads profiles, relay lists and zapped events on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

// Zap receipts are published to the relays in the zap request, which are often popular relays instead of the user's own
const EXTRA_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const DEFAULT_PUBKEY = "5c508c34f58866ec7341aaf10cc1af52e9232bb9f859c8103ca5ecf2aa93bf78";
const TOP_LIMIT = 10;
const PAGE_SIZE = 25;
const DAY = 86400;

type Metric = "sats" | "count";
type Bucket = "day" | "week" | "month";
type Total = { sats: number; count: number };

const pubkey$ = new BehaviorSubject(DEFAULT_PUBKEY);
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** The zap receipts sent by a user, LNURL servers copy the sender into the uppercase P tag */
const sentFilter = (pubkey: string) => ({ kinds: [kinds.Zap], "#P": [pubkey] });

/** Waits briefly for a relay list so a user without one still syncs from the fallback relays */
const relayList = (relays$: Observable<string[] | undefined>) =>
  relays$.pipe(defined(), take(1), timeout({ first: 5_000, with: () => of([]) }));

/** Syncs every zap the user sent from their outboxes, inboxes and popular relays in a single sync loader run */
function sync$(user: User): Observable<SyncLoaderStatus> {
  return combineLatest([relayList(user.outboxes$), relayList(user.inboxes$)]).pipe(
    // Subscribing to status$ starts the run, and every received event is added to the store
    switchMap(
      ([outboxes, inboxes]) =>
        syncLoader({ relays: relaySet(outboxes, inboxes, EXTRA_RELAYS), filter: sentFilter(user.pubkey) }).status$,
    ),
  );
}

// ---------------------------------------------------------------------------
// Zaps
// ---------------------------------------------------------------------------

const sats = (zap: Zap) => Math.floor(zap.amount / 1000);

/** Every zap in the store sent by the user, verified against the sender in the embedded zap request */
function sentZaps$(pubkey: string): Observable<Zap[]> {
  return eventStore.timeline(sentFilter(pubkey)).pipe(
    auditTime(250),
    castTimelineStream(Zap, eventStore),
    map((zaps) => zaps.filter((zap) => zap.sender.pubkey === pubkey)),
  );
}

/** The pointer to the event a zap was for, or undefined for profile zaps */
const zapTarget = (zap: Zap): EventPointer | AddressPointer | undefined =>
  zap.addressPointer ?? zap.eventPointer ?? undefined;

/** A stable key for the zapped event, addresses survive replaceable event revisions */
const targetKey = (pointer: EventPointer | AddressPointer) =>
  "identifier" in pointer ? getReplaceableAddressFromPointer(pointer) : pointer.id;

type Recipient = Total & { pubkey: string };
type Target = Total & { id: string; pointer: EventPointer | AddressPointer; zap: Zap };
type Stats = Total & { largest: number; recipients: Recipient[]; targets: Target[]; profileZaps: number };

/** Totals the zaps by recipient and by zapped event */
function getStats(zaps: Zap[]): Stats {
  const recipients = new Map<string, Recipient>();
  const targets = new Map<string, Target>();
  const stats = { sats: 0, count: zaps.length, largest: 0, profileZaps: 0 };

  for (const zap of zaps) {
    const amount = sats(zap);
    stats.sats += amount;
    stats.largest = Math.max(stats.largest, amount);

    const pubkey = zap.recipient.pubkey;
    const recipient = recipients.get(pubkey) ?? { pubkey, sats: 0, count: 0 };
    recipients.set(pubkey, { ...recipient, sats: recipient.sats + amount, count: recipient.count + 1 });

    const pointer = zapTarget(zap);
    if (!pointer) {
      stats.profileZaps++;
      continue;
    }
    const id = targetKey(pointer);
    const target = targets.get(id) ?? { id, pointer, zap, sats: 0, count: 0 };
    targets.set(id, { ...target, sats: target.sats + amount, count: target.count + 1 });
  }

  const bySats = <T extends Total>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.sats - a.sats);
  return { ...stats, recipients: bySats(recipients), targets: bySats(targets) };
}

/** Picks a bucket size that keeps the chart readable for the span of the zaps */
function getBucket(zaps: Zap[]): Bucket {
  if (zaps.length === 0) return "day";
  const span = zaps[0].event.created_at - zaps[zaps.length - 1].event.created_at;
  if (span <= 60 * DAY) return "day";
  if (span <= 540 * DAY) return "week";
  return "month";
}

/** Returns the local start of the bucket containing a date */
function bucketStart(date: Date, bucket: Bucket): Date {
  if (bucket === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (bucket === "week") day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** Returns the start of the following bucket */
function nextBucket(date: Date, bucket: Bucket): Date {
  if (bucket === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (bucket === "week" ? 7 : 1));
}

const bucketFormat: Record<Bucket, Intl.DateTimeFormat> = {
  day: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
  week: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "2-digit" }),
  month: new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }),
};

/** Totals the zaps into consecutive time buckets, including empty ones so gaps in activity are visible */
function getTimeline(zaps: Zap[], bucket: Bucket) {
  const totals = new Map<number, Total>();
  for (const zap of zaps) {
    const start = bucketStart(zap.createdAt, bucket).getTime();
    const total = totals.get(start) ?? { sats: 0, count: 0 };
    totals.set(start, { sats: total.sats + sats(zap), count: total.count + 1 });
  }

  const buckets: (Total & { label: string })[] = [];
  if (zaps.length === 0) return buckets;
  const end = zaps[0].createdAt;
  for (let date = bucketStart(zaps[zaps.length - 1].createdAt, bucket); date <= end; date = nextBucket(date, bucket))
    buckets.push({
      label: bucketFormat[bucket].format(date),
      ...(totals.get(date.getTime()) ?? { sats: 0, count: 0 }),
    });
  return buckets;
}

/** The zapped event, zap pointers rarely have relay hints so it is also loaded from the recipient's outboxes */
function zappedEvent$(target: Target): Observable<NostrEvent | undefined> {
  const { pointer, zap } = target;
  return zap.recipient.outboxes$.pipe(
    map((outboxes) => relaySet(pointer.relays, outboxes, [...(getSeenRelays(zap.event) ?? [])])),
    distinctUntilChanged((a, b) => a.join() === b.join()),
    switchMap((relays) => eventStore.event({ ...pointer, relays })),
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const numberFormat = new Intl.NumberFormat();
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact" });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const contentCache = Symbol("zap-dashboard-content");
const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => <span className="text-primary">{node.value}</span>,
  mention: ({ node }) => <span className="text-primary">nostr:{node.encoded.slice(0, 16)}…</span>,
  hashtag: ({ node }) => <span>#{node.name}</span>,
  emoji: ({ node }) => <img src={node.url} alt={node.raw} title={node.raw} className="inline-block h-5 w-5" />,
  gallery: ({ node }) => <span className="text-primary">[{node.links.length} media]</span>,
};

function NoteContent({ event }: { event: NostrEvent }) {
  const content = useRenderedContent(event, components, { cacheKey: contentCache, maxLength: 160 });
  return <div className="whitespace-pre-wrap break-words line-clamp-3">{content}</div>;
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
  return <span className="font-semibold">{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>;
}

function Amount({ sats, count }: Total) {
  return (
    <div className="shrink-0 text-right">
      <div className="font-semibold text-warning">⚡{numberFormat.format(sats)}</div>
      <div className="text-sm text-base-content/60">
        {count} zap{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function SyncStatus({ status }: { status?: SyncLoaderStatus }) {
  if (!status) return <div className="text-sm text-base-content/60">Looking up relays…</div>;
  const relays = Object.values(status.relays);
  const finished = relays.filter((r) => r.state === "complete" || r.state === "error").length;
  const negentropy = relays.filter((r) => r.method === "negentropy").length;
  const failed = relays.filter((r) => r.state === "error").length;

  return (
    <details className="text-sm text-base-content/60">
      <summary className="cursor-pointer">
        {status.done ? null : <span className="loading loading-spinner loading-sm align-middle me-2" />}
        {status.done ? "Synced" : "Syncing"} {finished}/{relays.length} relays ({negentropy} negentropy) ·{" "}
        {status.loaded} new events
        {failed ? <span className="text-error"> · {failed} failed</span> : null}
      </summary>
      <div className="mt-2 border border-base-300 rounded-box divide-y divide-base-300">
        {relays.map((r) => (
          <div key={r.relay} className="flex gap-3 px-3 py-1">
            <span className="flex-1 truncate">{r.relay}</span>
            <span>{r.method ?? "—"}</span>
            <span className={r.state === "error" ? "text-error" : ""} title={r.error?.message}>
              {r.state}
            </span>
            <span className="w-12 text-right">{r.count}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function TimelineChart({ zaps }: { zaps: Zap[] }) {
  const [metric, setMetric] = useState<Metric>("sats");
  const bucket = getBucket(zaps);
  const timeline = useMemo(() => getTimeline(zaps, bucket), [zaps, bucket]);

  const data = {
    labels: timeline.map((b) => b.label),
    datasets: [
      {
        label: metric === "sats" ? "Sats" : "Zaps",
        data: timeline.map((b) => b[metric]),
        backgroundColor: "#f59e0b",
        borderRadius: 4,
        maxBarThickness: 24,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
      y: {
        beginAtZero: true,
        grid: { color: "rgba(128, 128, 128, 0.15)" },
        ticks: { callback: (v: string | number) => compactFormat.format(Number(v)) },
      },
    },
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold flex-1">
          {metric === "sats" ? "Sats" : "Zaps"} sent per {bucket}
        </h3>
        <div className="join">
          {(["sats", "count"] as const).map((m) => (
            <button
              key={m}
              className={`btn btn-sm join-item ${metric === m ? "btn-active" : ""}`}
              onClick={() => setMetric(m)}
            >
              {m === "sats" ? "Sats" : "Count"}
            </button>
          ))}
        </div>
      </div>
      <div className="h-64 border border-base-300 rounded-box p-3">
        <Bar data={data} options={options} />
      </div>
    </section>
  );
}

function RecipientRow({ recipient, onSelect }: { recipient: Recipient; onSelect: () => void }) {
  const user = useMemo(() => castUser(recipient.pubkey, eventStore), [recipient.pubkey]);
  return (
    <button
      className="flex items-center gap-3 w-full text-left py-2 border-b border-base-300 hover:bg-base-200"
      onClick={onSelect}
    >
      <Avatar user={user} />
      <div className="flex-1 min-w-0 truncate">
        <Name user={user} />
      </div>
      <Amount {...recipient} />
    </button>
  );
}

function TargetRow({ target }: { target: Target }) {
  const event = use$(() => zappedEvent$(target), [target.id]);
  return (
    <div className="flex gap-3 py-2 border-b border-base-300">
      <Avatar user={target.zap.recipient} />
      <div className="flex-1 min-w-0">
        {!event ? (
          <span className="text-base-content/60">Loading zapped event…</span>
        ) : event.content ? (
          <NoteContent event={event} />
        ) : (
          <span className="text-base-content/60">kind {event.kind} event</span>
        )}
      </div>
      <Amount {...target} />
    </div>
  );
}

function ZapRow({ zap }: { zap: Zap }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-base-300">
      <Avatar user={zap.recipient} />
      <div className="flex-1 min-w-0">
        <div className="truncate">
          <Name user={zap.recipient} />
          <span className="text-sm text-base-content/60 ms-2">{dateFormat.format(zap.createdAt)}</span>
        </div>
        {zap.request.content ? <div className="truncate text-base-content/70">{zap.request.content}</div> : null}
      </div>
      <span className="shrink-0 font-semibold text-warning">⚡{numberFormat.format(sats(zap))}</span>
    </div>
  );
}

function Dashboard({ user }: { user: User }) {
  const [recipient, setRecipient] = useState<string | undefined>(undefined);
  const [recent, setRecent] = useState(PAGE_SIZE);
  const [showAll, setShowAll] = useState(false);

  // The sync writes into the store while the dashboard renders purely from store queries
  const status = use$(() => sync$(user), [user.pubkey]);
  const all = use$(() => sentZaps$(user.pubkey), [user.pubkey]);

  // Narrow everything to a single recipient when one is selected
  const zaps = useMemo(
    () => (recipient ? all?.filter((zap) => zap.recipient.pubkey === recipient) : all) ?? [],
    [all, recipient],
  );
  const stats = useMemo(() => getStats(zaps), [zaps]);
  const selected = useMemo(() => (recipient ? castUser(recipient, eventStore) : undefined), [recipient]);

  if (!all || (all.length === 0 && !status?.done))
    return (
      <div className="p-6 space-y-3">
        <SyncStatus status={status} />
        <span className="loading loading-dots" />
      </div>
    );

  return (
    <div className="max-w-5xl w-full mx-auto p-6 space-y-6">
      <SyncStatus status={status} />

      {selected ? (
        <div className="flex items-center gap-3 border border-base-300 rounded-box px-3 py-2">
          <span className="text-base-content/60">Zaps to</span>
          <Avatar user={selected} />
          <Name user={selected} />
          <button className="btn btn-sm btn-ghost ms-auto" onClick={() => setRecipient(undefined)}>
            Show everyone
          </button>
        </div>
      ) : null}

      {zaps.length === 0 ? (
        <div className="text-center text-base-content/60 py-12">No zaps sent by this user were found</div>
      ) : (
        <>
          <div className="stats stats-vertical sm:stats-horizontal border border-base-300 w-full">
            <div className="stat">
              <div className="stat-title">Sent</div>
              <div className="stat-value text-warning">⚡{compactFormat.format(stats.sats)}</div>
              <div className="stat-desc">{numberFormat.format(stats.sats)} sats</div>
            </div>
            <div className="stat">
              <div className="stat-title">Zaps</div>
              <div className="stat-value">{numberFormat.format(stats.count)}</div>
              <div className="stat-desc">avg ⚡{numberFormat.format(Math.round(stats.sats / stats.count))}</div>
            </div>
            <div className="stat">
              <div className="stat-title">People</div>
              <div className="stat-value">{numberFormat.format(stats.recipients.length)}</div>
              <div className="stat-desc">{stats.profileZaps} profile zaps</div>
            </div>
            <div className="stat">
              <div className="stat-title">Events</div>
              <div className="stat-value">{numberFormat.format(stats.targets.length)}</div>
              <div className="stat-desc">largest ⚡{numberFormat.format(stats.largest)}</div>
            </div>
          </div>

          <TimelineChart zaps={zaps} />

          <div className="grid md:grid-cols-2 gap-6">
            {selected ? null : (
              <section>
                <h3 className="font-semibold mb-2">People zapped</h3>
                {stats.recipients.slice(0, showAll ? undefined : TOP_LIMIT).map((r) => (
                  <RecipientRow key={r.pubkey} recipient={r} onSelect={() => setRecipient(r.pubkey)} />
                ))}
                {stats.recipients.length > TOP_LIMIT ? (
                  <button className="btn btn-ghost btn-sm w-full" onClick={() => setShowAll(!showAll)}>
                    {showAll ? "Show top 10" : `Show all ${stats.recipients.length}`}
                  </button>
                ) : null}
              </section>
            )}
            <section className={selected ? "md:col-span-2" : ""}>
              <h3 className="font-semibold mb-2">Top zapped events</h3>
              {stats.targets.length === 0 ? <div className="text-base-content/60">Only profile zaps</div> : null}
              {stats.targets.slice(0, TOP_LIMIT).map((t) => (
                <TargetRow key={t.id} target={t} />
              ))}
            </section>
          </div>

          <section>
            <h3 className="font-semibold mb-2">Recent zaps</h3>
            {zaps.slice(0, recent).map((zap) => (
              <ZapRow key={zap.id} zap={zap} />
            ))}
            {zaps.length > recent ? (
              <button className="btn btn-ghost w-full text-primary" onClick={() => setRecent(recent + PAGE_SIZE)}>
                Load more
              </button>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

export default function ZapDashboard() {
  const pubkey = use$(pubkey$);
  const user = use$(user$);

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300">
        <PubkeyPicker value={pubkey} onChange={(pubkey) => pubkey$.next(pubkey)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {user ? (
          <Dashboard key={user.pubkey} user={user} />
        ) : (
          <div className="p-6 text-center text-base-content/60">Pick a user to see their zapping activity</div>
        )}
      </div>
    </div>
  );
}
