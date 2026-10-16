/**
 * Find apps that can open event kinds this client doesn't render, using NIP-89 recommendations from your follows
 * @tags nip-89, nip-19, nip-31, app-handlers, recommendations, links
 * @related app-handlers/recommendations, app-handlers/publisher
 */
import { AppHandler, castUser } from "applesauce-common/casts";
import { getAppHandlersFilter, getAppRecommendationsFilter, HandlerLinkPlatform } from "applesauce-common/helpers";
import { AppHandlersModel, RecommendedAppHandlersModel } from "applesauce-common/models";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { castEvent } from "applesauce-core/casts";
import {
  AddressPointer,
  decodePointer,
  encodePointer,
  EventPointer,
  getAddressPointerForEvent,
  getEventPointerForEvent,
  getTagValue,
  isAddressableKind,
  isAddressPointer,
  isEventPointer,
  kinds,
  NostrEvent,
  ProfilePointer,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useRef, useState } from "react";
import { catchError, distinctUntilChanged, endWith, ignoreElements, map, Observable, of, startWith } from "rxjs";
import LoginView from "../../components/login-view";
import RelayPicker from "../../components/relay-picker";
import { relayTimeline } from "../../extra/relay-timeline";
import { lookupRelays$ } from "../../settings";

type Pointer = AddressPointer | EventPointer | ProfilePointer;
type LoadState = { status: "loading" | "done" } | { status: "error"; message: string };

const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Kinds a social client typically can't render, so the feed shows events that need another app
const FEED_KINDS = [20, 21, 1063, 9802, 30023, 30311, 30402, 30617, 31922, 31923, 34235, 34550, 31337];
const PLATFORMS: HandlerLinkPlatform[] = ["web", "ios", "android"];

/** Parses a pasted NIP-19 entity into a pointer */
function parseEntity(input: string): { pointer?: Pointer; error?: string } {
  const value = input.trim().replace(/^nostr:/, "");
  if (!value) return {};
  try {
    const decoded = decodePointer(value);
    switch (decoded.type) {
      case "naddr":
      case "nevent":
      case "nprofile":
        return { pointer: decoded.data };
      case "note":
        return { pointer: { id: decoded.data } };
      case "npub":
        return { pointer: { pubkey: decoded.data } };
      default:
        return { error: `Unsupported entity type: ${decoded.type}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Returns the event kind a pointer resolves to, loading the event when a nevent has no kind */
function pointerKind$(pointer: Pointer): Observable<number | undefined> {
  if (isAddressPointer(pointer)) return of(pointer.kind);
  if (isEventPointer(pointer))
    return pointer.kind !== undefined ? of(pointer.kind) : eventStore.event(pointer).pipe(map((e) => e?.kind));
  return of(kinds.Metadata);
}

/** Requests handlers and recommendations for a kind into the store and reports the request status */
function loadHandlers(relay: string, kind: number, authors?: string[]): Observable<LoadState> {
  const filters = [getAppHandlersFilter(kind), getAppRecommendationsFilter(kind, authors)];
  return pool.request([relay], filters).pipe(
    mapEventsToStore(eventStore),
    ignoreElements(),
    endWith<LoadState>({ status: "done" }),
    startWith<LoadState>({ status: "loading" }),
    catchError((error) => of<LoadState>({ status: "error", message: String(error?.message ?? error) })),
  );
}

function FeedRow({ event, selected, onSelect }: { event: NostrEvent; selected: boolean; onSelect: () => void }) {
  const profile = use$(() => castUser(event.pubkey, eventStore).profile$, [event.pubkey]);
  return (
    <button
      className={`block w-full text-left p-3 border-b border-base-300 hover:bg-base-200 ${selected ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      <div className="flex justify-between gap-2">
        <span className="font-semibold truncate">{profile?.displayName ?? event.pubkey.slice(0, 8)}</span>
        <span className="badge badge-outline">kind {event.kind}</span>
      </div>
      <p className="text-sm text-base-content/70 line-clamp-2">{getTagValue(event, "alt") ?? "No alt description"}</p>
    </button>
  );
}

function Feed({ relay, selected, onSelect }: { relay: string; selected: string; onSelect: (entity: string) => void }) {
  const feed = use$(() => relayTimeline(eventStore, pool, [relay], { kinds: FEED_KINDS, limit: 50 }), [relay]);

  if (!feed || (feed.status === "loading" && feed.events.length === 0))
    return <div className="loading loading-spinner m-4" />;
  if (feed.errors.length > 0 && feed.events.length === 0)
    return <p className="p-3 text-error">Failed to load feed: {feed.errors.join(", ")}</p>;
  if (feed.events.length === 0) return <p className="p-3">No unsupported events found on this relay.</p>;

  return (
    <>
      {feed.events.map((event) => {
        const pointer = isAddressableKind(event.kind)
          ? getAddressPointerForEvent(event, [relay])!
          : getEventPointerForEvent(event, [relay]);
        const entity = encodePointer(pointer);
        return (
          <FeedRow key={event.id} event={event} selected={entity === selected} onSelect={() => onSelect(entity)} />
        );
      })}
    </>
  );
}

function HandlerRow({
  handler,
  pointer,
  platform,
  count,
  untrusted,
}: {
  handler: AppHandler;
  pointer: Pointer;
  platform: HandlerLinkPlatform;
  count?: number;
  untrusted?: boolean;
}) {
  // Falls back to the author's kind:0 profile when the handler has no metadata of its own
  const metadata = use$(handler.metadata$);
  const name = metadata?.display_name || metadata?.name || handler.name;
  const link = handler.link(pointer, platform);
  const usingWebFallback = !!link && !handler.platforms.includes(platform);

  return (
    <div className="flex gap-3 p-3 border-b border-base-300">
      <img
        src={metadata?.picture || `https://robohash.org/${handler.event.pubkey}.png`}
        alt={name}
        className="w-12 h-12 rounded object-cover shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{name}</span>
          {count !== undefined && <span className="badge badge-success badge-outline">recommended by {count}</span>}
          {untrusted && <span className="badge badge-warning badge-outline">unverified</span>}
        </div>
        {metadata?.about && <p className="text-sm line-clamp-2">{metadata.about}</p>}
        <p className="text-sm text-base-content/60">Kinds: {handler.supportedKinds.join(", ")}</p>
        {usingWebFallback && <p className="text-sm text-base-content/60">No {platform} link, using web</p>}
      </div>
      {link ? (
        <a className="btn btn-primary btn-sm self-center" href={link} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : (
        <span className="text-sm text-error self-center">No link</span>
      )}
    </div>
  );
}

function Handlers({ pointer, relay, pubkey }: { pointer: Pointer; relay: string; pubkey?: string }) {
  const [platform, setPlatform] = useState<HandlerLinkPlatform>("web");
  const kind = use$(() => pointerKind$(pointer), [pointer]);

  // The user and their follows, joined into a string so the streams below only resubscribe when the set changes.
  // An empty key means trust recommendations from anyone on the relay
  const authorsKey = use$(
    () =>
      pubkey
        ? castUser(pubkey, eventStore).contacts$.pipe(
            map((users) => [pubkey, ...users.map((u) => u.pubkey)].sort().join(",")),
            distinctUntilChanged(),
          )
        : of(""),
    [pubkey],
  );
  const authors = useMemo(() => (authorsKey ? authorsKey.split(",") : undefined), [authorsKey]);

  const state = use$(
    () => (kind === undefined ? undefined : loadHandlers(relay, kind, authors)),
    [relay, kind, authors],
  );
  // Handlers ranked by how many of the authors recommend each
  const recommended = use$(
    () =>
      kind === undefined
        ? undefined
        : eventStore
            .model(RecommendedAppHandlersModel, kind, authors)
            .pipe(
              map((ranked) =>
                ranked.map((r) => ({
                  handler: castEvent(r.handler, AppHandler, eventStore),
                  count: r.recommenders.length,
                })),
              ),
            ),
    [kind, authors],
  );
  const all = use$(
    () =>
      kind === undefined
        ? undefined
        : eventStore.model(AppHandlersModel, kind).pipe(castTimelineStream(AppHandler, eventStore)),
    [kind],
  );

  const others = useMemo(() => {
    const ranked = new Set(recommended?.map((r) => r.handler.uid));
    return all?.filter((h) => !ranked.has(h.uid));
  }, [all, recommended]);

  if (kind === undefined) return <p className="p-3">Loading the event to find its kind...</p>;

  return (
    <div className="flex flex-col min-h-0 grow">
      <div className="flex items-center gap-2 p-3 border-b border-base-300">
        <span className="font-semibold">Apps for kind {kind}</span>
        {state?.status === "loading" && <span className="loading loading-spinner loading-sm" />}
        <select
          className="select select-bordered select-sm ms-auto w-auto"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as HandlerLinkPlatform)}
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {state?.status === "error" && <p className="p-3 text-error">Failed to load handlers: {state.message}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <h3 className="px-3 pt-3 font-semibold">
          {pubkey ? "Recommended by you and your follows" : "Recommended by anyone on this relay"}
        </h3>
        {recommended?.length ? (
          recommended.map(({ handler, count }) => (
            <HandlerRow key={handler.uid} handler={handler} pointer={pointer} platform={platform} count={count} />
          ))
        ) : (
          <p className="p-3 text-base-content/60">
            {state?.status === "loading" ? "Looking for recommendations..." : "No recommendations found."}
          </p>
        )}

        <h3 className="px-3 pt-3 font-semibold">Other handlers</h3>
        <p className="px-3 text-sm text-warning">
          Anyone can publish a handler for any kind, so these are not vetted by anyone you follow.
        </p>
        {others?.length ? (
          others.map((h) => <HandlerRow key={h.uid} handler={h} pointer={pointer} platform={platform} untrusted />)
        ) : (
          <p className="p-3 text-base-content/60">
            {state?.status === "loading" ? "Looking for handlers..." : "No other handlers found."}
          </p>
        )}
      </div>
    </div>
  );
}

export default function OpenWith() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");
  const [input, setInput] = useState("");
  const [pubkey, setPubkey] = useState<string>();
  const login = useRef<HTMLDialogElement>(null);
  const { pointer, error } = useMemo(() => parseEntity(input), [input]);

  return (
    <div className="flex flex-col min-h-0 grow">
      <div className="flex flex-wrap gap-2 p-3 border-b border-base-300">
        <input
          type="text"
          className="input input-bordered flex-1 min-w-64"
          placeholder="Paste an npub, nprofile, note, nevent or naddr, or pick an event"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <RelayPicker value={relay} onChange={setRelay} />
        {pubkey ? (
          <button className="btn" onClick={() => setPubkey(undefined)}>
            Log out
          </button>
        ) : (
          <button className="btn" onClick={() => login.current?.showModal()}>
            Use my follows
          </button>
        )}
      </div>
      {error && <p className="p-3 text-error">{error}</p>}

      <div className="flex min-h-0 grow">
        <div className="w-80 shrink-0 min-h-0 overflow-y-auto border-r border-base-300">
          <Feed relay={relay} selected={input.trim()} onSelect={setInput} />
        </div>
        {pointer ? (
          <Handlers pointer={pointer} relay={relay} pubkey={pubkey} />
        ) : (
          <p className="p-3">Pick an event or paste an entity to find apps that can open it.</p>
        )}
      </div>

      <dialog className="modal" ref={login}>
        <div className="modal-box">
          <LoginView
            onLogin={(_signer, pk) => {
              setPubkey(pk);
              login.current?.close();
            }}
          />
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
