import { firstValueFrom, from, timeout, type SchedulerLike } from "rxjs";
import type { CountCache, CountCacheRecord } from "../../loaders/count-service.js";

// Epoch keys let invalidation cover entries written by earlier sessions without enumerating or clearing the store.
/** Creates bounded persistent cache access with policy-scoped invalidation */
export function createPersistentCountCache(cache: CountCache, clock: SchedulerLike, deadline: number) {
  let pending: Promise<unknown> = Promise.resolve();
  const run = <T>(action: () => Promise<T>, ordered = true): Promise<T> => {
    let expired = false;
    const task = pending.then(() => {
      if (expired) throw new Error("Count cache operation expired before execution");
      return action();
    });
    // Include queue wait in the deadline, and never start an operation that already timed out.
    const result = firstValueFrom(from(task).pipe(timeout({ first: deadline, scheduler: clock }))).catch((error) => {
      expired = true;
      throw error;
    });
    if (ordered) pending = result.catch(() => undefined);
    return result;
  };
  const prefix = "applesauce:counts:v1:";
  const globalKey = `${prefix}epoch`;
  const targetEpochKey = (target: string) => `${prefix}target:${target}`;
  const token = () => globalThis.crypto.randomUUID();

  return {
    read: (target: string, metric: string, policy: string) =>
      run(async () => {
        const global = await cache.get(globalKey);
        const local = await cache.get(targetEpochKey(target));
        if ((global !== undefined && typeof global !== "string") || (local !== undefined && typeof local !== "string"))
          throw new Error("Invalid count cache epoch");
        const key = prefix + JSON.stringify([global ?? "", local ?? "", target, metric, policy]);
        const record = await cache.get(key);
        return {
          record,
          write: (value: CountCacheRecord) =>
            run(async () => {
              const remaining = value.retainUntil === null ? 0 : value.retainUntil - clock.now();
              if (value.retainUntil !== null && remaining <= 0) return;
              await cache.set(key, value, remaining);
            }),
        };
      }, false),
    invalidate: (target?: string) =>
      run(async () => {
        await cache.set(target === undefined ? globalKey : targetEpochKey(target), token(), 0);
      }),
  };
}
