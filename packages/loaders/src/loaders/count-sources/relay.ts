import type { Debugger } from "applesauce-core";
import { concatMap, defer, EMPTY, filter, from, map, switchMap, take, tap, timeout, catchError } from "rxjs";
import { createCountSourceLogger, traceCountOperation } from "../../helpers/count-service/logging.js";
import { distinctPolicy, listStream, relays } from "../../helpers/count-service/policy.js";
import type { CountList, CountPool, CountRequest, CountSource } from "./types.js";

/** Options for ordered NIP-45 relay counts */
export interface RelayCountSourceOptions {
  /** The explicit COUNT transport, overriding pool.count */
  count?: CountRequest;

  /** The structural upstream pool supplying COUNT */
  pool?: Pick<CountPool, "count">;

  /** The ordered trusted relay list */
  relays: CountList<string>;

  /** The relay selection order, default priority */
  selection?: "priority" | "round-robin";

  /** The parent logger, overriding the service logger for this source */
  logger?: Debugger;

  /** The stable adapter identity */
  id?: string;
}

/**
 * Creates an ordered relay source that selects one COUNT result
 * @throws if neither count nor pool.count is available
 */
export function relayCountSource(options: RelayCountSourceOptions): CountSource {
  const count = options.count ?? options.pool?.count?.bind(options.pool);

  if (!count) throw new Error("A COUNT method or pool.count is required");

  const routes$ = listStream(options.relays).pipe(map(relays));
  const id = options.id ?? "nip45";
  const loggerFor = createCountSourceLogger("relay", options.logger);
  let cursor = 0;

  return {
    id,

    // Keep routing changes observable after a finite count has settled.
    policy: () =>
      routes$.pipe(
        map((value) => JSON.stringify(value)),
        distinctPolicy(),
      ),

    count: (query, context) =>
      defer(() => {
        const log = loggerFor(context);
        const target = query.target.address ?? query.target.id;
        const filters = query.metric.filters?.(query.target);

        if (!filters?.length) {
          log("Metric unsupported", id, query.metric.id, target);
          return EMPTY;
        }

        return routes$.pipe(
          // Snapshot this attempt's routes; the service replaces it when policy changes.
          take(1),
          tap((routes) => log("Relay candidates", id, query.metric.id, target, "count", routes.length)),

          switchMap((routes) => {
            // Advance only subscribed, supported resolutions; rotation is not a policy revision.
            const start = options.selection === "round-robin" && routes.length ? cursor++ % routes.length : 0;
            const ordered = [...routes.slice(start), ...routes.slice(0, start)];
            // Leave room for other candidates within the enclosing source timeout.
            const relayTimeout =
              options.selection === "round-robin"
                ? context.attemptTimeout / (routes.length + 1)
                : context.attemptTimeout;
            return from(ordered).pipe(
              // Query in priority order rather than opening all relay transports at once.
              concatMap((relay) =>
                // Admission stays lazy and cancellable while waiting for shared capacity.
                context.transport
                  .run([`relay:${relay}`], () =>
                    count([relay], filters).pipe(
                      traceCountOperation(log, context.clock, "COUNT transport", {
                        source: id,
                        relay,
                        metric: query.metric.id,
                        target,
                      }),
                    ),
                  )
                  .pipe(
                    timeout({
                      first: Math.max(1, Math.min(relayTimeout, context.deadline - context.clock.now())),
                      scheduler: context.clock,
                    }),

                    // Pool outcomes are progressive; accept only the selected relay's entry.
                    map(
                      (outcomes) =>
                        outcomes[relay] ?? Object.entries(outcomes).find(([url]) => relays([url])[0] === relay)?.[1],
                    ),
                    filter((outcome) => outcome !== undefined),

                    // One settled outcome is enough to accept or reject this relay.
                    take(1),
                    tap((outcome) => {
                      if (!outcome.ok) {
                        log("COUNT refused", id, relay, query.metric.id, target, outcome.error);
                        context.onFailure?.(outcome.error);
                      }
                    }),

                    // Refusal or invalid data completes empty so the next relay can run.
                    switchMap((outcome) => {
                      if (!outcome.ok) return EMPTY;

                      if (!Number.isSafeInteger(outcome.value.count) || outcome.value.count < 0) {
                        log("Invalid COUNT result", id, relay, query.metric.id, target, outcome.value.count);
                        return EMPTY;
                      }

                      log("COUNT accepted", id, relay, query.metric.id, target, outcome.value.count);
                      return from([
                        {
                          value: outcome.value.count,
                          metric: query.metric.id,
                          origin: { adapter: id, relay },
                          approximate: outcome.value.approximate,
                        },
                      ]);
                    }),

                    // Isolate transport failures without terminating the remaining relay sequence.
                    catchError((error) => {
                      log("COUNT attempt failed", id, relay, query.metric.id, target, error);
                      context.onFailure?.(error);

                      return EMPTY;
                    }),
                  ),
              ),

              // Stop at one usable total; counts from different relays are never added.
              take(1),
            );
          }),
        );
      }),
  };
}

/**
 * Creates a relay source that rotates the first candidate across subscribed resolutions
 * @throws if neither count nor pool.count is available
 */
export function roundRobinCountSource(options: Omit<RelayCountSourceOptions, "selection">): CountSource {
  return relayCountSource({ ...options, id: options.id ?? "nip45-round-robin", selection: "round-robin" });
}
