/**
 * Mint and revoke invite links for your Concord communities through the high-level ConcordClient: the
 * engine owns the private kind-13303 Invite List (client.invites), so creating a link publishes the
 * bundle, registers it in the community, and records it into your encrypted list in one call — gated
 * on the CREATE_INVITE permission you actually hold in each community.
 * @tags concord, invites, communities, roles, permissions, client, reactive
 * @related concord/admin-management, concord/community-list, concord/direct-invites
 */
import { EventStore } from "applesauce-core";
import { ConcordClient, Helpers, PERM, Storage, type CommunityState, type ConcordInviteLink } from "applesauce-concord";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useEffect, useMemo, useState } from "react";
import LoginView from "../../components/login-view";

const { STOCK_RELAYS, permNames } = Helpers;

const eventStore = new EventStore();
const pool = new RelayPool();
const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];

// Attach a loader so casts (profiles, the encrypted lists) can pull events from the network.
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: LOOKUP_RELAYS,
  extraRelays: STOCK_RELAYS,
});

function shortId(id: string) {
  return id.slice(0, 8) + "…" + id.slice(-8);
}

function communityName(state: CommunityState) {
  return state.metadata?.name || state.material.name || shortId(state.material.community_id);
}

/** The selected community: your standing, a permission-gated invite minter, and that community's invites. */
function CommunityPanel({
  client,
  state,
  onError,
}: {
  client: ConcordClient;
  state: CommunityState;
  onError: (message: string) => void;
}) {
  const community = client.getCommunity(state.material.community_id);
  // Reactive authority: a role grant that flips CREATE_INVITE re-enables the button on its own.
  const standing = use$(() => community?.standing$(community.pubkey), [community]);
  const canInvite = use$(() => community?.can$(PERM.CREATE_INVITE), [community]) ?? false;
  const status = use$(() => community?.status$, [community]);
  // Only this community's invites, re-emitting as the list changes.
  const entries = use$(() => client.invites.entries$, [client]) ?? [];
  const invites = entries.filter((invite) => invite.communityId === state.material.community_id);

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function createInvite() {
    setBusy(true);
    onError("");
    try {
      // One call: mints + publishes the bundle, registers the link (CORD-05 §5), and records it into
      // your encrypted kind-13303 Invite List. base is where the shareable /invite/ link is rooted.
      await client.invites.create(state.material.community_id, {
        base: typeof window !== "undefined" ? window.location.origin : "https://concord.app",
        label: label.trim() || undefined,
      });
      setLabel("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  }

  const perms = standing ? permNames(standing.permissions).map((name) => name.replace(/_/g, " ")) : [];

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-base-300 rounded-box p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <h2 className="font-semibold text-lg flex-1 min-w-0 break-words">{communityName(state)}</h2>
          <span className="badge badge-outline whitespace-nowrap">
            epoch {status?.epoch ?? state.material.root_epoch}
          </span>
        </div>
        <code className="text-xs opacity-60 break-all">{shortId(state.material.community_id)}</code>

        <div className="text-sm">
          <span className="opacity-60">You</span>{" "}
          {standing?.isOwner ? "Owner" : standing ? `position ${standing.position}` : "…"}
          <div className="mt-1 flex flex-wrap gap-1">
            {perms.length ? (
              perms.map((name) => (
                <span key={name} className="badge badge-outline badge-sm">
                  {name}
                </span>
              ))
            ) : (
              <span className="opacity-60">No permissions</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            className="input input-bordered input-sm flex-1"
            placeholder="Invite label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={!canInvite}
          />
          <button className="btn btn-sm btn-primary" onClick={createInvite} disabled={!canInvite || busy}>
            {busy ? "Creating…" : canInvite ? "Create invite" : "Need CREATE_INVITE"}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold flex-1">Invites</h3>
          <span className="badge badge-outline">{invites.length} total</span>
        </div>
        {invites.length === 0 && <p className="opacity-70">No invites for this community yet. Create one above.</p>}
        {invites.length > 0 && (
          <div className="flex flex-col gap-3">
            {invites.map((invite) => (
              <InviteRow
                key={invite.token}
                client={client}
                invite={invite}
                name={communityName(state)}
                onError={onError}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type InviteState = "live" | "expired" | "revoked";

function inviteState(invite: ConcordInviteLink): InviteState {
  if (invite.revoked) return "revoked";
  if (invite.expiresAt && Date.now() > invite.expiresAt) return "expired";
  return "live";
}

/** One invite row from the client's structured Invite List record. */
function InviteRow({
  client,
  invite,
  name,
  onError,
}: {
  client: ConcordClient;
  invite: ConcordInviteLink;
  name: string;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const state = inviteState(invite);
  const tone = state === "live" ? "badge-success" : state === "revoked" ? "badge-error" : "badge-warning";

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError("Could not copy to clipboard.");
    }
  }

  async function revoke() {
    setBusy(true);
    onError("");
    try {
      // Revokes the bundle (empty vsk-9 edition under the stored link key), unregisters the link, and
      // tombstones the entry in your encrypted list — all keyed off the token.
      await client.invites.revoke(invite.token);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to revoke invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`border border-base-300 rounded-box p-4 flex flex-col gap-2 ${state === "revoked" ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold flex-1 min-w-0 break-words">{invite.label || name}</span>
        <span className={`badge ${tone}`}>{state}</span>
        <code className="text-xs opacity-60">{shortId(invite.communityId)}</code>
      </div>
      <code className="text-xs opacity-70 break-all">{invite.url}</code>
      {invite.expiresAt && (
        <span className="text-xs opacity-60">Expires {new Date(invite.expiresAt).toLocaleString()}</span>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn btn-xs btn-ghost" onClick={copy}>
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button className="btn btn-xs btn-outline btn-error" onClick={revoke} disabled={busy || state === "revoked"}>
          {busy ? "Revoking…" : "Revoke"}
        </button>
      </div>
    </div>
  );
}

/** Invites whose community you are not currently a member of — left communities or ones not yet synced.
 *  Revoke still works: the manager kills the bundle straight from the stored link key, skipping the
 *  community registry cleanup (which only holds public link coordinates and isn't reachable anyway). */
function OrphanPanel({
  client,
  invites,
  onError,
}: {
  client: ConcordClient;
  invites: ConcordInviteLink[];
  onError: (message: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm opacity-70">
        Invites for communities you have left or that have not synced. Revoking cleans up the link and removes it from
        your list.
      </p>
      {invites.map((invite) => (
        <InviteRow
          key={invite.token}
          client={client}
          invite={invite}
          name={shortId(invite.communityId)}
          onError={onError}
        />
      ))}
    </div>
  );
}

// Sentinel tab id for the "not in any current community" bucket.
const OTHER_TAB = "__other__";

function InviteManager({ signer }: { signer: ISigner }) {
  const [client, setClient] = useState<ConcordClient | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const next = new ConcordClient({
      signer,
      pool,
      eventStore,
      storage: Storage.memoryStorage(),
      relays: STOCK_RELAYS,
      // Auto-unlock the community + invite lists so memberships sync and saved invites appear without a
      // manual unlock step; the direct-invite inbox isn't needed here.
      autoUnlock: true,
      watchDirectInvites: false,
    });
    setClient(next);
    void next.start();
    return () => next.stop();
  }, [signer]);

  const status = use$(() => client?.status$, [client]);
  const communities = use$(() => client?.communities$, [client]) ?? [];
  const inviteList = use$(() => client?.inviteList$, [client]);
  const [selected, setSelected] = useState("");

  const live = useMemo(() => communities.filter((state) => !state.dissolved), [communities]);
  const entries = use$(() => client?.invites.entries$, [client]) ?? [];
  // Track invite counts per community so the tabs can badge them.
  const countById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const invite of entries) counts.set(invite.communityId, (counts.get(invite.communityId) ?? 0) + 1);
    return counts;
  }, [entries]);
  // Invites for communities the user is not currently in (left, or not yet synced).
  const orphans = useMemo(() => {
    const liveIds = new Set(live.map((state) => state.material.community_id));
    return entries.filter((invite) => !liveIds.has(invite.communityId));
  }, [entries, live]);

  const hasTabs = live.length > 0 || orphans.length > 0;

  // Default to the first community (or the Other bucket if that's all there is), and drop a selection
  // that no longer points at a real tab.
  useEffect(() => {
    const valid = (id: string) =>
      id === (orphans.length ? OTHER_TAB : "") || live.some((s) => s.material.community_id === id);
    if (selected && !valid(selected)) setSelected("");
    else if (!selected && live[0]) setSelected(live[0].material.community_id);
    else if (!selected && orphans.length) setSelected(OTHER_TAB);
  }, [live, orphans, selected]);

  if (!client) return null;

  const active = live.find((state) => state.material.community_id === selected);

  return (
    <div className="w-full max-w-3xl mx-auto p-4 flex flex-col gap-5">
      {error && (
        <div className="alert alert-error py-2">
          <span>{error}</span>
          <button className="btn btn-xs btn-ghost" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}

      <section className="border border-base-300 rounded-box p-4 flex flex-wrap items-center gap-2">
        <h1 className="font-bold text-lg flex-1">Concord Invite Manager</h1>
        {status && (
          <>
            <span className="badge badge-outline">{status.communities} communities</span>
            <span className={`badge ${status.live === status.communities ? "badge-success" : "badge-info"}`}>
              {status.live} live · {status.syncing} syncing
            </span>
          </>
        )}
        <span className="badge badge-outline">
          {inviteList ? (inviteList.unlocked ? "invites unlocked" : "unlocking invites…") : "no invite list yet"}
        </span>
      </section>

      {!hasTabs && (
        <p className="opacity-70">
          No live memberships yet. Join or found a community in the community-list example, then come back to invite
          others. Owners and members holding CREATE_INVITE can mint links here.
        </p>
      )}

      {hasTabs && (
        <>
          {/* One tab per community — keeps each community's minting + invites isolated — plus an Other
              bucket for invites whose community you are no longer in. */}
          <div className="tabs tabs-boxed overflow-x-auto">
            {live.map((state) => {
              const id = state.material.community_id;
              const count = countById.get(id) ?? 0;
              return (
                <button
                  key={id}
                  className={`tab whitespace-nowrap ${selected === id ? "tab-active" : ""}`}
                  onClick={() => setSelected(id)}
                >
                  {communityName(state)}
                  {count > 0 && <span className="badge badge-sm badge-ghost ml-2">{count}</span>}
                </button>
              );
            })}
            {orphans.length > 0 && (
              <button
                className={`tab whitespace-nowrap ${selected === OTHER_TAB ? "tab-active" : ""}`}
                onClick={() => setSelected(OTHER_TAB)}
              >
                Other
                <span className="badge badge-sm badge-ghost ml-2">{orphans.length}</span>
              </button>
            )}
          </div>

          {active && <CommunityPanel client={client} state={active} onError={setError} />}
          {selected === OTHER_TAB && <OrphanPanel client={client} invites={orphans} onError={setError} />}
        </>
      )}
    </div>
  );
}

export default function ConcordInviteManagerExample() {
  const [signer, setSigner] = useState<ISigner | null>(null);

  if (!signer) return <LoginView onLogin={(newSigner) => setSigner(newSigner)} />;
  return <InviteManager signer={signer} />;
}
