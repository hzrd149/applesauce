import { castUser } from "applesauce-common/casts/user";
import type { EventStore } from "applesauce-core";
import { getPublicContacts, isFromCache, kinds } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { defined } from "applesauce-core/observable";
import type { NostrRequest } from "applesauce-loaders";
import type { SocialGraphLoaderResult, SocialGraphStatus } from "applesauce-loaders/loaders";
import {
  auditTime,
  catchError,
  concat,
  defer,
  EMPTY,
  filter,
  finalize,
  ignoreElements,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
  timeout,
  toArray,
} from "rxjs";

// Instrumentation for the social graph stress example. It records every REQ the loader sends and checks the
// loader's output for inconsistencies, so problems show up visually. Not a pattern for production apps.

/** Why the loader sent a REQ: a new batch, a retry of users a lossy relay dropped, or a refresh of cached lists */
export type ReqKind = "batch" | "retry" | "refresh";

/** A single REQ the social graph loader sent to one relay */
export type ReqRecord = {
  id: number;
  relay: string;
  kind: ReqKind;
  authors: number;
  filters: number;
  start: number;
  end?: number;
  state: "active" | "complete" | "cancelled" | "error";
  events: number;
  error?: string;
};

/** Progress at a point in time, used to draw the progress curve */
export type ProgressSample = { t: number; found: number; requested: number };

/** Consistency checks on the loader output, anything above zero is a loader bug */
export type CrawlChecks = {
  /** Events emitted for a user that were not newer than a list already emitted for them */
  stale: number;
  /** Events or status snapshots emitted after the done snapshot */
  afterDone: number;
  /** How many status snapshots said done, must be exactly one for a finished crawl */
  doneCount: number;
  /** REQs still open two seconds after the crawl ended or was stopped */
  openAfterEnd?: number;
  /** Users with an emitted list minus status.found at done */
  foundMismatch?: number;
  /** Unique users sent to relays minus status.requested at done */
  requestedMismatch?: number;
};

export type CrawlSnapshot = {
  requests: ReqRecord[];
  samples: ProgressSample[];
  status?: SocialGraphStatus;
  started: number;
  ended?: number;
  /** Users with an emitted follow list */
  lists: number;
  /** Lists that came from the cache */
  cached: number;
  /** Follow edges in the newest list of every user */
  edges: number;
  checks: CrawlChecks;
  /** Users a strict breadth-first crawl to the same distance would request, computed when the crawl is done */
  expected?: number;
};

/** The records of a single crawl, kept separate so a replaced crawl can't write into the next one */
class Crawl {
  requests: ReqRecord[] = [];
  samples: ProgressSample[] = [];
  status?: SocialGraphStatus;
  started = Date.now();
  ended?: number;
  checks: CrawlChecks = { stale: 0, afterDone: 0, doneCount: 0 };
  expected?: number;
  cached = 0;
  edges = 0;
  /** Every user sent to a relay, the ground truth for what the loader requested */
  requested = new Set<string>();
  // Pubkeys are interned to numbers so distance 2 crawls don't hold millions of strings
  ids = new Map<string, number>();
  keys: string[] = [];
  created = new Map<number, number>();
  follows = new Map<number, Uint32Array>();

  intern(pubkey: string) {
    let id = this.ids.get(pubkey);
    if (id === undefined) {
      id = this.keys.push(pubkey) - 1;
      this.ids.set(pubkey, id);
    }
    return id;
  }

  snapshot(): CrawlSnapshot {
    return {
      requests: [...this.requests],
      samples: [...this.samples],
      status: this.status,
      started: this.started,
      ended: this.ended,
      lists: this.created.size,
      cached: this.cached,
      edges: this.edges,
      checks: { ...this.checks },
      expected: this.expected,
    };
  }

  /** Counts the users within distance hops of the root, over the follow lists the crawl found */
  breadthFirst(root: string, distance: number) {
    const start = this.intern(root);
    const seen = new Set<number>([start]);
    let frontier = [start];
    for (let hop = 0; hop < distance; hop++) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const follow of this.follows.get(id) ?? []) {
          if (seen.has(follow)) continue;
          seen.add(follow);
          next.push(follow);
        }
      }
      frontier = next;
    }
    return seen.size;
  }
}

/** Records one social graph crawl at a time */
export class GraphMonitor {
  private crawl = new Crawl();
  private nextId = 0;
  private changes$ = new Subject<void>();

  /** UI-friendly snapshots, rate limited so heavy loading doesn't re-render on every event */
  readonly snapshot$: Observable<CrawlSnapshot> = this.changes$.pipe(
    auditTime(100),
    startWith(undefined),
    map(() => this.crawl.snapshot()),
  );

  private changed() {
    this.changes$.next();
  }

  /** Wraps a request method so every REQ, its events and its settlement are recorded */
  instrument(request: NostrRequest): NostrRequest {
    return (relays, filters) =>
      defer(() => {
        const crawl = this.crawl;
        const authors = filters.flatMap((f) => f.authors ?? []);
        for (const pubkey of authors) crawl.requested.add(pubkey);

        const record: ReqRecord = {
          id: this.nextId++,
          relay: relays.join(", "),
          // The loader only uses since on cached users and single author filters when retrying
          kind: filters.some((f) => f.since !== undefined)
            ? "refresh"
            : filters.length > 1 && filters.every((f) => f.authors?.length === 1)
              ? "retry"
              : "batch",
          authors: authors.length,
          filters: filters.length,
          start: Date.now(),
          state: "active",
          events: 0,
        };
        crawl.requests.push(record);
        this.changed();

        const settle = (state: ReqRecord["state"], error?: unknown) => {
          if (record.state !== "active") return;
          record.state = state;
          record.end = Date.now();
          if (error) record.error = error instanceof Error ? error.message : String(error);
          this.changed();
        };

        return request(relays, filters).pipe(
          tap({
            next: () => {
              record.events++;
              this.changed();
            },
            complete: () => settle("complete"),
            error: (error) => settle("error", error),
          }),
          // Unsubscribing before EOSE is a cancellation
          finalize(() => settle("cancelled")),
        );
      });
  }

  /**
   * Starts recording a new crawl and subscribes to both loader streams in one tick, checking their output
   * Calls onEnd once open REQs had two seconds to close
   */
  track(
    { events$, status$ }: SocialGraphLoaderResult,
    root: string,
    distance: number,
    onEnd: (snapshot: CrawlSnapshot) => void,
  ): Observable<NostrEvent> {
    return defer(() => {
      const crawl = (this.crawl = new Crawl());
      const { checks } = crawl;
      let done = false;
      this.changed();

      const events = events$.pipe(
        tap((event) => {
          if (done) checks.afterDone++;
          const id = crawl.intern(event.pubkey);
          const previous = crawl.created.get(id);
          if (previous !== undefined && event.created_at <= previous) {
            checks.stale++;
            return;
          }

          const follows = Uint32Array.from(getPublicContacts(event), (p) => crawl.intern(p.pubkey));
          crawl.edges += follows.length - (crawl.follows.get(id)?.length ?? 0);
          crawl.follows.set(id, follows);
          crawl.created.set(id, event.created_at);
          if (isFromCache(event)) crawl.cached++;
          this.changed();
        }),
      );

      const status = status$.pipe(
        tap((status) => {
          if (done) checks.afterDone++;
          crawl.status = status;
          crawl.samples.push({ t: Date.now() - crawl.started, found: status.found, requested: status.requested });
          if (status.done) {
            done = true;
            checks.doneCount++;
            checks.foundMismatch = crawl.created.size - status.found;
            checks.requestedMismatch = crawl.requested.size - status.requested;
            crawl.expected = crawl.breadthFirst(root, distance);
          }
          this.changed();
        }),
        ignoreElements(),
      );

      return merge(events, status).pipe(
        finalize(() => {
          crawl.ended = Date.now();
          this.changed();
          setTimeout(() => {
            checks.openAfterEnd = crawl.requests.filter((r) => r.state === "active").length;
            this.changed();
            onEnd(crawl.snapshot());
          }, 2000);
        }),
      );
    });
  }

  /** Returns the users that were sent to relays but have no emitted follow list */
  missing(): string[] {
    const { requested, ids, created } = this.crawl;
    return Array.from(requested).filter((pubkey) => {
      const id = ids.get(pubkey);
      return id === undefined || !created.has(id);
    });
  }
}

/** The result of re-checking a sample of missing users outside the loader */
export type VerifyResult = {
  state: "crawl relays" | "outboxes" | "done";
  checked: string[];
  /** Lists the crawl relays do have, these are users the loader lost */
  onCrawlRelays: string[];
  /** Lists only found on the users own NIP-65 outboxes, a relay coverage gap */
  onOutboxes: string[];
  /** Users with no follow list on any relay checked */
  none: string[];
};

/** Asks relays for each user with one single author filter per user, 20 per REQ, and returns who was found */
function findLists(request: NostrRequest, relays: string[], pubkeys: string[], since?: number) {
  const filter = (pubkey: string): Filter => ({ kinds: [kinds.Contacts], authors: [pubkey], since });
  const reqs = relays.flatMap((relay) =>
    Array.from({ length: Math.ceil(pubkeys.length / 20) }, (_, i) =>
      request([relay], pubkeys.slice(i * 20, i * 20 + 20).map(filter)).pipe(catchError(() => EMPTY)),
    ),
  );
  return merge(...reqs).pipe(
    map((event) => event.pubkey),
    toArray(),
    map((found) => new Set(found)),
  );
}

/**
 * Re-checks a random sample of missing users on the crawl relays, then on their own outboxes
 * Uses a plain request so the checks don't show up in the REQ log
 */
export function verifyMissing(
  request: NostrRequest,
  eventStore: EventStore,
  missing: string[],
  relays: string[],
  since?: number,
  size = 50,
): Observable<VerifyResult> {
  return defer(() => {
    const checked = [...missing].sort(() => Math.random() - 0.5).slice(0, size);
    const base: VerifyResult = { state: "crawl relays", checked, onCrawlRelays: [], onOutboxes: [], none: [] };

    return findLists(request, relays, checked, since).pipe(
      switchMap((found) => {
        const rest = checked.filter((pubkey) => !found.has(pubkey));
        const step: VerifyResult = { ...base, state: "outboxes", onCrawlRelays: [...found] };

        // Look up each remaining users NIP-65 outboxes and ask them directly
        const outboxes = merge(
          ...rest.map((pubkey) =>
            castUser(pubkey, eventStore).outboxes$.pipe(
              defined(),
              take(1),
              timeout({ first: 5_000 }),
              catchError(() => of([] as string[])),
              filter((outboxes) => outboxes.length > 0),
              mergeMap((outboxes) => findLists(request, outboxes.slice(0, 8), [pubkey], since)),
            ),
          ),
        ).pipe(
          toArray(),
          map((sets) => new Set(sets.flatMap((set) => [...set]))),
          map((onOutboxes): VerifyResult => ({
            ...step,
            state: "done",
            onOutboxes: [...onOutboxes],
            none: rest.filter((pubkey) => !onOutboxes.has(pubkey)),
          })),
        );

        return concat(of(step), outboxes);
      }),
      startWith(base),
    );
  });
}

/** A REQ placed on its relay's timeline, slot is the row it was drawn in while other REQs were open */
export type PlacedReq = ReqRecord & { slot: number };

/** How hard the crawl pushed one relay */
export type RelayLoad = {
  relay: string;
  requests: PlacedReq[];
  /** The most REQs open on the relay at the same time */
  peakOpen: number;
  /** The most REQs started on the relay in any one second */
  peakRate: number;
  /** Users asked for across all REQs, including retries and refreshes */
  authors: number;
};

/** Groups REQs by relay and packs overlapping REQs into rows, so the row count is the peak concurrency */
export function relayLoad(requests: ReqRecord[], now = Date.now()): RelayLoad[] {
  const byRelay = new Map<string, ReqRecord[]>();
  for (const req of requests) {
    const list = byRelay.get(req.relay);
    if (list) list.push(req);
    else byRelay.set(req.relay, [req]);
  }

  return Array.from(byRelay, ([relay, reqs]) => {
    const sorted = [...reqs].sort((a, b) => a.start - b.start);
    const ends: number[] = [];
    const placed = sorted.map((req) => {
      let slot = ends.findIndex((end) => end <= req.start);
      if (slot === -1) slot = ends.push(0) - 1;
      ends[slot] = req.end ?? now;
      return { ...req, slot };
    });

    let peakRate = 0;
    for (let i = 0, j = 0; i < sorted.length; i++) {
      while (sorted[i].start - sorted[j].start >= 1000) j++;
      peakRate = Math.max(peakRate, i - j + 1);
    }

    return {
      relay,
      requests: placed,
      peakOpen: ends.length,
      peakRate,
      authors: sorted.reduce((sum, req) => sum + req.authors, 0),
    };
  });
}
