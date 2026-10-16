import type { Debugger } from "applesauce-core";
import { verifyEvent, type NostrEvent } from "applesauce-core/helpers";
import {
  catchError,
  defaultIfEmpty,
  combineLatest,
  concatMap,
  EMPTY,
  filter,
  from,
  map,
  Observable,
  of,
  shareReplay,
  Subscriber,
  Subscription,
  switchMap,
  take,
  timeout,
  reduce,
  tap,
} from "rxjs";
import { createCountSourceLogger, traceCountOperation } from "../../helpers/count-service/logging.js";
import { distinctPolicy, listStream, relays } from "../../helpers/count-service/policy.js";
import type {
  AssertionRequest,
  CountContext,
  CountList,
  CountPool,
  CountProvider,
  CountProviderDeclaration,
  CountQuery,
  CountResult,
  CountSource,
  CountTransportScheduler,
} from "./types.js";

/** Options for metric-specific NIP-85 assertion counts */
export interface Nip85CountSourceOptions {
  /** The explicit finite assertion transport, overriding pool.request */
  request?: AssertionRequest;

  /** The structural upstream pool supplying finite event requests */
  pool?: Pick<CountPool, "request">;

  /** The metric-scoped providers, selected by assertion kind and tag */
  providers: (kind: number, tag: string) => CountList<CountProvider | CountProviderDeclaration>;

  /** The signature verifier, defaulting to the core event verifier */
  verify?: (event: NostrEvent) => boolean;

  /** The maximum assertion age in seconds, default 86400 */
  maxAge?: number;

  /** The admission window in milliseconds, default 10 */
  batchWindow?: number;

  /** The maximum subjects in a request, default 100 */
  batchSize?: number;

  /** The parent logger, overriding the service logger for this source */
  logger?: Debugger;

  /** The stable adapter identity */
  id?: string;
}

interface Route {
  pubkey: string;
  relays: string[];
}

interface Pending {
  query: CountQuery;
  subscriber: Subscriber<CountResult>;
}

interface Batch {
  id: number;
  pending: Set<Pending>;
  work: Subscription;
  dispatched: boolean;
}

/**
 * Creates a batched assertion source with reactive per-metric trust
 * @throws if the request transport is missing or batching or freshness options are invalid
 */
export function nip85CountSource(options: Nip85CountSourceOptions): CountSource {
  const upstream = options.request ?? options.pool?.request?.bind(options.pool);

  if (!upstream) throw new Error("A request method or pool.request is required");

  const id = options.id ?? "nip85";
  const loggerFor = createCountSourceLogger("nip85", options.logger);
  let batchSequence = 0;
  const window = options.batchWindow ?? 10;
  const size = options.batchSize ?? 100;
  const maxAge = options.maxAge ?? 86400;

  if (
    !Number.isFinite(window) ||
    window < 0 ||
    !Number.isInteger(size) ||
    size < 1 ||
    maxAge < 0 ||
    Number.isNaN(maxAge)
  )
    throw new Error("Invalid assertion batch or freshness options");

  // Weakly keyed by the service scheduler so adapters can safely be reused across services.
  const batches = new WeakMap<CountTransportScheduler, Map<string, Batch>>();

  // Share routing per metric and assertion kind without extending metric object lifetimes.
  const configurations = new WeakMap<object, Map<number, Observable<Route[]>>>();

  const routes = (query: CountQuery): Observable<Route[]> => {
    const kind = query.target.address ? 30384 : 30383;
    let byKind = configurations.get(query.metric);

    if (!byKind) {
      byKind = new Map();
      configurations.set(query.metric, byKind);
    }

    let config = byKind.get(kind);

    if (!config) {
      const tag = query.metric.assertionTag;
      config = !tag
        ? of([])
        : listStream(options.providers(query.target.address ? 30384 : 30383, tag)).pipe(
            // Replacing the trust list also releases subscriptions to removed providers' routes.
            switchMap((providers) =>
              providers.length
                ? // Nested relay updates remain part of the effective policy.
                  combineLatest(
                    providers.map((provider) =>
                      "pubkey" in provider
                        ? listStream(provider.relays$).pipe(
                            map((list) => ({ pubkey: provider.pubkey, relays: relays(list) })),
                          )
                        : of({
                            pubkey: provider.servicePubkey,
                            relays:
                              provider.kind === kind && provider.tag === tag
                                ? relays(provider.relay ? [provider.relay] : [])
                                : [],
                          }),
                    ),
                  )
                : of([]),
            ),
            map((list) => {
              const merged = new Map<string, Route>();

              for (const route of list) {
                if (!/^[0-9a-f]{64}$/.test(route.pubkey)) continue;

                const existing = merged.get(route.pubkey);

                if (existing) existing.relays = relays([...existing.relays, ...route.relays]);
                else merged.set(route.pubkey, { ...route });
              }

              return [...merged.values()];
            }),

            // Policy observers and count attempts share one lazily observed configuration.
            shareReplay({ bufferSize: 1, refCount: true }),
          );

      byKind.set(kind, config);
    }

    return config;
  };

  const parse = (events: NostrEvent[], pending: Pending, route: Route, relay: string): CountResult | undefined => {
    const subject = pending.query.target.address ?? pending.query.target.id;
    const latest = events.find((event) => event.tags.find((tag) => tag[0] === "d")?.[1] === subject);

    if (!latest) return;

    const tags = latest.tags.filter((tag) => tag[0] === pending.query.metric.assertionTag);

    if (tags?.length !== 1 || !/^\d+$/.test(tags[0][1] ?? "")) return;

    const value = Number(tags[0][1]);

    if (!Number.isSafeInteger(value) || value < 0) return;

    return {
      value,
      metric: pending.query.metric.id,
      assertedAt: latest.created_at,
      origin: { adapter: id, provider: route.pubkey, relay },
    };
  };

  const request = (query: CountQuery, route: Route, relay: string, context: CountContext, singleton = false) =>
    new Observable<CountResult>((subscriber) => {
      const log = loggerFor(context);
      let groups = batches.get(context.transport);

      if (!groups) {
        groups = new Map();
        batches.set(context.transport, groups);
      }

      // Metrics may share an assertion batch; singleton recovery stays scoped to one subject.
      const key = JSON.stringify([
        route.pubkey,
        relay,
        query.target.address ? 30384 : 30383,
        singleton ? (query.target.address ?? query.target.id) : "batch",
      ]);

      let batch = groups.get(key);
      const pending: Pending = { query, subscriber };

      if (!batch || batch.dispatched || batch.pending.size >= size) {
        batch = { id: ++batchSequence, pending: new Set([pending]), work: new Subscription(), dispatched: false };
        groups.set(key, batch);
        log("Assertion batch created", id, batch.id, route.pubkey, relay, "singleton", singleton);

        const current = batch;

        // Collect demand during the batch window without holding transport capacity.
        current.work.add(
          context.clock.schedule(() => {
            current.work.add(
              context.transport
                .run([`relay:${relay}`, `provider:${route.pubkey}`], () => {
                  // Build requested subjects at admission, after queued cancellations have detached.
                  current.dispatched = true;

                  // New interests now form another batch instead of joining an in-flight request.
                  if (groups!.get(key) === current) groups!.delete(key);

                  const subjects = [
                    ...new Set(
                      [...current.pending].map((entry) => entry.query.target.address ?? entry.query.target.id),
                    ),
                  ];
                  if (!subjects.length) return EMPTY;
                  log("Assertion batch dispatched", id, current.id, route.pubkey, relay, "subjects", subjects.length);

                  const kind = query.target.address ? 30384 : 30383;

                  return upstream([relay], [{ kinds: [kind], authors: [route.pubkey], "#d": subjects }]).pipe(
                    timeout({
                      each: Math.max(1, Math.min(context.attemptTimeout, context.deadline - context.clock.now())),
                      scheduler: context.clock,
                    }),

                    // Validate before retaining events, including the signer, subject, and freshness.
                    filter((event) => {
                      const subject = event.tags.find((tag) => tag[0] === "d")?.[1];
                      let rejected: string | undefined;

                      if (event.kind !== kind || event.pubkey !== route.pubkey) rejected = "unexpected signer or kind";
                      else if (!subjects.includes(subject ?? "")) rejected = "unexpected subject";
                      else if (
                        !Number.isSafeInteger(event.created_at) ||
                        event.created_at < 0 ||
                        event.created_at > context.clock.now() / 1000 + 60
                      )
                        rejected = "invalid timestamp";
                      else if (context.clock.now() / 1000 - event.created_at > maxAge) rejected = "stale assertion";
                      else if (!(options.verify ?? verifyEvent)(event)) rejected = "invalid signature";

                      if (rejected) log("Assertion rejected", id, current.id, event.id, rejected);
                      return rejected === undefined;
                    }),

                    // Retain only the latest valid assertion per subject until the finite request ends.
                    reduce((latest, event) => {
                      const subject = event.tags.find((tag) => tag[0] === "d")![1];
                      const previous = latest.get(subject);

                      if (
                        !previous ||
                        event.created_at > previous.created_at ||
                        (event.created_at === previous.created_at && event.id < previous.id)
                      )
                        latest.set(subject, event);

                      return latest;
                    }, new Map<string, NostrEvent>()),
                    map((latest) => [...latest.values()]),

                    traceCountOperation(log, context.clock, "Assertion batch", {
                      source: id,
                      batch: current.id,
                      provider: route.pubkey,
                      relay,
                      subjects: subjects.length,
                    }),
                  );
                })
                .subscribe({
                  next: (events) => {
                    // Delivery can synchronously detach interests, so iterate a membership snapshot.
                    for (const entry of [...current.pending]) {
                      try {
                        const result = parse(events, entry, route, relay);

                        if (result) {
                          log(
                            "Assertion metric accepted",
                            id,
                            current.id,
                            entry.query.metric.id,
                            entry.query.target.address ?? entry.query.target.id,
                            result.value,
                          );
                          entry.subscriber.next(result);
                        } else {
                          log(
                            "Assertion metric unavailable",
                            id,
                            current.id,
                            entry.query.metric.id,
                            entry.query.target.address ?? entry.query.target.id,
                          );
                        }
                      } catch (error) {
                        entry.subscriber.error(error);
                      }
                    }
                  },

                  error: (error) => {
                    for (const entry of [...current.pending]) entry.subscriber.error(error);
                  },

                  complete: () => {
                    for (const entry of [...current.pending]) entry.subscriber.complete();
                  },
                }),
            );
          }, window),
        );
      } else {
        batch.pending.add(pending);
        log("Assertion batch joined", id, batch.id, query.metric.id, query.target.address ?? query.target.id);
      }

      const current = batch;

      return () => {
        // Detach this metric; only the final interest cancels the batch timer or transport.
        current.pending.delete(pending);
        log(
          "Assertion interest detached",
          id,
          current.id,
          query.metric.id,
          query.target.address ?? query.target.id,
          "remaining",
          current.pending.size,
        );
        if (!current.pending.size) {
          log("Assertion batch released", id, current.id, "dispatched", current.dispatched);
          current.work.unsubscribe();
          if (groups!.get(key) === current) groups!.delete(key);
        }
      };
    });

  return {
    id,

    // Keep observing trust and nested routing even after a lower-priority source answers.
    policy: (query) =>
      routes(query).pipe(
        map((value) => JSON.stringify(value)),
        distinctPolicy(),
      ),

    count: (query, context) =>
      routes(query).pipe(
        // Resolve against one configuration snapshot; policy changes restart the service resolution.
        take(1),
        tap((providers) =>
          loggerFor(context)(
            "Provider candidates",
            id,
            query.metric.id,
            query.target.address ?? query.target.id,
            "count",
            providers.length,
          ),
        ),

        switchMap((providers) =>
          from(providers).pipe(
            // Preserve provider priority, then relay priority within each provider.
            concatMap((provider) =>
              from(provider.relays).pipe(
                concatMap((relay) =>
                  // A singleton recovery handles relay truncation without an unbounded retry loop.
                  request(query, provider, relay, context).pipe(
                    // A missing metric triggers recovery; a result with value zero still succeeds.
                    defaultIfEmpty(undefined),

                    switchMap((result) => {
                      if (result) return of(result);
                      loggerFor(context)(
                        "Retrying missing assertion subject",
                        id,
                        provider.pubkey,
                        relay,
                        query.metric.id,
                        query.target.address ?? query.target.id,
                      );
                      return request(query, provider, relay, context, true);
                    }),

                    catchError((error) => {
                      loggerFor(context)(
                        "Assertion attempt failed",
                        id,
                        provider.pubkey,
                        relay,
                        query.metric.id,
                        query.target.address ?? query.target.id,
                        error,
                      );
                      context.onFailure?.(error);

                      return EMPTY;
                    }),
                  ),
                ),
              ),
            ),

            // One accepted provider result ends the search and tears down remaining interests.
            take(1),
          ),
        ),
      ),
  };
}
