/**
 * Display a timeline of reactions (likes, reposts) with user profiles and caching
 * @tags nip-25, feed, timeline, reactions, cache
 * @related feed/loading-reactions, feed/relay-timeline
 */
import { castTimelineStream } from "applesauce-common/observable";

import NoteContent from "../../components/note-content";
import { relayTimeline } from "../../extra/relay-timeline";
import { map, switchMap, of } from "rxjs";

import { castUser, Reaction, User } from "applesauce-common/casts";

import { EventStore } from "applesauce-core";
import { encodePointer, persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { Filter, kinds, NostrEvent } from "applesauce-core/helpers";
import { useMemo, useState } from "react";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

// Setup event store
const eventStore = new EventStore();

// Create a relay pool for connections
const pool = new RelayPool();

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters<NostrEvent>(cache, filters).then((events) => {
    console.log("loaded events from cache", events.length);
    return events;
  });
}

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: lookupRelays$,
});

/** A component for rendering user avatars */
function Avatar({ user }: { user: User }) {
  const picture = use$(user.profile$.picture);

  return (
    <div className="avatar">
      <div className="w-8 rounded-full">
        <img src={picture || `https://robohash.org/${user.pubkey}.png`} />
      </div>
    </div>
  );
}

/** A component for rendering usernames */
function Username({ user }: { user: User }) {
  const displayName = use$(user.profile$.displayName);

  return <>{displayName || user.pubkey.slice(0, 8) + "..."}</>;
}

function ReactionEvent({ reaction }: { reaction: Reaction }) {
  const pointer = reaction.reactedPointer;
  const reactedTo = use$(reaction.reactedTo$);
  const reactedToUser = useMemo(() => reactedTo && castUser(reactedTo, eventStore), [reactedTo]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Avatar user={reaction.author} />
        <h2>
          <span className="font-bold">
            <Username user={reaction.author} />
          </span>
          <span> reacted {reaction.content} to</span>
        </h2>
        <time className="ms-auto text-sm text-gray-500">{reaction.createdAt.toLocaleString()}</time>
      </div>

      {reactedTo ? (
        <div className="border border-base-300 bg-base-100 ">
          <div className="p-4 space-y-3">
            {reactedToUser && (
              <div className="flex items-center gap-4">
                <Avatar user={reactedToUser} />
                <h2 className="font-semibold">
                  <Username user={reactedToUser} />
                </h2>
              </div>
            )}
            <NoteContent event={reactedTo} />
          </div>
        </div>
      ) : pointer ? (
        <div className="border border-base-300 bg-base-200  opacity-50">
          <div className="p-4 space-y-3 overflow-hidden">
            <div className="flex items-center gap-4">
              <span className="loading loading-dots loading-lg" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-mono">{encodePointer(pointer)}</p>
                {pointer.relays && pointer.relays.length > 0 && (
                  <p className="text-sm text-gray-500">Checking relays: {pointer.relays.join(", ")}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ReactionsTimeline() {
  const [relay, setRelay] = useState("wss://relay.primal.net/");

  const feed = use$(
    () =>
      relayTimeline(eventStore, pool, [relay], { kinds: [kinds.Reaction], limit: 20 }).pipe(
        switchMap((result) =>
          of(result.events).pipe(
            castTimelineStream(Reaction, eventStore),
            map((events) => ({ ...result, events })),
          ),
        ),
      ),
    [relay],
  );
  const reactions = feed?.events;

  return (
    <div className="max-w-4xl mx-auto my-8">
      <div className="flex gap-2 mb-4">
        <RelayPicker value={relay} onChange={setRelay} />
        {feed?.status === "loading" && <p role="status">Loading events…</p>}
        {feed?.errors.map((error) => (
          <p role="alert" className="text-error" key={error}>
            {error}
          </p>
        ))}
        {feed?.status !== "loading" && reactions?.length === 0 && <p>No events found.</p>}
      </div>

      <div className="flex flex-col gap-4">
        {reactions?.map((reaction) => (
          <ReactionEvent key={reaction.id} reaction={reaction} />
        ))}
      </div>
    </div>
  );
}
