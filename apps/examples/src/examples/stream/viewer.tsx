/**
 * View live streams with chat functionality and stream metadata
 * @tags nip-53, stream, viewer, chat
 * @related feed/relay-timeline
 */
import { castTimelineStream } from "applesauce-common/observable";
import { default as NoteContent } from "../../components/note-content";
import { publishEvent } from "../../extra/publish";
import { relayTimeline } from "../../extra/relay-timeline";
import { shareReplay, map } from "rxjs";

import { Stream, StreamChatMessage } from "applesauce-common/casts";
import { StreamChatMessageFactory } from "applesauce-common/factories";

import { EventStore, mapEventsToStore } from "applesauce-core";
import { buildCommonEventRelationFilters, relaySet, kinds } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import { ExtensionSigner } from "applesauce-signers";

import { memo, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import ReactPlayer from "react-player";

import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const STREAM_DEBUG_MODAL_ID = "stream_debug_modal";

// Create an event store for all events
const eventStore = new EventStore({ verifyEvent });

const signer = new ExtensionSigner();

// Create a relay pool to make relay connections
const pool = new RelayPool({
  informationCache: new Keyv({ store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "nip11" }) }),
});

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

function StreamCard({ stream }: { stream: Stream }) {
  const host = use$(() => stream.host.profile$, [stream]);
  const { title, image, viewers } = stream;

  return (
    <div className="border border-base-300 bg-base-100 ">
      {image && (
        <figure>
          <img src={image} alt={title} className="h-48 w-full object-cover" />
        </figure>
      )}
      <div className="p-4">
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
          <div className="badge badge-success badge">live</div>
        </div>

        <h2 className="font-semibold text-lg">{title}</h2>

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

function ChatMessage({ message, relays }: { message: StreamChatMessage; relays: string[] | undefined }) {
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
        <time
          className="text-sm opacity-50 ml-2"
          title={`Seen on ${message.seen?.size ?? 0}/${relays?.length ?? 0} chat relays`}
        >
          {message.createdAt.toLocaleTimeString()}
        </time>
      </div>
      <div className="chat-bubble">
        <NoteContent event={message.event} />
      </div>
    </div>
  );
}

function RelayName({ pool, url }: { pool: RelayPool; url: string }) {
  const name = use$(() => pool.relay(url).name$, [url]);
  return <span>{name}</span>;
}

function RelayFavicon({ pool, url }: { pool: RelayPool; url: string }) {
  const relay = useMemo(() => pool.relay(url), [url]);
  const src = use$(() => relay.icon$, [relay]);
  const status = use$(() => relay.status$, [relay]);

  return (
    <div className="avatar">
      <div className={`w-6 rounded-full border-2 ${status?.connected ? "border-success" : "border-error"}`}>
        <img src={src} alt="" width={24} height={24} loading="lazy" />
      </div>
    </div>
  );
}

function StreamChatDebugModal({ stream }: { stream: Stream }) {
  const inboxes = use$(stream.host.inboxes$);
  const platform = use$(stream.author.inboxes$);
  const allRelays = useMemo(() => relaySet(inboxes, stream.relays, platform), [inboxes, platform, stream.relays]);
  const inboxSet = useMemo(() => new Set(relaySet(inboxes)), [inboxes]);
  const streamRelaySet = useMemo(() => new Set(relaySet(stream.relays)), [stream.relays]);
  const platformRelaySet = useMemo(() => new Set(relaySet(platform)), [platform]);
  const rawJson = useMemo(() => JSON.stringify(stream.event, null, 2), [stream.event]);

  const openModal = () => {
    (document.getElementById(STREAM_DEBUG_MODAL_ID) as HTMLDialogElement | null)?.showModal();
  };

  return (
    <>
      <button
        type="button"
        className="btn gap-1"
        title="Stream debug: chat relays and raw event"
        aria-label="Stream debug"
        onClick={openModal}
      >
        {allRelays.length > 0 ? (
          <span className="badge badge-ghost" title="Relays used for chat subscription and publish">
            {allRelays.length}
          </span>
        ) : null}
        <span className="text-sm">Debug</span>
      </button>
      <dialog id={STREAM_DEBUG_MODAL_ID} className="modal">
        <div className="modal-box max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          <h3 className="font-bold text-lg">Stream debug</h3>
          <p className="text-sm text-base-content/70 py-1">Chat relays and raw replaceable event JSON.</p>

          <div className="divider my-2">Chat relays</div>
          <p className="text-sm text-base-content/70">
            Host inboxes and stream <code className="text-sm">relays</code> tags merged for chat. Badges show each
            relay&apos;s role.
          </p>
          <div className="py-2 overflow-y-auto max-h-48">
            {allRelays.length === 0 ? (
              <div role="alert" className="alert">
                <span>No host inboxes or stream relays configured for this chat.</span>
              </div>
            ) : (
              <ul className="list">
                {allRelays.map((url) => {
                  const isInbox = inboxSet.has(url);
                  const isStreamRelay = streamRelaySet.has(url);
                  const isPlatformRelay = platformRelaySet.has(url);

                  return (
                    <li key={url} className="list-row">
                      <div className="list-col-grow flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <RelayFavicon pool={pool} url={url} />
                          <RelayName pool={pool} url={url} />
                        </div>
                        <div className="flex flex-wrap gap-1 shrink-0 ms-auto">
                          {isInbox ? (
                            <span className="badge badge-secondary" title="From host NIP-65 read relays">
                              inbox
                            </span>
                          ) : null}
                          {isStreamRelay ? (
                            <span className="badge badge-primary" title="From stream event relays tag">
                              stream
                            </span>
                          ) : null}
                          {isPlatformRelay ? (
                            <span className="badge badge-secondary" title="From platform inboxes">
                              platform
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="divider my-2">Raw event</div>
          <p className="text-sm text-base-content/70">
            Kind {stream.event.kind} replaceable — <code className="text-sm">JSON.stringify</code> of the event.
          </p>
          <pre className="text-sm font-mono whitespace-pre-wrap break-all bg-base-200 rounded-lg p-3 max-h-[min(50vh,24rem)] overflow-auto">
            {rawJson}
          </pre>

          <div className="modal-action">
            <form method="dialog">
              <button type="submit" className="btn">
                Close
              </button>
            </form>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit">close</button>
        </form>
      </dialog>
    </>
  );
}

function StreamChat({ stream, relays }: { stream: Stream; relays: string[] }) {
  const chat = use$(() => stream.chat$, [stream]);

  // Subscribe to chat messages and zaps for the stream
  use$(
    () =>
      pool
        .subscription(
          relays,
          buildCommonEventRelationFilters({ kinds: [kinds.LiveChatMessage, kinds.Zap] }, stream.event),
          { reconnect: true, resubscribe: true },
        )
        .pipe(mapEventsToStore(eventStore)),
    [stream, relays],
  );

  return (
    <>
      <div className="border-b border-base-300 p-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div>
              <h3 className="font-bold text-lg">Live Chat</h3>
              <p className="text-sm text-base-content/60">{chat?.length || 0} messages</p>
            </div>
          </div>
          <div className="ms-auto">
            <StreamChatDebugModal stream={stream} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col-reverse gap-1 overflow-x-hidden">
        {chat && chat.length > 0 ? (
          chat.map((message) => <ChatMessage key={message.id} message={message} relays={relays} />)
        ) : (
          <div className="text-center text-base-content/60 py-8">No chat messages yet</div>
        )}
      </div>
    </>
  );
}

function ChatMessageForm({ stream, relays }: { stream: Stream; relays: string[] }) {
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      content: "",
    },
    mode: "all",
  });

  const send = handleSubmit(async (values) => {
    if (relays.length === 0) throw new Error("No relays found for stream");

    const event = await StreamChatMessageFactory.create(stream.event, values.content).sign(signer);

    await publishEvent(pool, relays, event);
    eventStore.add(event);
    reset();
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
  const host = use$(() => stream.host.profile$, [stream]);
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

  const inboxes = use$(stream.host.inboxes$);
  const platform = use$(stream.author.inboxes$);
  const relays = useMemo(() => relaySet(inboxes, stream.relays, platform), [inboxes, platform, stream.relays]);

  return (
    <div className="h-screen bg-base-100 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 p-3 border-b border-base-300">
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" onClick={onBack}>
            ← Back to Streams
          </button>
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
          <StreamChat stream={stream} relays={relays} />
          <ChatMessageForm stream={stream} relays={relays} />
        </div>
      </div>
    </div>
  );
}

export default function StreamCastExample() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const feed$ = useMemo(
    () =>
      relayTimeline(eventStore, pool, [relay], { kinds: [kinds.LiveEvent] }).pipe(
        shareReplay({ bufferSize: 1, refCount: true }),
      ),
    [relay],
  );
  const feed = use$(feed$);
  const streams = use$(
    () =>
      feed$.pipe(
        map((state) => state.events),
        castTimelineStream(Stream, eventStore),
      ),
    [feed$],
  );

  const selectedStream = streams?.find((stream) => stream.uid === selectedAddress);
  if (selectedStream) {
    return <StreamViewer stream={selectedStream} onBack={() => setSelectedAddress(null)} />;
  }

  return (
    <div className="container mx-auto my-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Live Streams</h1>
        {feed?.status === "loading" && <p role="status">Loading…</p>}
        {feed?.errors.map((error) => (
          <p key={error} role="alert" className="text-error">
            {error}
          </p>
        ))}
        <RelayPicker value={relay} onChange={(next) => setRelay(next)} />
      </div>

      <StreamGrid streams={streams || []} onStreamSelect={(stream) => setSelectedAddress(stream.uid)} />
    </div>
  );
}
