/**
 * Search NIP-34 repository announcements via NIP-50 on ngit index relay
 * @tags nip-34, nip-50, git, search, reactions, feed
 * @related git/favorite-repos-feed, feed/loading-reactions, search/relay
 */
import { GitRepository, User } from "applesauce-common/casts";
import { GIT_REPOSITORY_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import {
  type Filter,
  ensureWebSocketURL,
  getDisplayName,
  getProfilePicture,
  getEventUID,
  naddrEncode,
  normalizeURL,
  npubEncode,
  relaySet,
} from "applesauce-core/helpers";
import { processTags } from "applesauce-core/helpers/tags";
import { createEventLoaderForStore, createReactionsLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useCallback, useMemo, useState } from "react";
import {
  catchError,
  combineLatest,
  defer,
  endWith,
  ignoreElements,
  map,
  of,
  startWith,
  switchMap,
  tap,
  Subject,
  exhaustMap,
  concat,
  timer,
} from "rxjs";

import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const DEFAULT_INDEX_RELAY = "wss://index.ngit.dev/";

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/", "wss://relay.ngit.dev/"],
});

const reactionLoader = createReactionsLoader(pool, { eventStore });

type SearchStatus = { status: "loading" | "done" } | { status: "error"; message: string };
type SearchState = SearchStatus & { repos: GitRepository[] };

/** Runs a NIP-50 search on one relay and renders the matching repos from the store (latest revisions only) */
function searchRepos(relay: string, query: string) {
  const filter: Filter = { kinds: [GIT_REPOSITORY_KIND], limit: 50 };
  if (query) filter.search = query;

  return defer(() => {
    // Addresses matched by this search; the store keeps only the newest revision of each
    const matches = new Set<string>();

    const status$ = pool
      .relay(relay)
      .request(filter, { timeout: 20_000 })
      .pipe(
        tap((event) => matches.add(getEventUID(event))),
        mapEventsToStore(eventStore),
        ignoreElements(),
        endWith<SearchStatus>({ status: "done" }),
        startWith<SearchStatus>({ status: "loading" }),
        catchError((err) => of<SearchStatus>({ status: "error", message: err?.message ?? "Request failed" })),
      );

    return status$.pipe(
      switchMap((status) =>
        eventStore.timeline({ kinds: [GIT_REPOSITORY_KIND] }).pipe(
          map((events) => events.filter((e) => matches.has(getEventUID(e)))),
          castTimelineStream(GitRepository, eventStore),
          map((repos): SearchState => ({ ...status, repos })),
        ),
      ),
    );
  });
}

function graspServersFromRepoTags(repo: GitRepository): string[] {
  return relaySet(processTags(repo.event.tags, (tag) => (tag[0] === "g" ? tag[1] : undefined)));
}

function endpointHostname(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** URL suitable for {@link RelayPool.relay} (NIP-11 + shared connection). */
function toPoolRelayUrl(rawUrl: string): string | null {
  try {
    let u = rawUrl.trim();
    if (u.startsWith("http:") || u.startsWith("https:")) u = ensureWebSocketURL(u);
    return normalizeURL(u);
  } catch {
    return null;
  }
}

function workshopUrl(repo: GitRepository) {
  return `https://gitworkshop.dev/${npubEncode(repo.event.pubkey)}/${encodeURIComponent(repo.identifier)}`;
}

function naddrUri(repo: GitRepository) {
  return `nostr:${naddrEncode(repo.pointer)}`;
}

function CopyButton({
  value,
  label = "Copy",
  className = "btn btn-sm",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const copy$ = useMemo(() => new Subject<void>(), []);
  const copied =
    use$(
      () =>
        copy$.pipe(
          exhaustMap(() =>
            defer(() => navigator.clipboard.writeText(value)).pipe(
              switchMap(() => concat(of(true), timer(2000).pipe(map(() => false)))),
              catchError(() => of(false)),
            ),
          ),
        ),
      [copy$, value],
    ) ?? false;

  return (
    <button
      type="button"
      className={className}
      title={value}
      onClick={(e) => {
        e.stopPropagation();
        copy$.next();
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function Avatar({ user, size = "w-9 h-9" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <div className="avatar shrink-0">
      <div className={`${size} rounded-full border border-base-300`}>
        <img src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)} alt="" />
      </div>
    </div>
  );
}

function UserName({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <>{getDisplayName(profile, user.pubkey.slice(0, 8) + "…")}</>;
}

function MaintainerChip({ user }: { user: User }) {
  return (
    <div className="flex items-center gap-2 min-w-0 max-w-[14rem] rounded border border-base-300 px-2 py-1">
      <Avatar user={user} size="w-6 h-6" />
      <span className="truncate font-medium">
        <UserName user={user} />
      </span>
    </div>
  );
}

function EndpointChip({ url, kind }: { url: string; kind: "relay" | "grasp" }) {
  const display = use$(() => {
    const relayUrl = toPoolRelayUrl(url);
    if (!relayUrl) return of({ icon: undefined as string | undefined, name: url });

    const r = pool.relay(relayUrl);
    return combineLatest({ icon: r.icon$, name: r.name$ });
  }, [url]);

  return (
    <span
      className="inline-flex items-center gap-1.5 max-w-[14rem] rounded border border-base-300 px-2 py-0.5"
      title={`${kind === "relay" ? "Relay" : "Grasp"}: ${url}`}
    >
      {display?.icon && (
        <img
          src={display.icon}
          alt=""
          className="size-4 shrink-0 rounded-sm"
          loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).hidden = true)}
        />
      )}
      <span className="truncate font-medium">{display?.name ?? endpointHostname(url)}</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Reactions({ repo, relay }: { repo: GitRepository; relay: string }) {
  const reactions = use$(repo.reactions$);
  use$(() => reactionLoader(repo.event, [relay, "wss://relay.ngit.dev/"]), [repo.id, relay]);

  const counts = new Map<string, number>();
  for (const r of reactions ?? []) counts.set(r.content || "+", (counts.get(r.content || "+") ?? 0) + 1);
  if (counts.size === 0) return null;

  return (
    <Section title="Reactions">
      <div className="flex flex-wrap gap-2">
        {[...counts].map(([emoji, count]) => (
          <span key={emoji} className="badge badge-outline gap-1">
            {emoji} {count}
          </span>
        ))}
      </div>
    </Section>
  );
}

function Upstream({ repo }: { repo: GitRepository }) {
  const upstream = use$(repo.upstream$);
  if (!upstream) return null;

  return (
    <Section title="Upstream repository">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-base-300 p-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar user={upstream.author} />
          <div className="min-w-0 text-sm truncate">
            <UserName user={upstream.author} /> / <code>{upstream.identifier}</code>
          </div>
        </div>
        <div className="flex gap-2">
          <a href={workshopUrl(upstream)} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline">
            Open
          </a>
          <CopyButton value={naddrUri(upstream)} label="Copy link" />
        </div>
      </div>
    </Section>
  );
}

function RepoDetails({ repo, relay, onClose }: { repo: GitRepository; relay: string; onClose: () => void }) {
  const graspServers = useMemo(() => graspServersFromRepoTags(repo), [repo]);

  // Open the native dialog as soon as it mounts
  const openDialog = useCallback((node: HTMLDialogElement | null) => {
    if (node && !node.open) node.showModal();
  }, []);

  return (
    <dialog
      ref={openDialog}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[90dvh] rounded border border-base-300 bg-base-100 text-base-content p-0 backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-5 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar user={repo.author} size="w-12 h-12" />
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate">{repo.name ?? repo.identifier}</h2>
              <p className="text-sm text-base-content/60 truncate">
                <UserName user={repo.author} /> / <code>{repo.identifier}</code>
              </p>
            </div>
          </div>
          <form method="dialog">
            <button className="btn btn-sm btn-ghost" aria-label="Close">
              ✕
            </button>
          </form>
        </header>

        {repo.description && <p className="text-sm text-base-content/80">{repo.description}</p>}

        <div className="flex flex-wrap gap-2">
          <a href={workshopUrl(repo)} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary">
            Open in Git Workshop
          </a>
          <CopyButton value={naddrUri(repo)} label="Copy naddr" />
          {repo.webUrls[0] && (
            <a href={repo.webUrls[0]} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline">
              Website
            </a>
          )}
        </div>

        {repo.cloneUrls.length > 0 && (
          <Section title="Clone">
            <div className="flex flex-col gap-2">
              {repo.cloneUrls.map((url) => (
                <div key={url} className="flex items-center gap-2">
                  <code className="flex-1 bg-base-200 px-2 py-1 break-all">{url}</code>
                  <CopyButton value={url} className="btn btn-sm" />
                </div>
              ))}
            </div>
          </Section>
        )}

        <Upstream repo={repo} />

        {repo.maintainers.length > 0 && (
          <Section title="Maintainers">
            <div className="flex flex-wrap gap-2">
              {repo.maintainers.map((maintainer) => (
                <MaintainerChip key={maintainer.pubkey} user={maintainer} />
              ))}
            </div>
          </Section>
        )}

        {(repo.relays.length > 0 || graspServers.length > 0) && (
          <Section title="Relays & Grasp servers">
            <div className="flex flex-wrap gap-2">
              {repo.relays.map((r) => (
                <EndpointChip key={r} url={r} kind="relay" />
              ))}
              {graspServers.map((g) => (
                <EndpointChip key={g} url={g} kind="grasp" />
              ))}
            </div>
          </Section>
        )}

        {repo.hashtags.length > 0 && (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1">
              {repo.hashtags.map((tag) => (
                <span key={tag} className="badge badge-outline">
                  {tag}
                </span>
              ))}
            </div>
          </Section>
        )}

        <Reactions repo={repo} relay={relay} />

        <div className="text-base-content/60 space-y-1">
          <div>Updated {repo.createdAt.toLocaleString()}</div>
          {repo.earliestUniqueCommit && (
            <div>
              Earliest unique commit <code className="bg-base-200 px-1">{repo.earliestUniqueCommit}</code>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

function RepoRow({ repo, onSelect }: { repo: GitRepository; onSelect: () => void }) {
  return (
    <li
      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-base-200/50"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <Avatar user={repo.author} />
      <div className="flex-1 min-w-0">
        <div className="truncate">
          <span className="font-semibold">{repo.name ?? repo.identifier}</span>
          <span className="text-sm text-base-content/60">
            {" "}
            by <UserName user={repo.author} />
          </span>
        </div>
        {repo.description && <p className="text-sm text-base-content/70 truncate">{repo.description}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <a
          href={workshopUrl(repo)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-ghost"
          onClick={(e) => e.stopPropagation()}
        >
          Open
        </a>
        <CopyButton value={naddrUri(repo)} label="Copy link" className="btn btn-sm btn-ghost" />
      </div>
    </li>
  );
}

export default function RepoSearchFeed() {
  const [relay, setRelay] = useState(DEFAULT_INDEX_RELAY);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const search = use$(() => searchRepos(relay, query), [relay, query]);
  const repos = search?.repos ?? [];
  const selectedRepo = selected ? repos.find((r) => r.uid === selected) : undefined;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <form
          className="join flex flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(String(new FormData(e.currentTarget).get("q") ?? "").trim());
          }}
        >
          <input
            name="q"
            type="search"
            className="input input-bordered join-item flex-1"
            placeholder="Search repositories (NIP-50)…"
            defaultValue={query}
          />
          <button type="submit" className="btn btn-primary join-item" disabled={search?.status === "loading"}>
            {search?.status === "loading" && <span className="loading loading-spinner loading-sm" />}
            Search
          </button>
        </form>
        <RelayPicker
          value={relay}
          onChange={(r) => setRelay(r)}
          common={[DEFAULT_INDEX_RELAY, "wss://relay.ngit.dev/", "wss://search.nos.today"]}
        />
      </div>

      {search?.status === "error" && (
        <div className="alert alert-warning mb-4" role="alert">
          {search.message}
        </div>
      )}

      {repos.length > 0 ? (
        <ul className="border border-base-300 divide-y divide-base-300">
          {repos.map((repo) => (
            <RepoRow key={repo.uid} repo={repo} onSelect={() => setSelected(repo.uid)} />
          ))}
        </ul>
      ) : !search || search.status === "loading" ? (
        <div className="border border-base-300 p-6 text-center">
          <span className="loading loading-spinner" />
          <p className="mt-3 text-base-content/70">Loading repository announcements…</p>
        </div>
      ) : (
        <div className="border border-base-300 p-6 text-center">
          <h2 className="font-semibold">No repositories found</h2>
          <p className="text-sm text-base-content/70 mt-2">Try another query or relay.</p>
        </div>
      )}

      {selectedRepo && (
        <RepoDetails key={selectedRepo.uid} repo={selectedRepo} relay={relay} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
