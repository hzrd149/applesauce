/**
 * Display a timeline of zaps (Lightning payments) with amounts and recipients
 * @tags nip-57, zap, timeline, lightning
 * @related zap/graph, nutzap/zap-feed
 */
import { castTimelineStream } from "applesauce-common/observable";
import { relayTimeline } from "../../extra/relay-timeline";
import { shareReplay, map } from "rxjs";

import { castUser, User, Zap } from "applesauce-common/casts";

import { type Link } from "applesauce-content/nast";
import { EventStore } from "applesauce-core";
import { isAudioURL, isImageURL, isVideoURL, kinds } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";

import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

// Setup event store
const eventStore = new EventStore();
const pool = new RelayPool();

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

function LinkRenderer({ node: link }: { node: Link }) {
  if (isImageURL(link.href))
    return (
      <a href={link.href} target="_blank">
        <img src={link.href} className="max-h-64 rounded" alt="" />
      </a>
    );
  if (isVideoURL(link.href)) return <video src={link.href} className="max-h-64 rounded" controls />;
  if (isAudioURL(link.href)) return <audio src={link.href} className="rounded" controls />;
  return (
    <a href={link.href} target="_blank" className="text-blue-500 hover:underline">
      {link.value}
    </a>
  );
}

/** Renders the zap request content using the same renderers as the notes/rendering example. */
const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: LinkRenderer,
  mention: ({ node }) => (
    <a href={`https://njump.me/${node.encoded}`} target="_blank" className="text-purple-500 hover:underline">
      @{node.encoded.slice(0, 8)}...
    </a>
  ),
  hashtag: ({ node }) => <span className="text-orange-500">#{node.hashtag}</span>,
  emoji: ({ node }) => <img title={node.raw} src={node.url} className="w-6 h-6 inline align-text-bottom" />,
};

/** A component for rendering user avatars */
function Avatar({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div className="avatar">
      <div className="w-8 rounded-full">
        <img src={profile?.picture ?? `https://robohash.org/${user.pubkey}.png`} />
      </div>
    </div>
  );
}

/** A component for rendering usernames */
function Username({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <>{profile?.displayName ?? profile?.name ?? "unknown"}</>;
}

function ZapEvent({ zap }: { zap: Zap }) {
  const amount = Math.round(zap.amount / 1000); // Convert msats to sats
  const addressPointer = zap.addressPointer ?? undefined;
  const eventPointer = zap.eventPointer ?? undefined;
  const isProfileZap = !addressPointer && !eventPointer;
  const zappedEvent = use$(zap.event$);

  // The zap message lives on the zap request (kind 9734) embedded in the receipt.
  const message = zap.request.content.trim();
  const renderedMessage = useRenderedContent(zap.request, components);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <Avatar user={zap.sender} />
        <h2>
          <span className="font-bold">
            <Username user={zap.sender} />
          </span>
          <span> zapped </span>
          {isProfileZap && (
            <>
              <span className="font-bold">
                <Username user={zap.recipient} />
              </span>{" "}
            </>
          )}
          <span className="text-warning font-bold">{amount} sats</span>
        </h2>
        <time className="ms-auto text-sm text-gray-500">{new Date(zap.event.created_at * 1000).toLocaleString()}</time>
      </div>

      {message && (
        <div className="whitespace-pre-wrap border-l-4 border-warning ps-3 py-1 text-sm">{renderedMessage}</div>
      )}

      {isProfileZap ? (
        <div className="border border-base-300  bg-base-100 ">
          <div className="p-4">
            <div className="flex items-center gap-4">
              <Avatar user={zap.recipient} />
              <div className="flex flex-col">
                <h2 className="font-semibold">
                  <Username user={zap.recipient} />
                </h2>
                <span className="text-sm text-gray-500">Profile zap</span>
              </div>
            </div>
          </div>
        </div>
      ) : zappedEvent ? (
        <div className="border border-base-300  bg-base-100 ">
          <div className="p-4">
            <div className="flex items-center gap-4">
              <Avatar user={castUser(zappedEvent.pubkey, eventStore)} />
              <h2 className="font-semibold">
                <Username user={castUser(zappedEvent.pubkey, eventStore)} />
              </h2>
            </div>
            <p>{zappedEvent.content}</p>
          </div>
        </div>
      ) : addressPointer ? (
        <div className="border border-base-300  bg-base-200  opacity-50">
          <div className="p-4">
            <div className="flex items-center gap-4">
              <span className="loading loading-dots loading-lg" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-mono">
                  Loading address: {addressPointer.kind}:{addressPointer.pubkey.slice(0, 8)}…:
                  {addressPointer.identifier}
                </p>
                {addressPointer.relays && addressPointer.relays.length > 0 && (
                  <p className="text-sm text-gray-500">Checking relays: {addressPointer.relays.join(", ")}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-base-300  bg-base-200  opacity-50">
          <div className="p-4">
            <div className="flex items-center gap-4">
              <span className="loading loading-dots loading-lg" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-mono">Loading event: {eventPointer!.id}</p>
                {eventPointer!.relays && eventPointer!.relays.length > 0 && (
                  <p className="text-sm text-gray-500">Checking relays: {eventPointer!.relays.join(", ")}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ZapsTimeline() {
  const [relay, setRelay] = useState<string>("wss://relay.primal.net/");

  const feed$ = useMemo(
    () =>
      relayTimeline(eventStore, pool, [relay], { kinds: [kinds.Zap] }).pipe(
        shareReplay({ bufferSize: 1, refCount: true }),
      ),
    [relay],
  );
  const feed = use$(feed$);
  const zaps = use$(
    () =>
      feed$.pipe(
        map((state) => state.events),
        castTimelineStream(Zap, eventStore),
      ),
    [feed$],
  );

  return (
    <div className="container mx-auto p-2 h-full max-w-4xl">
      <div className="flex gap-2 mb-4">
        {feed?.status === "loading" && <p role="status">Loading…</p>}
        {feed?.errors.map((error) => (
          <p key={error} role="alert" className="text-error">
            {error}
          </p>
        ))}
        <RelayPicker value={relay} onChange={(next: typeof relay) => setRelay(next)} />
      </div>

      <div className="flex flex-col gap-4">
        {zaps?.map((zap) => (
          <ZapEvent key={zap.event.id} zap={zap} />
        ))}
      </div>
    </div>
  );
}
