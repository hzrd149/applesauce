import type { NostrEvent } from "applesauce-core/helpers";
import type { AssertionRequest, CountRequest, CountSource, CountTarget } from "applesauce-loaders/loaders";
import { auditTime, BehaviorSubject, Observable, startWith, timer } from "rxjs";

/** The bounded measurements for the simulated count transports */
export class CountStressMonitor {
  totals = {
    requests: 0,
    completed: 0,
    cancelled: 0,
    abandoned: 0,
    active: 0,
    pending: 0,
    hits: 0,
    misses: 0,
    fallbacks: 0,
    bytes: 0,
    subjects: 0,
    p50: 0,
    p95: 0,
    firstP50: 0,
    firstP95: 0,
  };
  private latencies: number[] = [];
  private firstValues: number[] = [];
  private updates = new BehaviorSubject({ ...this.totals });
  snapshots$ = this.updates.pipe(auditTime(100), startWith({ ...this.totals }));

  diagnostic = (event: { type: string; active: number; pending: number; latency?: number }) => {
    this.totals.active = event.active;
    this.totals.pending = event.pending;
    if (event.type === "cache-hit") this.totals.hits++;
    if (event.type === "cache-miss") this.totals.misses++;
    if (event.type === "abandoned") this.totals.abandoned++;
    if (event.type === "fallback") this.totals.fallbacks++;
    if (event.type === "first-value" && event.latency !== undefined) {
      this.firstValues.push(event.latency);
      if (this.firstValues.length > 512) this.firstValues.shift();
      const sorted = [...this.firstValues].sort((a, b) => a - b);
      this.totals.firstP50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      this.totals.firstP95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    }
    this.publish();
  };

  private publish() {
    this.updates.next({ ...this.totals });
  }

  track<T>(source: Observable<T>): Observable<T> {
    return new Observable((subscriber) => {
      this.totals.requests++;
      this.publish();
      let done = false;
      const sub = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (error) => {
          done = true;
          this.publish();
          subscriber.error(error);
        },
        complete: () => {
          done = true;
          this.totals.completed++;
          this.publish();
          subscriber.complete();
        },
      });
      return () => {
        sub.unsubscribe();
        if (!done) {
          this.totals.cancelled++;
          this.publish();
        }
      };
    });
  }

  transport<T>(latency: number, subjects: number, response: () => { values: T[]; bytes: number }): Observable<T> {
    return new Observable((subscriber) => {
      const began = performance.now();
      let done = false;
      this.totals.requests++;
      this.totals.subjects += subjects;
      this.publish();
      const task = timer(latency).subscribe(() => {
        const result = response();
        done = true;
        this.totals.completed++;
        this.totals.bytes += result.bytes;
        this.latencies.push(performance.now() - began);
        if (this.latencies.length > 512) this.latencies.shift();
        const sorted = [...this.latencies].sort((a, b) => a - b);
        this.totals.p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        this.totals.p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
        this.publish();
        result.values.forEach((value) => subscriber.next(value));
        subscriber.complete();
      });
      return () => {
        task.unsubscribe();
        if (!done) {
          this.totals.cancelled++;
          this.publish();
        }
      };
    });
  }
}

/** Returns deterministic targets with a mix of recent and older timestamps */
export function countStressTargets(now = Math.floor(Date.now() / 1000)): CountTarget[] {
  return Array.from({ length: 10000 }, (_, index) => ({
    id: index.toString(16).padStart(64, "0"),
    kind: 1,
    created_at: now - (index % 3 === 0 ? index : index * 3600),
  }));
}

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const valueFor = (id: string) => parseInt(id.slice(-6), 16) % 40;
export const stressProviderKey = "b".repeat(64);

/** Creates seeded synthetic COUNT and assertion transports without network access */
export function countStressTransports(
  monitor: CountStressMonitor,
  latency: number,
): { count: CountRequest; request: AssertionRequest; baseline: CountSource } {
  return {
    count: (relays, filters) =>
      monitor.transport(latency, 1, () => {
        const id = filters[0]["#e"]?.[0] ?? filters[0]["#E"]?.[0] ?? "0";
        const response = { [relays[0]]: { ok: true as const, value: { count: valueFor(id) } } };
        return { values: [response], bytes: byteLength(["COUNT", "id", filters]) + byteLength(response) };
      }),
    request: (_relays, filters) =>
      monitor.transport(latency, filters[0]["#d"]?.length ?? 0, () => {
        const events = (filters[0]["#d"] ?? []).map((id): NostrEvent => ({
          id,
          kind: 30383,
          pubkey: filters[0].authors?.[0] ?? stressProviderKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["d", id],
            ["reaction_cnt", String(valueFor(id))],
            ["comment_cnt", String(valueFor(id))],
          ],
          content: "",
          sig: "",
        }));
        return { values: events, bytes: byteLength(["REQ", "id", filters]) + byteLength(events) };
      }),
    baseline: {
      id: "download-baseline",
      policy: () => new BehaviorSubject("seed:1"),
      count: (query, context) =>
        context.transport.run(["relay:wss://simulation.test/"], () =>
          monitor.transport(latency, 1, () => {
            const events = Array.from({ length: valueFor(query.target.id) }, (_, i) => ({
              id: i.toString(16).padStart(64, "0"),
              kind: query.metric.assertionTag === "reaction_cnt" ? 7 : 1111,
              pubkey: stressProviderKey,
              created_at: 1,
              tags: [["e", query.target.id]],
              content: "+",
              sig: "0".repeat(128),
            }));
            return {
              values: [
                {
                  value: events.length,
                  metric: query.metric.id,
                  origin: { adapter: "download-baseline", relay: "wss://simulation.test/" },
                },
              ],
              bytes: byteLength(events),
            };
          }),
        ),
    },
  };
}
