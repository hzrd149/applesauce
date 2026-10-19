import { IAsyncEventStoreActions, IAsyncEventStoreRead, IEventStoreActions, IEventStoreRead } from "applesauce-core";
import { getPublicContacts } from "applesauce-core/helpers";
import { Filter } from "applesauce-core/helpers/filter";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { catchError, EMPTY, filter, firstValueFrom, isObservable, map, Observable, share, Subscription } from "rxjs";
import { makeCacheRequest } from "../helpers/cache.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, UpstreamPool } from "../types.js";

/** Throttle for progress snapshots, matching the sync loader */
const PROGRESS_INTERVAL = 250;
/** Max single-author filters per retry REQ; some relays reject or ignore larger REQs */
const RETRY_FILTERS = 20;
/** A relay that returned fewer than this share of the lists found for a batch is treated as dropping users */
const LOSSY_RATIO = 0.9;

/** The user to start from and how many follow hops to load. `since` skips follow lists older than it */
export type SocialGraphLoadRequest = ProfilePointer & { distance: number; since?: number };

/** Request progress for a single relay during a social graph load */
export type SocialGraphRelayStatus = {
  relay: string;
  /** The number of requests sent to this relay, including retries */
  requests: number;
  /** The number of contact events this relay returned */
  events: number;
  /** The number of retry requests for authors the relay dropped from a larger request */
  retries: number;
  /** The number of requests that failed */
  errors: number;
  /** The most recent request error */
  error?: Error;
};

/** A snapshot of a social graph load, emitted on lifecycle changes and at most every 250 ms otherwise */
export type SocialGraphStatus = {
  /** The number of unique users whose follow list has been requested */
  requested: number;
  /** The number of users with a follow list */
  found: number;
  /** The number of requested users that finished without a follow list */
  missing: number;
  /** The number of users waiting to be requested */
  queued: number;
  /** The number of batches currently loading */
  inFlight: number;
  /** Whether the load has finished */
  done: boolean;
  /** Per-relay request progress keyed by relay url */
  relays: Record<string, SocialGraphRelayStatus>;
};

/** The pair of observables returned by a social graph loader, subscribe to both in the same tick to share one load */
export type SocialGraphLoaderResult = {
  /** The newest follow list for each user, emitted as it arrives. Completes when the load is done */
  events$: Observable<NostrEvent>;
  /** Progress snapshots for the load. Completes when the load is done */
  status$: Observable<SocialGraphStatus>;
};

/** A loader that loads the social graph of a user out to a set distance */
export type SocialGraphLoader = (user: SocialGraphLoadRequest) => SocialGraphLoaderResult;

/** An event store that the social graph loader can both write to and read from */
export type SocialGraphEventStore = (IEventStoreActions | IAsyncEventStoreActions) &
  (IEventStoreRead | IAsyncEventStoreRead);

export type SocialGraphLoaderOptions = Partial<{
  /** An event store to send all the events to and fall back to when the relays return nothing */
  eventStore?: SocialGraphEventStore;
  /** A method used to load events from a local cache, cached lists are refreshed from relays */
  cacheRequest: CacheRequest;
  /** The number of users to request in each batch (default 100) */
  parallel: number;
  /** The number of batches to load at once (default 6) */
  concurrency: number;
  /** Extra relays to load from */
  extraRelays?: string[] | Observable<string[]>;
  /** Whether to also request each user from the relay hints in contact lists */
  hints?: boolean;
  /** The maximum number of hinted relays to use per batch (default 8) */
  maxHintRelays: number;
  /** The maximum number of requests open on one relay at once (default 4) */
  maxRequestsPerRelay: number;
}>;

type QueuedProfilePointer = ProfilePointer & { distance: number; since?: number };

type Message = { type: "event"; event: NostrEvent } | { type: "status"; status: SocialGraphStatus };

/** Create filters for loading contact lists, keeping different since windows separate. */
function createContactsFilters(pointers: QueuedProfilePointer[]): Filter[] {
  const bySince = new Map<number | undefined, string[]>();

  for (const pointer of pointers) {
    const authors = bySince.get(pointer.since);
    if (authors) authors.push(pointer.pubkey);
    else bySince.set(pointer.since, [pointer.pubkey]);
  }

  return Array.from(bySince.entries()).map(([since, authors]) => {
    const filter: Filter = { kinds: [kinds.Contacts], authors };
    if (since !== undefined) filter.since = since;
    return filter;
  });
}

/** Routes every pointer to the base relays and, with hints, each pointer to its own most common hinted relays */
function routeBatch(pointers: QueuedProfilePointer[], baseRelays: string[], hints: boolean, maxHintRelays: number) {
  const routes = new Map<string, QueuedProfilePointer[]>(baseRelays.map((relay) => [relay, pointers]));
  if (!hints) return routes;

  const hinted = new Map<string, QueuedProfilePointer[]>();
  for (const pointer of pointers) {
    for (const relay of mergeRelaySets(pointer.relays)) {
      if (routes.has(relay)) continue;
      const list = hinted.get(relay);
      if (list) list.push(pointer);
      else hinted.set(relay, [pointer]);
    }
  }

  // Hints are often dead relays, so only use the ones shared by the most users
  const top = Array.from(hinted.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxHintRelays);
  for (const [relay, list] of top) routes.set(relay, list);

  return routes;
}

/** Create a social graph loader */
export function createSocialGraphLoader(pool: UpstreamPool, opts?: SocialGraphLoaderOptions): SocialGraphLoader {
  const request = wrapUpstreamPool(pool);
  const batchSize = opts?.parallel ?? 100;
  const concurrency = opts?.concurrency ?? 6;
  const maxHintRelays = opts?.maxHintRelays ?? 8;
  const maxRequestsPerRelay = opts?.maxRequestsPerRelay ?? 4;
  const eventStore = opts?.eventStore;

  return (user) => {
    const run$ = new Observable<Message>((subscriber) => {
      const subscriptions = new Subscription();
      // Root is marked seen so a follow-back does not request it twice
      const seen = new Set<string>([user.pubkey]);
      let queue: (QueuedProfilePointer | undefined)[] = [user];
      let queueHead = 0;
      // created_at of the newest follow list per user, full events are only held while their batch loads
      const newest = new Map<string, number>();
      const relays: Record<string, SocialGraphRelayStatus> = {};
      // Open request slots per relay; relays answer one connection's REQs in order, so extra REQs only queue
      const slots = new Map<string, { open: number; waiting: (() => void)[] }>();
      let requested = 0;
      let missing = 0;
      let inFlight = 0;
      let closed = false;
      let progressTimer: ReturnType<typeof setTimeout> | undefined;
      let baseRelays: string[] = [];

      const snapshot = (done = false): SocialGraphStatus => ({
        requested,
        found: newest.size,
        missing,
        queued: queue.length - queueHead,
        inFlight,
        done,
        relays: Object.fromEntries(Object.entries(relays).map(([url, s]) => [url, { ...s }])),
      });
      const emitStatus = (immediate = false) => {
        if (closed) return;
        if (immediate) {
          clearTimeout(progressTimer);
          progressTimer = undefined;
          subscriber.next({ type: "status", status: snapshot() });
        } else if (!progressTimer) {
          progressTimer = setTimeout(() => {
            progressTimer = undefined;
            if (!closed) subscriber.next({ type: "status", status: snapshot() });
          }, PROGRESS_INTERVAL);
        }
      };
      const relayStatus = (relay: string) =>
        (relays[relay] ??= { relay, requests: 0, events: 0, retries: 0, errors: 0 });

      /** Emits a contact event if it is the newest for a user in this batch, returns whether it was kept */
      const handleEvent = (event: NostrEvent, batch: Map<string, NostrEvent | undefined>) => {
        if (closed || event.kind !== kinds.Contacts || !batch.has(event.pubkey)) return false;
        const previous = newest.get(event.pubkey);
        if (previous !== undefined && event.created_at <= previous) return false;

        newest.set(event.pubkey, event.created_at);
        batch.set(event.pubkey, event);

        if (!eventStore) subscriber.next({ type: "event", event });
        else {
          const stored = eventStore.add(event);
          if (stored instanceof Promise)
            stored.then(
              (e) => e && !closed && subscriber.next({ type: "event", event: e }),
              () => {},
            );
          else if (stored) subscriber.next({ type: "event", event: stored });
        }

        emitStatus();
        return true;
      };

      /** Subscribes to an observable of events and resolves when it ends */
      const drain = (source: Observable<NostrEvent>, onEvent: (event: NostrEvent) => void) =>
        new Promise<void>((resolve) => {
          subscriptions.add(source.subscribe({ next: onEvent, error: () => resolve(), complete: () => resolve() }));
        });

      /** Waits for a free request slot on a relay and returns a function that releases it */
      const acquire = async (relay: string) => {
        let slot = slots.get(relay);
        if (!slot) slots.set(relay, (slot = { open: 0, waiting: [] }));
        if (slot.open >= maxRequestsPerRelay) await new Promise<void>((resolve) => slot!.waiting.push(resolve));
        slot.open++;
        return () => {
          slot!.open--;
          slot!.waiting.shift()?.();
        };
      };

      /** Requests one relay and records its progress, resolves with the event count and users it returned */
      const requestRelay = async (relay: string, filters: Filter[], batch: Map<string, NostrEvent | undefined>) => {
        const result = { events: 0, authors: new Set<string>() };
        const release = await acquire(relay);
        if (closed) {
          release();
          return result;
        }
        const status = relayStatus(relay);
        status.requests++;
        emitStatus();
        return drain(
          request([relay], filters).pipe(
            catchError((error) => {
              status.errors++;
              status.error = error instanceof Error ? error : new Error(String(error));
              emitStatus(true);
              return EMPTY;
            }),
          ),
          (event) => {
            status.events++;
            if (!batch.has(event.pubkey)) return;
            result.events++;
            result.authors.add(event.pubkey);
            handleEvent(event, batch);
          },
        )
          .finally(release)
          .then(() => result);
      };

      const loadBatch = async (pointers: QueuedProfilePointer[]) => {
        const batch = new Map<string, NostrEvent | undefined>(pointers.map((p) => [p.pubkey, undefined]));

        // Load cached lists first, then ask relays only for lists newer than the oldest cached one
        let toRequest = pointers;
        if (opts?.cacheRequest) {
          await drain(
            makeCacheRequest(opts.cacheRequest, createContactsFilters(pointers)).pipe(catchError(() => EMPTY)),
            (event) => handleEvent(event, batch),
          );

          const cached = pointers.filter((p) => batch.get(p.pubkey));
          if (cached.length > 0) {
            const oldest = Math.min(...cached.map((p) => batch.get(p.pubkey)!.created_at)) + 1;
            toRequest = pointers.map((p) =>
              batch.get(p.pubkey) ? { ...p, since: Math.max(p.since ?? 0, oldest) } : p,
            );
          }
        }

        // Request every relay separately so each one completes on its own
        const routes = routeBatch(toRequest, baseRelays, opts?.hints ?? false, maxHintRelays);
        const results = await Promise.all(
          Array.from(routes.entries()).map(async ([relay, routed]) => ({
            relay,
            routed,
            ...(await requestRelay(relay, createContactsFilters(routed), batch)),
          })),
        );

        // Some relays fill an implicit limit with stale copies and silently drop users from multi-author
        // requests. Re-ask a relay that looks lossy for the users no relay returned, one filter per user
        for (const { relay, routed, events, authors } of results) {
          if (closed || authors.size === 0) continue;
          const found = routed.filter((p) => batch.get(p.pubkey)).length;
          const lossy = events > authors.size || authors.size < found * LOSSY_RATIO;
          if (!lossy) continue;

          const dropped = routed.filter((p) => !batch.get(p.pubkey));
          for (let i = 0; i < dropped.length && !closed; i += RETRY_FILTERS) {
            relayStatus(relay).retries++;
            const filters = dropped.slice(i, i + RETRY_FILTERS).flatMap((p) => createContactsFilters([p]));
            await requestRelay(relay, filters, batch);
          }
        }

        // Expand the queue from the newest list for each user, falling back to the event store
        for (const pointer of pointers) {
          if (closed) return;
          let latest = batch.get(pointer.pubkey);
          if (!latest && eventStore)
            latest = (await eventStore.getReplaceable(kinds.Contacts, pointer.pubkey)) ?? undefined;

          if (!latest) {
            missing++;
            continue;
          }
          if (!newest.has(pointer.pubkey)) newest.set(pointer.pubkey, latest.created_at);

          if (pointer.distance > 0) {
            for (const contact of getPublicContacts(latest)) {
              if (seen.has(contact.pubkey)) continue;
              seen.add(contact.pubkey);
              // Forward `since` onto descendants so the whole crawl shares the window
              queue.push({ ...contact, distance: pointer.distance - 1, since: pointer.since });
            }
          }
        }
      };

      const finish = () => {
        if (closed) return;
        clearTimeout(progressTimer);
        subscriber.next({ type: "status", status: snapshot(true) });
        closed = true;
        subscriber.complete();
      };

      // Start batches until the concurrency limit, each finished batch frees a slot for the next
      const pump = () => {
        while (!closed && inFlight < concurrency && queueHead < queue.length) {
          const pointers: QueuedProfilePointer[] = [];
          const end = Math.min(queueHead + batchSize, queue.length);
          while (queueHead < end) {
            pointers.push(queue[queueHead]!);
            queue[queueHead++] = undefined;
          }
          // Release consumed pointers immediately and compact only after draining at least half the queue
          if (queueHead === queue.length || (queueHead >= 1024 && queueHead >= queue.length / 2)) {
            queue = queue.slice(queueHead);
            queueHead = 0;
          }
          requested += pointers.length;
          inFlight++;
          emitStatus(true);

          loadBatch(pointers).then(
            () => {
              inFlight--;
              if (inFlight === 0 && queueHead === queue.length) finish();
              else {
                emitStatus(true);
                pump();
              }
            },
            (error) => {
              closed = true;
              subscriber.error(error);
            },
          );
        }
      };

      const extra = opts?.extraRelays;
      Promise.resolve(isObservable(extra) ? firstValueFrom(extra) : extra).then(
        (extraRelays) => {
          if (closed) return;
          baseRelays = mergeRelaySets(user.relays, extraRelays);
          pump();
        },
        (error) => subscriber.error(error),
      );

      return () => {
        closed = true;
        clearTimeout(progressTimer);
        subscriptions.unsubscribe();
      };
    }).pipe(share());

    return {
      events$: run$.pipe(
        filter((m): m is Extract<Message, { type: "event" }> => m.type === "event"),
        map((m) => m.event),
      ),
      status$: run$.pipe(
        filter((m): m is Extract<Message, { type: "status" }> => m.type === "status"),
        map((m) => m.status),
      ),
    };
  };
}
