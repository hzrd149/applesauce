/**
 * A simple timeline of NIP-5D napplet manifests with links to open them
 * @tags nip-5d, napplet, feed
 * @related torrent/feed
 */
import { Napplet, User } from "applesauce-common/casts";
import { mergeBlossomServers, NAPPLET_KINDS } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo } from "react";
import { BehaviorSubject } from "rxjs";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

// Load author profiles and Blossom server lists on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

/** Shows the author's avatar and display name from their profile */
function Author({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <img
        className="w-6 h-6 rounded-full shrink-0"
        src={profile?.picture || `https://robohash.org/${user.pubkey}.png`}
        alt=""
      />
      <span className="truncate">{profile?.displayName || user.npub.slice(0, 12)}</span>
    </div>
  );
}

/** Turns a `d` identifier like "my-cool_app" into "My Cool App" */
function prettify(identifier: string) {
  return identifier.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Picks a human friendly title, falling back to the identifier and then the kind */
function getTitle(napplet: Napplet) {
  if (napplet.title) return napplet.title;
  if (napplet.identifier) return prettify(napplet.identifier);
  return napplet.isRoot ? "Untitled napplet" : "Untitled snapshot";
}

/** Resolves the icon blob from the manifest server hints, then the author's Blossom servers */
function NappletIcon({ napplet }: { napplet: Napplet }) {
  const servers = use$(napplet.author.blossomServers$);
  const icon = napplet.icon;
  const server = mergeBlossomServers<string | URL>(napplet.servers, servers)[0];
  const title = getTitle(napplet);

  if (icon && server)
    return <img className="w-12 h-12 rounded shrink-0 object-cover" src={new URL(icon.sha256, server).href} alt="" />;

  return (
    <div className="w-12 h-12 rounded shrink-0 border border-base-300 flex items-center justify-center text-xl font-bold">
      {title[0]}
    </div>
  );
}

function NappletItem({ napplet }: { napplet: Napplet }) {
  // NIP-19 address with relay hints from the author's outboxes
  const address = use$(napplet.address$) ?? napplet.address;

  return (
    <div className="border-b border-base-300 py-3 flex items-start gap-3">
      <NappletIcon napplet={napplet} />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className="font-bold truncate">{getTitle(napplet)}</h3>
          {napplet.isSnapshot && <span className="badge badge-ghost">Snapshot</span>}
        </div>
        {napplet.description && <p className="line-clamp-2">{napplet.description}</p>}
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <Author user={napplet.author} />
          <span className="shrink-0">· {napplet.createdAt.toLocaleDateString()}</span>
          {napplet.source && (
            <a className="link shrink-0" href={napplet.source} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
        </div>
      </div>
      <a
        className="btn btn-primary btn-sm shrink-0"
        href={`https://kehto.github.io/web/paja/?pointer=${address}`}
        target="_blank"
        rel="noreferrer"
      >
        Open
      </a>
    </div>
  );
}

export default function NappletBrowser() {
  const relay$ = useMemo(() => new BehaviorSubject("wss://relay.primal.net/"), []);
  const relay = use$(relay$);

  use$(
    () => pool.relay(relay).subscription({ kinds: NAPPLET_KINDS, limit: 200 }).pipe(mapEventsToStore(eventStore)),
    [relay],
  );

  const napplets = use$(
    () => eventStore.timeline({ kinds: NAPPLET_KINDS }).pipe(castTimelineStream(Napplet, eventStore)),
    [],
  );

  return (
    <div className="max-w-4xl w-full mx-auto my-8 px-4 flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold mb-2">Napplet Timeline</h1>
        <p className="text-base-content/60 mb-4">Sandboxed Nostr web applets (NIP-5D) published as manifest events</p>
        <RelayPicker value={relay} onChange={(url) => relay$.next(url)} />
      </div>

      {napplets === undefined ? (
        <span className="loading loading-spinner loading-lg self-center" />
      ) : napplets.length === 0 ? (
        <p className="text-center py-12 text-base-content/60">No napplets found. Try a different relay.</p>
      ) : (
        <div>
          {napplets.map((napplet) => (
            <NappletItem key={napplet.id} napplet={napplet} />
          ))}
        </div>
      )}
    </div>
  );
}
