/**
 * A live relay feed of NIP-5A nsites with a cast-driven details dialog, snapshots, copy lineage and social activity
 * @tags nip-5a, nsite, casts, blossom, comments, reactions
 * @related napplet/store, notes/rendering
 */
import { AppHandler, castEvent, Comment, NamedNsite, Nsite, RootNsite, User } from "applesauce-common/casts";
import { APP_HANDLER_KIND, COMMENT_KIND, NSITE_KIND, NSITE_KINDS, NSITE_ROOT_KIND } from "applesauce-common/helpers";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import {
  AddressPointer,
  buildCommonEventRelationFilters,
  encodePointer,
  EventPointer,
  Filter,
  getReplaceableAddressFromPointer,
  getEventUID,
  unixNow,
  kinds,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, createTimelineLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defer,
  EMPTY,
  finalize,
  ignoreElements,
  map,
  merge,
  of,
  startWith,
  Subject,
  switchMap,
  tap,
} from "rxjs";
import JsonBlock from "../../components/json-block";
import NoteContent from "../../components/note-content";
import RelayPicker from "../../components/relay-picker";
import { relayTimeline } from "../../extra/relay-timeline";
import { lookupRelays$ } from "../../settings";

const DEFAULT_RELAY = "wss://relay.nsite.lol/";
const NSITE_RELAYS = [DEFAULT_RELAY];
type Pointer = AddressPointer | EventPointer;
type Select = (site: Nsite) => void;
type Tab = "overview" | "versions" | "activity" | "raw";

const eventStore = new EventStore();
const pool = new RelayPool();
const relay$ = new BehaviorSubject(DEFAULT_RELAY);
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: relay$.pipe(map((relay) => [relay])),
});

function siteName(site: Nsite) {
  return (
    site.title ||
    (site.isNamed
      ? castEvent(site.event, NamedNsite, site.store).identifier
      : site.isSnapshot
        ? "Manifest snapshot"
        : "Root site")
  );
}
function addressable(site: Nsite) {
  return site.isRoot
    ? castEvent(site.event, RootNsite, site.store)
    : site.isNamed
      ? castEvent(site.event, NamedNsite, site.store)
      : undefined;
}
function safeLink(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function Author({ user }: { user: User }) {
  const profile = use$(() => user.profile$, [user]);
  return (
    <span className="inline-flex items-center gap-2 min-w-0" title={user.npub}>
      {safeLink(profile?.picture) && (
        <img src={profile?.picture} alt="" className="size-7 rounded-full object-cover" loading="lazy" />
      )}
      <span className="truncate">{profile?.displayName || `${user.npub.slice(0, 14)}…`}</span>
    </span>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-base-300 py-5 space-y-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <dt className="text-base-content/60">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}
function SiteLink({ site, select }: { site: Nsite; select: Select }) {
  return (
    <button
      className="w-full flex flex-wrap gap-x-3 gap-y-1 py-3 text-left hover:bg-base-200 border-b border-base-300"
      onClick={() => select(site)}
    >
      <span className="font-medium">{siteName(site)}</span>
      <span className="text-base-content/60">{site.isSnapshot ? "Snapshot" : site.isRoot ? "Root" : "Named"}</span>
      <span className="text-sm text-base-content/60">
        <Author user={site.author} /> · {site.createdAt.toLocaleString()}
      </span>
    </button>
  );
}
function Sites({ sites, select, empty }: { sites: Nsite[] | undefined; select: Select; empty: string }) {
  if (!sites) return <p role="status">Loading…</p>;
  return sites.length ? (
    <div>
      {sites.map((site) => (
        <SiteLink key={site.uid} site={site} select={select} />
      ))}
    </div>
  ) : (
    <p className="text-base-content/60">{empty}</p>
  );
}

// Collection relationships are store queries, so explicitly subscribe to their relay filters.
function relatedFilters(site: Nsite): Filter[] {
  const filters = buildCommonEventRelationFilters(
    { kinds: [COMMENT_KIND, kinds.Reaction, kinds.Zap, kinds.Repost, kinds.GenericRepost], limit: 200 },
    site.event,
  );
  filters.push(
    site.coordinate
      ? { kinds: [COMMENT_KIND], "#A": [site.coordinate], limit: 200 }
      : { kinds: [COMMENT_KIND], "#E": [site.id], limit: 200 },
  );
  const coordinates = new Set(
    [
      site.coordinate,
      site.parentPointer && getReplaceableAddressFromPointer(site.parentPointer),
      site.rootPointer && getReplaceableAddressFromPointer(site.rootPointer),
    ].filter((value): value is string => !!value),
  );
  for (const coordinate of coordinates) {
    filters.push({ kinds: NSITE_KINDS, "#a": [coordinate], limit: 200 });
    filters.push({ kinds: NSITE_KINDS, "#A": [coordinate], limit: 200 });
  }
  filters.push({ kinds: [NSITE_ROOT_KIND, NSITE_KIND], authors: [site.author.pubkey], limit: 100 });
  return filters;
}
function LoadStatus({ status }: { status: { status: string; errors: string[] } | undefined }) {
  if (!status || status.status === "loading")
    return (
      <p role="status" className="text-sm text-base-content/60">
        Loading related events…
      </p>
    );
  if (status.errors.length)
    return (
      <p role="alert" className="text-error">
        Some related events could not be loaded: {status.errors.join("; ")}
      </p>
    );
  return (
    <p className="text-sm text-base-content/60">
      {status.status === "live"
        ? "Related events are live on the selected relay."
        : "Relay subscription closed; showing loaded events."}
    </p>
  );
}

function UpstreamApp({ pointer, select }: { pointer: AddressPointer; select: Select }) {
  // NIP-5A app tags can reference any addressable app kind; only NIP-89 handlers (kind 31990) are understood here
  const handler = use$(
    () =>
      pointer.kind === APP_HANDLER_KIND
        ? eventStore.replaceable(pointer).pipe(castEventStream(AppHandler, eventStore))
        : undefined,
    [pointer],
  );
  const address = getReplaceableAddressFromPointer(pointer);
  if (!handler) return <p className="break-all text-base-content/60">App unavailable: {address}</p>;
  return <AppHandlerSites handler={handler} select={select} />;
}
function AppHandlerSites({ handler, select }: { handler: AppHandler; select: Select }) {
  const latest = use$(() => handler.latest$, [handler]);
  // Multi-letter app tags cannot be queried with a NIP-01 tag filter. Filter the loaded relay manifests locally through the cast.
  const sites = use$(() => handler.nsites$, [handler]);
  use$(
    () =>
      relay$.pipe(
        switchMap((relay) =>
          relayTimeline(eventStore, pool, [relay], {
            kinds: NSITE_KINDS,
            authors: [handler.author.pubkey],
            limit: 100,
          }),
        ),
      ),
    [handler],
  );
  return (
    <div className="border-l-2 border-base-300 pl-3 space-y-2">
      <p className="font-semibold">{handler.name}</p>
      <Author user={handler.author} />
      {latest && <Sites sites={[latest]} select={select} empty="" />}
      <Sites sites={sites} select={select} empty="No linked manifests loaded." />
    </div>
  );
}
function Overview({ site, select }: { site: Nsite; select: Select }) {
  const servers = use$(() => site.servers$, [site]);
  const address = use$(() => site.address$, [site]);
  const authorSites = use$(() => site.author.nsites$, [site]);
  const profile = use$(() => site.author.profile$, [site]);
  const rootSite = use$(() => profile?.nsite$, [profile]);
  const [host, setHost] = useState("nsite.run");
  const [path, setPath] = useState("/");
  const resolved = site.resolvePath(path);
  let siteURL: string | undefined;
  try {
    siteURL = safeLink(site.url(host).href);
  } catch {
    /* Keep invalid host input editable. */
  }
  return (
    <>
      <dl className="space-y-3 py-4">
        <Field label="Author">
          <Author user={site.author} />
        </Field>
        <Field label="Published">{site.createdAt.toLocaleString()}</Field>
        <Field label="Kind">
          {site.kind} · {site.isSnapshot ? "Snapshot" : site.isNamed ? "Named site" : "Root site"}
        </Field>
        <Field label="Nostr address">
          <code>{address || site.address}</code>
        </Field>
        <Field label="Aggregate hash">
          <code>{site.aggregateHash || "Not advertised"}</code>
        </Field>
        <Field label="Hash verification">
          <span
            className={
              site.aggregateHash && site.aggregateHash !== site.computedAggregateHash
                ? "text-error"
                : "text-base-content/60"
            }
          >
            {!site.aggregateHash
              ? "No advertised hash to compare"
              : site.aggregateHash === site.computedAggregateHash
                ? "Matches the file manifest"
                : "Does not match the file manifest"}
          </span>
        </Field>
        {site.source && (
          <Field label="Source">
            {safeLink(site.source) ? (
              <a className="link" href={safeLink(site.source)} target="_blank" rel="noopener noreferrer">
                {site.source}
              </a>
            ) : (
              <code>{site.source}</code>
            )}
          </Field>
        )}
      </dl>
      <Section title="Open site">
        <label className="flex flex-wrap gap-3 items-center">
          Host domain
          <input
            aria-label="Nsite host domain"
            className="input border-base-300"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </label>
        {siteURL ? (
          <a className="link break-all" href={siteURL} target="_blank" rel="noopener noreferrer">
            {siteURL}
          </a>
        ) : (
          <p className="text-error">Enter a valid host domain.</p>
        )}
      </Section>
      <Section title={`Files (${site.files.length})`}>
        <label className="flex flex-wrap items-center gap-3">
          Resolve a path
          <input
            aria-label="Resolve a path"
            className="input border-base-300"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <p className="text-sm text-base-content/60">
          {resolved ? `${path} → ${resolved.path}` : "No matching file or /404.html fallback."}
        </p>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Path</th>
                <th>SHA-256</th>
                <th>Blob</th>
              </tr>
            </thead>
            <tbody>
              {site.files.map((file, i) => (
                <tr key={`${file.path}:${i}`}>
                  <td className="font-mono">{file.path}</td>
                  <td className="font-mono break-all min-w-48">{file.sha256}</td>
                  <td>
                    {servers?.[0] && safeLink(servers[0].href) ? (
                      <a
                        className="link"
                        href={new URL(file.sha256, servers[0]).href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open blob
                      </a>
                    ) : (
                      "No server"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Blossom servers">
        <p className="text-sm text-base-content/60">Manifest hints first, followed by the author's server list.</p>
        {servers?.length ? (
          <ul className="space-y-2">
            {servers.map((server) => (
              <li key={server.href} className="break-all">
                {server.href}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base-content/60">No server hints or author servers loaded.</p>
        )}
      </Section>
      <Section title="Upstream apps">
        {!site.appPointers.length && <p className="text-base-content/60">No upstream apps referenced.</p>}
        {site.appPointers.map((pointer) => (
          <UpstreamApp key={getReplaceableAddressFromPointer(pointer)} pointer={pointer} select={select} />
        ))}
      </Section>
      <Section title="More from this author">
        {rootSite && rootSite.uid !== site.uid && (
          <div>
            <span className="text-sm text-base-content/60">Profile's root site</span>
            <SiteLink site={rootSite} select={select} />
          </div>
        )}
        <Sites
          sites={authorSites?.filter((other) => other.uid !== site.uid)}
          select={select}
          empty="No other sites found on this relay."
        />
      </Section>
    </>
  );
}

function ParentLink({
  label,
  site,
  pointer,
  select,
}: {
  label: string;
  site?: Nsite;
  pointer?: AddressPointer;
  select: Select;
}) {
  if (!pointer) return null;
  return (
    <div>
      <p className="text-base-content/60">{label}</p>
      {site ? (
        <SiteLink site={site} select={select} />
      ) : (
        <p className="font-mono break-all">Referenced site unavailable: {getReplaceableAddressFromPointer(pointer)}</p>
      )}
    </div>
  );
}
function VersionList({ site, select }: { site: RootNsite | NamedNsite; select: Select }) {
  const snapshots = use$(() => site.snapshots$, [site]);
  const copies = use$(() => site.copies$, [site]);
  const lineage = use$(() => site.lineage$, [site]);
  return (
    <>
      <Section title={`Snapshots (${snapshots?.length ?? 0})`}>
        <Sites sites={snapshots} select={select} empty="No snapshots found on this relay." />
      </Section>
      <Section title={`Direct copies (${copies?.length ?? 0})`}>
        <Sites sites={copies} select={select} empty="No direct copies found on this relay." />
      </Section>
      <Section title={`Origin lineage (${lineage?.length ?? 0})`}>
        <Sites
          sites={lineage}
          select={select}
          empty="No copied sites or snapshots reference this site as their origin."
        />
      </Section>
    </>
  );
}
function Versions({ site, select }: { site: Nsite; select: Select }) {
  const parent = use$(() => site.parent$, [site]);
  const root = use$(() => site.root$, [site]);
  const current = addressable(site);
  const source = parent && addressable(parent);
  return (
    <>
      <Section title="Parent and origin">
        {!site.parentPointer && !site.rootPointer && (
          <p className="text-base-content/60">An original manifest with no copy lineage.</p>
        )}
        <ParentLink
          label={site.isSnapshot ? "Snapshot of" : "Copied from"}
          site={parent}
          pointer={site.parentPointer}
          select={select}
        />
        <ParentLink label="Lineage origin" site={root} pointer={site.rootPointer} select={select} />
      </Section>
      {current ? (
        <VersionList site={current} select={select} />
      ) : source ? (
        <>
          <p className="py-3 text-base-content/60">Other versions and copies of {siteName(source)}.</p>
          <VersionList site={source} select={select} />
        </>
      ) : (
        <p className="py-4 text-base-content/60">
          Version history is unavailable until the snapshot's parent manifest is loaded.
        </p>
      )}
    </>
  );
}

function CommentItem({ comment, relay, depth = 0 }: { comment: Comment; relay: string; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const replies = use$(() => comment.replies$, [comment]);
  const reactions = use$(() => comment.reactions$, [comment]);
  const related = use$(
    () =>
      expanded
        ? relayTimeline(
            eventStore,
            pool,
            [relay],
            buildCommonEventRelationFilters({ kinds: [COMMENT_KIND, kinds.Reaction], limit: 100 }, comment.event),
          )
        : undefined,
    [expanded, comment, relay],
  );
  return (
    <div className="border-l-2 border-base-300 pl-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-base-content/60">
        <Author user={comment.author} />
        <time dateTime={comment.createdAt.toISOString()}>{comment.createdAt.toLocaleString()}</time>
      </div>
      <NoteContent event={comment.event} />
      {depth < 3 && (
        <button className="btn btn-sm btn-ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide replies" : "Show replies"} ({replies?.length ?? 0}) · {reactions?.length ?? 0} reactions
        </button>
      )}
      {expanded && (
        <div className="space-y-2">
          <LoadStatus status={related} />
          {replies?.length ? (
            replies.map((reply) => <CommentItem key={reply.id} comment={reply} relay={relay} depth={depth + 1} />)
          ) : (
            <p className="text-sm text-base-content/60">No replies loaded.</p>
          )}
        </div>
      )}
    </div>
  );
}
function Activity({ site, relay }: { site: Nsite; relay: string }) {
  const comments = use$(() => site.comments$, [site]);
  const reactions = use$(() => site.reactions$, [site]);
  const zaps = use$(() => site.zaps$, [site]);
  const shares = use$(() => site.shares$, [site]);
  const sats = (zaps?.reduce((sum, zap) => sum + zap.amount, 0) ?? 0) / 1000;
  return (
    <>
      <Section title={`Comments (${comments?.length ?? 0})`}>
        {comments?.length ? (
          comments.map((comment) => <CommentItem key={comment.id} comment={comment} relay={relay} />)
        ) : (
          <p className="text-base-content/60">No comments found on this relay.</p>
        )}
      </Section>
      <Section title={`Reactions (${reactions?.length ?? 0})`}>
        {reactions?.length ? (
          <ul>
            {reactions.map((reaction) => (
              <li key={reaction.id} className="flex flex-wrap gap-3 py-2 border-b border-base-300">
                <span className="font-medium">{reaction.content}</span>
                <Author user={reaction.author} />
                <time className="text-sm text-base-content/60">{reaction.createdAt.toLocaleString()}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base-content/60">No reactions found on this relay.</p>
        )}
      </Section>
      <Section title={`Zaps (${zaps?.length ?? 0}) · ${sats.toLocaleString()} sats`}>
        {zaps?.length ? (
          <ul>
            {zaps.map((zap) => (
              <li key={zap.id} className="flex flex-wrap gap-3 py-2 border-b border-base-300">
                <span>{(zap.amount / 1000).toLocaleString()} sats</span>
                <Author user={zap.sender} />
                <NoteContent event={zap.request} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base-content/60">No zap receipts found on this relay.</p>
        )}
      </Section>
      <Section title={`Shares (${shares?.length ?? 0})`}>
        {shares?.length ? (
          <ul>
            {shares.map((share) => (
              <li key={share.id} className="flex flex-wrap gap-3 py-2 border-b border-base-300">
                <Author user={share.author} />
                <time className="text-sm text-base-content/60">{share.createdAt.toLocaleString()}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base-content/60">No shares found on this relay.</p>
        )}
      </Section>
    </>
  );
}

function Details({ site, relay, select }: { site: Nsite; relay: string; select: Select }) {
  const [tab, setTab] = useState<Tab>("overview");
  const related = use$(() => relayTimeline(eventStore, pool, [relay], relatedFilters(site)), [relay, site]);
  return (
    <>
      <h2 id="nsite-dialog-title" className="text-2xl font-bold break-words">
        {siteName(site)}
      </h2>
      <div className="text-base-content/60 flex flex-wrap items-center gap-2 py-2">
        <Author user={site.author} />
        <span>· {site.isSnapshot ? "Snapshot" : site.isRoot ? "Root site" : "Named site"}</span>
      </div>
      {site.description && <p className="whitespace-pre-wrap py-3">{site.description}</p>}
      <div role="tablist" aria-label="Site details" className="flex flex-wrap border-b border-base-300 mb-3">
        {(
          [
            ["overview", "Overview"],
            ["versions", "Versions & lineage"],
            ["activity", "Activity"],
            ["raw", "Raw event"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            id={`nsite-tab-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls="nsite-tab-panel"
            className={`px-4 py-3 border-b-2 ${tab === value ? "border-primary text-primary" : "border-transparent"}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <LoadStatus status={related} />
      <div id="nsite-tab-panel" role="tabpanel" aria-labelledby={`nsite-tab-${tab}`}>
        {tab === "overview" && <Overview site={site} select={select} />}
        {tab === "versions" && <Versions site={site} select={select} />}
        {tab === "activity" && <Activity site={site} relay={relay} />}
        {tab === "raw" && (
          <div className="py-4">
            <JsonBlock value={site.event} />
          </div>
        )}
      </div>
    </>
  );
}
function DetailsDialog({ pointer, relay, close }: { pointer: Pointer; relay: string; close: () => void }) {
  const [history, setHistory] = useState<Pointer[]>([pointer]);
  const current = history[history.length - 1];
  const site = use$(() => eventStore.event(current).pipe(castEventStream(Nsite, eventStore)), [current]);
  const select: Select = (next) => setHistory((history) => [...history, next.pointer]);
  return (
    <dialog
      ref={(dialog) => {
        if (dialog && !dialog.open) dialog.showModal();
      }}
      onCancel={close}
      onClose={close}
      aria-labelledby="nsite-dialog-title"
      className="modal"
    >
      <div className="modal-box w-11/12 max-w-5xl max-h-[90dvh] overflow-y-auto border border-base-300 shadow-none">
        <div className="flex items-center justify-between gap-3 mb-4">
          <button
            className="btn btn-sm btn-ghost"
            disabled={history.length < 2}
            onClick={() => setHistory((history) => history.slice(0, -1))}
          >
            ← Back
          </button>
          <button className="btn btn-sm btn-outline" onClick={close} aria-label="Close nsite details">
            Close
          </button>
        </div>
        {site ? (
          <Details key={site.uid} site={site} relay={relay} select={select} />
        ) : (
          <div>
            <h2 id="nsite-dialog-title" className="text-xl font-semibold">
              Site unavailable
            </h2>
            <p className="py-4 text-base-content/60">
              Loading the referenced manifest. It may be unavailable or invalid.
            </p>
            <code className="break-all">{encodePointer(current)}</code>
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="Close details backdrop">Close</button>
      </form>
    </dialog>
  );
}

// Keep one subscription to the stateful loader while scroll triggers advance its window.
function pagedFeed(relay: string, more$: Subject<void>) {
  return defer(() => {
    const filter = { kinds: [NSITE_ROOT_KIND, NSITE_KIND] };
    const seen = new Set<string>();
    const page$ = new BehaviorSubject({ loading: true, done: false, error: "" });
    const loader = createTimelineLoader(
      (relays, filters) =>
        defer(() => {
          let count = 0;
          let oldest = Infinity;
          page$.next({ loading: true, done: false, error: "" });
          return pool.request(relays, filters).pipe(
            tap((event) => {
              count++;
              oldest = Math.min(oldest, event.created_at);
              seen.add(getEventUID(event));
              eventStore.add(event);
            }),
            catchError((error) => {
              page$.next({ loading: false, done: false, error: String(error.message ?? error) });
              return EMPTY;
            }),
            finalize(() => {
              const until = filters[0]?.until;
              page$.next({
                ...page$.value,
                loading: false,
                done: !page$.value.error && (count === 0 || (until !== undefined && oldest - 1 >= until)),
              });
            }),
          );
        }),
      [relay],
      filter,
      { limit: 50 },
    );
    const loading$ = merge(
      loader({}), // Anchor the shared loader so later triggers preserve its cursor.
      more$.pipe(
        startWith(undefined),
        switchMap(() => loader()),
      ),
    ).pipe(ignoreElements(), startWith(null));
    return combineLatest([
      relayTimeline(eventStore, pool, [relay], { ...filter, since: unixNow(), limit: 50 }),
      eventStore.timeline(filter),
      page$,
      loading$,
    ]).pipe(
      map(([live, events, page]) => {
        const liveSeen = new Set(live.events.map(getEventUID));
        return {
          ...live,
          page,
          errors: [...live.errors, ...(page.error ? [page.error] : [])],
          events: events.filter((event) => seen.has(getEventUID(event)) || liveSeen.has(getEventUID(event))),
        };
      }),
    );
  });
}

export default function NsiteFeed() {
  const relay = use$(relay$);
  const more$ = useMemo(() => new Subject<void>(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Pointer | null>(null);
  const feed = use$(
    () =>
      pagedFeed(relay, more$).pipe(
        switchMap((result) =>
          of(result.events).pipe(
            castTimelineStream(Nsite, eventStore),
            map((sites) => ({ ...result, sites })),
          ),
        ),
        // The relay helper scopes the store's revision-aware timeline to events received from this relay.
        // Cast only those events, not every nsite the detail loaders have added to the store.
      ),
    [relay, more$, refresh],
  );
  const sites = feed?.sites;
  // Reobserve after each page: a sentinel that still fills the viewport loads another page.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !feed || feed.page.loading || feed.page.done || feed.page.error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) more$.next();
      },
      { root: scrollRef.current, rootMargin: "0px 0px 300px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [feed?.page, more$, relay, refresh]);
  const changeRelay = (value: string) => {
    setSelected(null);
    relay$.next(value);
  };
  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex flex-wrap items-end gap-4 p-4 border-b border-base-300">
        <label className="flex-1 min-w-64 space-y-2">
          <span>Relay</span>
          <RelayPicker value={relay} onChange={changeRelay} common={NSITE_RELAYS} className="w-full" />
        </label>
        <button className="btn btn-outline" onClick={() => setRefresh(refresh + 1)}>
          Reload feed
        </button>
        <span className="pb-3 text-base-content/60">
          {sites?.length ?? 0} sites ·{" "}
          {feed?.status === "live" ? "Live" : feed?.status === "closed" ? "Closed" : "Connecting…"}
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {feed?.errors.length ? (
          <div role="alert" className="p-4 text-error">
            {feed.errors.join("; ")}
          </div>
        ) : null}
        {!sites?.length && (
          <p role="status" className="p-8 text-center text-base-content/60">
            {!feed || feed.page.loading
              ? "Loading nsites…"
              : feed.errors.length
                ? "Unable to load sites from this relay."
                : "No valid root or named sites found on this relay."}
          </p>
        )}
        {sites?.map((site) => (
          <button
            key={site.uid}
            className="w-full text-left p-5 border-b border-base-300 hover:bg-base-200 flex flex-col gap-2"
            onClick={() => setSelected(site.pointer)}
          >
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-xl font-semibold break-words">{siteName(site)}</h2>
              <span className="text-sm text-base-content/60">
                {site.isRoot ? "Root" : "Named"} · {site.files.length} files
              </span>
            </div>
            {site.description && <p className="line-clamp-2 whitespace-pre-wrap">{site.description}</p>}
            <div className="flex flex-wrap items-center gap-3 text-sm text-base-content/60">
              <Author user={site.author} />
              <time dateTime={site.createdAt.toISOString()}>{site.createdAt.toLocaleString()}</time>
            </div>
          </button>
        ))}
        <div ref={sentinelRef} role="status" className="p-4 text-center text-base-content/60">
          {feed?.page.loading ? "Loading more sites…" : feed?.page.done ? "All sites loaded." : "Scroll for more sites"}
        </div>
      </div>
      {selected && <DetailsDialog pointer={selected} relay={relay} close={() => setSelected(null)} />}
    </div>
  );
}
