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
} from "rxjs";
import { distinctPolicy, listStream, relays } from "../../helpers/count-service/policy.js";
import type {
  AssertionRequest,
  CountContext,
  CountList,
  CountProvider,
  CountProviderDeclaration,
  CountQuery,
  CountResult,
  CountSource,
  CountTransportScheduler,
} from "./types.js";

/** Options for metric-specific NIP-85 assertion counts */
export interface Nip85CountSourceOptions {
  /** The finite assertion event transport */
  request: AssertionRequest;
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
  pending: Set<Pending>;
  work: Subscription;
  dispatched: boolean;
}

/**
 * Creates a batched assertion source with reactive per-metric trust
 * @throws if batching or assertion freshness options are invalid
 */
export function nip85CountSource(options: Nip85CountSourceOptions): CountSource {
  const id = options.id ?? "nip85";
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
            switchMap((providers) =>
              providers.length
                ? combineLatest(
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
      let groups = batches.get(context.transport);
      if (!groups) {
        groups = new Map();
        batches.set(context.transport, groups);
      }
      const key = JSON.stringify([
        route.pubkey,
        relay,
        query.target.address ? 30384 : 30383,
        singleton ? (query.target.address ?? query.target.id) : "batch",
      ]);
      let batch = groups.get(key);
      const pending: Pending = { query, subscriber };
      if (!batch || batch.dispatched || batch.pending.size >= size) {
        batch = { pending: new Set([pending]), work: new Subscription(), dispatched: false };
        groups.set(key, batch);
        const current = batch;
        current.work.add(
          context.clock.schedule(() => {
            current.work.add(
              context.transport
                .run([`relay:${relay}`, `provider:${route.pubkey}`], () => {
                  current.dispatched = true;
                  if (groups!.get(key) === current) groups!.delete(key);
                  const subjects = [
                    ...new Set(
                      [...current.pending].map((entry) => entry.query.target.address ?? entry.query.target.id),
                    ),
                  ];
                  if (!subjects.length) return EMPTY;
                  const kind = query.target.address ? 30384 : 30383;
                  return options.request([relay], [{ kinds: [kind], authors: [route.pubkey], "#d": subjects }]).pipe(
                    timeout({
                      each: Math.max(1, Math.min(context.attemptTimeout, context.deadline - context.clock.now())),
                      scheduler: context.clock,
                    }),
                    filter(
                      (event) =>
                        event.kind === kind &&
                        event.pubkey === route.pubkey &&
                        subjects.includes(event.tags.find((tag) => tag[0] === "d")?.[1] ?? "") &&
                        Number.isSafeInteger(event.created_at) &&
                        event.created_at >= 0 &&
                        event.created_at <= context.clock.now() / 1000 + 60 &&
                        context.clock.now() / 1000 - event.created_at <= maxAge &&
                        (options.verify ?? verifyEvent)(event),
                    ),
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
                  );
                })
                .subscribe({
                  next: (events) => {
                    for (const entry of [...current.pending]) {
                      try {
                        const result = parse(events, entry, route, relay);
                        if (result) entry.subscriber.next(result);
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
      } else batch.pending.add(pending);
      const current = batch;
      return () => {
        current.pending.delete(pending);
        if (!current.pending.size) {
          current.work.unsubscribe();
          if (groups!.get(key) === current) groups!.delete(key);
        }
      };
    });
  return {
    id,
    policy: (query) =>
      routes(query).pipe(
        map((value) => JSON.stringify(value)),
        distinctPolicy(),
      ),
    count: (query, context) =>
      routes(query).pipe(
        take(1),
        switchMap((providers) =>
          from(providers).pipe(
            concatMap((provider) =>
              from(provider.relays).pipe(
                concatMap((relay) =>
                  // A singleton recovery handles relay truncation without an unbounded retry loop.
                  request(query, provider, relay, context).pipe(
                    defaultIfEmpty(undefined),
                    switchMap((result) => (result ? of(result) : request(query, provider, relay, context, true))),
                    catchError((error) => {
                      context.onFailure?.(error);
                      return EMPTY;
                    }),
                  ),
                ),
              ),
            ),
            take(1),
          ),
        ),
      ),
  };
}
