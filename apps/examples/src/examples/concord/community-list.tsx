/**
 * Load and auto-unlock your self-encrypted Concord community list (kind 13302), then join, leave, and
 * re-join communities — rendered off the reactive concordCommunityList$ chain, no ConcordClient.
 * @tags concord, communities, casts, factories, encryption, nip-44, reactive
 * @related concord/invite-manager, concord/crypto-history
 */
import { BehaviorSubject, EventStore } from "applesauce-core";
import { castUser } from "applesauce-core/casts";
import { relaySet } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { type CommunityListCommunity, type JoinMaterial } from "applesauce-concord";

import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useEffect, useMemo, useState } from "react";
import { combineLatest, firstValueFrom, map, of, switchMap, timeout, toArray } from "rxjs";

import "applesauce-concord/casts";
import LoginView from "../../components/login-view";
import { CommunityListFactory } from "applesauce-concord/factories";
import {
  COMMUNITY_LIST_KIND,
  createCommunity,
  decryptBundle,
  INVITE_BUNDLE_KIND,
  parseInviteLink,
  STOCK_RELAYS,
  verifyOwner,
} from "applesauce-concord/helpers";

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

// The relays we both load the list from and re-publish every mutation to.
const relays$ = combineLatest([outboxes$, extraRelayList$]).pipe(
  map(([outboxes, extraRelayList]) => relaySet(outboxes, extraRelayList)),
);

const loader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays: LOOKUP_RELAYS,
  extraRelays: extraRelayList$,
});

function shortId(id: string) {
  return id.slice(0, 8) + "…" + id.slice(-8);
}

/** Build a fresh membership entry from join material (seed == current on a brand new join). */
function entryFromMaterial(material: JoinMaterial): CommunityListCommunity {
  return { community_id: material.community_id, seed: material, current: material, added_at: Date.now() };
}

/** Fetch and decrypt an invite bundle into join material (mirrors ConcordClient.joinByLink). */
async function redeemInvite(url: string): Promise<JoinMaterial> {
  const parsed = parseInviteLink(url.trim());
  const relays = parsed.bootstrapRelays.length ? parsed.bootstrapRelays : STOCK_RELAYS;

  const events = await firstValueFrom(
    pool
      .request(relays, [{ kinds: [INVITE_BUNDLE_KIND], authors: [parsed.linkSigner] }])
      .pipe(toArray(), timeout(10000)),
  ).catch(() => [] as NostrEvent[]);

  // The live bundle is the newest un-revoked edition (vsk 6).
  const live = events
    .filter((e) => (e.tags.find((t) => t[0] === "vsk")?.[1] ?? "6") === "6")
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!live) throw new Error("Invite bundle not found or revoked.");

  const bundle = decryptBundle(live.content, parsed.token);
  const material: JoinMaterial = {
    community_id: bundle.community_id,
    owner: bundle.owner,
    owner_salt: bundle.owner_salt,
    community_root: bundle.community_root,
    root_epoch: bundle.root_epoch,
    channels: bundle.channels ?? [],
    relays: bundle.relays ?? relays,
    name: bundle.name,
  };
  if (!verifyOwner(material)) throw new Error("Invite failed owner verification.");
  if (bundle.expires_at && Date.now() > bundle.expires_at) throw new Error("This invite has expired.");
  return material;
}

function CommunityCard({
  community,
  tone,
  action,
}: {
  community: CommunityListCommunity;
  tone: string;
  action: React.ReactNode;
}) {
  const relays = community.current.relays.length ? community.current.relays : ["No relays saved"];

  return (
    <div className={`border rounded-box p-4 flex flex-col gap-3 h-full ${tone}`}>
      <div className="flex items-start gap-2">
        <h3 className="font-semibold text-lg flex-1 min-w-0 break-words">
          {community.current.name || "Unnamed community"}
        </h3>
        <span className="badge badge-outline whitespace-nowrap">epoch {community.current.root_epoch}</span>
      </div>

      <code className="text-xs opacity-60 break-all">{shortId(community.community_id)}</code>

      <div className="text-sm">
        <div className="font-medium">Owner</div>
        <code className="break-all opacity-70">{shortId(nip19.npubEncode(community.current.owner))}</code>
      </div>

      <div className="text-sm">
        <div className="font-medium">
          Relays <span className="opacity-60">· {community.current.channels.length} channel keys</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {relays.map((relay) => (
            <span key={relay} className="badge badge-ghost badge-sm font-mono">
              {relay}
            </span>
          ))}
        </div>
      </div>

      <div className="text-xs opacity-60">Added {new Date(community.added_at).toLocaleString()}</div>

      <div className="mt-auto pt-1 flex justify-end">{action}</div>
    </div>
  );
}

function ConcordCommunityListManager() {
  const signer = use$(signer$);
  const user = use$(user$);
  const extraRelays = use$(extraRelays$);
  const relays = use$(relays$);
  const outboxes = use$(outboxes$);

  const communityList = use$(() => user?.concordCommunityList$, [user]);

  const [loading, setLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState("");

  // Fetch the replaceable list event into the store from outbox + extra relays.
  useEffect(() => {
    if (!user || !relays) return;

    setLoading(true);
    setError(null);

    const subscription = loader({ kind: COMMUNITY_LIST_KIND, pubkey: user.pubkey, relays }).subscribe({
      error: (err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load community list");
        setLoading(false);
      },
      complete: () => setLoading(false),
    });

    return () => subscription.unsubscribe();
  }, [user?.pubkey, relays]);

  // Auto-unlock the self-encrypted list whenever a locked one arrives. Once unlocked, the reactive
  // communities$/liveCommunities$/tombstones$ observables below re-emit on their own — including after
  // every republish — so there is nothing to manually re-derive here.
  useEffect(() => {
    if (!communityList || communityList.unlocked || !signer?.nip44) return;

    let alive = true;
    setUnlocking(true);
    communityList
      .unlock(signer)
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to unlock community list"))
      .finally(() => alive && setUnlocking(false));

    return () => {
      alive = false;
    };
  }, [communityList, signer]);

  // The reactive chain: user → concordCommunityList$ → communities$ / liveCommunities$ / tombstones$.
  // Each emits `undefined` while locked, then the decrypted arrays once unlock() notifies the event.
  const communities = use$(() => communityList?.communities$, [communityList]);
  const liveCommunities = use$(() => communityList?.liveCommunities$, [communityList]);
  const tombstones = use$(() => communityList?.tombstones$, [communityList]);

  const view = useMemo(() => {
    if (!communities || !liveCommunities || !tombstones) return null;
    const liveIds = new Set(liveCommunities.map((c) => c.community_id));
    // Communities we still hold material for but have left — re-joinable in place.
    const left = communities.filter((c) => !liveIds.has(c.community_id));
    return { communities, tombstones, live: liveCommunities, left };
  }, [communities, liveCommunities, tombstones]);

  // Start a factory that either amends the existing list or creates the user's first one.
  function listFactory() {
    const event = communityList?.event;
    return event ? CommunityListFactory.modify(event) : CommunityListFactory.create();
  }

  // Sign the mutated list, store it, and re-publish the replaceable event to every relay.
  async function publish(build: () => CommunityListFactory, label: string) {
    if (!signer) return;
    if (!signer.nip44) return setError("This signer does not support NIP-44 encryption.");

    setBusy(label);
    setError(null);
    try {
      const signed = await build().sign(signer);
      await eventStore.add(signed);
      if (relays?.length) await pool.publish(relays, signed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish community list");
    } finally {
      setBusy(null);
    }
  }

  function leave(community: CommunityListCommunity) {
    const name = community.current.name || "community";
    publish(() => CommunityListFactory.modify(communityList!.event).leave(community.community_id), `Leaving ${name}…`);
  }

  function rejoin(community: CommunityListCommunity) {
    const name = community.current.name || "community";
    // A join with a fresh added_at post-dates the tombstone and resurrects the membership.
    publish(() => listFactory().join(entryFromMaterial(community.current)), `Re-joining ${name}…`);
  }

  async function joinViaInvite() {
    setBusy("Fetching invite…");
    setError(null);
    let material: JoinMaterial;
    try {
      material = await redeemInvite(inviteLink);
    } catch (err) {
      setBusy(null);
      return setError(err instanceof Error ? err.message : "Failed to redeem invite link");
    }
    await publish(() => listFactory().join(entryFromMaterial(material)), `Joining ${material.name}…`);
    setInviteLink("");
  }

  async function foundDemoCommunity() {
    if (!user) return;
    const extra = (extraRelays ?? "")
      .split(/\n|,/)
      .map((r) => r.trim())
      .filter(Boolean);
    const genesis = await createCommunity({
      ownerPubkey: user.pubkey,
      name: `Demo #${(view?.communities.length ?? 0) + 1}`,
      relays: extra.length ? extra : STOCK_RELAYS,
    });
    await publish(() => listFactory().join(entryFromMaterial(genesis.material)), "Founding demo community…");
  }

  const disabled = busy !== null || unlocking;

  return (
    <div className="w-full p-4 flex flex-col gap-5">
      {error && (
        <div className="alert alert-error py-2">
          <span>{error}</span>
          <button className="btn btn-xs btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold flex-1">Relays</h2>
          <span className="badge badge-outline">{user ? shortId(user.pubkey) : "…"}</span>
          <span className="badge badge-outline">
            {loading ? "loading" : communityList ? "list loaded" : "no list yet"}
          </span>
          <span className="badge badge-outline">
            {unlocking ? "unlocking" : communityList?.unlocked ? "unlocked" : "locked"}
          </span>
        </div>
        <textarea
          className="textarea textarea-bordered font-mono text-sm"
          rows={4}
          value={extraRelays ?? ""}
          onChange={(e) => extraRelays$.next(e.target.value)}
        />
        <div className="text-sm opacity-70">
          Loading from and publishing to {relays?.length ?? 0} relay{relays?.length === 1 ? "" : "s"} — your{" "}
          {outboxes?.length ?? 0} NIP-65 outbox relay{outboxes?.length === 1 ? "" : "s"} plus the extras above.
        </div>
      </section>

      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <h2 className="font-bold">Join a community</h2>
        <p className="text-sm opacity-70">
          Paste a Concord invite link to fetch its bundle, verify the owner proof, and add the membership.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            className="input input-bordered font-mono text-sm flex-1 min-w-64"
            placeholder="https://…/invite/naddr1…#…"
            value={inviteLink}
            onChange={(e) => setInviteLink(e.target.value)}
          />
          <button className="btn btn-primary" onClick={joinViaInvite} disabled={disabled || !inviteLink.trim()}>
            Join via invite
          </button>
          <button
            className="btn btn-ghost"
            onClick={foundDemoCommunity}
            disabled={disabled}
            title="Found a throwaway community to try the leave / re-join flow"
          >
            Found demo community
          </button>
        </div>
        {busy && <span className="text-sm opacity-70">{busy}</span>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold flex-1">Joined communities</h2>
          {view && <span className="badge badge-outline">{view.live.length} live</span>}
          {view && <span className="badge badge-outline">{view.tombstones.length} tombstones</span>}
        </div>

        {!communityList && <p className="opacity-70">Loading your list event…</p>}
        {communityList && !communityList.unlocked && <p className="opacity-70">Unlocking the encrypted list…</p>}
        {view && view.live.length === 0 && (
          <p className="opacity-70">No live memberships. Redeem an invite link above to get started.</p>
        )}
        {view && view.live.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {view.live.map((community) => (
              <CommunityCard
                key={community.community_id}
                community={community}
                tone="border-base-300"
                action={
                  <button
                    className="btn btn-sm btn-outline btn-error"
                    onClick={() => leave(community)}
                    disabled={disabled}
                  >
                    Leave
                  </button>
                }
              />
            ))}
          </div>
        )}
      </section>

      {view && view.left.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-bold">Left communities</h2>
          <p className="text-sm opacity-70">
            Tombstoned memberships you still hold material for — re-joining resurrects them in the list.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {view.left.map((community) => (
              <CommunityCard
                key={community.community_id}
                community={community}
                tone="border-base-300 opacity-70"
                action={
                  <button
                    className="btn btn-sm btn-outline btn-success"
                    onClick={() => rejoin(community)}
                    disabled={disabled}
                  >
                    Re-join
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}
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

  return <ConcordCommunityListManager />;
}
