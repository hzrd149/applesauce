import { nanoid } from "nanoid";
import { Filter, type NostrEvent } from "nostr-tools";
import {
  catchError,
  combineLatest,
  defer,
  EMPTY,
  endWith,
  identity,
  ignoreElements,
  merge,
  Observable,
  of,
  share,
  switchMap,
} from "rxjs";

import {
  EventMemory,
  filterDuplicateEvents,
  IAsyncEventStoreActions,
  IAsyncEventStoreRead,
  IEventStoreActions,
  IEventStoreRead,
} from "applesauce-core";
import { NegentropySyncOptions, type ReconcileFunction } from "./negentropy.js";
import { completeOnEose } from "./operators/complete-on-eose.js";
import { onlyEvents } from "./operators/only-events.js";
import {
  CountResponse,
  FilterInput,
  IGroup,
  IRelay,
  PublishOptions,
  PublishResponse,
  RequestOptions,
  SubscriptionOptions,
  SubscriptionResponse,
} from "./types.js";
import { SyncDirection } from "./relay.js";

/** Options for negentropy sync on a group of relays */
export type GroupNegentropySyncOptions = NegentropySyncOptions & {
  /** Whether to sync in parallel (default true) */
  parallel?: boolean;
};

/** Options for a subscription on a group of relays */
export type GroupSubscriptionOptions = SubscriptionOptions & {
  /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
};

/** Options for a request on a group of relays */
export type GroupRequestOptions = RequestOptions & {
  /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
};

export class RelayGroup implements IGroup {
  constructor(public relays: IRelay[]) {}

  /** Takes an array of observables and only emits EOSE when all observables have emitted EOSE */
  protected mergeEOSE(
    requests: Observable<SubscriptionResponse>[],
    eventStore: IEventStoreActions | IAsyncEventStoreActions | null = new EventMemory(),
  ) {
    // Create stream of events only
    const events = merge(...requests).pipe(
      // Ignore non event responses
      onlyEvents(),
      // If an event store is provided, filter duplicate events
      eventStore ? filterDuplicateEvents(eventStore) : identity,
    );

    // Create stream that emits EOSE when all relays have sent EOSE
    const eose = merge(
      // Create a new map of requests that only emits EOSE
      ...requests.map((observable) => observable.pipe(completeOnEose(), ignoreElements())),
    ).pipe(
      // When all relays have sent EOSE, emit EOSE
      endWith("EOSE" as const),
    );

    return merge(events, eose);
  }

  /**
   * Make a request to all relays
   * @note This does not deduplicate events
   */
  req(
    filters: FilterInput,
    id = nanoid(),
    opts?: {
      /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
      eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
    },
  ): Observable<SubscriptionResponse> {
    const requests = this.relays.map((relay) =>
      relay.req(filters, id).pipe(
        // Ignore connection errors
        catchError(() => of("EOSE" as const)),
      ),
    );

    // Merge events and the single EOSE stream
    return this.mergeEOSE(requests, opts?.eventStore);
  }

  /** Send an event to all relays */
  event(event: NostrEvent): Observable<PublishResponse> {
    return merge(
      ...this.relays.map((relay) =>
        relay.event(event).pipe(
          // Catch error and return as PublishResponse
          catchError((err) =>
            of({ ok: false, from: relay.url, message: err?.message || "Unknown error" } satisfies PublishResponse),
          ),
        ),
      ),
    );
  }

  /** Negentropy sync events with the relays and an event store */
  async negentropy(
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: GroupNegentropySyncOptions,
  ): Promise<boolean> {
    // Filter out relays that do not support NIP-77 negentropy sync
    const supported = await Promise.all(this.relays.map(async (relay) => [relay, await relay.getSupported()] as const));
    const relays = supported.filter(([_, supported]) => supported?.includes(77)).map(([relay]) => relay);
    if (relays.length === 0) throw new Error("No relays support NIP-77 negentropy sync");

    // Non parallel sync is not supported yet
    if (!opts?.parallel) throw new Error("Negentropy sync must be parallel (for now)");

    // Sync all the relays in parallel
    await Promise.allSettled(relays.map((relay) => relay.negentropy(store, filter, reconcile, opts)));

    return true;
  }

  /** Publish an event to all relays with retries ( default 3 retries ) */
  publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResponse[]> {
    return Promise.all(
      this.relays.map((relay) =>
        relay.publish(event, opts).catch(
          // Catch error and return as PublishResponse
          (err) => ({ ok: false, from: relay.url, message: err?.message || "Unknown error" }) satisfies PublishResponse,
        ),
      ),
    );
  }

  /** Request events from all relays with retries ( default 3 retries ) */
  request(filters: FilterInput, opts?: GroupRequestOptions): Observable<NostrEvent> {
    return merge(
      ...this.relays.map((relay) =>
        relay.request(filters, opts).pipe(
          // Ignore individual connection errors
          catchError(() => EMPTY),
        ),
      ),
    ).pipe(
      // If an event store is provided, filter duplicate events
      opts?.eventStore == null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory()),
    );
  }

  /** Open a subscription to all relays with retries ( default 3 retries ) */
  subscription(filters: FilterInput, opts?: GroupSubscriptionOptions): Observable<SubscriptionResponse> {
    return this.mergeEOSE(
      this.relays.map((relay) =>
        relay.subscription(filters, opts).pipe(
          // Ignore individual connection errors
          catchError(() => EMPTY),
        ),
      ),
      // Pass event store so that duplicate events are removed
      opts?.eventStore,
    );
  }

  /** Count events on all relays in the group */
  count(filters: Filter | Filter[], id = nanoid()): Observable<Record<string, CountResponse>> {
    return combineLatest(Object.fromEntries(this.relays.map((relay) => [relay.url, relay.count(filters, id)])));
  }

  /** Negentropy sync events with the relays and an event store */
  sync(
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
    filter: Filter,
    direction?: SyncDirection,
  ): Observable<NostrEvent> {
    // Get an array of relays that support NIP-77 negentropy sync
    return defer(async () => {
      const supported = await Promise.all(
        this.relays.map(async (relay) => [relay, await relay.getSupported()] as const),
      );
      const relays = supported.filter(([_, supported]) => supported?.includes(77)).map(([relay]) => relay);
      if (relays.length === 0) throw new Error("No relays support NIP-77 negentropy sync");
      return relays;
    }).pipe(
      // Once relays are selected, sync all the relays in parallel
      switchMap((relays) => merge(...relays.map((relay) => relay.sync(store, filter, direction)))),
      // Only create one upstream subscription
      share(),
    );
  }
}
