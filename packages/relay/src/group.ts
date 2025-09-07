import { nanoid } from "nanoid";
import { type NostrEvent } from "nostr-tools";
import { catchError, EMPTY, endWith, identity, ignoreElements, merge, Observable, of } from "rxjs";

import { filterDuplicateEvents, IEventStoreActions } from "applesauce-core";
import { completeOnEose } from "./operators/complete-on-eose.js";
import { onlyEvents } from "./operators/only-events.js";
import {
  FilterInput,
  IGroup,
  IRelay,
  PublishOptions,
  PublishResponse,
  RequestOptions,
  SubscriptionOptions,
  SubscriptionResponse,
} from "./types.js";

export class RelayGroup implements IGroup {
  constructor(public relays: IRelay[]) {}

  /** Takes an array of observables and only emits EOSE when all observables have emitted EOSE */
  protected mergeEOSE(requests: Observable<SubscriptionResponse>[], eventStore?: IEventStoreActions) {
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
  req(filters: FilterInput, id = nanoid(8)): Observable<SubscriptionResponse> {
    const requests = this.relays.map((relay) =>
      relay.req(filters, id).pipe(
        // Ignore connection errors
        catchError(() => of("EOSE" as const)),
      ),
    );

    // Merge events and the single EOSE stream
    return this.mergeEOSE(requests);
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
  request(
    filters: FilterInput,
    opts?: RequestOptions & {
      // Add all events to the store and deduplicate them
      eventStore?: IEventStoreActions;
    },
  ): Observable<NostrEvent> {
    return merge(
      ...this.relays.map((relay) =>
        relay.request(filters, opts).pipe(
          // Ignore individual connection errors
          catchError(() => EMPTY),
        ),
      ),
    ).pipe(
      // If an event store is provided, filter duplicate events
      opts?.eventStore ? filterDuplicateEvents(opts.eventStore) : identity,
    );
  }

  /** Open a subscription to all relays with retries ( default 3 retries ) */
  subscription(
    filters: FilterInput,
    opts?: SubscriptionOptions & { eventStore?: IEventStoreActions },
  ): Observable<SubscriptionResponse> {
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
}
