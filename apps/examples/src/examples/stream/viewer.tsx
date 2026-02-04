/**
 * View live streams with chat functionality and stream metadata
 * @tags stream, viewer, chat
 * @related feed/relay-timeline
 */
import { StreamChatMessage as StreamChatMessageBlueprint } from "applesauce-common/blueprints";
import { Stream, StreamChatMessage } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { EventFactory, EventStore, mapEventsToStore } from "applesauce-core";
import { buildCommonEventRelationFilters, unixNow } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { kinds } from "nostr-tools";
import { memo, useState } from "react";
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

function StreamCard({ stream }: { stream: Stream }) {
  const host = use$(() => stream.host.profile$, [stream.id]);
  const { title, image, viewers } = stream;

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
                src={host?.picture || `https://robohash.org/${stream.host.pubkey}`}
                alt={host?.displayName || stream.host.pubkey}
              />
            </div>
          </div>
          <span className="text-sm font-medium">{host?.displayName || stream.host.pubkey}</span>
          <div className="badge badge-success badge-sm">live</div>
        </div>

        <h2 className="card-title text-lg">{title}</h2>

        {viewers !== undefined && (
          <div className="text-sm text-base-content/60 mt-2">
            <span>{viewers} viewers</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StreamGrid({ streams, onStreamSelect }: { streams: Stream[]; onStreamSelect: (stream: Stream) => void }) {
  const liveStreams = streams?.filter((stream) => stream.status === "live") || [];

  if (liveStreams.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-base-content/60">No live streams found on this relay</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {liveStreams.map((stream) => (
        <div key={stream.id} onClick={() => onStreamSelect(stream)} className="cursor-pointer">
          <StreamCard stream={stream} />
        </div>
      ))}
    </div>
  );
}

function ChatMessage({ message }: { message: StreamChatMessage }) {
  const profile = use$(() => message.author.profile$, [message.id]);

  return (
    <div className="chat chat-start">
      <div className="chat-image avatar">
        <div className="w-10 rounded-full">
          <img
            alt={profile?.displayName || message.author.pubkey}
            src={profile?.picture || `https://robohash.org/${message.author.pubkey}`}
          />
        </div>
      </div>
      <div className="chat-header">
        {profile?.displayName || message.author.pubkey}
        <time className="text-xs opacity-50 ml-2">{message.createdAt.toLocaleTimeString()}</time>
      </div>
      <div className="chat-bubble">{message.event.content}</div>
    </div>
  );
}

function StreamChat({ stream }: { stream: Stream }) {
  const chat = use$(() => stream.chat$, [stream.id]);

  return (
    <>
      <div className="border-b border-base-300 p-4">
        <h3 className="font-bold text-lg">Live Chat</h3>
        <p className="text-sm text-base-content/60">{chat?.length || 0} messages</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse gap-1 overflow-x-hidden">
        {chat && chat.length > 0 ? (
          chat.map((message) => <ChatMessage key={message.id} message={message} />)
        ) : (
          <div className="text-center text-base-content/60 py-8">No chat messages yet</div>
        )}
      </div>
    </>
  );
}

function ChatMessageForm({ stream }: { stream: Stream }) {
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      content: "",
    },
    mode: "all",
  });

  const inboxes = use$(stream.host.inboxes$);
  const send = handleSubmit(async (values) => {
    const relays = inboxes || stream.relays;
    if (!relays) throw new Error("No relays found for stream");

    const draft = await factory.create(StreamChatMessageBlueprint, stream.event, values.content);
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

function StreamInfo({ stream }: { stream: Stream }) {
  const host = use$(() => stream.host.profile$, [stream.id]);
  const title = stream.title || "Untitled Stream";
  const summary = stream.summary;
  const status = stream.status;
  const viewers = stream.viewers;

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
              src={host?.picture || `https://robohash.org/${stream.host.pubkey}`}
              alt={host?.displayName || stream.host.npub}
            />
          </div>
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-xl">{title}</h2>
          <p className="text-sm text-base-content/70">by {host?.displayName || stream.host.npub}</p>
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

const StreamPlayer = memo(ReactPlayer);

function StreamViewer({ stream, onBack }: { stream: Stream; onBack: () => void }) {
  const streaming = stream.streamingVideos[0];
  const status = stream.status;

  // Subscribe to chat messages and zaps for the stream
  use$(
    () =>
      pool.subscription(
        stream.relays || ["wss://relay.damus.io/"],
        buildCommonEventRelationFilters({ kinds: [kinds.LiveChatMessage, kinds.Zap] }, stream.event),
        { eventStore },
      ),
    [stream.id],
  );

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
            {streaming && status === "live" ? (
              <div className="w-full h-full">
                <StreamPlayer src={streaming} playing controls width="100%" height="100%" />
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
        <div className="w-sm border-l border-base-300 bg-base-50 overflow-hidden h-full flex flex-col shrink-0">
          <StreamChat stream={stream} />
          <ChatMessageForm stream={stream} />
        </div>
      </div>
    </div>
  );
}

export default function StreamCastExample() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");
  const [selectedStream, setSelectedStream] = useState<Stream | null>(null);

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
          // deduplicate events using the event store
          mapEventsToStore(eventStore),
        ),
    [relay],
  );

  // Get streams and cast them to Stream class
  const streams = use$(
    () => eventStore.timeline({ kinds: [kinds.LiveEvent] }).pipe(castTimelineStream(Stream, eventStore)),
    [],
  );

  if (selectedStream) {
    return <StreamViewer stream={selectedStream} onBack={() => setSelectedStream(null)} />;
  }

  return (
    <div className="container mx-auto my-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Live Streams</h1>
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <StreamGrid streams={streams || []} onStreamSelect={setSelectedStream} />
    </div>
  );
}
