/**
 * A creator dashboard that syncs every zap the signed in user received with NIP-77, summarizes earnings and lets the creator thank zappers with comments and reactions
 * @tags nip-57, nip-77, nip-22, nip-25, zap, notifications, dashboard, sync, actions
 * @related notifications/mentions, zap/zap-history, zap/timeline, comment/feed
 */
import { ProxySigner } from "applesauce-accounts";
import { type Action, ActionRunner } from "applesauce-actions";
import { castUser, type User, Zap } from "applesauce-common/casts";
import { CommentFactory, ReactionFactory } from "applesauce-common/factories";
import { COMMENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore } from "applesauce-core";
import {
  fakeVerifyEvent,
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  kinds,
  markFromCache,
  persistEventsToCache,
  relaySet,
  unixNow,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { addProfilePointerTag } from "applesauce-core/operations/tag/common";
import {
  createEventLoaderForStore,
  createSyncLoader,
  type SyncLoaderStatus,
  type SyncLoadRequest,
} from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Check, Heart, MessageCircle, Zap as ZapIcon } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useMemo, useState } from "react";
import {
  auditTime,
  BehaviorSubject,
  catchError,
  combineLatest,
  concatWith,
  defer,
  distinctUntilChanged,
  EMPTY,
  ignoreElements,
  map,
  merge,
  type Observable,
  of,
  scan,
  shareReplay,
  switchMap,
  tap,
} from "rxjs";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

/** Skips signature verification for cached events, they were verified by the event store before they were saved */
function trustCached(events: NostrEvent[]) {
  for (const event of events) fakeVerifyEvent(event);
  return events;
}

// The default nostr-idb IndexedDB database, shared with the other cache examples
const cache = await openDB();
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

createEventLoaderForStore(eventStore, pool, {
  cacheRequest: (filters) => getEventsForFilters<NostrEvent>(cache, filters).then(trustCached),
  lookupRelays: lookupRelays$,
});

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

// Zap receipts are published to the relays in the zap request, which are often popular relays instead of the inboxes
const EXTRA_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const RESPONSE_KINDS = [COMMENT_KIND, kinds.Reaction];
const QUICK_REACTIONS = ["🤙", "🙏", "⚡", "❤️"];
const PAGE_SIZE = 50;
const DAY = 86400;

/** A range from a number of days ago up to now */
type Range = { since: number; days: number };
type ListFilter = "all" | "unanswered";
type SyncSummary = { relays: number; negentropy: number; failed: number; events: number; done: boolean };
type LoadMessage = { key: string; status: SyncLoaderStatus } | { key: string; event: NostrEvent };

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));
const range$ = new BehaviorSubject<Range>({ since: unixNow() - 30 * DAY, days: 30 });

// The runner follows the signed in account and saves published responses to the store so the UI updates instantly
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  const responses = await pool.publish(relays?.length ? relays : EXTRA_RELAYS, event);
  if (!responses.some((r) => r.ok)) throw new Error("No relay accepted the event");
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const hydrated = new Map<string, Observable<never>>();

/** Loads the cached events matching a filter into the store once, so negentropy only syncs what the cache is missing */
function hydrate(filter: Filter): Observable<never> {
  const key = JSON.stringify(filter);
  let hydrate$ = hydrated.get(key);
  if (!hydrate$) {
    hydrate$ = defer(() => getEventsForFilters<NostrEvent>(cache, [filter])).pipe(
      tap((events) => {
        for (const event of events) {
          markFromCache(event);
          fakeVerifyEvent(event);
          eventStore.add(event);
        }
      }),
      ignoreElements(),
      catchError(() => EMPTY),
      shareReplay(1),
    );
    hydrated.set(key, hydrate$);
  }
  return hydrate$;
}

/** Hydrates the filter from the cache, then runs a single sync load and tags its messages with a key */
function load(key: string, request: SyncLoadRequest): Observable<LoadMessage> {
  return hydrate(request.filter).pipe(
    concatWith(
      defer(() => {
        const { status$, events$ } = syncLoader(request);
        return merge(status$.pipe(map((status) => ({ key, status }))), events$.pipe(map((event) => ({ key, event }))));
      }),
    ),
  );
}

/** Reduces the messages of many loads into a single summary of relays, negentropy support and synced events */
function summarize(messages$: Observable<LoadMessage>): Observable<SyncSummary> {
  return messages$.pipe(
    scan(
      (state, message) => {
        if ("status" in message) state.statuses.set(message.key, message.status);
        else state.events.add(message.event.id);
        return state;
      },
      { statuses: new Map<string, SyncLoaderStatus>(), events: new Set<string>() },
    ),
    auditTime(100),
    map(({ statuses, events }): SyncSummary => {
      const all = [...statuses.values()];
      const relays = new Map<string, boolean>();
      const failed = new Set<string>();
      for (const status of all)
        for (const r of Object.values(status.relays)) {
          relays.set(r.relay, relays.get(r.relay) || r.method === "negentropy");
          if (r.state === "error") failed.add(r.relay);
        }
      return {
        relays: relays.size,
        negentropy: [...relays.values()].filter(Boolean).length,
        failed: failed.size,
        events: events.size,
        done: all.every((status) => status.done),
      };
    }),
  );
}

/** Applies the range to a filter */
const inRange = (filter: Filter, range: Range): Filter => ({ ...filter, since: range.since });

/** The zap receipts sent to the user */
const zapsFilter = (pubkey: string): Filter => ({ kinds: [kinds.Zap], "#p": [pubkey] });
/** The comments and reactions the user published, used to tell which zaps were answered */
const responsesFilter = (pubkey: string): Filter => ({ kinds: RESPONSE_KINDS, authors: [pubkey] });

/** Syncs the zaps from the user's inboxes and popular relays, and the user's responses from their outboxes */
function dashboardSync$(user: User, range: Range): Observable<SyncSummary> {
  const inboxes$ = user.inboxes$.pipe(map((inboxes) => relaySet(EXTRA_RELAYS, inboxes)));
  const outboxes$ = user.outboxes$.pipe(defined());
  return defer(() =>
    summarize(
      merge(
        // The loader starts each relay as the inboxes and outboxes load, without restarting the others
        load("zaps", { relays: inboxes$, filter: inRange(zapsFilter(user.pubkey), range) }),
        load("responses", { relays: outboxes$, filter: inRange(responsesFilter(user.pubkey), range) }),
      ),
    ),
  );
}

/** Subscribes to new zaps as they arrive */
function liveZaps$(user: User) {
  const filter = { ...zapsFilter(user.pubkey), since: unixNow() };
  return user.inboxes$.pipe(
    defined(),
    switchMap((inboxes) => pool.subscription(relaySet(inboxes, EXTRA_RELAYS), filter, { eventStore })),
  );
}

// ---------------------------------------------------------------------------
// Zaps and responses
// ---------------------------------------------------------------------------

const sats = (zap: Zap) => Math.floor(zap.amount / 1000);

/** Every zap in the store that the user received within the range, ignoring zaps the user sent themselves */
function zaps$(pubkey: string, range: Range): Observable<Zap[]> {
  return eventStore.timeline(inRange(zapsFilter(pubkey), range)).pipe(
    auditTime(100),
    castTimelineStream(Zap, eventStore),
    map((zaps) => zaps.filter((zap) => zap.sender.pubkey !== pubkey)),
  );
}

/** The event a zap was for, zap pointers rarely have relay hints so it is also loaded from the creator's outboxes */
function zappedEvent$(zap: Zap, user: User): Observable<NostrEvent | undefined> {
  const pointer = zap.addressPointer ?? zap.eventPointer;
  if (!pointer) return of(undefined);
  return user.outboxes$.pipe(
    map((outboxes) => relaySet(pointer.relays, outboxes, [...(getSeenRelays(zap.event) ?? [])], EXTRA_RELAYS)),
    distinctUntilChanged((a, b) => a.join() === b.join()),
    switchMap((relays) => eventStore.event({ ...pointer, relays })),
  );
}

/** The comments and reactions the user published on a zap receipt */
function responses$(zap: Zap, pubkey: string): Observable<NostrEvent[]> {
  return eventStore.timeline({ kinds: RESPONSE_KINDS, authors: [pubkey], "#e": [zap.id] });
}

/** The set of zap ids the user has responded to */
function answered$(pubkey: string): Observable<Set<string>> {
  return eventStore.timeline(responsesFilter(pubkey)).pipe(
    auditTime(100),
    map((events) => new Set(events.flatMap((e) => e.tags.filter((t) => t[0] === "e").map((t) => t[1])))),
  );
}

type Stats = {
  total: number;
  count: number;
  zappers: { pubkey: string; sats: number; count: number }[];
  content: { id: string; sats: number; count: number }[];
};

/** Totals the zaps by sender and by zapped event */
function getStats(zaps: Zap[]): Stats {
  const zappers = new Map<string, { pubkey: string; sats: number; count: number }>();
  const content = new Map<string, { id: string; sats: number; count: number }>();
  let total = 0;
  for (const zap of zaps) {
    total += sats(zap);
    const sender = zappers.get(zap.sender.pubkey) ?? { pubkey: zap.sender.pubkey, sats: 0, count: 0 };
    zappers.set(sender.pubkey, { ...sender, sats: sender.sats + sats(zap), count: sender.count + 1 });
    const id = zap.eventPointer?.id;
    if (!id) continue;
    const target = content.get(id) ?? { id, sats: 0, count: 0 };
    content.set(id, { ...target, sats: target.sats + sats(zap), count: target.count + 1 });
  }
  const top = <T extends { sats: number }>(m: Map<string, T>) =>
    [...m.values()].sort((a, b) => b.sats - a.sats).slice(0, 5);
  return { total, count: zaps.length, zappers: top(zappers), content: top(content) };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Relays for a response: the sender's inboxes, the user's outboxes and the relays the receipt was seen on */
async function responseRelays(zap: Zap, user: User) {
  const [inboxes, outboxes] = await Promise.all([
    zap.sender.inboxes$.$first(1_000, undefined),
    user.outboxes$.$first(1_000, undefined),
  ]);
  return relaySet(inboxes, outboxes, [...(getSeenRelays(zap.event) ?? [])]);
}

/** Comments on a zap receipt and tags the sender, the receipt itself is authored by the zapper's lightning service */
function ReplyToZap(zap: Zap, content: string): Action {
  return async ({ signer, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const comment = await CommentFactory.create(zap.event, content)
      .modifyPublicTags(addProfilePointerTag(zap.sender.pubkey))
      .sign(signer);
    await publish(comment, await responseRelays(zap, user));
  };
}

/** Reacts to a zap receipt and tags the sender */
function ReactToZap(zap: Zap, emoji: string): Action {
  return async ({ signer, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const reaction = await ReactionFactory.create(zap.event, emoji)
      .modifyPublicTags(addProfilePointerTag(zap.sender.pubkey))
      .sign(signer);
    await publish(reaction, await responseRelays(zap, user));
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const contentCache = Symbol("zaps-note-content");

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a className="link" href={node.href} target="_blank" rel="noopener noreferrer">
      {node.value}
    </a>
  ),
  mention: ({ node }) => <span className="text-primary">nostr:{node.encoded.slice(0, 16)}…</span>,
  hashtag: ({ node }) => <span>#{node.name}</span>,
  emoji: ({ node }) => <img src={node.url} alt={node.raw} title={node.raw} className="inline-block h-5 w-5" />,
  gallery: ({ node }) => <span className="text-primary">[{node.links.length} media]</span>,
};

function NoteContent({ event, maxLength }: { event: NostrEvent; maxLength?: number }) {
  const content = useRenderedContent(event, components, { cacheKey: contentCache, maxLength });
  return <div className="whitespace-pre-wrap break-words">{content}</div>;
}

const numberFormat = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Avatar({ user, size = "size-8" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}`)}
      className={`${size} rounded-full bg-base-200 shrink-0`}
    />
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="font-semibold">{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>;
}

const PRESETS = [1, 7, 30, 90, 365];

function RangePicker({ range }: { range: Range }) {
  return (
    <div className="join">
      {PRESETS.map((days) => (
        <button
          key={days}
          className={`btn btn-sm join-item ${range.days === days ? "btn-active" : ""}`}
          onClick={() => range$.next({ since: unixNow() - days * DAY, days })}
        >
          {days === 365 ? "1y" : `${days}d`}
        </button>
      ))}
    </div>
  );
}

function SyncStatus({ summary }: { summary?: SyncSummary }) {
  if (!summary) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-base-content/60">
      {summary.done ? null : <span className="loading loading-spinner loading-sm" />}
      {summary.done ? "Synced" : "Syncing"} {summary.relays} relays ({summary.negentropy} negentropy) · {summary.events}{" "}
      events
      {summary.failed ? <span className="text-error">· {summary.failed} failed</span> : null}
    </div>
  );
}

function ZapItem({
  zap,
  answered,
  selected,
  onSelect,
}: {
  zap: Zap;
  answered: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`flex gap-3 w-full text-left px-4 py-3 border-b border-base-300 border-l-2 hover:bg-base-200 ${selected ? "bg-base-200 border-l-primary" : "border-l-transparent"}`}
      onClick={onSelect}
    >
      <Avatar user={zap.sender} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate">
            <Name user={zap.sender} />
          </span>
          <span className="ms-auto shrink-0 font-semibold text-warning">⚡{numberFormat.format(sats(zap))}</span>
        </div>
        {zap.request.content || answered ? (
          <div className="flex items-center gap-2 text-sm text-base-content/70">
            <span className="truncate flex-1">{zap.request.content}</span>
            {answered ? <Check size={16} className="text-success shrink-0" /> : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

/** Describes the kind of event that was zapped */
function zappedType(kind: number) {
  if (kind === kinds.ShortTextNote) return "note";
  if (kind === kinds.LongFormArticle) return "article";
  if (kind === COMMENT_KIND) return "comment";
  return `kind ${kind} event`;
}

function ZappedEvent({ zap, user }: { zap: Zap; user: User }) {
  const event = use$(() => zappedEvent$(zap, user), [zap.id, user.pubkey]);
  if (!zap.eventPointer && !zap.addressPointer) return <div className="text-base-content/60">Zapped your profile</div>;
  if (!event) return <div className="text-base-content/60">Loading zapped event…</div>;
  return (
    <div className="border border-base-300 rounded-box p-3 space-y-2">
      <div className="text-sm text-base-content/60">
        For your {zappedType(event.kind)} from {dateFormat.format(event.created_at * 1000)}
      </div>
      <NoteContent event={event} maxLength={400} />
    </div>
  );
}

function Response({ event }: { event: NostrEvent }) {
  return (
    <div className="flex gap-2 items-baseline">
      {event.kind === kinds.Reaction ? <Heart size={16} /> : <MessageCircle size={16} />}
      <span className="flex-1 whitespace-pre-wrap break-words">{event.content}</span>
      <span className="text-sm text-base-content/60 shrink-0">{dateFormat.format(event.created_at * 1000)}</span>
    </div>
  );
}

function RespondForm({ zap }: { zap: Zap }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: Action) => {
    setBusy(true);
    setError("");
    try {
      await actions.run(() => action);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        className="textarea w-full"
        rows={3}
        placeholder="Say thanks…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_REACTIONS.map((emoji) => (
          <button key={emoji} className="btn btn-sm" disabled={busy} onClick={() => run(ReactToZap(zap, emoji))}>
            {emoji}
          </button>
        ))}
        <button
          className="btn btn-sm btn-primary ms-auto"
          disabled={busy || !text.trim()}
          onClick={() => run(ReplyToZap(zap, text.trim()))}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : "Reply"}
        </button>
      </div>
      {error ? <div className="text-error text-sm">{error}</div> : null}
    </div>
  );
}

function ZapDetail({ zap, user }: { zap: Zap; user: User }) {
  const responses = use$(() => responses$(zap, user.pubkey), [zap.id, user.pubkey]);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Avatar user={zap.sender} size="size-10" />
        <div className="flex-1 min-w-0">
          <Name user={zap.sender} />
          <div className="text-sm text-base-content/60">{dateFormat.format(zap.createdAt)}</div>
        </div>
        <div className="text-2xl font-bold text-warning">⚡{numberFormat.format(sats(zap))}</div>
      </div>

      {zap.request.content ? <p className="text-lg whitespace-pre-wrap break-words">{zap.request.content}</p> : null}
      <ZappedEvent zap={zap} user={user} />

      <section className="space-y-3 border-t border-base-300 pt-4">
        <h3 className="font-semibold">Your responses</h3>
        {responses?.length ? responses.map((e) => <Response key={e.id} event={e} />) : null}
        <RespondForm zap={zap} />
      </section>
    </div>
  );
}

function TopContent({ id, sats, count }: { id: string; sats: number; count: number }) {
  const event = use$(() => eventStore.event(id), [id]);
  return (
    <div className="flex gap-3 py-2 border-b border-base-300">
      <div className="flex-1 min-w-0 text-sm">
        {event ? <NoteContent event={event} maxLength={120} /> : <span className="text-base-content/60">Loading…</span>}
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold text-warning">⚡{numberFormat.format(sats)}</div>
        <div className="text-sm text-base-content/60">{count} zaps</div>
      </div>
    </div>
  );
}

function TopZapper({ pubkey, sats, count }: { pubkey: string; sats: number; count: number }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  return (
    <div className="flex items-center gap-3 py-2 border-b border-base-300">
      <Avatar user={user} />
      <div className="flex-1 min-w-0 truncate">
        <Name user={user} />
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold text-warning">⚡{numberFormat.format(sats)}</div>
        <div className="text-sm text-base-content/60">{count} zaps</div>
      </div>
    </div>
  );
}

function Overview({ zaps, unanswered }: { zaps: Zap[]; unanswered: number }) {
  const stats = useMemo(() => getStats(zaps), [zaps]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="stats stats-vertical sm:stats-horizontal border border-base-300 w-full">
        <div className="stat">
          <div className="stat-title">Received</div>
          <div className="stat-value text-warning">⚡{numberFormat.format(stats.total)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Zaps</div>
          <div className="stat-value">{stats.count}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Needs reply</div>
          <div className="stat-value">{unanswered}</div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h3 className="font-semibold mb-2">Top zappers</h3>
          {stats.zappers.map((z) => (
            <TopZapper key={z.pubkey} {...z} />
          ))}
        </section>
        <section>
          <h3 className="font-semibold mb-2">Top content</h3>
          {stats.content.map((c) => (
            <TopContent key={c.id} {...c} />
          ))}
        </section>
      </div>
    </div>
  );
}

function Dashboard({ user, range }: { user: User; range: Range }) {
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState<ListFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Re-syncing an overlapping range is cheap, negentropy only transfers what the store is missing
  const summary = use$(() => dashboardSync$(user, range), [user.pubkey, range]);
  use$(() => liveZaps$(user), [user.pubkey]);

  // Render purely from the event store
  const data = use$(
    () => combineLatest({ zaps: zaps$(user.pubkey, range), answered: answered$(user.pubkey) }),
    [user.pubkey, range],
  );
  const zaps = data?.zaps;
  const unanswered = zaps?.filter((zap) => !data?.answered.has(zap.id)) ?? [];
  const visible = filter === "all" ? zaps : unanswered;
  const zap = zaps?.find((z) => z.id === selected);

  return (
    <div className="flex min-h-0 grow w-full">
      <section className="w-md shrink-0 border-r border-base-300 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-base-300 space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold flex items-center gap-2 flex-1">
              <ZapIcon size={18} /> Zaps
            </h1>
            <div className="join">
              <button
                className={`btn btn-sm join-item ${filter === "all" ? "btn-active" : ""}`}
                onClick={() => setFilter("all")}
              >
                All {zaps?.length ?? ""}
              </button>
              <button
                className={`btn btn-sm join-item ${filter === "unanswered" ? "btn-active" : ""}`}
                onClick={() => setFilter("unanswered")}
              >
                Needs reply {unanswered.length}
              </button>
            </div>
          </div>
          <SyncStatus summary={summary} />
        </div>
        <div className="overflow-y-auto min-h-0 flex-1">
          {!visible ? (
            <div className="p-6 text-center">
              <span className="loading loading-dots" />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-6 text-center text-base-content/60">
              {summary?.done ? "No zaps in this range" : "Looking for zaps…"}
            </div>
          ) : (
            visible
              .slice(0, limit)
              .map((z) => (
                <ZapItem
                  key={z.id}
                  zap={z}
                  answered={!!data?.answered.has(z.id)}
                  selected={z.id === selected}
                  onSelect={() => setSelected(z.id)}
                />
              ))
          )}
          {visible && visible.length > limit ? (
            <button className="btn btn-ghost w-full text-primary" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Load more
            </button>
          ) : null}
        </div>
      </section>

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        {zap ? (
          <div>
            <button className="btn btn-ghost btn-sm m-3" onClick={() => setSelected(undefined)}>
              ← Overview
            </button>
            <ZapDetail key={zap.id} zap={zap} user={user} />
          </div>
        ) : (
          <Overview zaps={zaps ?? []} unanswered={unanswered.length} />
        )}
      </main>
    </div>
  );
}

export default function ZapsDashboard() {
  const user = use$(user$);
  const signer = use$(signer$);
  const range = use$(range$);

  if (!user || !signer)
    return (
      <LoginView
        onLogin={(s, pk) => {
          signer$.next(s);
          pubkey$.next(pk);
        }}
      />
    );

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300 flex flex-wrap items-center gap-3">
        <Avatar user={user} />
        <div className="flex-1">
          <Name user={user} />
        </div>
        <RangePicker range={range} />
      </div>
      <Dashboard key={user.pubkey} user={user} range={range} />
    </div>
  );
}
