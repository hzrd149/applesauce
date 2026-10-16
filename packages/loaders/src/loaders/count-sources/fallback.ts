import { catchError, combineLatest, concat, defer, EMPTY, filter, map, of, take, timeout } from "rxjs";
import { createCountSourceLogger, traceCountOperation } from "../../helpers/count-service/logging.js";
import type { CountContext, CountQuery, CountResult, CountSource } from "./types.js";

/**
 * Resolves sources in order without combining their values
 * @throws if child source IDs are duplicated
 */
export function fallbackCountSource(sources: readonly CountSource[], id = "fallback"): CountSource {
  if (new Set(sources.map((s) => s.id)).size !== sources.length) throw new Error("Count source IDs must be unique");

  const loggerFor = createCountSourceLogger("fallback");

  return {
    id,

    // Observe every child policy independently of which finite count attempt succeeds.
    policy: (query) =>
      sources.length
        ? combineLatest(sources.map((s) => s.policy(query))).pipe(map((value) => JSON.stringify(value)))
        : of("[]"),

    count: (query: CountQuery, context: CountContext) =>
      // Subscribe to candidates sequentially; constructing the hierarchy starts no work.
      concat(
        ...sources.map((source, index) =>
          // Invoke a source only when its turn arrives and demand still exists.
          defer(() => {
            const remaining = context.deadline - context.clock.now();

            if (index) context.diagnostic?.("fallback");

            if (remaining <= 0) {
              loggerFor(context)(
                "Resolution deadline exhausted",
                source.id,
                query.metric.id,
                query.target.address ?? query.target.id,
              );
              return EMPTY;
            }

            return defer(() => source.count(query, context)).pipe(
              // Ignore malformed results, while preserving a successful zero.
              filter(
                (result: CountResult) =>
                  result.metric === query.metric.id && Number.isSafeInteger(result.value) && result.value >= 0,
              ),

              // The first valid count finishes this candidate, including a count of zero.
              take(1),

              // Bound each candidate's wait; the service also enforces the shared resolution deadline.
              timeout({
                first: Math.max(
                  1,
                  Math.min(source.managed && context.routed ? Infinity : context.attemptTimeout, remaining),
                ),
                scheduler: context.clock,
              }),

              traceCountOperation(loggerFor(context), context.clock, "Source attempt", {
                source: source.id,
                metric: query.metric.id,
                target: query.target.address ?? query.target.id,
                priority: index,
              }),

              // Empty completion advances concat to the next candidate; errors do the same.
              catchError((error) => {
                context.onFailure?.(error);

                return EMPTY;
              }),
            );
          }),
        ),
      ).pipe(
        // The first valid result prevents later sources from subscribing.
        take(1),
      ),
  };
}
