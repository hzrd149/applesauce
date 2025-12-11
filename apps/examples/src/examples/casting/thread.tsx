import { castNote, Note, Zap } from "applesauce-common/casts";
import { castEvent } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import { kinds, relaySet } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { useObservableMemo } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { nip19 } from "nostr-tools";
import { EventPointer, npubEncode } from "nostr-tools/nip19";
import { useEffect, useState } from "react";

// Setup event store
const eventStore = new EventStore();
const pool = new RelayPool();

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

/** Component to render a single zap */
function ZapItem({ zap }: { zap: Zap }) {
  const sender = useObservableMemo(() => zap.sender$, [zap.id]);
  const amountSats = Math.round(zap.amount / 1000); // Convert msats to sats

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="avatar">
        <div className="w-6 rounded-full">
          <img
            src={sender?.picture || `https://robohash.org/${zap.sender}.png`}
            alt={sender?.displayName || npubEncode(zap.sender)}
          />
        </div>
      </div>
      <span className="font-medium">{sender?.displayName || npubEncode(zap.sender)}</span>
      <span className="text-primary">⚡ {amountSats} sats</span>
    </div>
  );
}

/** Component to render a single note with author info */
function NoteItem({ note }: { note: Note }) {
  const author = useObservableMemo(() => note.author$, [note.id]);
  const replies = useObservableMemo(() => note.replies$, [note.id]);
  const zaps = useObservableMemo(() => note.zaps$, [note.id]);

  return (
    <div className="bg-base-100 mb-2">
      <div className="p-2">
        <div className="flex items-center gap-3 mb-1">
          <div className="avatar">
            <div className="w-10 rounded-full">
              <img
                src={author?.picture || `https://robohash.org/${note.pubkey}.png`}
                alt={author?.displayName || npubEncode(note.pubkey)}
              />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">{author?.displayName || npubEncode(note.pubkey)}</h3>
            <p className="text-sm text-base-content/60">{npubEncode(note.pubkey)}</p>
          </div>
          <button
            className="btn btn-sm btn-link"
            onClick={() => {
              console.log(note);
            }}
          >
            print
          </button>
        </div>
        <p className="whitespace-pre-wrap overflow-hidden text-ellipsis">{note.content.trim()}</p>
        {zaps && zaps.length > 0 && (
          <div className="mt-2 pt-2 border-t border-base-300/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">⚡</span>
              <span className="font-semibold">
                {zaps.length} zap{zaps.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {zaps.map((zap) => (
                <ZapItem key={zap.id} zap={zap} />
              ))}
            </div>
          </div>
        )}
        {replies && replies.length > 0 && (
          <div className="ml-2 mt-2 border-l border-base-300/50 pl-3">
            {replies.map((reply) => (
              <NoteItem key={reply.id} note={reply} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ThreadExample() {
  const [neventInput, setNeventInput] = useState(
    "nostr:nevent1qqsd4xdw2zfm23xrcmpxeze8pysp0nyrwcwstnt0v5z9hymfqtne6gczyqalp33lewf5vdq847t6te0wvnags0gs0mu72kz8938tn24wlfze6qg6waehxw309ac8junpd45kgtnxd9shg6npvchxxmmd9uq3kamnwvaz7tmjv4kxz7fwwajhxar9wfhxyarr9e3k7mf0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qghwaehxw309aex2mrp0yh8qunfd4skctnwv46z7qcyqqqqqqguy5qm0",
  );
  const [eventPointer, setEventPointer] = useState<EventPointer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Decode nip-19 nevent
  useEffect(() => {
    if (!neventInput.trim()) {
      setEventPointer(null);
      setError(null);
      return;
    }

    try {
      const decoded = nip19.decode(neventInput.trim().replace(/^nostr:/, ""));
      if (decoded.type === "nevent") {
        setEventPointer(decoded.data);
        setError(null);
      } else {
        throw new Error("Input must be a nevent (NIP-19 event pointer)");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to decode nevent");
      setEventPointer(null);
    }
  }, [neventInput]);

  // Load the event and cast it to a note
  const note = useObservableMemo(() => {
    if (!eventPointer) return undefined;
    return eventStore.event(eventPointer).pipe(castEvent(castNote));
  }, [eventPointer?.id, eventPointer?.relays?.join("|")]);

  /** Resolve the authors inboxes for loading events */
  const inboxes = useObservableMemo(() => note?.author$.inboxes$, [note]);

  // const name = useObservableMemo(() => note?.author$.displayName, [note]);

  // Load all kind 1 and 9735 events that reference the event
  useObservableMemo(() => {
    if (!eventPointer) return;

    // Request kind 1 events that reference this event
    return pool.subscription(
      relaySet(eventPointer.relays, inboxes),
      {
        kinds: [kinds.ShortTextNote, kinds.Zap],
        "#e": [eventPointer.id],
      },
      { eventStore },
    );
  }, [eventPointer, inboxes]);

  return (
    <div className="container mx-auto my-8 px-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Thread Viewer</h1>
      <p className="mb-4">Enter a NIP-19 nevent to view the thread with replies</p>

      <div className="mb-6">
        <input
          type="text"
          className="input input-bordered w-full"
          placeholder="nevent1..."
          value={neventInput}
          onChange={(e) => setNeventInput(e.target.value)}
        />
      </div>

      {error && (
        <div className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      )}

      {!note && eventPointer && (
        <div className="flex justify-center my-8">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      )}

      {note && <NoteItem note={note} />}

      {!eventPointer && (
        <div className="alert alert-info">
          <span>Enter a nevent to load a thread</span>
        </div>
      )}
    </div>
  );
}
