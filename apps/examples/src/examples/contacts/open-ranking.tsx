/**
 * Score contacts with an ORE provider that supports ORE-02.
 * @tags contacts, open-ranking, web-of-trust, nostr-web-token
 * @related contacts/manager, search/open-ranking
 */
import { castUser, User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import { DEFAULT_OPEN_RANKING_PROVIDER, OpenRanking, OpenRankingAlgorithm, OpenRankingStats } from "applesauce-extra";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import { BehaviorSubject, map, defer, from, mergeMap, scan, startWith, catchError, of } from "rxjs";

import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";

// Common Open Ranking providers to choose from
const COMMON_PROVIDERS = [DEFAULT_OPEN_RANKING_PROVIDER];

// The endpoint defined by ORE-02 — its key in the capability document
const STATS_ENDPOINT = "/stats/pubkey";

// Setup event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

// Create unified event loader for the store so profiles/contacts/mailboxes are fetched on demand
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
});

// Setup application state
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

/** The fetch state for a single contact's web-of-trust stats */
type StatsEntry = { loading?: boolean; stats?: OpenRankingStats; error?: string };

/** The numeric stats fields contacts can be sorted by */
type SortField = "rank" | "followers" | "follows" | "muters" | "mutes" | "reporters" | "hops" | "pagerank";

const SORT_OPTIONS: { id: SortField; label: string }[] = [
  { id: "rank", label: "Rank" },
  { id: "followers", label: "Followers" },
  { id: "follows", label: "Follows" },
  { id: "muters", label: "Muters" },
  { id: "mutes", label: "Mutes" },
  { id: "reporters", label: "Reporters" },
  { id: "hops", label: "Hops" },
  { id: "pagerank", label: "PageRank" },
];

/** Formats a rank, which may be fractional (e.g. GrapeRank influence ×100) */
function formatRank(rank: number): string {
  return rank.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function ContactRow({ user, entry }: { user: User; entry?: StatsEntry }) {
  const profile = use$(() => user.profile$, [user.pubkey]);

  const displayName = getDisplayName(profile, user.pubkey.slice(0, 8) + "…");
  const picture = getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`);
  const stats = entry?.stats;

  return (
    <li className="list-row items-center">
      <div>
        <img className="size-10 rounded-box" src={picture} alt={displayName} />
      </div>
      <div className="min-w-0">
        <div className="truncate">{displayName}</div>
        <div className="text-sm font-mono opacity-60 truncate">{user.pubkey.slice(0, 16)}…</div>
      </div>

      {/* The optional statistics returned alongside the rank by ORE-02 */}
      <div className="list-col-wrap flex flex-wrap gap-3 text-sm opacity-70">
        {stats?.followers !== undefined && <span>{stats.followers.toLocaleString()} followers</span>}
        {stats?.follows !== undefined && <span>{stats.follows.toLocaleString()} follows</span>}
        {stats?.muters !== undefined && <span>{stats.muters.toLocaleString()} muters</span>}
        {stats?.hops !== undefined && <span>{stats.hops} hops</span>}
      </div>

      {/* The rank — the one field ORE-02 always returns */}
      <div className="text-right">
        {entry?.loading ? (
          <span className="loading loading-spinner loading-sm" />
        ) : entry?.error ? (
          <span className="badge badge-ghost " title={entry.error}>
            error
          </span>
        ) : stats ? (
          <span className="badge badge-primary font-mono" title="Web-of-trust rank">
            {formatRank(stats.rank)}
          </span>
        ) : (
          <span className="text-sm opacity-40">—</span>
        )}
      </div>
    </li>
  );
}

function ContactScores({ user }: { user: User }) {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);
  const contacts = use$(() => user.contacts$, [user.pubkey]);

  const [provider, setProvider] = useState(DEFAULT_OPEN_RANKING_PROVIDER);
  const [requestedAlgorithm, setRequestedAlgorithm] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const setAlgorithm = (value: string) => {
    setRequestedAlgorithm(value);
    setAuthorized(false);
  };
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Keep one client per provider; discovery never recreates it when algorithms change.
  const openRanking = useMemo(() => new OpenRanking(provider), [provider]);
  const discovery = use$(
    () =>
      defer(() => openRanking.discover()).pipe(
        map((capabilities) => ({
          algorithms: capabilities[STATS_ENDPOINT] ?? [],
          error: undefined as string | undefined,
        })),
        catchError((error) => of({ algorithms: [] as OpenRankingAlgorithm[], error: String(error.message ?? error) })),
      ),
    [openRanking],
  );
  const algorithms = discovery?.algorithms;
  const discoverError = discovery?.error;
  const selected = algorithms?.find((value) => value.id === requestedAlgorithm) ?? algorithms?.[0];
  const algorithm = selected?.id ?? "";
  const requiresPov = selected?.pov ?? false;
  const statsMap =
    use$(() => {
      if (!selected || !contacts?.length || (selected.pov && (!pubkey || !signer || !authorized)))
        return of({} as Record<string, StatsEntry>);
      const initial = Object.fromEntries(contacts.map((contact) => [contact.pubkey, { loading: true }])) as Record<
        string,
        StatsEntry
      >;
      return defer(() => {
        // A personalized request is authorized by the explicit Load Scores button.
        openRanking.setSigner(selected.pov ? (signer ?? undefined) : undefined);
        return from(contacts).pipe(
          mergeMap(
            (contact) =>
              defer(() =>
                openRanking.stats(contact.pubkey, {
                  algorithm: selected.id,
                  pov: selected.pov ? (pubkey ?? undefined) : undefined,
                }),
              ).pipe(
                map((stats) => ({ pubkey: contact.pubkey, entry: { stats } as StatsEntry })),
                catchError((error) =>
                  of({ pubkey: contact.pubkey, entry: { error: String(error.message ?? error) } as StatsEntry }),
                ),
              ),
            8,
          ),
          scan((entries, result) => ({ ...entries, [result.pubkey]: result.entry }), initial),
          startWith(initial),
        );
      });
    }, [contacts, selected, openRanking, pubkey, signer, authorized]) ?? {};

  // Sort by the selected stats field, always sinking contacts without a value to the bottom
  const sorted = useMemo(() => {
    if (!contacts) return [];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...contacts].sort((a, b) => {
      const va = statsMap[a.pubkey]?.stats?.[sortField];
      const vb = statsMap[b.pubkey]?.stats?.[sortField];
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      return (va - vb) * dir;
    });
  }, [contacts, statsMap, sortField, sortDir]);

  const supportsStats = algorithms !== undefined && algorithms.length > 0;

  return (
    <div className="container mx-auto my-8 px-4 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Contact Scores</h1>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            signer$.next(null);
            pubkey$.next(null);
          }}
        >
          Sign out
        </button>
      </div>

      {/* Provider selection — its capability document tells us if ORE-02 is available */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex flex-col gap-1 flex-1 min-w-[16rem]">
          <span className="text-sm">Open Ranking provider</span>
          <input
            type="text"
            list="open-ranking-providers"
            placeholder="https://provider.example.com"
            className="input input-bordered w-full"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
          <datalist id="open-ranking-providers">
            {COMMON_PROVIDERS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>

        {supportsStats && (
          <label className="flex flex-col gap-1">
            <span className="text-sm">Algorithm</span>
            <select className="select select-bordered" value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
              {algorithms!.map((a) => (
                <option key={a.id} value={a.id} disabled={a.pov && !signer} title={a.description}>
                  {a.name}
                  {a.pov ? " (point-of-view)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* The provider must advertise the /stats/pubkey endpoint for this example to work */}
      {algorithms === undefined && !discoverError && (
        <div className="flex items-center gap-2 text-sm opacity-70 mb-4">
          <span className="loading loading-spinner loading-sm" />
          Checking provider for ORE-02 support…
        </div>
      )}
      {algorithms !== undefined && !supportsStats && (
        <div className="alert alert-warning mb-4">
          <span>{discoverError ?? `This provider does not support the ORE-02 ${STATS_ENDPOINT} endpoint.`}</span>
        </div>
      )}
      {requiresPov && !signer && supportsStats && (
        <div className="alert alert-info mb-4">
          <span>This algorithm is personalized — sign in to authenticate point-of-view requests.</span>
        </div>
      )}

      {requiresPov && (
        <button className="btn btn-primary mb-4" disabled={!signer} onClick={() => setAuthorized(true)}>
          Load personalized scores
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-xl font-semibold">Contacts {contacts ? `(${contacts.length})` : ""}</h2>

        {/* Sort the list by any of the numeric stats returned by ORE-02 */}
        {supportsStats && !!contacts?.length && (
          <div className="join">
            <select
              className="select select-bordered select-sm join-item"
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  Sort by {o.label}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm join-item"
              onClick={() => setSortDir((dir) => (dir === "desc" ? "asc" : "desc"))}
              title={sortDir === "desc" ? "Descending (highest first)" : "Ascending (lowest first)"}
            >
              {sortDir === "desc" ? "↓" : "↑"}
            </button>
          </div>
        )}
      </div>

      {!contacts ? (
        <div className="flex items-center gap-2 text-sm opacity-70 py-8">
          <span className="loading loading-spinner loading-sm" />
          Loading contacts…
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 opacity-60">No contacts found in your follow list.</div>
      ) : (
        <ul className="list border border-base-300 rounded-box">
          {sorted.map((contact) => (
            <ContactRow
              key={contact.pubkey}
              user={contact}
              entry={supportsStats ? statsMap[contact.pubkey] : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ContactScoresExample() {
  const user = use$(user$);

  if (!user) {
    return (
      <LoginView
        onLogin={(newSigner, newPubkey) => {
          signer$.next(newSigner);
          pubkey$.next(newPubkey);
        }}
      />
    );
  }

  return <ContactScores user={user} />;
}
