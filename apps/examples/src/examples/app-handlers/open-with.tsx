/**
 * Resolve the apps your follows trust to open any nostr address, using NIP-89 recommendations
 * @tags nip-89, nip-19, app-handlers, recommendations, links
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
  EventPointer,
  isAddressPointer,
  isEventPointer,
  kinds,
  ProfilePointer,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useRef, useState } from "react";
import { catchError, distinctUntilChanged, endWith, ignoreElements, map, Observable, of, startWith } from "rxjs";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";

type Pointer = AddressPointer | EventPointer | ProfilePointer;
type LoadState = { status: "loading" | "done" } | { status: "error"; message: string };

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
const PLATFORMS: HandlerLinkPlatform[] = ["web", "ios", "android"];
const EXAMPLE = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";

const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

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
function loadHandlers(relays: string[], kind: number, authors?: string[]): Observable<LoadState> {
  const filters = [getAppHandlersFilter(kind), getAppRecommendationsFilter(kind, authors)];
  return pool.request(relays, filters).pipe(
    mapEventsToStore(eventStore),
    ignoreElements(),
    endWith<LoadState>({ status: "done" }),
    startWith<LoadState>({ status: "loading" }),
    catchError((error) => of<LoadState>({ status: "error", message: String(error?.message ?? error) })),
  );
}

function RecommenderAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  const name = profile?.displayName || pubkey.slice(0, 8);
  return (
    <img
      src={profile?.picture || `https://robohash.org/${pubkey}.png`}
      alt={name}
      title={name}
      className="h-6 w-6 rounded-full border border-base-100 object-cover"
    />
  );
}

/** A compact stack of the users that recommend an app */
function RecommendedBy({ pubkeys }: { pubkeys: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {pubkeys.slice(0, 5).map((p) => (
          <RecommenderAvatar key={p} pubkey={p} />
        ))}
      </div>
      <span className="text-sm text-base-content/60">
        Recommended by {pubkeys.length} {pubkeys.length === 1 ? "person" : "people"}
      </span>
    </div>
  );
}

function HandlerRow({
  handler,
  pointer,
  platform,
  recommenders,
}: {
  handler: AppHandler;
  pointer: Pointer;
  platform: HandlerLinkPlatform;
  recommenders?: string[];
}) {
  // Falls back to the author's profile when the handler has no metadata of its own
  const metadata = use$(handler.metadata$);
  const name = metadata?.display_name || metadata?.name || handler.name;
  const link = handler.link(pointer, platform);

  return (
    <div className="flex items-center gap-3 p-3 border-b border-base-300">
      <img
        src={metadata?.picture || `https://robohash.org/${handler.event.pubkey}.png`}
        alt={name}
        className="w-10 h-10 rounded object-cover shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{name}</div>
        {recommenders && <RecommendedBy pubkeys={recommenders} />}
      </div>
      {link ? (
        <a className="btn btn-primary btn-sm" href={link} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : (
        <span className="text-sm text-base-content/60">No {platform} link</span>
      )}
    </div>
  );
}

function Handlers({
  pointer,
  relays,
  pubkey,
  platform,
}: {
  pointer: Pointer;
  relays: string[];
  pubkey?: string;
  platform: HandlerLinkPlatform;
}) {
  const kind = use$(() => pointerKind$(pointer), [pointer]);

  // The user and their follows, joined into a string so the streams below only resubscribe when the set changes.
  // An empty key means trust recommendations from anyone
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
    () => (kind === undefined ? undefined : loadHandlers(relays, kind, authors)),
    [relays.join(","), kind, authors],
  );
  // Handlers ranked by how many of the authors recommend each
  const recommended = use$(
    () =>
      kind === undefined
        ? undefined
        : eventStore.model(RecommendedAppHandlersModel, kind, authors).pipe(
            map((ranked) =>
              ranked.map((r) => ({
                handler: castEvent(r.handler, AppHandler, eventStore),
                recommenders: r.recommenders,
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

  const loading = kind === undefined || state?.status === "loading";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {state?.status === "error" && <p className="p-3 text-error">Failed to load apps: {state.message}</p>}

      <h3 className="flex items-center gap-2 px-3 pt-3 font-semibold">
        {pubkey ? "Trusted by you and your follows" : "Recommended by anyone"}
        {loading && <span className="loading loading-spinner loading-sm" />}
      </h3>
      {recommended?.length ? (
        recommended.map(({ handler, recommenders }) => (
          <HandlerRow
            key={handler.uid}
            handler={handler}
            pointer={pointer}
            platform={platform}
            recommenders={recommenders}
          />
        ))
      ) : (
        <p className="p-3 text-base-content/60">{loading ? "Looking for apps..." : "No recommendations found."}</p>
      )}

      {others && others.length > 0 && (
        <>
          <h3 className="px-3 pt-6 font-semibold">Other apps</h3>
          <p className="px-3 text-sm text-base-content/60">Not recommended by anyone you trust.</p>
          {others.map((h) => (
            <HandlerRow key={h.uid} handler={h} pointer={pointer} platform={platform} />
          ))}
        </>
      )}
    </div>
  );
}

export default function OpenWith() {
  const [input, setInput] = useState(EXAMPLE);
  const [platform, setPlatform] = useState<HandlerLinkPlatform>("web");
  const [pubkey, setPubkey] = useState<string>();
  const login = useRef<HTMLDialogElement>(null);
  const { pointer, error } = useMemo(() => parseEntity(input), [input]);

  // Read from the user's outbox relays once they log in, otherwise from a few popular relays
  const relays = use$(
    () =>
      pubkey
        ? castUser(pubkey, eventStore).outboxes$.pipe(map((o) => o && (o.length ? o : FALLBACK_RELAYS)))
        : of(FALLBACK_RELAYS),
    [pubkey],
  );

  return (
    <div className="flex flex-col min-h-0 grow">
      <div className="flex flex-wrap gap-2 p-3 border-b border-base-300">
        <input
          type="text"
          className="input input-bordered flex-1 min-w-64"
          placeholder="Paste an npub, nprofile, note, nevent or naddr"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <select
          className="select select-bordered w-auto"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as HandlerLinkPlatform)}
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
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
      {pointer && !relays ? (
        <div className="flex items-center gap-2 p-3">
          <span className="loading loading-spinner loading-sm" /> Loading your outbox relays...
        </div>
      ) : pointer && relays ? (
        <Handlers pointer={pointer} relays={relays} pubkey={pubkey} platform={platform} />
      ) : (
        !error && <p className="p-3">Paste a nostr address to find apps that can open it.</p>
      )}

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
