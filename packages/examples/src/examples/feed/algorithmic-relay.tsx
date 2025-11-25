import { Link } from "applesauce-content/nast";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { isAudioURL, isImageURL, isVideoURL } from "applesauce-core/helpers";
import { ComponentMap, useObservableEagerState, useObservableMemo, useRenderedContent } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { neventEncode, npubEncode } from "nostr-tools/nip19";
import { useCallback, useState } from "react";
import { scan } from "rxjs";

import RelayPicker from "../../components/relay-picker";

// Create an event store for all events
const eventStore = new EventStore();

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Preset relay list with algo.utxo.one as requested
const PRESET_RELAYS = ["wss://algo.utxo.one/"];

function LinkRenderer({ node: link }: { node: Link }) {
  if (isImageURL(link.href))
    return (
      <a href={link.href} target="_blank">
        <img src={link.href} className="max-h-64 rounded" alt="Gallery image" />
      </a>
    );
  else if (isVideoURL(link.href)) return <video src={link.href} className="max-h-64 rounded" controls />;
  else if (isAudioURL(link.href)) return <audio src={link.href} className="max-h-64 rounded" controls />;
  else
    return (
      <a href={link.href} target="_blank" className="text-blue-500 hover:underline">
        {link.value}
      </a>
    );
}

// Create components for rendering content
const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: LinkRenderer,
  mention: ({ node }) => (
    <a href={`https://njump.me/${node.encoded}`} target="_blank" className="text-purple-500 hover:underline">
      @{node.encoded.slice(0, 9)}...{node.encoded.slice(-4)}
    </a>
  ),
  hashtag: ({ node }) => <span className="text-orange-500">#{node.hashtag}</span>,
  emoji: ({ node }) => <img title={node.raw} src={node.url} className="inline h-6 w-6" alt={node.raw} />,
  gallery: ({ node }) => (
    <div className="flex flex-wrap gap-2 my-2">
      {node.links.map((link, i) => (
        <a key={i} href={link} target="_blank">
          <img src={link} className="max-h-64 rounded" alt="Gallery image" />
        </a>
      ))}
    </div>
  ),
};

/** A component for rendering note events */
function Note({ note }: { note: NostrEvent }) {
  const content = useRenderedContent(note, components);
  const npub = npubEncode(note.pubkey);

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body">
        <div className="flex items-center gap-4">
          <div className="avatar">
            <div className="w-12 rounded-full">
              <img src={`https://robohash.org/${note.pubkey}.png`} alt="Profile" />
            </div>
          </div>
          <h2 className="card-title">
            {npub.slice(0, 9)}...{npub.slice(-4)}
          </h2>
          <a href={`https://njump.me/${neventEncode(note)}`} target="_blank" className="text-blue-500 hover:underline">
            Open in Njump
          </a>
        </div>
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}

export default function AlgorithmicRelayFeed() {
  const [relay, setRelay] = useState(PRESET_RELAYS[0]);
  const [refresh, setRefresh] = useState(0);
  const [pubkey, setPubkey] = useState<string | null>(null);

  // Subscribe to authentication state
  const challenge = useObservableEagerState(pool.relay(relay).challenge$);
  const authenticated = useObservableEagerState(pool.relay(relay).authenticated$);

  const needsAuth = !!challenge;

  // Handle authentication with extension signer
  const handleAuthenticate = useCallback(async () => {
    if (!needsAuth || authenticated) return;

    try {
      const signer = new ExtensionSigner();

      // get the users pubkey
      setPubkey(await signer.getPublicKey());

      // Instead of storing the relay, get it from the pool when needed
      // This is a better pattern for real applications
      await pool
        .relay(relay)
        .authenticate(signer)
        .then((response) => console.log("Authentication response:", response))
        .catch((error) => console.error("Authentication error:", error));
    } catch (error) {
      console.error("Authentication failed:", error);
    }
  }, [relay, needsAuth, authenticated]);

  // Create a timeline observable using scan operator to preserve order
  const events = useObservableMemo(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [1] })
        .pipe(
          // Only get events from relay (ignore EOSE)
          onlyEvents(),
          // Deduplicate events using the event store but keep original time
          mapEventsToStore(eventStore),
          // Use scan to preserve the order events came from the relay
          // This is different from mapEventsToTimeline which sorts by created_at
          scan((acc, event) => [...acc, event], [] as NostrEvent[]),
        ),
    // Pass refresh in to trigger creating a new timeline
    [relay, refresh],
  );

  const npub = pubkey && npubEncode(pubkey);

  return (
    <div className="container mx-auto my-8 px-4">
      <div className="flex items-center gap-2">
        <div className="join">
          <RelayPicker value={relay} onChange={setRelay} common={PRESET_RELAYS} />

          {/* Refresh button */}
          <button className="btn join-item btn-square" title="Refresh feed" onClick={() => setRefresh(refresh + 1)}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
          </button>
        </div>

        {authenticated && npub && (
          <p>
            Authenticated as{" "}
            <span className="font-bold text-purple-500">
              {npub.slice(0, 9)}...{npub.slice(-4)}
            </span>
          </p>
        )}
      </div>

      {needsAuth && !authenticated ? (
        <div className="mt-8 text-center">
          <p>This relay requires authentication.</p>
          <p>Click the "Authenticate" button to sign in with your extension.</p>
          {challenge && <p>Challenge received: {challenge.slice(0, 10)}...</p>}

          <button className="btn btn-primary mt-4" onClick={handleAuthenticate}>
            Authenticate
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-4">
          {events?.length === 0 ? (
            <div className="text-center mt-8">
              <p>No events received yet from this relay.</p>
            </div>
          ) : (
            events?.map((event) => <Note key={event.id} note={event} />)
          )}
        </div>
      )}
    </div>
  );
}
