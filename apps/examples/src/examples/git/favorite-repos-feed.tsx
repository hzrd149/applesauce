/**
 * Public feed of users' favorite Git repositories from NIP-51 lists
 * @tags nip-51, nip-34, git, repositories, feed
 * @related casting/custom, bookmarks/manager
 */
import { FavoriteGitRepos } from "applesauce-common/casts/git-lists";
import { GIT_REPOSITORIES_KIND, REPOSITORY_ANNOUNCEMENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { catchErrorInline, EventStore, mapEventsToStore } from "applesauce-core";
import {
  AddressPointer,
  getDisplayName,
  getProfilePicture,
  getReplaceableAddressFromPointer,
  getTagValue,
  KnownEvent,
  NostrEvent,
} from "applesauce-core/helpers";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import RelayPicker from "../../components/relay-picker";

type RepositoryEvent = KnownEvent<typeof REPOSITORY_ANNOUNCEMENT_KIND>;

type RepositoryFavorite = {
  pointer: AddressPointer;
  address: string;
  favoritedBy: FavoriteGitRepos[];
};

const RepositoryNameSymbol = Symbol.for("example-repository-name");
const RepositoryDescriptionSymbol = Symbol.for("example-repository-description");
const RepositoryCloneSymbol = Symbol.for("example-repository-clone");
const RepositoryWebSymbol = Symbol.for("example-repository-web");
const RepositoryTagsSymbol = Symbol.for("example-repository-tags");

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
  extraRelays: ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/", "wss://relay.nostr.band/"],
});

function getRepositoryName(repo: NostrEvent): string | undefined {
  if (repo.kind !== REPOSITORY_ANNOUNCEMENT_KIND) return undefined;
  return getOrComputeCachedValue(repo, RepositoryNameSymbol, () => getTagValue(repo, "name"));
}

function getRepositoryDescription(repo: NostrEvent): string | undefined {
  if (repo.kind !== REPOSITORY_ANNOUNCEMENT_KIND) return undefined;
  return getOrComputeCachedValue(repo, RepositoryDescriptionSymbol, () => getTagValue(repo, "description"));
}

function getRepositoryClone(repo: NostrEvent): string[] {
  if (repo.kind !== REPOSITORY_ANNOUNCEMENT_KIND) return [];
  return getOrComputeCachedValue(repo, RepositoryCloneSymbol, () =>
    repo.tags.filter((tag) => tag[0] === "clone" && tag[1]).map((tag) => tag[1]),
  );
}

function getRepositoryWeb(repo: NostrEvent): string[] {
  if (repo.kind !== REPOSITORY_ANNOUNCEMENT_KIND) return [];
  return getOrComputeCachedValue(repo, RepositoryWebSymbol, () =>
    repo.tags.filter((tag) => tag[0] === "web" && tag[1]).map((tag) => tag[1]),
  );
}

function getRepositoryTags(repo: NostrEvent): string[] {
  if (repo.kind !== REPOSITORY_ANNOUNCEMENT_KIND) return [];
  return getOrComputeCachedValue(repo, RepositoryTagsSymbol, () =>
    repo.tags.filter((tag) => tag[0] === "t" && tag[1]).map((tag) => tag[1]),
  );
}

function isValidRepository(repo: NostrEvent | undefined): repo is RepositoryEvent {
  return !!repo && repo.kind === REPOSITORY_ANNOUNCEMENT_KIND && !!getTagValue(repo, "d") && !!getRepositoryName(repo);
}

function getFavoritesFromLists(lists: FavoriteGitRepos[]): RepositoryFavorite[] {
  const favorites = new Map<string, RepositoryFavorite>();

  for (const list of lists) {
    for (const pointer of list.repositories) {
      const address = getReplaceableAddressFromPointer(pointer);
      const favorite = favorites.get(address);

      if (favorite) favorite.favoritedBy.push(list);
      else favorites.set(address, { pointer, address, favoritedBy: [list] });
    }
  }

  return [...favorites.values()].sort((a, b) => b.favoritedBy.length - a.favoritedBy.length);
}

function Favoriter({ list }: { list: FavoriteGitRepos }) {
  const pubkey = list.event.pubkey;
  const profile = use$(list.author.profile$);
  const displayName = profile?.displayName || profile?.name || pubkey.slice(0, 8) + "...";
  const picture = profile?.picture || `https://robohash.org/${pubkey}.png`;

  return (
    <div className="tooltip flex-none" data-tip={displayName}>
      <div className="avatar">
        <div className="w-8 h-8 rounded-full border border-base-300">
          <img src={picture} alt={displayName} />
        </div>
      </div>
    </div>
  );
}

function RepositoryRow({ favorite }: { favorite: RepositoryFavorite }) {
  const repo = use$(
    () => eventStore.replaceable(favorite.pointer),
    [favorite.address, favorite.pointer.relays?.join("|")],
  );
  const ownerProfile = use$(() => eventStore.profile(favorite.pointer.pubkey), [favorite.pointer.pubkey]);
  const ownerName = getDisplayName(ownerProfile, favorite.pointer.pubkey.slice(0, 8) + "...");
  const ownerPicture = getProfilePicture(ownerProfile, `https://robohash.org/${favorite.pointer.pubkey}.png`);

  if (!repo) {
    return (
      <div className="border border-base-300 bg-base-100 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-sm truncate">{favorite.address}</div>
            <div className="text-sm text-base-content/60">Loading repository announcement...</div>
          </div>
          <span className="loading loading-spinner loading-sm" />
        </div>
      </div>
    );
  }

  const name = isValidRepository(repo) ? getRepositoryName(repo)! : favorite.pointer.identifier;
  const description = getRepositoryDescription(repo);
  const clone = getRepositoryClone(repo);
  const web = getRepositoryWeb(repo);
  const tags = getRepositoryTags(repo);

  return (
    <article className="border border-base-300 bg-base-100 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="avatar">
              <div className="w-9 h-9 rounded-full border border-base-300">
                <img src={ownerPicture} alt={ownerName} />
              </div>
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight truncate">{name}</h2>
              <p className="text-xs text-base-content/60 truncate">
                {ownerName} / <code>{favorite.pointer.identifier}</code>
              </p>
            </div>
          </div>

          {description && <p className="text-sm text-base-content/80 mb-3 max-w-3xl">{description}</p>}

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {tags.slice(0, 8).map((tag) => (
                <span key={tag} className="badge badge-outline badge-sm">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 text-sm">
            {clone[0] && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base-content/60">Clone</span>
                <code className="bg-base-200 px-2 py-1 text-xs break-all">{clone[0]}</code>
                <button className="btn btn-xs" onClick={() => navigator.clipboard.writeText(clone[0])}>
                  Copy
                </button>
              </div>
            )}

            {web[0] && (
              <a href={web[0]} target="_blank" rel="noopener noreferrer" className="link link-primary w-fit">
                Open repository website
              </a>
            )}
          </div>
        </div>

        <div className="md:w-56 md:border-l md:border-base-300 md:pl-4">
          <div className="text-xs uppercase tracking-wide text-base-content/60 mb-2">
            Favorited by {favorite.favoritedBy.length}
          </div>
          <div className="flex flex-wrap gap-0.5 mb-3 overflow-hidden">
            {favorite.favoritedBy.slice(0, 10).map((list) => (
              <Favoriter key={list.event.id} list={list} />
            ))}
          </div>
          <div className="text-xs text-base-content/60">
            Latest list:{" "}
            {new Date(Math.max(...favorite.favoritedBy.map((list) => list.event.created_at)) * 1000).toLocaleString()}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function FavoriteRepositoriesFeed() {
  const [relay, setRelay] = useState("wss://relay.ngit.dev/");

  use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [GIT_REPOSITORIES_KIND], limit: 100 })
        .pipe(mapEventsToStore(eventStore), catchErrorInline()),
    [relay],
  );

  const lists = use$(
    () =>
      eventStore.timeline({ kinds: [GIT_REPOSITORIES_KIND] }).pipe(castTimelineStream(FavoriteGitRepos, eventStore)),
    [],
  );

  const favorites = useMemo(() => getFavoritesFromLists(lists ?? []), [lists]);
  const publicPointers = favorites.reduce((sum, favorite) => sum + favorite.favoritedBy.length, 0);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8">
      <div className="border-b border-base-300 pb-5 mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Public Favorite Git Repositories</h1>
            <p className="text-base-content/70 mt-2 max-w-3xl">
              This feed watches public NIP-51 Git repository lists (kind {GIT_REPOSITORIES_KIND}) and loads the NIP-34
              repository announcements (kind {REPOSITORY_ANNOUNCEMENT_KIND}) they reference.
            </p>
          </div>
          <div className="w-full lg:w-96">
            <RelayPicker value={relay} onChange={setRelay} common={["wss://relay.ngit.dev/", "wss://gitnostr.com/"]} />
          </div>
        </div>

        <div className="stats stats-vertical sm:stats-horizontal border border-base-300 mt-5">
          <div className="stat py-3">
            <div className="stat-title">Lists</div>
            <div className="stat-value text-2xl">{lists?.length ?? 0}</div>
          </div>
          <div className="stat py-3">
            <div className="stat-title">Public Pointers</div>
            <div className="stat-value text-2xl">{publicPointers}</div>
          </div>
          <div className="stat py-3">
            <div className="stat-title">Repositories</div>
            <div className="stat-value text-2xl">{favorites.length}</div>
          </div>
        </div>
      </div>

      {!lists ? (
        <div className="border border-base-300 p-6 text-center">
          <span className="loading loading-spinner" />
          <p className="mt-3 text-base-content/70">Listening for public Git repository lists...</p>
        </div>
      ) : favorites.length === 0 ? (
        <div className="border border-base-300 p-6 text-center">
          <h2 className="font-semibold">No public Git repository favorites found yet</h2>
          <p className="text-sm text-base-content/70 mt-2">
            Try another relay, or wait for kind {GIT_REPOSITORIES_KIND} events to arrive.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {favorites.map((favorite) => (
            <RepositoryRow key={favorite.address} favorite={favorite} />
          ))}
        </div>
      )}
    </div>
  );
}
