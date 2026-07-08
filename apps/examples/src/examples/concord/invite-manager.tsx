/**
 * Mint, inspect, and revoke invite links for your Concord communities — resolving each invite's bundle
 * event (kind 33301) through the reactive concordInviteList$ → bundles$ chain, and unlocking bundles on
 * demand to preview their contents.
 * @tags concord, invites, communities, casts, factories, encryption, nip-44, reactive
 * @related concord/community-list, concord/crypto-history
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { BehaviorSubject, EventStore } from "applesauce-core";
import { castUser } from "applesauce-core/casts";
import { relaySet } from "applesauce-core/helpers";
import { finalizeEvent } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import {
  Casts,
  Factories,
  Helpers,
  type CommunityListCommunity,
  type InviteBundle,
  type InviteListInvite,
} from "applesauce-concord";

const {
  buildInviteLink,
  COMMUNITY_LIST_KIND,
  INVITE_LIST_KIND,
  newInviteToken,
  parseInviteLink,
  STOCK_RELAYS,
} = Helpers;

const { InviteBundleFactory, InviteListFactory } = Factories;

type InviteWithBundle = Casts.InviteWithBundle;
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";
import { combineLatest, map, of, switchMap } from "rxjs";

import "applesauce-concord/casts";
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

// The relays we both load the two lists from and re-publish every mutation to.
const relays$ = combineLatest([outboxes$, extraRelayList$]).pipe(
  map(([outboxes, extraRelayList]) => relaySet(outboxes, extraRelayList)),
);

// Attaching a loader to the store is what lets bundles$ pull each invite's bundle from the network.
const loader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays: LOOKUP_RELAYS,
  extraRelays: extraRelayList$,
});

function shortId(id: string) {
  return id.slice(0, 8) + "…" + id.slice(-8);
}

/** Build an invite bundle straight from a membership's current join material. */
function bundleFromCommunity(community: CommunityListCommunity, creator: string, label: string): InviteBundle {
  return { ...community.current, creator_npub: creator, label: label.trim() || undefined };
}

type InviteStatus = "live" | "revoked" | "loading";

/** One invite row: link, live/revoked state, and an on-demand unlock to inspect the decrypted bundle. */
function InviteRow({
  pair,
  status,
  communityName,
  disabled,
  copied,
  onCopy,
  onRevoke,
}: {
  pair: InviteWithBundle;
  status: InviteStatus;
  communityName: string;
  disabled: boolean;
  copied: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  // Reactive decrypted contents — re-emits when unlock() notifies the bundle event.
  const contents = use$(() => pair.bundle?.bundle$, [pair.bundle]);

  const tone = status === "live" ? "badge-success" : status === "revoked" ? "badge-error" : "badge-ghost";

  // Decrypt the bundle in place with the entry's token; bundle$ then emits the contents.
  function inspect() {
    if (!pair.bundle || pair.bundle.unlocked) return;
    try {
      pair.bundle.unlock(hexToBytes(pair.invite.token));
    } catch {
      /* wrong token or revoked (empty) bundle — nothing to inspect */
    }
  }

  return (
    <div
      className={`border border-base-300 rounded-box p-4 flex flex-col gap-2 ${status === "revoked" ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold flex-1 min-w-0 break-words">{pair.invite.label || communityName}</span>
        <span className={`badge ${tone}`}>{status}</span>
        <code className="text-xs opacity-60">{shortId(pair.invite.community_id)}</code>
      </div>
      <code className="text-xs opacity-70 break-all">{pair.invite.url}</code>

      {contents && (
        <div className="border border-base-300 rounded-box p-3 flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="opacity-60">Community</span> {contents.name || "Unnamed"}
            </span>
            <span>
              <span className="opacity-60">Epoch</span> {contents.root_epoch}
            </span>
            <span>
              <span className="opacity-60">Channel keys</span> {contents.channels.length}
            </span>
            {contents.expires_at && (
              <span>
                <span className="opacity-60">Expires</span> {new Date(contents.expires_at).toLocaleString()}
              </span>
            )}
          </div>
          <div>
            <span className="opacity-60">Owner</span>{" "}
            <code className="break-all">{shortId(nip19.npubEncode(contents.owner))}</code>
          </div>
          <div className="flex flex-wrap gap-1">
            {(contents.relays.length ? contents.relays : ["No relays"]).map((relay) => (
              <span key={relay} className="badge badge-ghost badge-sm font-mono">
                {relay}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {status === "live" && !contents && (
          <button className="btn btn-xs btn-ghost" onClick={inspect} disabled={!pair.bundle}>
            {pair.bundle ? "Inspect" : "Loading bundle…"}
          </button>
        )}
        <button className="btn btn-xs btn-ghost" onClick={onCopy}>
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button
          className="btn btn-xs btn-outline btn-error"
          onClick={onRevoke}
          disabled={disabled || status === "revoked"}
        >
          Revoke
        </button>
      </div>
    </div>
  );
}

function ConcordInviteManager() {
  const signer = use$(signer$);
  const user = use$(user$);
  const extraRelays = use$(extraRelays$);
  const relays = use$(relays$);
  const outboxes = use$(outboxes$);

  const communityList = use$(() => user?.concordCommunityList$, [user]);
  const inviteList = use$(() => user?.concordInviteList$, [user]);

  // The reactive chains: memberships to invite for, and each minted invite paired with its bundle event.
  const communities = use$(() => communityList?.liveCommunities$, [communityList]);
  const invitePairs = use$(() => inviteList?.bundles$, [inviteList]);
  const tombstones = use$(() => inviteList?.tombstones$, [inviteList]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [base, setBase] = useState(() => (typeof window !== "undefined" ? window.location.origin : "https://concord.app"));
  const [copied, setCopied] = useState<string | null>(null);

  // Load both replaceable list events into the store from outbox + extra relays.
  useEffect(() => {
    if (!user || !relays) return;
    setError(null);
    const onError = (err: unknown) => setError(err instanceof Error ? err.message : "Failed to load a list");
    const subs = [
      loader({ kind: COMMUNITY_LIST_KIND, pubkey: user.pubkey, relays }).subscribe({ error: onError }),
      loader({ kind: INVITE_LIST_KIND, pubkey: user.pubkey, relays }).subscribe({ error: onError }),
    ];
    return () => subs.forEach((sub) => sub.unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.pubkey, relays]);

  // Auto-unlock both self-encrypted lists; the reactive observables above re-emit on their own once unlocked.
  useEffect(() => {
    if (!signer?.nip44) return;
    let alive = true;
    for (const list of [communityList, inviteList]) {
      if (list && !list.unlocked)
        list
          .unlock(signer)
          .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to unlock a list"));
    }
    return () => {
      alive = false;
    };
  }, [communityList, inviteList, signer]);

  const revokedTokens = new Set(tombstones?.map((tombstone) => tombstone.token));
  function statusOf(pair: InviteWithBundle): InviteStatus {
    if (revokedTokens.has(pair.invite.token) || pair.bundle?.revoked) return "revoked";
    if (pair.bundle?.live) return "live";
    return "loading";
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((current) => (current === url ? null : current)), 1500);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  // Mint an invite: publish the token-encrypted bundle under a throwaway link_signer key, then record the
  // link into the user's self-encrypted invite list (creating the list on the first invite).
  async function createInvite(community: CommunityListCommunity) {
    if (!signer || !user) return;
    if (!signer.nip44) return setError("This signer does not support NIP-44 encryption.");

    const name = community.current.name || "community";
    setBusy(`Creating invite for ${name}…`);
    setError(null);
    try {
      const token = newInviteToken();
      const linkSk = generateSecretKey();
      const linkPub = getPublicKey(linkSk);
      const bundleRelays = community.current.relays.length ? community.current.relays : (relays ?? STOCK_RELAYS);

      // 1. The bundle event, signed by the throwaway link_signer (not the user).
      const bundle = bundleFromCommunity(community, user.pubkey, labels[community.community_id] ?? "");
      const bundleEvent = finalizeEvent(await InviteBundleFactory.create(bundle, token), linkSk);
      await eventStore.add(bundleEvent);
      await pool.publish(bundleRelays, bundleEvent);

      // 2. The shareable link (naddr of the link_signer + the unlock token in the fragment).
      const url = buildInviteLink(base, linkPub, token, bundleRelays);

      // 3. Record it into the invite list — signer_sk is what lets us revoke the ephemeral bundle later.
      const entry: InviteListInvite = {
        token: bytesToHex(token),
        signer_sk: bytesToHex(linkSk),
        community_id: community.community_id,
        url,
        created_at: Math.floor(Date.now() / 1000),
        label: labels[community.community_id]?.trim() || undefined,
      };
      const listEvent = inviteList?.event;
      const factory = listEvent ? InviteListFactory.modify(listEvent) : InviteListFactory.create();
      const listSigned = await factory.mintInvite(entry).sign(signer);
      await eventStore.add(listSigned);
      if (relays?.length) await pool.publish(relays, listSigned);

      setLabels((current) => ({ ...current, [community.community_id]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setBusy(null);
    }
  }

  // Revoke an invite from both sides: tombstone the bundle (vsk 9, signed by the recovered link key) and
  // tombstone the list entry so the revocation propagates across the user's devices.
  async function revokeInvite(pair: InviteWithBundle) {
    if (!signer || !inviteList) return;
    const { invite } = pair;
    setBusy("Revoking invite…");
    setError(null);
    try {
      // 1. Publish an empty vsk-9 edition at the bundle's coordinate, signed by the stored link_signer key.
      const revocation = finalizeEvent(await InviteBundleFactory.revoke(), hexToBytes(invite.signer_sk));
      await eventStore.add(revocation);
      const bundleRelays = parseInviteLink(invite.url).bootstrapRelays;
      await pool.publish(bundleRelays.length ? bundleRelays : (relays ?? STOCK_RELAYS), revocation);

      // 2. Tombstone the entry in the self-encrypted invite list.
      const listSigned = await InviteListFactory.modify(inviteList.event)
        .revokeInvite(invite.token, invite.community_id)
        .sign(signer);
      await eventStore.add(listSigned);
      if (relays?.length) await pool.publish(relays, listSigned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke invite");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  const communityName = (id: string) =>
    communities?.find((community) => community.community_id === id)?.current.name || shortId(id);

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
          <span className="badge badge-outline">{communityList?.unlocked ? "communities unlocked" : "communities locked"}</span>
          <span className="badge badge-outline">{inviteList?.unlocked ? "invites unlocked" : "invites locked"}</span>
        </div>
        <textarea
          className="textarea textarea-bordered font-mono text-sm"
          rows={3}
          value={extraRelays ?? ""}
          onChange={(e) => extraRelays$.next(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Invite link base</span>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </label>
        <div className="text-sm opacity-70">
          Loading from and publishing to {relays?.length ?? 0} relay{relays?.length === 1 ? "" : "s"} — your{" "}
          {outboxes?.length ?? 0} NIP-65 outbox relay{outboxes?.length === 1 ? "" : "s"} plus the extras above.
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">Your communities</h2>
        {!communityList && (
          <p className="opacity-70">
            No community list found. Join a community in the community-list example first, then come back to invite others.
          </p>
        )}
        {communityList && !communities && <p className="opacity-70">Unlocking your community list…</p>}
        {communities && communities.length === 0 && (
          <p className="opacity-70">
            No live memberships. Join a community in the community-list example first, then come back to invite others.
          </p>
        )}
        {communities && communities.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {communities.map((community) => (
              <div
                key={community.community_id}
                className="border border-base-300 rounded-box p-4 flex flex-col gap-3 h-full"
              >
                <div className="flex items-start gap-2">
                  <h3 className="font-semibold text-lg flex-1 min-w-0 break-words">
                    {community.current.name || "Unnamed community"}
                  </h3>
                  <span className="badge badge-outline whitespace-nowrap">epoch {community.current.root_epoch}</span>
                </div>
                <code className="text-xs opacity-60 break-all">{shortId(community.community_id)}</code>
                <input
                  type="text"
                  className="input input-bordered input-sm"
                  placeholder="Invite label (optional)"
                  value={labels[community.community_id] ?? ""}
                  onChange={(e) => setLabels((current) => ({ ...current, [community.community_id]: e.target.value }))}
                />
                <div className="mt-auto pt-1 flex justify-end">
                  <button className="btn btn-sm btn-primary" onClick={() => createInvite(community)} disabled={disabled}>
                    Create invite
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {busy && <span className="text-sm opacity-70">{busy}</span>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold flex-1">Your invites</h2>
          {invitePairs && <span className="badge badge-outline">{invitePairs.length} total</span>}
        </div>

        {!inviteList && <p className="opacity-70">No invites yet. Create one for a community above.</p>}
        {inviteList && !invitePairs && <p className="opacity-70">Unlocking your invite list…</p>}
        {invitePairs && invitePairs.length === 0 && (
          <p className="opacity-70">No invites yet. Create one for a community above.</p>
        )}
        {invitePairs && invitePairs.length > 0 && (
          <div className="flex flex-col gap-3">
            {invitePairs.map((pair) => (
              <InviteRow
                key={pair.invite.token}
                pair={pair}
                status={statusOf(pair)}
                communityName={communityName(pair.invite.community_id)}
                disabled={disabled}
                copied={copied === pair.invite.url}
                onCopy={() => copyLink(pair.invite.url)}
                onRevoke={() => revokeInvite(pair)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function ConcordInviteManagerExample() {
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

  return <ConcordInviteManager />;
}
