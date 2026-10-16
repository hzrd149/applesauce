/**
 * Browse NIP-35 torrents by category tree, search tag, or movie/TV database ID using tag-indexed relay filters
 * @tags nip-35, torrent, search, filters, categories
 * @related torrent/feed, torrent/publisher, torrent/manager
 */
import { Torrent } from "applesauce-common/casts";
import {
  createTorrentExternalIdentifier,
  TORRENT_KIND,
  TorrentExternalIdentifierPrefix,
} from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { Filter } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import RelayPicker from "../../components/relay-picker";

const eventStore = new EventStore();
const pool = new RelayPool();

const ID_PREFIXES: TorrentExternalIdentifierPrefix[] = ["imdb", "tmdb", "ttvdb", "mal", "anilist"];

type CategoryNode = { count: number; children: Map<string, CategoryNode> };

/** Builds a category tree from each torrent's tcat path parts */
function buildCategoryTree(torrents: Torrent[]): CategoryNode {
  const root: CategoryNode = { count: 0, children: new Map() };
  for (const torrent of torrents) {
    let node = root;
    node.count++;
    for (const part of torrent.categoryPathParts) {
      if (!node.children.has(part)) node.children.set(part, { count: 0, children: new Map() });
      node = node.children.get(part)!;
      node.count++;
    }
  }
  return root;
}

function CategoryTree({
  node,
  path,
  selected,
  onSelect,
}: {
  node: CategoryNode;
  path: string[];
  selected: string[];
  onSelect: (path: string[]) => void;
}) {
  return (
    <ul className="ml-3">
      {[...node.children.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, child]) => {
          const childPath = [...path, name];
          const active = childPath.join(",") === selected.join(",");
          return (
            <li key={name}>
              <button
                className={`text-sm ${active ? "font-bold text-primary" : ""}`}
                onClick={() => onSelect(childPath)}
              >
                {name} <span className="text-base-content/50">({child.count})</span>
              </button>
              {child.children.size > 0 && (
                <CategoryTree node={child} path={childPath} selected={selected} onSelect={onSelect} />
              )}
            </li>
          );
        })}
    </ul>
  );
}

/** One row per info hash, since several users can publish the same torrent */
function TorrentResult({ torrents }: { torrents: Torrent[] }) {
  const [first] = torrents;

  return (
    <div className="border border-base-300 rounded-box p-3 flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{first.title || "Untitled torrent"}</div>
        {first.magnetLink && (
          <a className="btn btn-xs btn-primary" href={first.magnetLink}>
            Magnet
          </a>
        )}
      </div>
      <code className="text-xs text-base-content/60">{first.infoHash}</code>
      <div className="flex flex-wrap gap-1 text-xs">
        {first.categoryPathParts.length > 0 && (
          <span className="badge badge-sm badge-ghost">{first.categoryPathParts.join(" › ")}</span>
        )}
        {first.externalIdentifiers.map((id) => (
          <span key={id.identifier} className="badge badge-sm badge-outline">
            {id.identifier}
          </span>
        ))}
        {first.searchTags.map((tag) => (
          <span key={tag} className="badge badge-sm">
            #{tag}
          </span>
        ))}
      </div>
      <div className="text-xs text-base-content/60">
        {first.files.length} files · published by {torrents.length} {torrents.length === 1 ? "user" : "users"}
      </div>
    </div>
  );
}

export default function TorrentSearch() {
  const [relay, setRelay] = useState("wss://relay.primal.net/");
  const [filter, setFilter] = useState<Filter>({ kinds: [TORRENT_KIND], limit: 200 });
  const [category, setCategory] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [idPrefix, setIdPrefix] = useState<TorrentExternalIdentifierPrefix>("imdb");
  const [idMediaType, setIdMediaType] = useState("");
  const [idValue, setIdValue] = useState("");

  // Ask the relay for torrents matching the current filter
  use$(() => pool.relay(relay).subscription(filter).pipe(mapEventsToStore(eventStore)), [relay, filter]);

  // Read the same filter back from the store and cast to Torrent (invalid events are dropped)
  const torrents = use$(
    () => eventStore.timeline({ ...filter, limit: undefined }).pipe(castTimelineStream(Torrent, eventStore)),
    [filter],
  );

  const tree = useMemo(() => buildCategoryTree(torrents ?? []), [torrents]);

  // Filter by category locally, then group by info hash
  const groups = useMemo(() => {
    const byHash = new Map<string, Torrent[]>();
    for (const torrent of torrents ?? []) {
      if (category.some((part, i) => torrent.categoryPathParts[i] !== part)) continue;
      byHash.set(torrent.infoHash, [...(byHash.get(torrent.infoHash) ?? []), torrent]);
    }
    return [...byHash.values()];
  }, [torrents, category]);

  // Most common search tags in the loaded torrents
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const torrent of torrents ?? [])
      for (const tag of torrent.searchTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [torrents]);

  const searchTag = (tag: string) => {
    setCategory([]);
    setFilter({ kinds: [TORRENT_KIND], "#t": [tag.toLowerCase()], limit: 200 });
  };

  const searchId = () => {
    if (!idValue.trim()) return;
    const { identifier } = createTorrentExternalIdentifier(idPrefix, idValue.trim(), idMediaType.trim() || undefined);
    setCategory([]);
    setFilter({ kinds: [TORRENT_KIND], "#i": [identifier], limit: 200 });
  };

  const reset = () => {
    setCategory([]);
    setFilter({ kinds: [TORRENT_KIND], limit: 200 });
  };

  return (
    <div className="max-w-6xl w-full mx-auto my-8 px-4 flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold">Torrent search</h1>
        <p className="text-base-content/60">
          Search tags and external IDs are indexed tags, so relays can filter on <code>#t</code> and <code>#i</code>.
        </p>
      </div>

      <RelayPicker value={relay} onChange={setRelay} />

      <div className="flex flex-wrap gap-2 items-center">
        <div className="join">
          <input
            className="input input-sm join-item"
            placeholder="Tag, e.g. movie"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tagInput.trim() && searchTag(tagInput.trim())}
          />
          <button className="btn btn-sm join-item" onClick={() => tagInput.trim() && searchTag(tagInput.trim())}>
            #t
          </button>
        </div>
        <div className="join">
          <select
            className="select select-sm join-item w-24"
            value={idPrefix}
            onChange={(e) => setIdPrefix(e.target.value as TorrentExternalIdentifierPrefix)}
          >
            {ID_PREFIXES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <input
            className="input input-sm join-item w-24"
            placeholder="movie"
            value={idMediaType}
            onChange={(e) => setIdMediaType(e.target.value)}
          />
          <input
            className="input input-sm join-item w-36"
            placeholder="tt15239678"
            value={idValue}
            onChange={(e) => setIdValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchId()}
          />
          <button className="btn btn-sm join-item" onClick={searchId}>
            #i
          </button>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={reset}>
          Reset
        </button>
      </div>

      <code className="text-xs text-base-content/60">{JSON.stringify(filter)}</code>

      {popularTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {popularTags.map(([tag, count]) => (
            <button key={tag} className="badge badge-outline" onClick={() => searchTag(tag)}>
              #{tag} ({count})
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <aside className="border border-base-300 rounded-box p-3 h-fit">
          <button
            className={`text-sm ${category.length === 0 ? "font-bold text-primary" : ""}`}
            onClick={() => setCategory([])}
          >
            All categories <span className="text-base-content/50">({tree.count})</span>
          </button>
          <CategoryTree node={tree} path={[]} selected={category} onSelect={setCategory} />
        </aside>

        <div className="flex flex-col gap-2">
          {torrents === undefined ? (
            <span className="loading loading-spinner" />
          ) : groups.length === 0 ? (
            <p className="text-base-content/60">No torrents match. Try another relay, tag or ID.</p>
          ) : (
            groups.map((group) => <TorrentResult key={group[0].infoHash} torrents={group} />)
          )}
        </div>
      </div>
    </div>
  );
}
