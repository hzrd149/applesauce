/**
 * Load timeline events with pagination support for efficient data loading
 * @tags loader, timeline, pagination
 * @related loader/timeline-scrolling, feed/relay-timeline
 */
import { use$ } from "applesauce-react/hooks";
import {
  BehaviorSubject,
  Subject,
  defer,
  exhaustMap,
  tap,
  ignoreElements,
  endWith,
  startWith,
  catchError,
  of,
  switchMap,
  map,
} from "rxjs";

import { EventStore } from "applesauce-core";
import { getSeenRelays, mergeRelaySets } from "applesauce-core/helpers";
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const eventStore = new EventStore();
const pool = new RelayPool();

import { NostrEvent } from "applesauce-core/helpers";

import { npubEncode } from "applesauce-core/helpers/pointers";
import { useMemo } from "react";

function EventRow({ event, relays }: { event: NostrEvent; relays: string[] }) {
  const seen = getSeenRelays(event);
  const truncatedId = event.id.slice(0, 4);

  const npub = useMemo(() => {
    try {
      return npubEncode(event.pubkey);
    } catch (e) {
      return event.pubkey;
    }
  }, [event.pubkey]);

  const truncatedNpub = npub.slice(0, 8);
  const truncatedContent = event.content.length > 50 ? `${event.content.slice(0, 50)}...` : event.content;

  return (
    <tr>
      <td>{truncatedId}</td>
      <td>{truncatedNpub}</td>
      <td className="truncate">{truncatedContent}</td>
      {relays.map((relay) => (
        <td key={relay} title={relay}>
          {seen?.has(relay) ? "✅" : "❌"}
        </td>
      ))}
    </tr>
  );
}

export default function PaginatedTimelineExample() {
  const limit$ = useMemo(() => new BehaviorSubject(20), []);
  const limit = use$(limit$);

  const relays$ = useMemo(
    () => new BehaviorSubject(mergeRelaySets(["wss://relay.damus.io", "wss://nos.lol", "wss://nostr.land"])),
    [],
  );
  const relays = use$(relays$);

  const loader = useMemo(() => {
    return createTimelineLoader(pool, relays, [{ kinds: [1] }], { limit, eventStore });
  }, [relays, limit]);

  const pages$ = useMemo(() => new Subject<void>(), [loader]);
  const reset$ = useMemo(() => new BehaviorSubject(0), []);
  const reset = use$(reset$);
  const request = use$(
    () =>
      defer(() => {
        const matched = new Set<string>();
        return pages$.pipe(
          exhaustMap(() =>
            loader().pipe(
              tap((event) => matched.add(event.id)),
              ignoreElements(),
              endWith({ loading: false, error: null as string | null }),
              startWith({ loading: true, error: null as string | null }),
              catchError((error) => of({ loading: false, error: String(error) })),
            ),
          ),
          startWith({ loading: false, error: null as string | null }),
          switchMap((status) =>
            eventStore
              .timeline({ kinds: [1] })
              .pipe(map((events) => ({ ...status, events: events.filter((event) => matched.has(event.id)) }))),
          ),
        );
      }),
    [loader, pages$, reset],
  );
  const events = request?.events ?? [];
  const loading = request?.loading ?? false;
  const next = () => pages$.next();

  return (
    <div className="container mx-auto my-8">
      <div className="flex gap-2">
        <input type="number" value={limit} onChange={(e) => limit$.next(Number(e.target.value))} />

        <button className="btn" onClick={() => reset$.next(reset$.value + 1)}>
          Clear
        </button>
      </div>

      {request?.error && (
        <p role="alert" className="text-error">
          {request.error}
        </p>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Pubkey</th>
            <th>Content</th>
            {relays.map((r) => (
              <th key={r} />
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <EventRow key={event.id} event={event} relays={relays} />
          ))}
        </tbody>
      </table>

      <div className="flex justify-center my-4">
        {loading ? (
          <span className="loading loading-dots loading-xl"></span>
        ) : (
          <button className="btn btn-primary block" onClick={next}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
