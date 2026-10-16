/**
 * Display reactions (likes, reposts) with loading states and user information
 * @tags nip-25, feed, reactions, loading
 * @related feed/reactions-timeline
 */
import { Note, castEvent } from "applesauce-common/casts";
import NoteContent from "../../components/note-content";
import { paginatedTimeline } from "../../extra/pagination";

import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import { ReactionsModel } from "applesauce-common/models";
import { createEventLoaderForStore, createReactionsLoader, createTimelineLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { NostrEvent } from "applesauce-core/helpers/event";

import { useMemo, useState } from "react";
import { map, Subject, materialize, scan, startWith } from "rxjs";

import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

// Create an event store for all events
const eventStore = new EventStore();

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  // Fallback to lookup relays if profiles cant be found
  lookupRelays: lookupRelays$,
});

// Create a tag value loader for reactions (kind 7 events with "e" tags)
const reactionLoader = createReactionsLoader(pool, {
  eventStore,
  onError: (error, source) => console.warn("Partial reaction load", source, error),
});

/** Hook to load and group reactions for a specific event */
function useReactions(event: NostrEvent) {
  const reactions = use$(
    () =>
      eventStore.model(ReactionsModel, event).pipe(
        map((reactions) =>
          reactions.reduce(
            (acc, reaction) => {
              const content = reaction.content || "+";
              acc[content] = (acc[content] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
        ),
      ),
    [event],
  );

  // Load reactions when component mounts
  const status = use$(
    () =>
      reactionLoader(event).pipe(
        materialize(),
        scan(
          (state, notification) =>
            notification.kind === "E"
              ? {
                  loading: false,
                  error: String(notification.error?.message ?? notification.error) as string | undefined,
                }
              : notification.kind === "C"
                ? { ...state, loading: false }
                : state,
          { loading: true, error: undefined as string | undefined },
        ),
        startWith({ loading: true, error: undefined as string | undefined }),
      ),
    [event],
  );

  return { reactions: reactions ?? {}, loading: status?.loading ?? true, error: status?.error };
}

/** Component to display reaction counts */
function ReactionCounts({ event }: { event: NostrEvent }) {
  const { reactions, loading, error } = useReactions(event);

  const reactionEntries = Object.entries(reactions);
  if (error)
    return (
      <p role="alert" className="text-error">
        {error}
      </p>
    );
  if (loading && !reactionEntries.length) return <p role="status">Loading reactions…</p>;

  if (reactionEntries.length === 0) {
    return <div className="text-sm text-gray-500 mt-2">No reactions loaded</div>;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {reactionEntries.map(([emoji, count]) => (
        <div key={emoji} className="badge badge-outline  flex items-center gap-1">
          <span>{emoji}</span>
          <span>{count}</span>
        </div>
      ))}
    </div>
  );
}

function NoteItem({ note }: { note: Note }) {
  const profile = use$(note.author.profile$);

  return (
    <div className="border border-base-300 bg-base-100 ">
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-4">
          <div className="avatar">
            <div className="w-10 rounded-full">
              <img src={getProfilePicture(profile, `https://robohash.org/${note.author.pubkey}.png`)} alt="Profile" />
            </div>
          </div>
          <div className="flex flex-col">
            <h2 className="font-semibold">{getDisplayName(profile)}</h2>
            <time className="text-sm text-gray-500">{new Date(note.event.created_at * 1000).toLocaleString()}</time>
          </div>
        </div>
        <NoteContent event={note.event} className="mt-2" />

        {/* Reaction counts */}
        <ReactionCounts event={note.event} />
      </div>
    </div>
  );
}

export default function FeedWithReactions() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");

  const filter = useMemo(
    () => ({
      kinds: [1],
      authors: ["32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245"],
    }),
    [],
  );

  // Create a timeline loader
  const timeline = useMemo(
    () => createTimelineLoader(pool, [relay], filter, { eventStore, limit: 20 }),
    [relay, filter],
  );

  const pages$ = useMemo(() => new Subject<void>(), []);
  const page = use$(() => paginatedTimeline(eventStore, timeline, pages$, filter), [timeline]);
  const feed = page?.events.map((event) => castEvent(event, Note, eventStore));

  return (
    <div className="container mx-auto my-8 px-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-4">Feed with Reactions</h1>
        <RelayPicker value={relay} onChange={(value) => setRelay(value)} />
      </div>

      {page?.error && (
        <p role="alert" className="text-error">
          {page.error}
        </p>
      )}
      {page?.loading && <p role="status">Loading events…</p>}
      <div className="flex flex-col gap-4 py-4">
        {feed?.map((event) => (
          <NoteItem key={event.id} note={event} />
        ))}
        <button className="btn btn-primary mx-auto" onClick={() => pages$.next()} disabled={page?.loading}>
          Load More
        </button>
      </div>
    </div>
  );
}
