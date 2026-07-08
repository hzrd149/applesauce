/**
 * Load and unlock the logged-in user's saved Concord community list without creating a ConcordClient.
 * @tags concord, communities, casts, encryption, nip-44
 * @related concord/getting-started, concord/chat, concord/admin
 */
import { BehaviorSubject, EventStore } from "applesauce-core";
import { castUser } from "applesauce-core/casts";
import { relaySet } from "applesauce-core/helpers";
import {
  COMMUNITY_LIST_KIND,
  STOCK_RELAYS,
  type CommunityListCommunity,
  type CommunityTombstone,
} from "applesauce-extra/concord";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";
import { combineLatest, map, of, switchMap } from "rxjs";

import "applesauce-extra/concord/casts/index";
import LoginView from "../../components/login-view";

const eventStore = new EventStore();
const pool = new RelayPool();
const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));
const extraRelays$ = new BehaviorSubject(STOCK_RELAYS.join("\n"));

const extraRelayList$ = extraRelays$.pipe(
  map((text) =>
    text
      .split(/\n|,/)
      .map((relay) => relay.trim())
      .filter(Boolean),
  ),
);

const outboxes$ = user$.pipe(switchMap((user) => user?.outboxes$ ?? of(undefined)));

const loadRelays$ = combineLatest([outboxes$, extraRelayList$]).pipe(
  map(([outboxes, extraRelayList]) => relaySet(outboxes, extraRelayList)),
);

const loader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays: LOOKUP_RELAYS,
  extraRelays: extraRelayList$,
});

function shortId(id: string) {
  return id.slice(0, 8) + "..." + id.slice(-8);
}

function CommunityCard({ community }: { community: CommunityListCommunity }) {
  const relays = community.current.relays.length ? community.current.relays : ["No relays saved"];

  return (
    <div className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-64">
          <h3 className="font-semibold text-lg">{community.current.name || "Unnamed community"}</h3>
          <code className="text-xs opacity-70 break-all">{community.community_id}</code>
        </div>
        <span className="badge badge-outline">epoch {community.current.root_epoch}</span>
        <span className="badge badge-outline">{community.current.channels.length} channel keys</span>
      </div>

      <div className="grid md:grid-cols-2 gap-3 text-sm">
        <div>
          <div className="font-medium">Owner</div>
          <code className="break-all opacity-70">{nip19.npubEncode(community.current.owner)}</code>
        </div>
        <div>
          <div className="font-medium">Added</div>
          <span className="opacity-70">{new Date(community.added_at).toLocaleString()}</span>
        </div>
      </div>

      <div>
        <div className="font-medium text-sm mb-1">Relays</div>
        <div className="flex flex-wrap gap-2">
          {relays.map((relay) => (
            <span key={relay} className="badge badge-ghost font-mono">
              {relay}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConcordCommunityList() {
  const signer = use$(signer$);
  const user = use$(user$);
  const extraRelays = use$(extraRelays$);
  const loadRelays = use$(loadRelays$);
  const outboxes = use$(outboxes$);

  const communityList = use$(() => user?.concordCommunityList$, [user]);
  const [unlocked, setUnlocked] = useState<{
    communities: CommunityListCommunity[];
    tombstones: CommunityTombstone[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveCommunities = communityList?.liveCommunities ?? [];

  useEffect(() => {
    if (!user || !loadRelays) return;

    setLoading(true);
    setError(null);
    setUnlocked(null);

    const subscription = loader({ kind: COMMUNITY_LIST_KIND, pubkey: user.pubkey, relays: loadRelays }).subscribe({
      error: (err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load community list");
        setLoading(false);
      },
      complete: () => setLoading(false),
    });

    return () => subscription.unsubscribe();
  }, [user?.pubkey, loadRelays]);

  async function unlockList() {
    if (!communityList || !signer) return;
    if (!signer.nip44) {
      setError("This signer does not support NIP-44 decryption.");
      return;
    }

    setUnlocking(true);
    setError(null);

    try {
      setUnlocked(await communityList.unlock(signer));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock community list");
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="container mx-auto max-w-5xl p-4 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Concord community list</h1>
        <p className="opacity-70">
          Subscribe to the User cast while the EventStore loader fetches the encrypted kind {COMMUNITY_LIST_KIND} list
          from outbox and extra relays.
        </p>
      </div>

      {error && <div className="alert alert-error py-2">{error}</div>}

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold flex-1">Extra relays</h2>
          <span className="badge badge-outline">{user ? shortId(user.pubkey) : "..."}</span>
        </div>
        <textarea
          className="textarea textarea-bordered font-mono text-sm"
          rows={5}
          value={extraRelays ?? ""}
          onChange={(e) => extraRelays$.next(e.target.value)}
        />
        <div className="text-sm opacity-70">
          The loader also uses {outboxes?.length ?? 0} outbox relay{outboxes?.length === 1 ? "" : "s"} from the user's
          NIP-65 mailbox list.
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled>
            {loading ? "Loading list event..." : communityList ? "List event loaded" : "Waiting for list event"}
          </button>
          <button className="btn btn-secondary" onClick={unlockList} disabled={!communityList || unlocking}>
            {unlocking ? "Unlocking..." : communityList?.unlocked ? "Read unlocked list" : "Unlock list"}
          </button>
        </div>
      </section>

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-2">
        <h2 className="font-bold">List status</h2>
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-outline">event {communityList ? "loaded" : "missing"}</span>
          <span className="badge badge-outline">content {communityList?.unlocked ? "unlocked" : "locked"}</span>
          {unlocked && <span className="badge badge-outline">{unlocked.communities.length} saved communities</span>}
          {unlocked && <span className="badge badge-outline">{unlocked.tombstones.length} tombstones</span>}
        </div>
        {communityList && <code className="text-xs break-all opacity-70">{communityList.id}</code>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">Live communities</h2>
        {!communityList && <p className="opacity-70">Load your list event first.</p>}
        {communityList && !communityList.unlocked && (
          <p className="opacity-70">Unlock the list to derive live memberships.</p>
        )}
        {communityList?.unlocked && liveCommunities.length === 0 && (
          <p className="opacity-70">No live Concord communities are saved in this list.</p>
        )}
        {liveCommunities.map((community) => (
          <CommunityCard key={community.community_id} community={community} />
        ))}
      </section>
    </div>
  );
}

export default function ConcordCommunityListExample() {
  const signer = use$(signer$);
  const user = use$(user$);

  if (!signer || !user) {
    return (
      <LoginView
        onLogin={(newSigner, newPubkey) => {
          signer$.next(newSigner);
          pubkey$.next(newPubkey);
        }}
      />
    );
  }

  return <ConcordCommunityList />;
}
