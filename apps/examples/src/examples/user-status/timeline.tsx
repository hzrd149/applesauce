/**
 * Show each author's live status next to their name in a relay timeline
 * @tags user-status, feed, timeline, models, casts
 * @related user-status/manager, user-status/explorer, feed/relay-timeline
 */
import { Note, User } from "applesauce-common/casts";
import { UserStatusModel } from "applesauce-common/models";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { getDisplayName, getProfilePicture, NostrEvent } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useState } from "react";

import RelayPicker from "../../components/relay-picker";

const eventStore = new EventStore();
const pool = new RelayPool();

// The loader fetches each author's status on demand when user.status$ asks the store for it
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  emoji: ({ node }) => <img title={node.raw} src={node.url} className="inline h-5 w-5 align-text-bottom" />,
};

function StatusText({ event, icon }: { event: NostrEvent; icon: string }) {
  const content = useRenderedContent(event, components);
  return (
    <div className="truncate text-sm opacity-70">
      {icon} {content}
    </div>
  );
}

/** The general status, read through the User cast */
function GeneralStatus({ user }: { user: User }) {
  const status = use$(user.status$);
  if (!status) return null;

  return status.url ? (
    <a href={status.url} target="_blank" className="hover:underline">
      <StatusText event={status.event} icon="💬" />
    </a>
  ) : (
    <StatusText event={status.event} icon="💬" />
  );
}

/** The music status, read through the UserStatusModel without casts */
function MusicStatus({ pubkey }: { pubkey: string }) {
  const status = use$(() => eventStore.model(UserStatusModel, pubkey, "music"), [pubkey]);
  return status ? <StatusText event={status.event} icon="🎵" /> : null;
}

function NoteItem({ note, showMusic }: { note: Note; showMusic: boolean }) {
  const profile = use$(note.author.profile$);

  return (
    <div className="flex gap-3 border-b border-base-300 p-4">
      <img
        src={getProfilePicture(profile, `https://robohash.org/${note.author.pubkey}.png`)}
        className="h-10 w-10 shrink-0 rounded-full"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="font-semibold">{getDisplayName(profile, note.author.pubkey.slice(0, 8))}</div>
        <GeneralStatus user={note.author} />
        {showMusic && <MusicStatus pubkey={note.author.pubkey} />}
        <p className="mt-1 whitespace-pre-wrap break-words">{note.event.content}</p>
      </div>
    </div>
  );
}

export default function StatusTimeline() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");
  const [showMusic, setShowMusic] = useState(true);

  const notes = use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [1], limit: 50 })
        .pipe(mapEventsToStore(eventStore), mapEventsToTimeline(), castTimelineStream(Note, eventStore)),
    [relay],
  );

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <RelayPicker value={relay} onChange={setRelay} />
          <label className="label cursor-pointer gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={showMusic}
              onChange={(e) => setShowMusic(e.target.checked)}
            />
            <span className="text-sm">Music</span>
          </label>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border border-base-300">
          {!notes && <div className="p-4 text-sm opacity-60">Loading notes...</div>}
          {notes?.length === 0 && <div className="p-4 text-sm opacity-60">No notes yet</div>}
          {notes?.map((note) => (
            <NoteItem key={note.id} note={note} showMusic={showMusic} />
          ))}
        </div>
      </div>
    </div>
  );
}
