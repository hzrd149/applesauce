import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { NostrRequest } from "applesauce-loaders";
import type { TimelineWindow } from "applesauce-loaders/loaders";
import {
  auditTime,
  concat,
  defer,
  EMPTY,
  filter,
  finalize,
  map,
  MonoTypeOperatorFunction,
  Observable,
  startWith,
  Subject,
  tap,
} from "rxjs";

// Instrumentation for the timeline scrubber example. It records what the loader asks relays for and what each
// loader call receives, so loader bugs show up visually. Not a pattern for production apps.

export type RequestState = "active" | "complete" | "cancelled" | "error";

/** A single REQ the timeline loader sent to one relay */
export type RequestRecord = {
  id: number;
  relay: string;
  since?: number;
  until?: number;
  limit?: number;
  start: number;
  end?: number;
  state: RequestState;
  count: number;
  oldest?: number;
  newest?: number;
};

/** A single loader(window) call and how it settled */
export type CallRecord = {
  id: number;
  since?: number;
  until?: number;
  start: number;
  end?: number;
  state: "pending" | "complete" | "cancelled" | "error";
  events: number;
  duplicates: number;
};

export type MonitorSnapshot = {
  requests: RequestRecord[];
  calls: CallRecord[];
  /** Event timestamps received from each relay, keyed by event id */
  received: Map<string, Map<string, number>>;
  /** How many times the outbox map emitted, each emission can restart relay requests */
  maps: number;
};

/** Records requests and loader calls for one loader instance at a time */
export class TimelineMonitor {
  private requests: RequestRecord[] = [];
  private calls: CallRecord[] = [];
  private received = new Map<string, Map<string, number>>();
  private maps = 0;
  private nextId = 0;
  private changes$ = new Subject<void>();

  /** UI-friendly snapshots, rate limited so heavy loading doesn't re-render on every event */
  readonly snapshot$: Observable<MonitorSnapshot> = this.changes$.pipe(
    auditTime(100),
    startWith(undefined),
    map(() => ({
      requests: [...this.requests],
      calls: [...this.calls],
      received: new Map(this.received),
      maps: this.maps,
    })),
  );

  /** Clears all records, used when a new loader is created */
  reset() {
    this.requests = [];
    this.calls = [];
    this.received = new Map();
    this.maps = 0;
    this.changed();
  }

  /** Counts emissions of the outbox map passed to the loader */
  countMaps<T>(): MonoTypeOperatorFunction<T> {
    return tap(() => {
      this.maps++;
      this.changed();
    });
  }

  private changed() {
    this.changes$.next();
  }

  /** Wraps a request method so every REQ, its events and its settlement are recorded */
  instrument(request: NostrRequest): NostrRequest {
    return (relays, filters) =>
      defer(() => {
        // The timeline loader sends one relay per request, with the same bounds on every filter
        const filter = filters[0] ?? {};
        const record: RequestRecord = {
          id: this.nextId++,
          relay: relays.join(", "),
          since: filter.since,
          until: filter.until,
          limit: filter.limit,
          start: Date.now(),
          state: "active",
          count: 0,
        };
        this.requests.push(record);
        this.changed();

        const settle = (state: RequestState) => {
          if (record.state !== "active") return;
          record.state = state;
          record.end = Date.now();
          this.changed();
        };

        return request(relays, filters).pipe(
          tap({
            next: (event) => {
              record.count++;
              record.oldest = Math.min(record.oldest ?? Infinity, event.created_at);
              record.newest = Math.max(record.newest ?? -Infinity, event.created_at);
              for (const relay of relays) {
                let ids = this.received.get(relay);
                if (!ids) this.received.set(relay, (ids = new Map()));
                ids.set(event.id, event.created_at);
              }
              this.changed();
            },
            complete: () => settle("complete"),
            error: () => settle("error"),
          }),
          // Unsubscribing before EOSE is a cancellation
          finalize(() => settle("cancelled")),
        );
      });
  }

  /** Records a loader(window) call, its events and whether it ever completes */
  trackCall(window: TimelineWindow, call$: Observable<NostrEvent>): Observable<NostrEvent> {
    return defer(() => {
      const record: CallRecord = {
        id: this.nextId++,
        since: window.since,
        until: window.until,
        start: Date.now(),
        state: "pending",
        events: 0,
        duplicates: 0,
      };
      const seen = new Set<string>();
      this.calls.push(record);
      this.changed();

      const settle = (state: CallRecord["state"]) => {
        if (record.state !== "pending") return;
        record.state = state;
        record.end = Date.now();
        this.changed();
      };

      return call$.pipe(
        tap({
          next: (event) => {
            record.events++;
            // A single call should never receive the same event twice
            if (seen.has(event.id)) record.duplicates++;
            else seen.add(event.id);
            this.changed();
          },
          complete: () => settle("complete"),
          error: () => settle("error"),
        }),
        finalize(() => settle("cancelled")),
      );
    });
  }
}

/**
 * Independently pages backward through [since, until] on one relay to find every event it holds
 * Uses an inclusive `until` and event ids so events sharing a second are not skipped
 */
export function crawlWindow(
  request: NostrRequest,
  relay: string,
  base: Filter,
  since: number,
  until: number,
  limit = 500,
): Observable<NostrEvent> {
  const seen = new Set<string>();
  let pages = 0;

  const page = (cursor: number): Observable<NostrEvent> => {
    let returned = 0;
    let fresh = 0;
    let oldest = cursor;

    return concat(
      request([relay], [{ ...base, since, until: cursor, limit }]).pipe(
        tap((event) => {
          returned++;
          oldest = Math.min(oldest, event.created_at);
        }),
        // Ignore events outside the bounds or already returned by an earlier page
        filter((event) => event.created_at >= since && event.created_at <= cursor && !seen.has(event.id)),
        tap((event) => {
          fresh++;
          seen.add(event.id);
        }),
      ),
      defer(() => {
        // Only an empty page proves there is nothing older
        if (returned === 0 || ++pages > 200) return EMPTY;
        // Request the oldest second again, or step past it when the page had nothing new
        const next = fresh > 0 ? oldest : oldest - 1;
        return next < since ? EMPTY : page(next);
      }),
    );
  };

  return page(until);
}
