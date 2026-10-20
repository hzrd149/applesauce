/**
 * Score live replies from ten popular relays with the nspam on-device spam classifier and measure how fast it runs in the browser
 * @tags feed, spam, moderation, machine-learning, stress
 * @related feed/pow-notes, relay/optimistic-verification
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { type NostrEvent, unixNow } from "applesauce-core/helpers";
import {
  extractNspamFeatures,
  isNspamReply,
  loadNspamModel,
  NSPAM_MAX_BUNDLE,
  NSPAM_MODEL_VERSION,
  type NspamModel,
  predictNspam,
} from "applesauce-extra/nspam";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import {
  bufferTime,
  catchError,
  defer,
  EMPTY,
  map,
  merge,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  takeUntil,
} from "rxjs";

import { lookupRelays$ } from "../../settings";

const RELAYS = [
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.primal.net/",
  "wss://nostr.mom/",
  "wss://relay.snort.social/",
  "wss://offchain.pub/",
  "wss://nostr.bitcoiner.social/",
  "wss://relay.nostr.net/",
  "wss://relay.ditto.pub/",
  "wss://nostr.oxtr.dev/",
];
const LOOKBACKS: [string, number][] = [
  ["Live only", 0],
  ["Last 10 min", 600],
  ["Last hour", 3600],
];
const MAX_TIMINGS = 2000;

// Skip signature checks, this example measures the classifier and thousands of events cost CPU time
const eventStore = new EventStore({ verifyEvent: () => true });
const pool = new RelayPool();

// Load profiles for the flagged authors on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// ---------------------------------------------------------------------------
// Live scanning
// ---------------------------------------------------------------------------

type ModelState =
  { status: "loading" } | { status: "ready"; model: NspamModel; loadMs: number } | { status: "error"; message: string };

/** The model is downloaded once and shared by every scan */
const model$ = defer(async () => {
  const start = performance.now();
  const model = await loadNspamModel();
  return { status: "ready", model, loadMs: performance.now() - start } as ModelState;
}).pipe(
  startWith({ status: "loading" } as ModelState),
  catchError((err) => of({ status: "error", message: String(err) } as ModelState)),
  shareReplay(1),
);

type Author = {
  pubkey: string;
  /** The newest replies, used as the scoring bundle */
  notes: NostrEvent[];
  replies: number;
  score: number;
  raw: number;
};

type RelayStats = { url: string; received: number; replies: number; byAuthor: Map<string, number> };

type ScanState = {
  started: number;
  elapsed: number;
  notes: number;
  duplicates: number;
  replies: number;
  authors: Map<string, Author>;
  relays: RelayStats[];
  recent: NostrEvent[];
  featureMs: number;
  treeMs: number;
  inferences: number;
  timings: number[];
};

/** Subscribes to every relay and scores each author's reply bundle as new replies arrive */
function scan$(model: NspamModel, lookback: number) {
  return defer(() => {
    const state: ScanState = {
      started: performance.now(),
      elapsed: 0,
      notes: 0,
      duplicates: 0,
      replies: 0,
      authors: new Map(),
      relays: RELAYS.map((url) => ({ url, received: 0, replies: 0, byAuthor: new Map() })),
      recent: [],
      featureMs: 0,
      treeMs: 0,
      inferences: 0,
      timings: [],
    };
    const seen = new Set<string>();
    const filter = lookback
      ? { kinds: [1], since: unixNow() - lookback, limit: 500 }
      : { kinds: [1], since: unixNow() };

    const receive = (relay: RelayStats, event: NostrEvent, pending: Set<Author>) => {
      relay.received++;
      const reply = isNspamReply(event);
      if (reply) {
        relay.replies++;
        relay.byAuthor.set(event.pubkey, (relay.byAuthor.get(event.pubkey) ?? 0) + 1);
      }
      if (seen.has(event.id)) {
        state.duplicates++;
        return;
      }
      seen.add(event.id);
      state.notes++;
      eventStore.add(event);
      if (!reply) return;

      state.replies++;
      const author = state.authors.get(event.pubkey) ?? {
        pubkey: event.pubkey,
        notes: [],
        replies: 0,
        score: 0,
        raw: 0,
      };
      state.authors.set(event.pubkey, author);
      author.replies++;
      author.notes = [...author.notes, event].sort((a, b) => b.created_at - a.created_at).slice(0, NSPAM_MAX_BUNDLE);
      pending.add(author);
      state.recent = [event, ...state.recent].slice(0, 100);
    };

    return merge(
      ...state.relays.map((relay) =>
        pool
          .relay(relay.url)
          .subscription(filter)
          .pipe(
            onlyEvents(),
            map((event) => [relay, event] as const),
            // One failed relay should not stop the others
            catchError(() => EMPTY),
          ),
      ),
    ).pipe(
      bufferTime(250),
      map((batch) => {
        // Score each author once per batch with their newest replies
        const pending = new Set<Author>();
        for (const [relay, event] of batch) receive(relay, event, pending);
        for (const author of pending) {
          const start = performance.now();
          const features = extractNspamFeatures(author.notes);
          const extracted = performance.now();
          Object.assign(author, predictNspam(model, features));
          const end = performance.now();

          state.featureMs += extracted - start;
          state.treeMs += end - extracted;
          state.inferences++;
          state.timings.push(end - start);
        }
        state.timings = state.timings.slice(-MAX_TIMINGS);
        return { ...state, elapsed: performance.now() - state.started };
      }),
    );
  });
}

// Emits when the user stops a scan, so the last results stay on screen
const stop$ = new Subject<void>();

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const percent = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");
const ms = (n?: number) => (n === undefined ? "—" : `${n.toFixed(2)} ms`);

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="border border-base-300 p-3">
      <div className="text-sm opacity-60">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {detail && <div className="text-sm opacity-60">{detail}</div>}
    </div>
  );
}

function AuthorName({ pubkey }: { pubkey: string }) {
  const user = castUser(pubkey, eventStore);
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <img
        src={profile?.picture ?? `https://robohash.org/${pubkey}.png`}
        className="size-6 shrink-0 rounded-full"
        loading="lazy"
      />
      <span className="truncate font-medium">{profile?.displayName ?? user.npub.slice(0, 16)}</span>
    </span>
  );
}

function ScoreBadge({ author, threshold }: { author?: Author; threshold: number }) {
  if (!author) return null;
  return (
    <span
      className={`badge shrink-0 tabular-nums ${author.score >= threshold ? "badge-error" : "badge-ghost"}`}
      title={`raw ${author.raw.toExponential(2)} from ${author.notes.length} replies`}
    >
      {author.score.toFixed(2)} · {author.notes.length}
    </span>
  );
}

function RelayRow({ relay, isSpam }: { relay: RelayStats; isSpam: (pubkey: string) => boolean }) {
  const connected = use$(() => pool.relay(relay.url).connected$, [relay.url]);
  const spam = [...relay.byAuthor].reduce((n, [pubkey, replies]) => (isSpam(pubkey) ? n + replies : n), 0);

  return (
    <tr>
      <td>
        <span className={`status me-2 ${connected ? "status-success" : "status-error"}`} />
        {relay.url.replace(/^wss:\/\/|\/$/g, "")}
      </td>
      <td className="tabular-nums">{relay.received}</td>
      <td className="tabular-nums">{relay.replies}</td>
      <td className="tabular-nums">{spam}</td>
      <td className="tabular-nums">{percent(spam, relay.replies)}</td>
    </tr>
  );
}

function FlaggedAuthor({ author, threshold }: { author: Author; threshold: number }) {
  return (
    <details className="border-b border-base-300">
      <summary className="flex cursor-pointer items-center gap-2 p-2">
        <AuthorName pubkey={author.pubkey} />
        <span className="ms-auto shrink-0 text-sm opacity-60">{author.replies} replies</span>
        <ScoreBadge author={author} threshold={threshold} />
      </summary>
      <ol className="space-y-1 px-2 pb-2 text-sm">
        {author.notes.map((note) => (
          <li key={note.id} className="line-clamp-3 border-l-2 border-error/50 ps-2 break-all whitespace-pre-wrap">
            {note.content}
          </li>
        ))}
      </ol>
    </details>
  );
}

function RecentReply({ event, author, threshold }: { event: NostrEvent; author?: Author; threshold: number }) {
  return (
    <li className="border-b border-base-300 p-2">
      <div className="flex items-center gap-2">
        <AuthorName pubkey={event.pubkey} />
        <ScoreBadge author={author} threshold={threshold} />
      </div>
      <p className="mt-1 line-clamp-3 text-sm break-all whitespace-pre-wrap opacity-80">{event.content}</p>
    </li>
  );
}

export default function SpamFilter() {
  const [session, setSession] = useState<{ lookback: number }>();
  const [running, setRunning] = useState(false);
  const [lookback, setLookback] = useState(0);
  const [threshold, setThreshold] = useState(0.5);
  const [minReplies, setMinReplies] = useState(1);
  const [show, setShow] = useState<"all" | "spam" | "clean">("all");

  const model = use$(model$);
  const scan = use$(
    () =>
      session &&
      model$.pipe(
        switchMap((m) => (m.status === "ready" ? scan$(m.model, session.lookback) : EMPTY)),
        takeUntil(stop$),
      ),
    [session],
  );

  const stats = useMemo(() => {
    if (!scan) return undefined;
    const isSpam = (pubkey: string) => {
      const author = scan.authors.get(pubkey);
      return !!author && author.notes.length >= minReplies && author.score >= threshold;
    };
    const authors = [...scan.authors.values()];
    const flagged = authors.filter((a) => isSpam(a.pubkey)).sort((a, b) => b.score - a.score || b.replies - a.replies);
    const sorted = [...scan.timings].sort((a, b) => a - b);
    const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const recent = scan.recent.filter((e) => show === "all" || (show === "spam") === isSpam(e.pubkey));

    return {
      isSpam,
      flagged,
      recent,
      spamReplies: flagged.reduce((n, a) => n + a.replies, 0),
      p50: quantile(0.5),
      p95: quantile(0.95),
      max: sorted[sorted.length - 1],
    };
  }, [scan, threshold, minReplies, show]);

  const start = () => {
    setRunning(true);
    setSession({ lookback });
  };
  const stop = () => {
    stop$.next();
    setRunning(false);
  };

  const seconds = (scan?.elapsed ?? 0) / 1000;
  const scoringMs = (scan?.featureMs ?? 0) + (scan?.treeMs ?? 0);

  return (
    <div className="flex min-h-0 grow flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={`btn ${running ? "btn-error" : "btn-primary"}`}
          disabled={!running && model?.status !== "ready"}
          onClick={running ? stop : start}
        >
          {running ? "Stop" : scan ? "Restart" : "Start"}
        </button>
        <select
          className="select w-36"
          value={lookback}
          disabled={running}
          onChange={(e) => setLookback(Number(e.target.value))}
        >
          {LOOKBACKS.map(([label, value]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          Threshold
          <input
            type="range"
            className="range range-sm w-40"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
          <span className="w-10 tabular-nums">{threshold.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-2">
          Min replies
          <select className="select w-20" value={minReplies} onChange={(e) => setMinReplies(Number(e.target.value))}>
            {[1, 2, 3, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="ms-auto text-sm opacity-70">
          {model?.status === "loading" && `Downloading nspam ${NSPAM_MODEL_VERSION} from Hugging Face…`}
          {model?.status === "ready" &&
            `nspam ${NSPAM_MODEL_VERSION}: ${model.model.roots.length} trees, ${model.model.feature.length} nodes, loaded in ${model.loadMs.toFixed(0)} ms`}
        </span>
      </div>

      {model?.status === "error" && <div className="border border-error p-2 text-error">{model.message}</div>}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Unique notes" value={scan?.notes ?? 0} detail={`${scan?.duplicates ?? 0} duplicates`} />
        <Stat
          label="Replies scored"
          value={scan?.replies ?? 0}
          detail={`${(scan?.notes ?? 0) - (scan?.replies ?? 0)} root notes skipped`}
        />
        <Stat label="Authors" value={scan?.authors.size ?? 0} detail={`${stats?.flagged.length ?? 0} flagged`} />
        <Stat
          label="Spam replies"
          value={stats?.spamReplies ?? 0}
          detail={percent(stats?.spamReplies ?? 0, scan?.replies ?? 0)}
        />
        <Stat label="Notes / second" value={seconds ? ((scan?.notes ?? 0) / seconds).toFixed(1) : "—"} />
        <Stat
          label="Inferences"
          value={scan?.inferences ?? 0}
          detail={`avg ${ms(scan?.inferences ? scoringMs / scan.inferences : undefined)}`}
        />
        <Stat label="p50 / p95" value={ms(stats?.p50)} detail={`p95 ${ms(stats?.p95)}, max ${ms(stats?.max)}`} />
        <Stat
          label="Main thread"
          value={seconds ? percent(scoringMs, scan!.elapsed) : "—"}
          detail={`${percent(scan?.featureMs ?? 0, scoringMs)} features, rest trees`}
        />
      </div>

      <div className="overflow-x-auto border border-base-300">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Relay</th>
              <th>Received</th>
              <th>Replies</th>
              <th>Spam replies</th>
              <th>Spam %</th>
            </tr>
          </thead>
          <tbody>
            {stats && scan?.relays.map((relay) => <RelayRow key={relay.url} relay={relay} isSpam={stats.isSpam} />)}
          </tbody>
        </table>
      </div>

      <div className="grid min-h-96 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col border border-base-300">
          <h2 className="border-b border-base-300 p-2 font-semibold">Flagged authors</h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {stats?.flagged.slice(0, 100).map((author) => (
              <FlaggedAuthor key={author.pubkey} author={author} threshold={threshold} />
            ))}
          </div>
        </section>
        <section className="flex min-h-0 flex-col border border-base-300">
          <div className="flex items-center gap-2 border-b border-base-300 p-2">
            <h2 className="font-semibold">Recent replies</h2>
            <div className="join ms-auto">
              {(["all", "spam", "clean"] as const).map((value) => (
                <button
                  key={value}
                  className={`btn btn-sm join-item ${show === value ? "btn-active" : ""}`}
                  onClick={() => setShow(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {stats?.recent.map((event) => (
              <RecentReply
                key={event.id}
                event={event}
                author={scan?.authors.get(event.pubkey)}
                threshold={threshold}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
