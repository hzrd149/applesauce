import {
  catchError,
  combineLatest,
  concat,
  concatMap,
  defer,
  EMPTY,
  filter,
  from,
  map,
  of,
  switchMap,
  startWith,
  take,
  timeout,
} from "rxjs";
import type { CountContext, CountQuery, CountSource } from "./types.js";

/** Options for composable count routing groups */
export interface CountRoutingOptions {
  /** The stable group identity */
  id?: string;

  /** Whether busy candidates wait for capacity or are skipped, default wait */
  busy?: "wait" | "skip";

  /** The optional total budget for this branch in milliseconds */
  timeout?: number;
}

/**
 * Creates a routing group over protocol sources or nested groups
 * @throws if the branch timeout is invalid
 */
export function routingCountSource(
  strategy: "fallback" | "round-robin" | "availability",
  sources: readonly CountSource[],
  options: CountRoutingOptions = {},
): CountSource {
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0))
    throw new Error("Invalid count branch timeout");

  let cursor = 0;

  // Assume support until the source tells us otherwise. This lets async sources join selection.
  const supports = (source: CountSource, query: CountQuery) =>
    defer(() => source.supports?.(query) ?? of(true)).pipe(
      startWith(true),

      catchError(() => of(false)),
    );

  // Wait for an availability value before choosing a source that might already be busy.
  const available = (source: CountSource, query: CountQuery, context: CountContext) =>
    defer(() => source.available?.(query, context) ?? of(true)).pipe(
      startWith(false),

      catchError((error) => {
        context.onFailure?.(error);

        return of(false);
      }),
    );

  // Keep watching every child so releasing capacity can make this group available again.
  const ready = (query: CountQuery, context: CountContext) =>
    sources.length ? combineLatest(sources.map((source) => available(source, query, context))) : of([] as boolean[]);

  return {
    id: options.id ?? strategy,
    managed: true,

    supports: (query) => {
      if (!sources.length) return of(false);

      const supportStreams = sources.map((source) => supports(source, query));

      return combineLatest(supportStreams).pipe(
        // The group supports a query as long as at least one child does.
        map((values) => values.some(Boolean)),
      );
    },

    // A change in any child policy restarts the service resolution.
    policy: (query) => {
      if (!sources.length) return of(JSON.stringify([strategy, []]));

      const policies = sources.map((source) =>
        source.policy(query).pipe(
          // Include the source identity so replacing a child changes the group policy too.
          map((policy) => [source.id, policy]),
        ),
      );

      return combineLatest(policies).pipe(
        map((values) => JSON.stringify([strategy, options.busy ?? "wait", options.timeout ?? null, values])),
      );
    },

    available: (query, context) => ready(query, context).pipe(map((values) => values.some(Boolean))),

    count: (query, context) =>
      defer(() => {
        // Rotate once per subscription, then keep that order for this resolution.
        const start = strategy === "round-robin" && sources.length ? cursor++ % sources.length : 0;
        const ordered = [...sources.slice(start), ...sources.slice(0, start)];

        const skip = strategy === "availability" || options.busy === "skip";

        // Nested groups can shorten the parent deadline, but cannot extend it.
        const deadline = Math.min(
          context.deadline,
          options.timeout === undefined ? Infinity : context.clock.now() + options.timeout,
        );

        const childContext: CountContext = { ...context, deadline, routed: true };

        // In skip mode, a busy transport completes empty instead of joining the queue.
        if (skip && context.runtime) {
          childContext.transport = {
            run: (keys, transport) => context.runtime!.tryRun(keys, transport),
          };
        }

        let attempts = 0;

        // A failed or empty attempt lets the caller choose another source.
        const attempt = (source: CountSource) =>
          defer(() => {
            if (context.clock.now() >= deadline) return EMPTY;

            if (attempts++) context.diagnostic?.("fallback");
            context.diagnostic?.("selected");

            return defer(() => source.count(query, childContext)).pipe(
              // Only a valid count for this metric can stop the search.
              filter(
                (result) =>
                  result.metric === query.metric.id && Number.isSafeInteger(result.value) && result.value >= 0,
              ),

              take(1),

              // Each child gets the time still available when its turn starts.
              timeout({
                first: Math.max(
                  1,
                  Math.min(source.managed ? Infinity : context.attemptTimeout, deadline - context.clock.now()),
                ),
                scheduler: context.clock,
              }),

              // Convert errors to empty completion so the next candidate can run.
              catchError((error) => {
                context.onFailure?.(error);
                return EMPTY;
              }),
            );
          });

        if (!skip) {
          // Try one source at a time. The first count cancels the rest of the sequence.
          return from(ordered).pipe(
            concatMap(attempt),

            take(1),
          );
        }

        // Reconsider all unattempted peers after capacity changes, without racing requests.
        const remaining = new Set(ordered);

        const next = (): ReturnType<CountSource["count"]> =>
          defer(() => {
            const candidates = ordered.filter((source) => remaining.has(source));

            if (!candidates.length) return EMPTY;

            // Wake up when support or capacity changes for any remaining candidate.
            return combineLatest(
              candidates.map((source) =>
                combineLatest([supports(source, query), available(source, query, childContext)]),
              ),
            ).pipe(
              // Pick the first candidate that both supports the query and has capacity.
              map((states) => ({
                supported: states.some(([supported]) => supported),
                source: candidates.find((_, index) => states[index][0] && states[index][1]),
              })),

              // Keep waiting if supported candidates are busy; finish if none support the query.
              filter(({ supported, source }) => !supported || !!source),

              // Stop watching availability once we have made this selection.
              take(1),

              timeout({
                first: Math.max(1, Math.min(context.selectionTimeout ?? 1000, deadline - context.clock.now())),
                scheduler: context.clock,
              }),

              switchMap(({ source }) => {
                if (!source) return EMPTY;

                // Try each source once. Only an empty attempt subscribes to next() again.
                remaining.delete(source);

                return concat(attempt(source), defer(next)).pipe(take(1));
              }),

              catchError((error) => {
                context.onFailure?.(error);
                return EMPTY;
              }),
            );
          });

        return next();
      }),
  };
}

/**
 * Creates a group that selects the first eligible source without waiting behind busy peers
 * @throws if the branch timeout is invalid
 */
export function availabilityCountSource(
  sources: readonly CountSource[],
  options: CountRoutingOptions = {},
): CountSource {
  return routingCountSource("availability", sources, options);
}
