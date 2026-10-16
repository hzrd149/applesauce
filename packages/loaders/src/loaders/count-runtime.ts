import {
  asyncScheduler,
  BehaviorSubject,
  defer,
  Observable,
  Subscriber,
  Subscription,
  Subject,
  type SchedulerLike,
} from "rxjs";
import { normalizeURL } from "applesauce-core/helpers/url";
import type { CountTransportScheduler } from "./count-sources/types.js";

/** Options for transport capacity shared by count sources and services */
export interface CountRuntimeOptions {
  /** The optional app-wide active transport limit */
  concurrency?: number;
  /** The optional active transport limit per relay */
  perRelay?: number;
  /** The optional active transport limit per assertion provider */
  perProvider?: number;
  /** The maximum waiting transports, default 256 */
  queueCapacity?: number;
  /** The scheduler used for admission and cooldowns */
  scheduler?: SchedulerLike;
  /** The cooldown after transport failures in milliseconds, default 1000 */
  failureCooldown?: number;
}

/** A transport activity snapshot shared by participating count services */
export interface CountRuntimeEvent {
  /** The admission or release operation */
  type: string;
  /** The number of active transports */
  active: number;
  /** The number of transports waiting for capacity */
  pending: number;
}

/** Shared transport capacity and protocol-specific failure availability */
export interface CountRuntime extends CountTransportScheduler {
  /** The runtime clock shared by participating services */
  scheduler: SchedulerLike;
  /** Emits transport activity snapshots */
  events$: Observable<CountRuntimeEvent>;
  /** Cancels queued work, cooldown timers, and active transports */
  stop(): void;
  /** Emits whenever transport eligibility changes */
  changes$: Observable<unknown>;
  /** Returns whether all resource slots are currently available */
  available(resources: readonly string[]): boolean;
  /** Attempts atomic admission without waiting when capacity is unavailable */
  tryRun<T>(resources: readonly string[], transport: () => Observable<T>): Observable<T>;
  /** Returns whether a protocol endpoint is outside failure cooldown */
  healthy(endpoint: string): boolean;
  /** Marks a protocol endpoint temporarily unavailable after failure */
  failure(endpoint: string): void;
}

/**
 * Creates a transport runtime with optional capacity limits and cancellable admission
 * @throws if capacity limits or cooldown options are invalid
 */
export function createCountRuntime(options: CountRuntimeOptions = {}): CountRuntime {
  for (const value of [options.concurrency, options.perRelay, options.perProvider, options.queueCapacity])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new Error("Count capacity must be a positive safe integer");
  const cooldown = options.failureCooldown ?? 1000;
  if (!Number.isFinite(cooldown) || cooldown < 0) throw new Error("Invalid count failure cooldown");
  const clock = options.scheduler ?? asyncScheduler;
  const changes = new BehaviorSubject(0);
  const events = new Subject<CountRuntimeEvent>();
  const lifetime = new Subscription();
  let stopped = false;
  const used = new Map<string, number>();
  const failures = new Map<string, number>();
  const cooldownTasks = new Map<string, Subscription>();
  const queue: Array<{ keys: string[]; start: () => void }> = [];
  let active = 0;
  let draining = false;
  const normalize = (key: string) => (key.startsWith("relay:") ? `relay:${normalizeURL(key.slice(6))}` : key);
  const available = (keys: readonly string[]) =>
    !stopped &&
    active < (options.concurrency ?? Infinity) &&
    keys
      .map(normalize)
      .every(
        (key) =>
          (used.get(key) ?? 0) <
          (key.startsWith("provider:") ? (options.perProvider ?? Infinity) : (options.perRelay ?? Infinity)),
      );
  const changed = () => changes.next(changes.value + 1);
  const report = (type: string) => events.next({ type, active, pending: queue.length });
  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      let index: number;
      while ((index = queue.findIndex((job) => available(job.keys))) !== -1) queue.splice(index, 1)[0].start();
    } finally {
      draining = false;
    }
    changed();
  };
  const execute = <T>(resources: readonly string[], transport: () => Observable<T>, wait: boolean) =>
    new Observable<T>((subscriber) => {
      if (stopped) {
        subscriber.complete();
        return;
      }
      lifetime.add(subscriber);
      subscriber.add(() => lifetime.remove(subscriber));
      const keys = [...new Set(resources.map(normalize))];
      let admitted = false;
      const job = {
        keys,
        start: () => {
          if (subscriber.closed) return;
          admitted = true;
          active++;
          keys.forEach((key) => used.set(key, (used.get(key) ?? 0) + 1));
          const work = new Subscription();
          subscriber.add(work);
          // Release only after the actual upstream subscription has been torn down.
          const upstream = new Subscriber<T>({
            next: (value) => subscriber.next(value),
            error: (error: unknown) => subscriber.error(error),
            complete: () => subscriber.complete(),
          });
          work.add(upstream);
          let subscribing = true;
          let pending = false;
          let released = false;
          const release = () => {
            if (released) return;
            if (subscribing) {
              pending = true;
              return;
            }
            released = true;
            active--;
            keys.forEach((key) => {
              const n = used.get(key)! - 1;
              if (n) used.set(key, n);
              else used.delete(key);
            });
            report("settled");
            drain();
          };
          work.add(release);
          report("start");
          changed();
          try {
            defer(transport).subscribe(upstream);
          } finally {
            subscribing = false;
            if (pending) release();
          }
        },
      };
      subscriber.add(() => {
        if (!admitted) {
          const index = queue.indexOf(job);
          if (index !== -1) {
            queue.splice(index, 1);
            report("abandoned");
            changed();
          }
        }
      });
      if (available(keys)) job.start();
      else if (!wait) subscriber.complete();
      else if (queue.length >= (options.queueCapacity ?? 256)) {
        report("overload");
        subscriber.error(new Error("Count queue capacity exceeded"));
      } else {
        queue.push(job);
        report("queued");
        changed();
      }
    });
  return {
    scheduler: clock,
    events$: events.asObservable(),
    stop: () => {
      stopped = true;
      lifetime.unsubscribe();
      failures.clear();
      cooldownTasks.clear();
      changes.complete();
      events.complete();
    },
    changes$: changes.asObservable(),
    available,
    run: (keys, transport) => execute(keys, transport, true),
    tryRun: (keys, transport) => execute(keys, transport, false),
    healthy: (endpoint) => {
      const until = failures.get(endpoint);
      return !stopped && (until === undefined || until <= clock.now());
    },
    failure: (endpoint) => {
      if (stopped || !cooldown) return;
      const until = clock.now() + cooldown;
      failures.set(endpoint, until);
      cooldownTasks.get(endpoint)?.unsubscribe();
      const task = clock.schedule(() => {
        if (failures.get(endpoint) === until) {
          failures.delete(endpoint);
          cooldownTasks.delete(endpoint);
          changed();
        }
      }, cooldown);
      cooldownTasks.set(endpoint, task);
      lifetime.add(task);
      changed();
    },
  };
}
