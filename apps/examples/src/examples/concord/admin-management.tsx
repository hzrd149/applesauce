/**
 * Manage Concord communities with the high-level ConcordClient engine: select a joined community where
 * you hold admin permissions, then update metadata, moderate members, manage roles/channels, and refound.
 * @tags concord, admin, communities, roles, moderation, encryption, client
 * @related concord/community-list, concord/invite-manager, concord/direct-invites
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import {
  ConcordClient,
  Helpers,
  PERM,
  Storage,
  type CommunityMetadata,
  type CommunityState,
  type ConcordCommunity,
  type PermName,
} from "applesauce-concord";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useEffect, useMemo, useState } from "react";
import LoginView from "../../components/login-view";

const { STOCK_RELAYS, parsePermissions, permNames } = Helpers;

const eventStore = new EventStore();
const pool = new RelayPool();
const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: LOOKUP_RELAYS,
  extraRelays: STOCK_RELAYS,
});

const ADMIN_BITS = [
  PERM.MANAGE_METADATA,
  PERM.MANAGE_CHANNELS,
  PERM.MANAGE_ROLES,
  PERM.KICK,
  PERM.BAN,
  PERM.CREATE_INVITE,
];

type Tab = "overview" | "info" | "members" | "roles" | "channels" | "security";

function shortId(id: string) {
  return id.slice(0, 8) + "..." + id.slice(-8);
}

// Map a sync-lifecycle phase to a DaisyUI badge color for the status indicators.
function phaseBadgeClass(phase: string) {
  switch (phase) {
    case "live":
      return "badge-success";
    case "syncing":
      return "badge-info";
    case "error":
    case "removed":
    case "dissolved":
      return "badge-error";
    default:
      return "badge-ghost";
  }
}

function namesFor(perms: bigint) {
  return permNames(perms).map((name) => name.replace(/_/g, " "));
}

function relaysFromText(text: string) {
  return text
    .split(/\n|,/)
    .map((relay) => relay.trim())
    .filter(Boolean);
}

// "Do I hold ANY admin bit here" — note this is `.some`, not `canDo(ADMIN_PERMS)`,
// which requires holding EVERY bit.
//
// The snapshot `canDo` is the right call in this one place: it runs over
// `client.communities$`, which re-emits whenever any community's state folds, so the
// filter already recomputes. Inside a single community, prefer `can$` — a component
// gating on `canDo` only re-renders if something above it happens to subscribe.
function isAdminCommunity(client: ConcordClient, state: CommunityState) {
  const community = client.getCommunity(state.material.community_id);
  if (!community || state.dissolved) return false;
  return ADMIN_BITS.some((perm) => community.canDo(perm));
}

// The client's descriptive status is now a typed snapshot (lifecycle phase + an
// aggregate over every joined community's sync/connection), so a UI can react to
// the whole client at a glance instead of a free-form string.
function StatusLine({ client }: { client: ConcordClient }) {
  const status = use$(client.status$);
  if (!status) return null;

  const phaseLabel = status.phase === "starting" ? "Starting…" : status.phase === "idle" ? "Idle" : "Ready";

  return (
    <div className="alert alert-info flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="font-medium">{phaseLabel}</span>
      <span className="opacity-70">
        {status.communities} communities · {status.live} live · {status.syncing} syncing
      </span>
      <span className={`badge badge-sm ${status.connected ? "badge-success" : "badge-ghost"}`}>
        {status.connected ? "connected" : "offline"}
      </span>
      {status.connected && (
        <span className={`badge badge-sm ${status.authenticated ? "badge-success" : "badge-warning"}`}>
          {status.authenticated ? "stream keys authed" : "stream keys pending"}
        </span>
      )}
    </div>
  );
}

// A single call-to-action banner: a title, an explanation, and one action button. `tone` maps to a
// literal DaisyUI alert class (kept literal so Tailwind doesn't purge it).
function Banner({
  tone,
  title,
  body,
  action,
  onClick,
  busy,
  disabled,
}: {
  tone: "warning" | "info";
  title: string;
  body: string;
  action: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const toneClass = tone === "warning" ? "alert-warning" : "alert-info";
  return (
    <div className={`alert ${toneClass} flex flex-wrap items-center gap-3 py-2`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs opacity-80">{body}</div>
      </div>
      <button className="btn btn-sm" disabled={disabled || busy} onClick={onClick}>
        {busy ? "Working…" : action}
      </button>
    </div>
  );
}

// Reactive alert banners: each appears only while the client needs the user to unlock, authenticate,
// read pending invites, or publish. Everything is driven off the client's observables — with all the
// `auto*` gates off, nothing touches the signer until the user acts on a banner.
function ActionBanners({ client, signer }: { client: ConcordClient; signer: ISigner }) {
  const communityList = use$(client.communityList$);
  const inviteList = use$(client.inviteList$);
  const dirty = use$(client.communityListDirty$);
  const watcher = use$(client.directInviteWatcher$);
  const needsAuth = use$(() => watcher?.needsAuth$, [watcher]);
  const pending = use$(() => watcher?.pendingCount$, [watcher]) ?? 0;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const listLocked = !!communityList && !communityList.unlocked;
  const inviteLocked = !!inviteList && !inviteList.unlocked;
  const noSigner = !signer.nip44;

  if (!error && !listLocked && !inviteLocked && !needsAuth && !dirty && pending === 0) return null;

  return (
    <div className="space-y-2">
      {error && (
        <div className="alert alert-error py-2 text-sm">
          <span>{error}</span>
          <button className="btn btn-xs btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {listLocked && (
        <Banner
          tone="warning"
          title="Community list is locked"
          body="Your membership list (kind 13302) is encrypted to you. Unlock it to load and sync your communities."
          action="Unlock"
          busy={busy === "unlock-list"}
          disabled={noSigner}
          onClick={() => run("unlock-list", () => communityList!.unlock(signer))}
        />
      )}

      {inviteLocked && (
        <Banner
          tone="warning"
          title="Invite list is locked"
          body="Your saved invites (kind 13303) are encrypted. Unlock it to read them."
          action="Unlock"
          busy={busy === "unlock-invites"}
          disabled={noSigner}
          onClick={() => run("unlock-invites", () => inviteList!.unlock(signer))}
        />
      )}

      {needsAuth && (
        <Banner
          tone="warning"
          title="Inbox authentication required"
          body="Your inbox relays require NIP-42 authentication before they will deliver Direct Invites."
          action="Authenticate"
          busy={busy === "auth"}
          onClick={() => run("auth", () => watcher!.authenticateUser())}
        />
      )}

      {pending > 0 && (
        <Banner
          tone="info"
          title={`${pending} pending invite${pending === 1 ? "" : "s"}`}
          body="You have unread Direct Invites (community + private-channel grants). Unlock them to review and accept."
          action="Read invites"
          busy={busy === "read"}
          disabled={noSigner}
          onClick={() => run("read", () => watcher!.readPending())}
        />
      )}

      {dirty && (
        <Banner
          tone="warning"
          title="Unpublished membership changes"
          body="Your community list changed locally (an epoch caught up, or you joined/left). Publish it so your other devices stay in sync."
          action="Publish"
          busy={busy === "publish"}
          disabled={noSigner}
          onClick={() => run("publish", () => client.saveCommunityList())}
        />
      )}
    </div>
  );
}

function CommunitySelector({ client, selected, onSelect }: { client: ConcordClient; selected?: string; onSelect: (id: string) => void }) {
  const communities = use$(client.communities$) ?? [];
  const adminCommunities = communities.filter((state) => isAdminCommunity(client, state));

  useEffect(() => {
    if (!selected && adminCommunities[0]) onSelect(adminCommunities[0].material.community_id);
    if (selected && !adminCommunities.some((state) => state.material.community_id === selected)) onSelect("");
  }, [adminCommunities, selected, onSelect]);

  if (adminCommunities.length === 0) {
    return (
      <div className="border border-base-300 rounded-box p-4">
        <h2 className="font-semibold">No synced admin communities yet</h2>
        <p className="mt-1 text-sm opacity-70">
          Unlock your community list above to bootstrap memberships, then wait for admin communities to sync. This
          example uses in-memory storage, so every reload starts from the relay-published list and fully syncs again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">Admin community</label>
      <select className="select select-bordered w-full" value={selected ?? ""} onChange={(e) => onSelect(e.target.value)}>
        {adminCommunities.map((state) => (
          <option key={state.material.community_id} value={state.material.community_id}>
            {state.metadata?.name || state.material.name || shortId(state.material.community_id)} · epoch {state.material.root_epoch}
          </option>
        ))}
      </select>
    </div>
  );
}

function PermissionBadges({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-sm opacity-60">No admin permissions</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((name) => (
        <span key={name} className="badge badge-outline badge-sm">
          {name}
        </span>
      ))}
    </div>
  );
}

function OverviewTab({ community }: { community: ConcordCommunity }) {
  const standing = use$(() => community.standing$(community.pubkey), [community]);
  const metadata = use$(() => community.metadata$, [community]);
  const members = use$(() => community.members$, [community]);
  const channels = use$(() => community.channels$, [community]);
  const dissolved = use$(() => community.dissolved$, [community]);
  // The engine's descriptive status: sync phase (idle → syncing → live) plus relay
  // connection/NIP-42 auth, derived reactively so this badge row updates live.
  const status = use$(community.status$);
  const material = community.material;

  if (!standing || !members || !channels) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="border border-base-300 rounded-box p-4">
        <h3 className="font-semibold">Community</h3>
        {status && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className={`badge badge-sm ${phaseBadgeClass(status.phase)}`}>{status.phase}</span>
            <span className={`badge badge-sm ${status.connected ? "badge-success" : "badge-ghost"}`}>
              {status.connected ? "connected" : "offline"}
            </span>
            {status.connected && (
              <span className={`badge badge-sm ${status.authenticated ? "badge-success" : "badge-warning"}`}>
                {status.authenticated ? "authenticated" : "authenticating"}
              </span>
            )}
            {status.error && <span className="badge badge-sm badge-error">{status.error}</span>}
          </div>
        )}
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <span className="opacity-60">Name</span> {metadata?.name || material.name || "Unnamed"}
          </div>
          <div>
            <span className="opacity-60">ID</span> <code>{shortId(material.community_id)}</code>
          </div>
          <div>
            <span className="opacity-60">Root epoch</span> {status?.epoch ?? material.root_epoch}
          </div>
          <div>
            <span className="opacity-60">Members</span> {members.size}
          </div>
          <div>
            <span className="opacity-60">Channels</span> {channels.length}
          </div>
          {dissolved && <div className="badge badge-error">Dissolved</div>}
        </div>
      </section>

      <section className="border border-base-300 rounded-box p-4">
        <h3 className="font-semibold">Your authority</h3>
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <span className="opacity-60">Position</span> {standing.isOwner ? "Owner" : standing.position}
          </div>
          <PermissionBadges names={namesFor(standing.permissions)} />
        </div>
      </section>
    </div>
  );
}

function InfoTab({ community, onError }: { community: ConcordCommunity; onError: (error: string) => void }) {
  const metadata = use$(() => community.metadata$, [community]);
  const canEdit = use$(() => community.can$(PERM.MANAGE_METADATA), [community]) ?? false;
  const current = metadata ?? { name: community.material.name, relays: community.material.relays };
  const [name, setName] = useState(current.name ?? "");
  const [description, setDescription] = useState(current.description ?? "");
  const [relays, setRelays] = useState((current.relays ?? []).join("\n"));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(current.name ?? "");
    setDescription(current.description ?? "");
    setRelays((current.relays ?? []).join("\n"));
  }, [current.name, current.description, current.relays?.join("\n")]);

  async function save() {
    setSaving(true);
    try {
      const patch: Partial<CommunityMetadata> = { name: name.trim() || "Unnamed", description, relays: relaysFromText(relays) };
      await community.admin.editMetadata(patch);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update metadata");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-base-300 rounded-box p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Community info</h3>
        <p className="text-sm opacity-70">Requires MANAGE_METADATA.</p>
      </div>
      <input className="input input-bordered w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <textarea
        className="textarea textarea-bordered w-full"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
      />
      <textarea
        className="textarea textarea-bordered w-full font-mono text-sm"
        value={relays}
        onChange={(e) => setRelays(e.target.value)}
        placeholder="wss://relay.example"
        rows={4}
      />
      <button className="btn btn-primary" onClick={save} disabled={saving || !canEdit}>
        {saving ? "Saving..." : "Update info"}
      </button>
    </section>
  );
}

function UserSummary({ pubkey }: { pubkey: string }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  const profile = use$(() => user.profile$, [user.pubkey]);
  const npub = user.npub;
  const displayName = getDisplayName(profile, shortId(npub));
  const picture = getProfilePicture(profile, `https://robohash.org/${pubkey}.png`);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <img className="size-9 rounded-box" src={picture} alt={displayName} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{displayName}</div>
        <code className="block truncate text-xs opacity-60">{shortId(npub)}</code>
      </div>
    </div>
  );
}

function MemberRow({ community, member, busy, onRun }: { community: ConcordCommunity; member: string; busy: string | null; onRun: (label: string, action: () => Promise<void>) => void }) {
  const standing = use$(() => community.standing$(member), [community, member]);
  const banlist = use$(() => community.banlist$, [community]);
  const banned = banlist?.has(member) ?? false;
  // canModerate$ carries the whole CORD-04 rule: hold the bit AND strictly outrank
  // the target — which is never true of yourself. Pairing canDo with a separately
  // read standing position leaves both halves for each call site to remember.
  const canKick = use$(() => community.canModerate$(member, PERM.KICK), [community, member]) ?? false;
  const canBan = use$(() => community.canModerate$(member, PERM.BAN), [community, member]) ?? false;
  const canUnban = use$(() => community.can$(PERM.BAN), [community]) ?? false;

  if (!standing) return null;

  return (
    <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UserSummary pubkey={member} />
          {standing.isOwner && <span className="badge badge-primary badge-sm">owner</span>}
          {banned && <span className="badge badge-error badge-sm">banned</span>}
        </div>
        <div className="mt-1 text-xs opacity-60">
          position {standing.isOwner ? 0 : standing.position} · {standing.roleIds.length} roles
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-xs btn-outline" disabled={!canKick || !!busy} onClick={() => onRun("kick", () => community.admin.kick(member))}>
          Kick
        </button>
        <button className="btn btn-xs btn-outline btn-error" disabled={!canBan || !!busy} onClick={() => onRun("ban", () => community.admin.ban(member))}>
          Ban
        </button>
        <button className="btn btn-xs btn-ghost" disabled={!banned || !canUnban || !!busy} onClick={() => onRun("unban", () => community.admin.unban(member))}>
          Unban
        </button>
      </div>
    </div>
  );
}

function MembersTab({ community, onError }: { community: ConcordCommunity; onError: (error: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const memberSet = use$(() => community.members$, [community]);
  const members = useMemo(() => [...(memberSet ?? [])].sort(), [memberSet]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try {
      await action();
    } catch (err) {
      onError(err instanceof Error ? err.message : `Failed to ${label}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border border-base-300 rounded-box p-4">
      <h3 className="font-semibold">Members</h3>
      <p className="mt-1 text-sm opacity-70">Kick removes roles and publishes a guestbook kick. Ban also updates the banlist.</p>
      <div className="mt-4 divide-y divide-base-300">
        {members.map((member) => (
          <MemberRow key={member} community={community} member={member} busy={busy} onRun={run} />
        ))}
      </div>
    </section>
  );
}

function RolesTab({ community, onError }: { community: ConcordCommunity; onError: (error: string) => void }) {
  const roles = use$(() => community.roles$, [community]) ?? [];
  const canManageRoles = use$(() => community.can$(PERM.MANAGE_ROLES), [community]) ?? false;
  const [name, setName] = useState("");
  const [position, setPosition] = useState(100);
  const [selectedPerms, setSelectedPerms] = useState<PermName[]>(["MANAGE_MESSAGES"]);
  const [grantMember, setGrantMember] = useState("");
  const [grantRoles, setGrantRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const permissionEntries = Object.entries(PERM) as [PermName, bigint][];

  function togglePerm(perm: PermName) {
    setSelectedPerms((current) => (current.includes(perm) ? current.filter((p) => p !== perm) : [...current, perm]));
  }

  async function createRole() {
    setBusy(true);
    try {
      const permissions = selectedPerms.reduce((bits, perm) => bits | PERM[perm], 0n);
      await community.admin.createRole(name.trim() || "Moderator", position, permissions);
      setName("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setBusy(false);
    }
  }

  async function saveGrant() {
    setBusy(true);
    try {
      await community.admin.grantRoles(grantMember.trim(), grantRoles);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to grant roles");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="border border-base-300 rounded-box p-4 space-y-3">
        <h3 className="font-semibold">Create role</h3>
        <input className="input input-bordered w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Role name" />
        <input
          className="input input-bordered w-full"
          type="number"
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          placeholder="Position"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {permissionEntries.map(([perm]) => (
            <label key={perm} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm" checked={selectedPerms.includes(perm)} onChange={() => togglePerm(perm)} />
              {perm.replace(/_/g, " ")}
            </label>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!canManageRoles || busy} onClick={createRole}>
          Create role
        </button>
      </section>

      <section className="border border-base-300 rounded-box p-4 space-y-3">
        <h3 className="font-semibold">Grant roles</h3>
        <input className="input input-bordered w-full" value={grantMember} onChange={(e) => setGrantMember(e.target.value)} placeholder="Member pubkey hex" />
        <div className="space-y-2">
          {roles.map((role) => (
            <label key={role.role_id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={grantRoles.includes(role.role_id)}
                onChange={() => setGrantRoles((current) => (current.includes(role.role_id) ? current.filter((id) => id !== role.role_id) : [...current, role.role_id]))}
              />
              {role.name} <span className="opacity-60">position {role.position}</span>
            </label>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!grantMember.trim() || !canManageRoles || busy} onClick={saveGrant}>
          Save grant
        </button>
      </section>

      <section className="border border-base-300 rounded-box p-4 lg:col-span-2">
        <h3 className="font-semibold">Existing roles</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {roles.map((role) => (
            <div key={role.role_id} className="border border-base-300 rounded-box p-3 text-sm">
              <div className="font-medium">{role.name}</div>
              <div className="opacity-60">position {role.position}</div>
              <PermissionBadges names={namesFor(parsePermissions(role.permissions))} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChannelsTab({ community, onError }: { community: ConcordCommunity; onError: (error: string) => void }) {
  const channels = use$(() => community.channels$, [community]) ?? [];
  const canManageChannels = use$(() => community.can$(PERM.MANAGE_CHANNELS), [community]) ?? false;
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createChannel() {
    setBusy(true);
    try {
      await community.admin.createChannel(name.trim() || "new-channel", { private: isPrivate, voice });
      setName("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setBusy(false);
    }
  }

  async function deleteChannel(channelId: string) {
    setBusy(true);
    try {
      await community.admin.deleteChannel(channelId);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete channel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <section className="border border-base-300 rounded-box p-4 space-y-3">
        <h3 className="font-semibold">Create channel</h3>
        <input className="input input-bordered w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} /> Private
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voice
        </label>
        <button className="btn btn-primary" disabled={!canManageChannels || busy} onClick={createChannel}>
          Create channel
        </button>
      </section>

      <section className="border border-base-300 rounded-box p-4">
        <h3 className="font-semibold">Channels</h3>
        <div className="mt-3 divide-y divide-base-300">
          {channels.map((channel) => (
            <div key={channel.channel_id} className={`flex items-center gap-2 py-3 ${channel.deleted ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">#{channel.name}</div>
                <div className="text-xs opacity-60">
                  {channel.private ? "private" : "public"} · epoch {channel.epoch ?? community.material.root_epoch}
                  {channel.voice ? " · voice" : ""}
                  {channel.deleted ? " · deleted" : ""}
                </div>
              </div>
              <button
                className="btn btn-xs btn-outline btn-error"
                disabled={channel.deleted || !canManageChannels || busy}
                onClick={() => deleteChannel(channel.channel_id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// The per-member authority check lives here rather than in the parent's map, so it
// can be a hook — and so excluding someone asks the same `canModerate$` question the
// Members tab asks before kicking them.
function RefoundMemberOption({ community, member, checked, onToggle }: { community: ConcordCommunity; member: string; checked: boolean; onToggle: () => void }) {
  const standing = use$(() => community.standing$(member), [community, member]);
  const canExclude = use$(() => community.canModerate$(member, PERM.BAN), [community, member]) ?? false;

  return (
    <label className={`flex items-center gap-3 text-sm ${!canExclude ? "opacity-50" : ""}`}>
      <input type="checkbox" className="checkbox checkbox-sm" checked={checked} disabled={!canExclude} onChange={onToggle} />
      <span className="opacity-70">Exclude</span>
      <UserSummary pubkey={member} />
      {standing?.isOwner && <span className="badge badge-primary badge-sm">owner</span>}
    </label>
  );
}

function SecurityTab({ community, onError }: { community: ConcordCommunity; onError: (error: string) => void }) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const memberSet = use$(() => community.members$, [community]);
  // `refound` keeps everyone not explicitly excluded — never ourselves, since the
  // engine always adds the caller back to the recipient set.
  const members = useMemo(
    () => [...(memberSet ?? [])].filter((member) => member !== community.pubkey),
    [memberSet, community],
  );

  function toggle(member: string) {
    setExcluded((current) => (current.includes(member) ? current.filter((m) => m !== member) : [...current, member]));
  }

  async function refound() {
    setBusy(true);
    try {
      const keep = members.filter((member) => !excluded.includes(member));
      await community.admin.refound({ keep, exclude: excluded });
      setExcluded([]);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to refound community");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-base-300 rounded-box p-4 space-y-4">
      <div>
        <h3 className="font-semibold">Refound community</h3>
        <p className="mt-1 text-sm opacity-70">
          Refounding rotates the community root and is the enforcement step after removing members. This example keeps
          private-channel rekeys separate so the community-wide keep list cannot over-grant channel keys.
        </p>
      </div>
      <div className="space-y-2">
        {members.map((member) => (
          <RefoundMemberOption
            key={member}
            community={community}
            member={member}
            checked={excluded.includes(member)}
            onToggle={() => toggle(member)}
          />
        ))}
      </div>
      <button className="btn btn-error" disabled={excluded.length === 0 || busy} onClick={refound}>
        {busy ? "Refounding..." : `Refound and exclude ${excluded.length}`}
      </button>
    </section>
  );
}

// No `state$` subscription here, and no `state` prop drilled into the tabs. Each tab
// subscribes the slice it renders, so a chat message arriving in any channel — which
// moves the presence-derived member set and re-emits `state$` — no longer re-renders
// the roles and channels UI along with it.
function AdminPanel({ client, communityId }: { client: ConcordClient; communityId: string }) {
  const community = client.getCommunity(communityId);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  if (!community) return null;

  const tabs: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["info", "Info"],
    ["members", "Members"],
    ["roles", "Roles"],
    ["channels", "Channels"],
    ["security", "Security"],
  ];

  return (
    <div className="space-y-4">
      {error && (
        <div className="alert alert-error py-2 text-sm">
          <span>{error}</span>
          <button className="btn btn-xs btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="tabs tabs-boxed overflow-x-auto">
        {tabs.map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? "tab-active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab community={community} />}
      {tab === "info" && <InfoTab community={community} onError={setError} />}
      {tab === "members" && <MembersTab community={community} onError={setError} />}
      {tab === "roles" && <RolesTab community={community} onError={setError} />}
      {tab === "channels" && <ChannelsTab community={community} onError={setError} />}
      {tab === "security" && <SecurityTab community={community} onError={setError} />}
    </div>
  );
}

function ConcordAdminManager({ signer }: { signer: ISigner }) {
  const [client, setClient] = useState<ConcordClient | null>(null);
  const [communityId, setCommunityId] = useState("");

  useEffect(() => {
    const next = new ConcordClient({
      signer,
      pool,
      eventStore,
      storage: Storage.memoryStorage(),
      relays: STOCK_RELAYS,
      autoUnlock: false,
      autoSaveCommunityList: false,
    });

    setClient(next);
    void next.start();
    return () => next.stop();
  }, [signer]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4">
      <div>
        <h1 className="text-3xl font-semibold">Concord Admin Management</h1>
        <p className="mt-2 text-base-content/70">
          The client runs in fully manual mode — every automatic gate (unlock, authenticate, publish) is off, so it
          starts up and syncs with zero calls to your signer. The status line below reflects the client, and a banner
          appears whenever it needs you to unlock a list, authenticate to a relay, read pending invites, or publish a
          membership change. In-memory storage means a fresh full sync each session.
        </p>
      </div>

      {client && <StatusLine client={client} />}
      {client && <ActionBanners client={client} signer={signer} />}
      {client && <CommunitySelector client={client} selected={communityId} onSelect={setCommunityId} />}
      {client && communityId && <AdminPanel client={client} communityId={communityId} />}
    </div>
  );
}

export default function ConcordAdminManagementExample() {
  const [account, setAccount] = useState<{ signer: ISigner } | null>(null);

  if (!account) return <LoginView onLogin={(signer) => setAccount({ signer })} />;
  return <ConcordAdminManager signer={account.signer} />;
}
