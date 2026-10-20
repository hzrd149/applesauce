/**
 * Narrow NIP-35 torrents by several search tags at once with NIP-91 AND filters, external IDs and a category tree
 * @tags nip-35, nip-91, torrent, search, filters, categories
 * @related torrent/feed, torrent/publisher, torrent/manager
 */
import { Torrent } from "applesauce-common/casts";
import {
  createTorrentExternalIdentifier,
  TORRENT_KIND,
  type TorrentExternalIdentifierPrefix,
} from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { type Filter, isSafeRelayURL, normalizeURL } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { type Relay, RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import { catchError, combineLatest, endWith, ignoreElements, map, of, startWith, switchMap } from "rxjs";

import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

// Torrents are spread across many relays, so search a set of them instead of a single one
const DEFAULT_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const ID_PREFIXES: TorrentExternalIdentifierPrefix[] = ["imdb", "tmdb", "ttvdb", "mal", "anilist"];

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

type Search = { tags: string[]; id?: string };
type RelayStatus = { url: string; loading: boolean; error?: string };

/** Builds the filter the store applies locally, where `&t` requires every selected tag */
function storeFilter({ tags, id }: Search): Filter {
  return { kinds: [TORRENT_KIND], "&t": tags.length ? tags : undefined, "#i": id ? [id] : undefined };
}

/** Builds the request for one relay, falling back to a single `#t` tag when it can't AND tags itself */
function relayFilter(search: Search, nip91: boolean): Filter {
  const filter: Filter = { ...storeFilter(search), limit: 200 };
  if (nip91 || search.tags.length === 0) return filter;
  // Every AND match has the first tag, so this is a superset the store narrows down
  return { ...filter, "&t": undefined, "#t": search.tags.slice(0, 1) };
}

/** Checks the relay's NIP-11 document for NIP-91 AND filter support */
function supportsAnd(relay: Relay) {
  return relay.supported$.pipe(map((nips) => nips?.includes(91) ?? false));
}

/** Requests the search from every relay into the store, picking each relay's filter from its supported NIPs */
function loadSearch(relays: string[], search: Search) {
  const requests = relays.map((url) => {
    const relay = pool.relay(url);
    return supportsAnd(relay).pipe(
      switchMap((nip91) => relay.request(relayFilter(search, nip91))),
      mapEventsToStore(eventStore),
      ignoreElements(),
      startWith<RelayStatus>({ url, loading: true }),
      endWith<RelayStatus>({ url, loading: false }),
      // A failing relay only ends its own request
      catchError((err) =>
        of<RelayStatus>({ url, loading: false, error: err instanceof Error ? err.message : String(err) }),
      ),
    );
  });
  return requests.length ? combineLatest(requests) : of<RelayStatus[]>([]);
}

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

/** Counts the search tags on the results that aren't already selected */
function countTags(torrents: Torrent[], selected: string[]) {
  const counts = new Map<string, number>();
  for (const torrent of torrents)
    for (const tag of torrent.searchTags) if (!selected.includes(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
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
    <ul className="ms-3">
      {[...node.children.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, child]) => {
          const childPath = [...path, name];
          const active = childPath.join(",") === selected.join(",");
          return (
            <li key={name}>
              <button
                className={`text-sm ${active ? "font-semibold text-primary" : ""}`}
                onClick={() => onSelect(childPath)}
              >
                {name} <span className="tabular-nums text-base-content/60">{child.count}</span>
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
function TorrentRow({ torrents, onTag }: { torrents: Torrent[]; onTag: (tag: string) => void }) {
  const [first] = torrents;

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">{first.title || "Untitled torrent"}</span>
        {first.magnetLink && (
          <a className="btn btn-sm btn-primary" href={first.magnetLink}>
            Magnet
          </a>
        )}
      </div>
      <code className="truncate text-sm text-base-content/60">{first.infoHash}</code>
      <div className="flex flex-wrap gap-1">
        {first.categoryPathParts.length > 0 && (
          <span className="badge badge-ghost">{first.categoryPathParts.join(" › ")}</span>
        )}
        {first.externalIdentifiers.map((id) => (
          <span key={id.identifier} className="badge badge-outline">
            {id.identifier}
          </span>
        ))}
        {first.searchTags.map((tag) => (
          <button key={tag} className="badge" onClick={() => onTag(tag)}>
            #{tag}
          </button>
        ))}
      </div>
      <p className="text-sm text-base-content/60">
        {first.files.length} files · published by {torrents.length} {torrents.length === 1 ? "user" : "users"}
      </p>
    </div>
  );
}

/** Parses a relay URL or bare hostname, returning undefined when it isn't a safe websocket URL */
function parseRelay(input: string) {
  const value = input.trim();
  if (!value) return undefined;
  try {
    const url = normalizeURL(value.includes("://") ? value : `wss://${value}`);
    return isSafeRelayURL(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

function RelayRow({ url, onRemove }: { url: string; onRemove: () => void }) {
  const icon = use$(() => pool.relay(url).icon$, [url]);
  const name = use$(() => pool.relay(url).name$, [url]);
  return (
    <li className="flex items-center gap-2">
      <div className="avatar shrink-0">
        <div className="size-6 rounded-full bg-base-300">{icon && <img src={icon} alt="" />}</div>
      </div>
      <span className="min-w-0 flex-1 truncate text-sm" title={url}>
        {name}
      </span>
      <button className="btn btn-sm btn-ghost btn-square" onClick={onRemove}>
        ✕
      </button>
    </li>
  );
}

/** The relays the search is sent to, with an input to add more */
function RelayList({ relays, onChange }: { relays: string[]; onChange: (relays: string[]) => void }) {
  const [input, setInput] = useState("");
  const url = parseRelay(input);
  const valid = !!url;

  const add = () => {
    if (!url) return;
    if (!relays.includes(url)) onChange([...relays, url]);
    setInput("");
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Relays</h2>
      <ul className="flex flex-col gap-1">
        {relays.map((relay) => (
          <RelayRow key={relay} url={relay} onRemove={() => onChange(relays.filter((r) => r !== relay))} />
        ))}
      </ul>
      <div className="join">
        <input
          className={`input input-sm join-item w-full ${input && !valid ? "input-error" : ""}`}
          placeholder="relay.example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-sm join-item" disabled={!valid} onClick={add}>
          Add
        </button>
      </div>
    </section>
  );
}

function IdSearch({ onSearch }: { onSearch: (id: string) => void }) {
  const [prefix, setPrefix] = useState<TorrentExternalIdentifierPrefix>("imdb");
  const [mediaType, setMediaType] = useState("");
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value.trim()) return;
    onSearch(createTorrentExternalIdentifier(prefix, value.trim(), mediaType.trim() || undefined).identifier);
    setValue("");
  };

  return (
    <div className="join">
      <select
        className="select select-sm join-item w-24"
        value={prefix}
        onChange={(e) => setPrefix(e.target.value as TorrentExternalIdentifierPrefix)}
      >
        {ID_PREFIXES.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <input
        className="input input-sm join-item w-24"
        placeholder="movie"
        value={mediaType}
        onChange={(e) => setMediaType(e.target.value)}
      />
      <input
        className="input input-sm join-item w-36"
        placeholder="tt15239678"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className="btn btn-sm join-item" onClick={submit}>
        Find ID
      </button>
    </div>
  );
}

export default function TorrentSearch() {
  const [relays, setRelays] = useState(DEFAULT_RELAYS);
  const [search, setSearch] = useState<Search>({ tags: [] });
  const [category, setCategory] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Load from the relays and read the AND-filtered results back from the store
  const statuses = use$(() => loadSearch(relays, search), [relays, search]);
  const loading = !statuses || statuses.some((s) => s.loading);
  const torrents = use$(
    () => eventStore.timeline(storeFilter(search)).pipe(castTimelineStream(Torrent, eventStore)),
    [search],
  );

  const addTag = (tag: string) => {
    const value = tag.trim().toLowerCase();
    if (value && !search.tags.includes(value)) setSearch({ ...search, tags: [...search.tags, value] });
    setCategory([]);
  };
  const removeTag = (tag: string) => setSearch({ ...search, tags: search.tags.filter((t) => t !== tag) });

  const tree = useMemo(() => buildCategoryTree(torrents ?? []), [torrents]);
  const popularTags = useMemo(() => countTags(torrents ?? [], search.tags), [torrents, search.tags]);

  // Filter by category locally, then group by info hash
  const groups = useMemo(() => {
    const byHash = new Map<string, Torrent[]>();
    for (const torrent of torrents ?? []) {
      if (category.some((part, i) => torrent.categoryPathParts[i] !== part)) continue;
      byHash.set(torrent.infoHash, [...(byHash.get(torrent.infoHash) ?? []), torrent]);
    }
    return [...byHash.values()];
  }, [torrents, category]);

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 p-3">
        <div className="join">
          <input
            className="input input-sm join-item"
            placeholder="Add a tag, e.g. movie"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              addTag(tagInput);
              setTagInput("");
            }}
          />
          <button
            className="btn btn-sm join-item"
            onClick={() => {
              addTag(tagInput);
              setTagInput("");
            }}
          >
            Add tag
          </button>
        </div>
        <IdSearch onSearch={(id) => setSearch({ ...search, id })} />
      </div>

      <div className="flex min-h-0 grow">
        <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-e border-base-300 p-4">
          <RelayList relays={relays} onChange={setRelays} />

          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Matching all of</h2>
            {search.tags.length === 0 && !search.id ? (
              <p className="text-sm text-base-content/60">Every torrent. Add tags or an ID to narrow the results.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {search.tags.map((tag) => (
                  <button key={tag} className="badge badge-primary gap-1" onClick={() => removeTag(tag)}>
                    #{tag} ✕
                  </button>
                ))}
                {search.id && (
                  <button className="badge badge-primary gap-1" onClick={() => setSearch({ ...search, id: undefined })}>
                    {search.id} ✕
                  </button>
                )}
              </div>
            )}
          </section>

          {popularTags.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold">Narrow by tag</h2>
              <div className="flex flex-wrap gap-1">
                {popularTags.map(([tag, count]) => (
                  <button key={tag} className="badge badge-outline" onClick={() => addTag(tag)}>
                    #{tag} <span className="tabular-nums text-base-content/60">{count}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-1">
            <h2 className="font-semibold">Categories</h2>
            <button
              className={`text-left text-sm ${category.length === 0 ? "font-semibold text-primary" : ""}`}
              onClick={() => setCategory([])}
            >
              All categories <span className="tabular-nums text-base-content/60">{tree.count}</span>
            </button>
            <CategoryTree node={tree} path={[]} selected={category} onSelect={setCategory} />
          </section>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-base-300 px-4 py-2 text-sm text-base-content/60">
            {loading && <span className="loading loading-spinner loading-sm" />}
            <span>
              {groups.length} {groups.length === 1 ? "torrent" : "torrents"}
            </span>
            {statuses?.map(
              (s) =>
                s.error && (
                  <span key={s.url} className="text-error">
                    {new URL(s.url).host}: {s.error}
                  </span>
                ),
            )}
          </div>
          <div className="min-h-0 flex-1 divide-y divide-base-300 overflow-y-auto">
            {groups.length > 0 ? (
              groups.map((group) => <TorrentRow key={group[0].infoHash} torrents={group} onTag={addTag} />)
            ) : (
              <p className="p-8 text-center text-base-content/60">
                {loading ? "Searching…" : "No torrents match every tag. Remove a tag or add another relay."}
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
