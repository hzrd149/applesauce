import { StreamChatMessage } from "applesauce-common/blueprints";
import {
  getStreamHost,
  getStreamImage,
  getStreamRelays,
  getStreamStartTime,
  getStreamStatus,
  getStreamStreamingURLs,
  getStreamSummary,
  getStreamTitle,
  getStreamViewers,
} from "applesauce-common/helpers/stream";
import { StreamChatMessagesModel } from "applesauce-common/models";
import { EventFactory, EventStore, mapEventsToStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  getReplaceableAddress,
  getSeenRelays,
  mergeRelaySets,
  ProfileContent,
  unixNow,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { kinds, NostrEvent } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";
import { useState } from "react";
import { useForm } from "react-hook-form";
import ReactPlayer from "react-player";
import RelayPicker from "../../components/relay-picker";

// Create an event store for all events
const eventStore = new EventStore();

const signer = new ExtensionSigner();
const factory = new EventFactory({ signer });

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/"],
});

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return use$(() => eventStore.profile(user), [user.pubkey, user.relays?.join("|")]);
}

function StreamCard({ stream }: { stream: NostrEvent }) {
  const host = getStreamHost(stream);
  const profile = useProfile(host);

  const title = getStreamTitle(stream) || "Untitled Stream";
  const summary = getStreamSummary(stream);
  const image = getStreamImage(stream);
  const status = getStreamStatus(stream);
  const startTime = getStreamStartTime(stream);
  const viewers = getStreamViewers(stream);
  const streamingUrls = getStreamStreamingURLs(stream);

  const statusColor = {
    live: "badge-success",
    planned: "badge-warning",
    ended: "badge-error",
  }[status];

  return (
    <div className="card bg-base-100 shadow-md">
      {image && (
        <figure>
          <img src={image} alt={title} className="h-48 w-full object-cover" />
        </figure>
      )}
      <div className="card-body">
        <div className="flex items-center gap-2 mb-2">
          <div className="avatar">
            <div className="w-8 rounded-full">
              <img
                src={getProfilePicture(profile, `https://robohash.org/${host.pubkey}`)}
                alt={getDisplayName(profile)}
              />
            </div>
          </div>
          <span className="text-sm font-medium">{getDisplayName(profile)}</span>
          <div className={`badge ${statusColor} badge-sm`}>{status}</div>
        </div>

        <h2 className="card-title text-lg">{title}</h2>
        {summary && <p className="text-sm text-base-content/70 line-clamp-2">{summary}</p>}

        <div className="flex items-center justify-between text-sm text-base-content/60 mt-2">
          <div className="flex items-center gap-4">
            {startTime && (
              <span>
                {new Date(startTime * 1000).toLocaleDateString()} {new Date(startTime * 1000).toLocaleTimeString()}
              </span>
            )}
            {viewers !== undefined && <span>{viewers} viewers</span>}
          </div>
          {streamingUrls.length > 0 && (
            <span className="text-xs bg-base-200 px-2 py-1 rounded">
              {streamingUrls.length} stream{streamingUrls.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StreamGrid({
  streams,
  onStreamSelect,
}: {
  streams: NostrEvent[];
  onStreamSelect: (stream: NostrEvent) => void;
}) {
  if (!streams || streams.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-base-content/60">No streams found on this relay</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {streams.map((stream) => (
        <div
          key={stream.id}
          onClick={() => onStreamSelect(stream)}
          className="cursor-pointer hover:scale-105 transition-transform"
        >
          <StreamCard stream={stream} />
        </div>
      ))}
    </div>
  );
}

function ChatMessage({ message }: { message: NostrEvent }) {
  const profile = useProfile({ pubkey: message.pubkey, relays: mergeRelaySets(getSeenRelays(message)) });

  return (
    <div className="chat chat-start">
      <div className="chat-image avatar">
        <div className="w-10 rounded-full">
          <img
            alt={getDisplayName(profile)}
            src={getProfilePicture(profile, `https://robohash.org/${message.pubkey}`)}
          />
        </div>
      </div>
      <div className="chat-header">
        {getDisplayName(profile)}
        <time className="text-xs opacity-50 ml-2">{new Date(message.created_at * 1000).toLocaleTimeString()}</time>
      </div>
      <div className="chat-bubble">{message.content}</div>
    </div>
  );
}

function StreamChat({ stream }: { stream: NostrEvent }) {
  // Get the stream's relays or fall back to a default
  const relays = getStreamRelays(stream) || ["wss://relay.damus.io/"];
  const streamAddress = getReplaceableAddress(stream);

  // Subscribe to chat messages
  use$(
    () =>
      streamAddress
        ? pool
            .subscription(relays, {
              kinds: [kinds.LiveChatMessage],
              "#a": [streamAddress],
            })
            .pipe(onlyEvents(), mapEventsToStore(eventStore))
        : undefined,
    [streamAddress, relays.join(",")],
  );

  const messages = use$(() => eventStore.model(StreamChatMessagesModel, stream), [stream]);

  return (
    <>
      <div className="border-b border-base-300 p-4">
        <h3 className="font-bold text-lg">Live Chat</h3>
        <p className="text-sm text-base-content/60">{messages?.length || 0} messages</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse gap-1 overflow-x-hidden">
        {messages && messages.length > 0 ? (
          messages.map((message: NostrEvent) => <ChatMessage key={message.id} message={message} />)
        ) : (
          <div className="text-center text-base-content/60 py-8">No chat messages yet</div>
        )}
      </div>
    </>
  );
}

function ChatMessageForm({ stream }: { stream: NostrEvent }) {
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      content: "",
    },
    mode: "all",
  });

  const send = handleSubmit(async (values) => {
    const relays = getStreamRelays(stream);
    if (!relays) throw new Error("No relays found for stream");

    const draft = await factory.create(StreamChatMessage, stream, values.content);
    const event = await factory.sign(draft);

    eventStore.add(event);
    reset();
    await pool.publish(relays, event);
  });

  return (
    <form className="flex gap-2 p-2" onSubmit={send}>
      <input type="text" placeholder="Message..." className="input" {...register("content", { required: true })} />
      <button className="btn btn-primary" type="submit">
        Send
      </button>
    </form>
  );
}

function StreamInfo({ stream }: { stream: NostrEvent }) {
  const host = getStreamHost(stream);
  const profile = useProfile(host);

  const title = getStreamTitle(stream) || "Untitled Stream";
  const summary = getStreamSummary(stream);
  const status = getStreamStatus(stream);
  const viewers = getStreamViewers(stream);

  const statusColor = {
    live: "badge-success",
    planned: "badge-warning",
    ended: "badge-error",
  }[status];

  return (
    <div className="p-4 border-b border-base-300">
      <div className="flex items-center gap-3 mb-3">
        <div className="avatar">
          <div className="w-12 rounded-full">
            <img
              src={getProfilePicture(profile, `https://robohash.org/${host.pubkey}`)}
              alt={getDisplayName(profile)}
            />
          </div>
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-xl">{title}</h2>
          <p className="text-sm text-base-content/70">by {getDisplayName(profile)}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`badge ${statusColor}`}>{status}</div>
          {viewers !== undefined && <div className="badge badge-outline">{viewers} viewers</div>}
        </div>
      </div>

      {summary && <p className="text-base-content/80 text-sm">{summary}</p>}
    </div>
  );
}

function StreamViewer({ stream, onBack }: { stream: NostrEvent; onBack: () => void }) {
  const streamingUrls = getStreamStreamingURLs(stream);
  const status = getStreamStatus(stream);

  // Use the first streaming URL if available
  const streamUrl = streamingUrls[0];

  return (
    <div className="h-screen bg-base-100 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="navbar bg-base-200 border-b border-base-300">
        <div className="navbar-start">
          <button className="btn btn-ghost" onClick={onBack}>
            ← Back to Streams
          </button>
        </div>
        <div className="navbar-center">
          <span className="text-lg font-semibold">Stream Viewer</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex h-full overflow-hidden">
        {/* Left side - Stream player */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <StreamInfo stream={stream} />

          <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
            {streamUrl && status === "live" ? (
              <div className="w-full h-full">
                {/* @ts-ignore - ReactPlayer types may be inconsistent */}
                <ReactPlayer src={streamUrl} playing controls width="100%" height="100%" />
              </div>
            ) : status === "ended" ? (
              <div className="text-center text-white">
                <div className="text-6xl mb-4">📺</div>
                <h3 className="text-xl mb-2">Stream has ended</h3>
                <p className="text-white/70">This stream is no longer live</p>
              </div>
            ) : status === "planned" ? (
              <div className="text-center text-white">
                <div className="text-6xl mb-4">⏰</div>
                <h3 className="text-xl mb-2">Stream is planned</h3>
                <p className="text-white/70">This stream hasn't started yet</p>
              </div>
            ) : (
              <div className="text-center text-white">
                <div className="text-6xl mb-4">❌</div>
                <h3 className="text-xl mb-2">No stream available</h3>
                <p className="text-white/70">No streaming URL found for this stream</p>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Chat */}
        <div className="w-sm border-l border-base-300 bg-base-50 overflow-hidden h-full flex flex-col flex-shrink-0">
          <StreamChat stream={stream} />
          <ChatMessageForm stream={stream} />
        </div>
      </div>
    </div>
  );
}

export default function StreamExample() {
  const [relay, setRelay] = useState("wss://relay.damus.io");
  const [selectedStream, setSelectedStream] = useState<NostrEvent | null>(null);

  // Subscribe to stream events
  use$(
    () =>
      pool
        .relay(relay)
        .subscription({
          kinds: [kinds.LiveEvent], // NIP-53 Live Event kind
          since: unixNow() - 7 * 24 * 60 * 60, // Last 7 days
        })
        .pipe(
          // Only get events from relay (ignore EOSE)
          onlyEvents(),
          // deduplicate events using the event store
          mapEventsToStore(eventStore),
        ),
    [relay],
  );

  const streams = use$(() => eventStore.timeline({ kinds: [kinds.LiveEvent] }), []);

  if (selectedStream) {
    return <StreamViewer stream={selectedStream} onBack={() => setSelectedStream(null)} />;
  }

  return (
    <div className="container mx-auto my-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Live Streams</h1>
        <p className="text-base-content/70 mb-6">
          Browse NIP-53 live streams from Nostr relays. Click on a stream to watch and join the chat.
        </p>
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <StreamGrid streams={streams || []} onStreamSelect={setSelectedStream} />
    </div>
  );
}
