import { Observable, Subscriber, Subscription, type SchedulerLike } from "rxjs";
import type { CountTransportScheduler } from "../../loaders/count-sources/types.js";

/** The internal atomic transport admission limits */
export interface TransportOptions {
  /** The clock used to coalesce teardown before admitting queued work */
  clock: SchedulerLike;
  /** The admission delay that absorbs short-lived demand */
  admissionWindow: number;
  /** The global transport limit */
  concurrency: number;
  /** The per-relay transport limit */
  perRelay: number;
  /** The per-provider transport limit */
  perProvider: number;
  /** The maximum pending transports */
  queueCapacity: number;
  /** The optional activity callback */
  diagnostic?: (event: { type: string; active: number; pending: number }) => void;
}

/** Creates a cancellable FIFO scheduler that atomically acquires all resources */
export function createTransportScheduler(options: TransportOptions): CountTransportScheduler {
  const queue: { resources: string[]; start: () => void; subscriber: Subscriber<unknown> }[] = [];
  const used = new Map<string, number>();
  let active = 0;
  let draining = false;
  let scheduled: Subscription | undefined;
  const report = (type: string) => options.diagnostic?.({ type, active, pending: queue.length });
  const fits = (resources: string[]) =>
    active < options.concurrency &&
    resources.every((r) => (used.get(r) ?? 0) < (r.startsWith("provider:") ? options.perProvider : options.perRelay));
  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      let index: number;
      while ((index = queue.findIndex((job) => fits(job.resources))) !== -1) {
        const [job] = queue.splice(index, 1);
        if (!job.subscriber.closed) job.start();
      }
    } finally {
      draining = false;
    }
  };
  const schedule = () => {
    if (queue.length && !scheduled && !draining) {
      const task = new Subscription();
      scheduled = task;
      task.add(
        options.clock.schedule(() => {
          if (scheduled === task) scheduled = undefined;
          drain();
        }, options.admissionWindow),
      );
    }
  };
  return {
    run: <T>(resources: readonly string[], transport: () => Observable<T>) =>
      new Observable<T>((subscriber) => {
        const keys = [...new Set(resources)];
        let admitted = false;
        const job = {
          resources: keys,
          subscriber: subscriber as Subscriber<unknown>,
          start: () => {
            admitted = true;
            active++;
            keys.forEach((r) => used.set(r, (used.get(r) ?? 0) + 1));
            report("start");
            let subscribing = true;
            let releasePending = false;
            let released = false;
            const release = () => {
              if (released) return;
              if (subscribing) {
                releasePending = true;
                return;
              }
              released = true;
              active--;
              keys.forEach((r) => {
                const n = used.get(r)! - 1;
                if (n) used.set(r, n);
                else used.delete(r);
              });
              report("settled");
              schedule();
            };
            const upstream = new Subscriber<T>({
              next: (value) => subscriber.next(value),
              error: (error: unknown) => subscriber.error(error),
              complete: () => subscriber.complete(),
            });
            // Tear down transport before releasing slots, including synchronous/reentrant settlement.
            subscriber.add(upstream);
            subscriber.add(release);
            try {
              transport().subscribe(upstream);
            } catch (error) {
              subscriber.error(error);
            } finally {
              subscribing = false;
              if (releasePending) release();
            }
          },
        };
        subscriber.add(() => {
          if (!admitted) {
            const i = queue.indexOf(job);
            if (i !== -1) {
              queue.splice(i, 1);
              report("abandoned");
            }
            if (!queue.length) {
              scheduled?.unsubscribe();
              scheduled = undefined;
            }
          }
        });
        if (queue.length >= options.queueCapacity) {
          report("overload");
          subscriber.error(new Error("Count queue capacity exceeded"));
        } else {
          queue.push(job);
          report("queued");
          schedule();
        }
      }),
  };
}
