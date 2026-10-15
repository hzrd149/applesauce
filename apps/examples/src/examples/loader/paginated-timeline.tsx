/**
 * Follow a scrolling time window across relays with automatic coverage and prefetch
 * @tags loader, timeline, infinite-scroll
 * @related loader/timeline-scrubber, feed/relay-timeline
 */
import { EventStore } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import { createEventLoaderForStore, createTimelineLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useState } from "react";
import { BehaviorSubject, EMPTY, filter, fromEvent, ignoreElements, tap, throttleTime } from "rxjs";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();
const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://nostr.land"];
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });
const loader = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore });
const until = unixNow();
const windows$ = new BehaviorSubject({ since: until - 3600, until });
const older = () => windows$.next({ ...windows$.value, since: Math.max(0, windows$.value.since - 3600) });

export default function WindowedTimelineExample() {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const window = use$(windows$);
  use$(() => loader(windows$), []);
  const statuses = use$(loader.status$) ?? [];
  const loading = statuses.length === 0 || statuses.some((status) => status.state === "loading");
  const events = use$(() => eventStore.timeline({ kinds: [1], ...window }), [window.since, window.until]) ?? [];

  use$(
    () =>
      viewport
        ? fromEvent(viewport, "scroll").pipe(
            throttleTime(250),
            filter(() => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 300),
            filter(() => !statuses.some((status) => status.state === "loading")),
            tap(older),
            ignoreElements(),
          )
        : EMPTY,
    [viewport, statuses],
  );

  return (
    <div className="flex min-h-0 grow flex-col gap-3">
      <p>Scroll down to extend the history window. Each relay fills missing time ranges independently.</p>
      <div className="flex flex-wrap gap-4 border-y border-base-300 py-2">
        <span>{events.length} notes</span>
        <span>
          {new Date(window.since * 1000).toLocaleString()} – {new Date(window.until * 1000).toLocaleString()}
        </span>
        <span>{loading ? "Loading visible range" : "Visible requests settled"}</span>
      </div>
      {statuses
        .filter((status) => status.state === "incomplete")
        .map((status) => (
          <p key={status.source} className="text-warning">
            {status.source}: {String(status.error ?? "Incomplete coverage")}
          </p>
        ))}
      <div ref={setViewport} className="min-h-0 flex-1 overflow-y-auto">
        {events.map((event) => (
          <article key={event.id} className="border-b border-base-300 py-3">
            <time className="text-sm">{new Date(event.created_at * 1000).toLocaleString()}</time>
            <p className="whitespace-pre-wrap break-words">{event.content}</p>
          </article>
        ))}
        {!events.length && !loading && <p>No notes in this time range.</p>}
        <button className="btn my-3" disabled={loading || window.since === 0} onClick={older}>
          Load an earlier hour
        </button>
      </div>
    </div>
  );
}
