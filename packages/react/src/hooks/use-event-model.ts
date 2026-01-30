import { ModelConstructor, withImmediateValueOrDefault } from "applesauce-core";
import hash_sum from "hash-sum";
import { of } from "rxjs";

import { useEventStore } from "./use-event-store.js";
import { useObservableEagerMemo } from "./use-observable-memo.js";

/** Runs and subscribes to a model on the {@link EventStore} */
export function useEventModel<T extends unknown, Args extends Array<any>>(
  factory: ModelConstructor<T, Args>,
  args?: Args | null,
): T | undefined {
  const store = useEventStore();

  return useObservableEagerMemo(() => {
    if (args) return store.model(factory, ...args).pipe(withImmediateValueOrDefault(undefined));
    else return of(undefined);
  }, [hash_sum(args), store, factory]);
}
