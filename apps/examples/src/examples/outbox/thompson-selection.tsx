/**
 * Compare default relay selection against Thompson sampling strategies
 * @tags nip-65, outbox, relay, thompson, selection, debugging
 * @related outbox/relay-selection, outbox/liveness-filter
 */
import { defined, EventStore, includeMailboxes } from "applesauce-core";
import {
  createFixedThompsonScore,
  createThompsonScore,
  groupPubkeysByRelay,
  selectOptimalRelays,
  selectRelaysPerAuthor,
  type RelayPrior,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$, useObservableEagerState } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ProfilePointer } from "nostr-tools/nip19";
import { useMemo, useState } from "react";
import { BehaviorSubject, shareReplay, switchMap, throttleTime } from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";

const pubkey$ = new BehaviorSubject<string | null>(null);
const pool = new RelayPool();
const eventStore = new EventStore();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/", "wss://indexer.coracle.social/"],
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
});

const contacts$ = pubkey$.pipe(
  defined(),
  switchMap((pubkey) => eventStore.contacts(pubkey)),
);

type PriorChoice = "good" | "bad";

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function relayPopularity(users: ProfilePointer[]) {
  const counts = new Map<string, number>();
  for (const user of users) {
    for (const relay of new Set(user.relays ?? [])) counts.set(relay, (counts.get(relay) ?? 0) + 1);
  }
  return counts;
}

function selectedRelays(users: ProfilePointer[]) {
  return Object.keys(groupPubkeysByRelay(users)).sort();
}

function makePrior(choice: PriorChoice): RelayPrior {
  return choice === "good" ? { alpha: 20, beta: 2 } : { alpha: 2, beta: 20 };
}

function overlap(a: string[], b: string[]) {
  const set = new Set(b);
  return a.filter((relay) => set.has(relay)).length;
}

function SelectionSummary({ title, relays, baseline }: { title: string; relays: string[]; baseline?: string[] }) {
  return (
    <div className="border border-base-300 p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="badge badge-neutral">{relays.length} relays</span>
      </div>
      {baseline && (
        <div className="text-xs text-base-content/60">
          {overlap(relays, baseline)} of {baseline.length} baseline relays overlap.
        </div>
      )}
      <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
        {relays.map((relay) => (
          <span key={relay} className="badge badge-outline font-mono text-[0.65rem]">
            {relay}
          </span>
        ))}
      </div>
    </div>
  );
}

function RelayScoreRow({
  relay,
  popularity,
  score,
  prior,
  onSetPrior,
}: {
  relay: string;
  popularity: number;
  score: number;
  prior?: PriorChoice;
  onSetPrior: (relay: string, prior?: PriorChoice) => void;
}) {
  return (
    <tr>
      <td className="font-mono text-xs break-all">{relay}</td>
      <td>{popularity}</td>
      <td>{score.toFixed(3)}</td>
      <td>
        {prior ? (
          <span className={`badge ${prior === "good" ? "badge-success" : "badge-error"}`}>{prior}</span>
        ) : (
          <span className="badge badge-ghost">cold</span>
        )}
      </td>
      <td>
        <div className="join">
          <button className="btn btn-xs join-item" onClick={() => onSetPrior(relay, "good")}>
            Good
          </button>
          <button className="btn btn-xs join-item" onClick={() => onSetPrior(relay, "bad")}>
            Bad
          </button>
          <button className="btn btn-xs join-item" onClick={() => onSetPrior(relay, undefined)}>
            Reset
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function ThompsonSelectionExample() {
  const pubkey = useObservableEagerState(pubkey$);
  const [maxConnections, setMaxConnections] = useState(30);
  const [maxRelaysPerUser, setMaxRelaysPerUser] = useState(4);
  const [seed, setSeed] = useState(1);
  const [usePopularity, setUsePopularity] = useState(true);
  const [priorChoices, setPriorChoices] = useState<Record<string, PriorChoice>>({});

  const contactsWithOutboxes$ = useMemo(
    () =>
      contacts$.pipe(
        includeMailboxes(eventStore),
        throttleTime(200),
        shareReplay(1),
      ),
    [],
  );

  const users = use$(contactsWithOutboxes$) ?? [];
  const popularity = useMemo(() => relayPopularity(users), [users]);
  const allRelays = useMemo(
    () => Array.from(popularity.keys()).sort((a, b) => (popularity.get(b) ?? 0) - (popularity.get(a) ?? 0)),
    [popularity],
  );

  const priors = useMemo(() => {
    const map = new Map<string, RelayPrior>();
    for (const [relay, choice] of Object.entries(priorChoices)) map.set(relay, makePrior(choice));
    return map;
  }, [priorChoices]);

  const fixedScore = useMemo(
    () => createFixedThompsonScore(allRelays, { priors, rng: mulberry32(seed), usePopularity }),
    [allRelays, priors, seed, usePopularity],
  );

  const perAuthorScore = useMemo(
    () => createThompsonScore({ priors, rng: mulberry32(seed), usePopularity }),
    [priors, seed, usePopularity],
  );

  const baselineSelection = useMemo(
    () => selectOptimalRelays(users, { maxConnections, maxRelaysPerUser }),
    [users, maxConnections, maxRelaysPerUser],
  );
  const fixedThompsonSelection = useMemo(
    () => selectOptimalRelays(users, { maxConnections, maxRelaysPerUser, score: fixedScore }),
    [users, maxConnections, maxRelaysPerUser, fixedScore],
  );
  const perAuthorSelection = useMemo(
    () => selectRelaysPerAuthor(users, { maxRelaysPerUser, score: perAuthorScore }),
    [users, maxRelaysPerUser, perAuthorScore],
  );

  const baselineRelays = selectedRelays(baselineSelection);
  const fixedRelays = selectedRelays(fixedThompsonSelection);
  const perAuthorRelays = selectedRelays(perAuthorSelection);

  const scoreRows = useMemo(
    () =>
      allRelays.slice(0, 50).map((relay) => ({
        relay,
        popularity: popularity.get(relay) ?? 0,
        score: fixedScore(relay, (popularity.get(relay) ?? 0) / Math.max(users.length, 1), popularity.get(relay) ?? 0),
      })),
    [allRelays, popularity, fixedScore, users.length],
  );

  const setPrior = (relay: string, prior?: PriorChoice) => {
    setPriorChoices((current) => {
      const next = { ...current };
      if (prior) next[relay] = prior;
      else delete next[relay];
      return next;
    });
  };

  return (
    <div className="min-h-screen p-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Thompson Relay Selection Debugger</h1>
        <p className="text-sm text-base-content/70 max-w-3xl">
          Compare default greedy selection against <code>createFixedThompsonScore</code> for connection-budgeted outbox
          selection and <code>createThompsonScore</code> for per-author selection. Use simulated priors to see how learned
          delivery history changes relay choices.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PubkeyPicker value={pubkey || ""} onChange={(p) => pubkey$.next(p)} placeholder="Enter a pubkey..." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-sm">Max connections: {maxConnections}</span>
            <input
              type="range"
              min="1"
              max="100"
              value={maxConnections}
              onChange={(e) => setMaxConnections(Number(e.target.value))}
              className="range range-primary range-sm"
            />
          </div>
          <div className="space-y-1">
            <span className="text-sm">Max relays per user: {maxRelaysPerUser}</span>
            <input
              type="range"
              min="1"
              max="20"
              value={maxRelaysPerUser}
              onChange={(e) => setMaxRelaysPerUser(Number(e.target.value))}
              className="range range-primary range-sm"
            />
          </div>
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={usePopularity}
              onChange={(e) => setUsePopularity(e.target.checked)}
            />
            <span className="label-text">Weight by relay popularity</span>
          </label>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary" onClick={() => setSeed((value) => value + 1)}>
              Reroll seed ({seed})
            </button>
            <button className="btn btn-sm" onClick={() => setPriorChoices({})}>
              Reset priors
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-base-300 p-3">
          <div className="text-xs uppercase tracking-wide text-base-content/60">Contacts</div>
          <div className="text-2xl font-semibold">{users.length}</div>
        </div>
        <div className="border border-base-300 p-3">
          <div className="text-xs uppercase tracking-wide text-base-content/60">Candidate Relays</div>
          <div className="text-2xl font-semibold">{allRelays.length}</div>
        </div>
        <div className="border border-base-300 p-3">
          <div className="text-xs uppercase tracking-wide text-base-content/60">Good Priors</div>
          <div className="text-2xl font-semibold text-success">
            {Object.values(priorChoices).filter((value) => value === "good").length}
          </div>
        </div>
        <div className="border border-base-300 p-3">
          <div className="text-xs uppercase tracking-wide text-base-content/60">Bad Priors</div>
          <div className="text-2xl font-semibold text-error">
            {Object.values(priorChoices).filter((value) => value === "bad").length}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <SelectionSummary title="Default greedy" relays={baselineRelays} />
        <SelectionSummary title="Greedy + fixed Thompson" relays={fixedRelays} baseline={baselineRelays} />
        <SelectionSummary title="Per-author Thompson" relays={perAuthorRelays} baseline={baselineRelays} />
      </div>

      <div className="overflow-x-auto border border-base-300 max-h-[55vh] overflow-y-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Relay</th>
              <th>Users</th>
              <th>Fixed Score</th>
              <th>Prior</th>
              <th>Simulate History</th>
            </tr>
          </thead>
          <tbody>
            {scoreRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-base-content/60">
                  {pubkey ? "Loading contacts and outboxes..." : "Enter a pubkey to start."}
                </td>
              </tr>
            ) : (
              scoreRows.map((row) => (
                <RelayScoreRow
                  key={row.relay}
                  relay={row.relay}
                  popularity={row.popularity}
                  score={row.score}
                  prior={priorChoices[row.relay]}
                  onSetPrior={setPrior}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
