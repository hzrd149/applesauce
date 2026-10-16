import { catchError, combineLatest, concat, defer, EMPTY, filter, map, of, take, timeout } from "rxjs";
import type { CountContext, CountQuery, CountResult, CountSource } from "./types.js";

/**
 * Resolves sources in order without combining their values
 * @throws if child source IDs are duplicated
 */
export function fallbackCountSource(sources: readonly CountSource[], id = "fallback"): CountSource {
  if (new Set(sources.map((s) => s.id)).size !== sources.length) throw new Error("Count source IDs must be unique");
  return {
    id,
    policy: (query) =>
      sources.length
        ? combineLatest(sources.map((s) => s.policy(query))).pipe(map((value) => JSON.stringify(value)))
        : of("[]"),
    count: (query: CountQuery, context: CountContext) =>
      concat(
        ...sources.map((source, index) =>
          defer(() => {
            if (index) context.diagnostic?.("fallback");
            return context.clock.now() >= context.deadline ? EMPTY : source.count(query, context);
          }).pipe(
            timeout({
              first: Math.max(1, Math.min(context.attemptTimeout, context.deadline - context.clock.now())),
              scheduler: context.clock,
            }),
            filter(
              (result: CountResult) =>
                result.metric === query.metric.id && Number.isSafeInteger(result.value) && result.value >= 0,
            ),
            take(1),
            catchError((error) => {
              context.onFailure?.(error);
              return EMPTY;
            }),
          ),
        ),
      ).pipe(take(1)),
  };
}
