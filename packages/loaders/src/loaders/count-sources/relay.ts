import { concatMap, defer, EMPTY, filter, from, map, switchMap, take, tap, timeout, catchError } from "rxjs";
import { distinctPolicy, listStream, relays } from "../../helpers/count-service/policy.js";
import type { CountList, CountRequest, CountSource } from "./types.js";

/** Options for ordered NIP-45 relay counts */
export interface RelayCountSourceOptions {
  /** The COUNT transport, usually pool.count.bind(pool) */
  count: CountRequest;
  /** The ordered trusted relay list */
  relays: CountList<string>;
  /** The stable adapter identity */
  id?: string;
}

/** Creates an ordered relay source that selects one COUNT result */
export function relayCountSource(options: RelayCountSourceOptions): CountSource {
  const routes$ = listStream(options.relays).pipe(map(relays));
  const id = options.id ?? "nip45";
  return {
    id,
    policy: () =>
      routes$.pipe(
        map((value) => JSON.stringify(value)),
        distinctPolicy(),
      ),
    count: (query, context) =>
      defer(() => {
        const filters = query.metric.filters?.(query.target);
        if (!filters?.length) return EMPTY;
        return routes$.pipe(
          take(1),
          switchMap((routes) =>
            from(routes).pipe(
              concatMap((relay) =>
                context.transport
                  .run([`relay:${relay}`], () => options.count([relay], filters))
                  .pipe(
                    timeout({
                      first: Math.max(1, Math.min(context.attemptTimeout, context.deadline - context.clock.now())),
                      scheduler: context.clock,
                    }),
                    map(
                      (outcomes) =>
                        outcomes[relay] ?? Object.entries(outcomes).find(([url]) => relays([url])[0] === relay)?.[1],
                    ),
                    filter((outcome) => outcome !== undefined),
                    take(1),
                    tap((outcome) => {
                      if (!outcome.ok) context.onFailure?.(outcome.error);
                    }),
                    switchMap((outcome) =>
                      outcome.ok && Number.isSafeInteger(outcome.value.count) && outcome.value.count >= 0
                        ? from([
                            {
                              value: outcome.value.count,
                              metric: query.metric.id,
                              origin: { adapter: id, relay },
                              approximate: outcome.value.approximate,
                            },
                          ])
                        : EMPTY,
                    ),
                    catchError((error) => {
                      context.onFailure?.(error);
                      return EMPTY;
                    }),
                  ),
              ),
              take(1),
            ),
          ),
        );
      }),
  };
}
