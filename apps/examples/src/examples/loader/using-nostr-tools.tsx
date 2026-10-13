/**
 * Integrate a relay pool with Applesauce loaders for event loading
 * @tags loader, relay-pool, integration
 * @related loader/using-ndk, loader/using-nostrify
 */
import NoteContent from "../../components/note-content";
import { BehaviorSubject, exhaustMap, ignoreElements, endWith, startWith, catchError, of } from "rxjs";

import { castEvent, Note } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { UpstreamPool } from "applesauce-loaders";
import { createEventLoaderForStore, createTimelineLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const pool = new RelayPool();

// Create an event store to hold events
const store = new EventStore();

const upstream: UpstreamPool = pool;

// Create the necessary loaders for the store to load profiles
createEventLoaderForStore(store, upstream, { lookupRelays: lookupRelays$ });

function ReplyingTo({ note }: { note: Note }) {
  const profile = use$(note.author.profile$);

  return (
    <p className="text-sm text-base-content/60 mb-2">
      Replying to <span className="font-semibold">{profile?.displayName ?? note.author.npub.slice(0, 8) + "..."}</span>{" "}
      <span className="italic line-clamp-1">{note.event.content}</span>
      <span className="text-sm text-base-content/60">{note.createdAt.toLocaleString()}</span>
    </p>
  );
}

function NoteEvent({ note }: { note: Note }) {
  const profile = use$(note.author.profile$);
  const replyingToEvent = use$(note.replyingTo$);
  const replyingToNote = replyingToEvent ? castEvent(replyingToEvent, Note, note.store) : null;

  return (
    <div className="border border-base-300 bg-base-100 ">
      <div className="p-4">
        {replyingToNote && <ReplyingTo note={replyingToNote} />}
        <div className="flex items-center gap-4">
          <div className="avatar">
            <div className="w-12 rounded-full">
              <img src={profile?.picture ?? `https://robohash.org/${note.author.pubkey}.png`} alt="Profile" />
            </div>
          </div>
          <h2 className="font-semibold">{profile?.displayName ?? note.author.npub.slice(0, 8) + "..."}</h2>
        </div>
        <NoteContent event={note.event} />
      </div>
    </div>
  );
}

export default function UsingNostrToolsExample() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");

  const loader = useMemo(
    () => createTimelineLoader(upstream, [relay], [{ kinds: [1] }], { eventStore: store, limit: 20 }),
    [relay],
  );

  const pages$ = useMemo(() => new BehaviorSubject(0), [loader]);
  const request = use$(
    () =>
      pages$.pipe(
        exhaustMap(() =>
          loader().pipe(
            ignoreElements(),
            endWith({ loading: false, error: null as string | null }),
            startWith({ loading: true, error: null as string | null }),
            catchError((error) => of({ loading: false, error: String(error) })),
          ),
        ),
      ),
    [loader, pages$],
  );
  const loadMore = () => pages$.next(pages$.value + 1);

  // Subscribe to a timeline of events from the store
  const events = use$(store.timeline({ kinds: [1] }));

  // Cast events to Notes
  const notes = useMemo(() => {
    if (!events) return [];
    return events.map((event) => castEvent(event, Note, store));
  }, [events]);

  return (
    <div className="container mx-auto my-8 px-4">
      <RelayPicker value={relay} onChange={(value: string) => setRelay(value)} />
      {request?.error && (
        <p role="alert" className="text-error">
          {request.error}
        </p>
      )}

      <div className="flex flex-col gap-4 py-4">
        {notes.map((note) => (
          <NoteEvent key={note.id} note={note} />
        ))}
      </div>

      {notes.length > 0 && (
        <div className="flex justify-center py-4">
          <button className="btn btn-primary" onClick={loadMore} disabled={request?.loading}>
            Load More
          </button>
        </div>
      )}
    </div>
  );
}
