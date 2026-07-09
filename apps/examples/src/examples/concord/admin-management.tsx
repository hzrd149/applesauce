/**
 * Manage Concord communities with the high-level ConcordClient engine: select a joined community where
 * you hold admin permissions, then update metadata, moderate members, manage roles/channels, and refound.
 * @tags concord, admin, communities, roles, moderation, encryption, client
 * @related concord/community-list, concord/invite-manager, concord/direct-invites
 */
import { EventStore } from "applesauce-core";
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
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";
import LoginView from "../../components/login-view";

const { STOCK_RELAYS, parsePermissions, permNames } = Helpers;

const eventStore = new EventStore();
const pool = new RelayPool();
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

function namesFor(perms: bigint) {
  return permNames(perms).map((name) => name.replace(/_/g, " "));
}

function relaysFromText(text: string) {
  return text
    .split(/\n|,/)
    .map((relay) => relay.trim())
    .filter(Boolean);
}

function isAdminCommunity(client: ConcordClient, state: CommunityState) {
  const community = client.getCommunity(state.material.community_id);
  if (!community || state.dissolved) return false;
  return ADMIN_BITS.some((perm) => community.canDo(perm));
}

function StatusLine({ client }: { client: ConcordClient }) {
  const status = use$(client.status$);
  return status ? <div className="alert alert-info py-2 text-sm">{status}</div> : null;
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
          This example uses in-memory Concord storage, so every reload starts from the relay-published community list and
          fully syncs community state again.
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

function OverviewTab({ community, state }: { community: ConcordCommunity; state: CommunityState }) {
  const standing = community.standingOf(community.pubkey);
  const metadata = state.metadata;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="border border-base-300 rounded-box p-4">
        <h3 className="font-semibold">Community</h3>
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <span className="opacity-60">Name</span> {metadata?.name || state.material.name || "Unnamed"}
          </div>
          <div>
            <span className="opacity-60">ID</span> <code>{shortId(state.material.community_id)}</code>
          </div>
          <div>
            <span className="opacity-60">Root epoch</span> {state.material.root_epoch}
          </div>
          <div>
            <span className="opacity-60">Members</span> {state.members.size}
          </div>
          <div>
            <span className="opacity-60">Channels</span> {state.channels.filter((c) => !c.deleted).length}
          </div>
          {state.dissolved && <div className="badge badge-error">Dissolved</div>}
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

function InfoTab({ community, state, onError }: { community: ConcordCommunity; state: CommunityState; onError: (error: string) => void }) {
  const current = state.metadata ?? { name: state.material.name, relays: state.material.relays };
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
      await community.editMetadata(patch);
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
      <button className="btn btn-primary" onClick={save} disabled={saving || !community.canDo(PERM.MANAGE_METADATA)}>
        {saving ? "Saving..." : "Update info"}
      </button>
    </section>
  );
}

function MembersTab({ community, state, onError }: { community: ConcordCommunity; state: CommunityState; onError: (error: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const members = [...state.members].sort();

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
        {members.map((member) => {
          const standing = community.standingOf(member);
          const banned = state.banlist.has(member);
          const canKick = member !== community.pubkey && community.canDo(PERM.KICK, standing.position);
          const canBan = member !== community.pubkey && community.canDo(PERM.BAN, standing.position);

          return (
            <div key={member} className="flex flex-col gap-3 py-3 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all text-sm">{shortId(nip19.npubEncode(member))}</code>
                  {standing.isOwner && <span className="badge badge-primary badge-sm">owner</span>}
                  {banned && <span className="badge badge-error badge-sm">banned</span>}
                </div>
                <div className="mt-1 text-xs opacity-60">
                  position {standing.isOwner ? 0 : standing.position} · {standing.roleIds.length} roles
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-xs btn-outline" disabled={!canKick || !!busy} onClick={() => run("kick", () => community.kick(member))}>
                  Kick
                </button>
                <button className="btn btn-xs btn-outline btn-error" disabled={!canBan || !!busy} onClick={() => run("ban", () => community.ban(member))}>
                  Ban
                </button>
                <button className="btn btn-xs btn-ghost" disabled={!banned || !community.canDo(PERM.BAN) || !!busy} onClick={() => run("unban", () => community.unban(member))}>
                  Unban
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RolesTab({ community, state, onError }: { community: ConcordCommunity; state: CommunityState; onError: (error: string) => void }) {
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
      await community.createRole(name.trim() || "Moderator", position, permissions);
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
      await community.grantRoles(grantMember.trim(), grantRoles);
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
        <button className="btn btn-primary" disabled={!community.canDo(PERM.MANAGE_ROLES) || busy} onClick={createRole}>
          Create role
        </button>
      </section>

      <section className="border border-base-300 rounded-box p-4 space-y-3">
        <h3 className="font-semibold">Grant roles</h3>
        <input className="input input-bordered w-full" value={grantMember} onChange={(e) => setGrantMember(e.target.value)} placeholder="Member pubkey hex" />
        <div className="space-y-2">
          {state.roles.map((role) => (
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
        <button className="btn btn-primary" disabled={!grantMember.trim() || !community.canDo(PERM.MANAGE_ROLES) || busy} onClick={saveGrant}>
          Save grant
        </button>
      </section>

      <section className="border border-base-300 rounded-box p-4 lg:col-span-2">
        <h3 className="font-semibold">Existing roles</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {state.roles.map((role) => (
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

function ChannelsTab({ community, state, onError }: { community: ConcordCommunity; state: CommunityState; onError: (error: string) => void }) {
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createChannel() {
    setBusy(true);
    try {
      await community.createChannel(name.trim() || "new-channel", isPrivate, voice);
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
      await community.deleteChannel(channelId);
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
        <button className="btn btn-primary" disabled={!community.canDo(PERM.MANAGE_CHANNELS) || busy} onClick={createChannel}>
          Create channel
        </button>
      </section>

      <section className="border border-base-300 rounded-box p-4">
        <h3 className="font-semibold">Channels</h3>
        <div className="mt-3 divide-y divide-base-300">
          {state.channels.map((channel) => (
            <div key={channel.channel_id} className={`flex items-center gap-2 py-3 ${channel.deleted ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">#{channel.name}</div>
                <div className="text-xs opacity-60">
                  {channel.private ? "private" : "public"} · epoch {channel.epoch ?? state.material.root_epoch}
                  {channel.voice ? " · voice" : ""}
                  {channel.deleted ? " · deleted" : ""}
                </div>
              </div>
              <button
                className="btn btn-xs btn-outline btn-error"
                disabled={channel.deleted || !community.canDo(PERM.MANAGE_CHANNELS) || busy}
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

function SecurityTab({ community, state, onError }: { community: ConcordCommunity; state: CommunityState; onError: (error: string) => void }) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const members = [...state.members].filter((member) => member !== community.pubkey);

  function toggle(member: string) {
    setExcluded((current) => (current.includes(member) ? current.filter((m) => m !== member) : [...current, member]));
  }

  async function refound() {
    setBusy(true);
    try {
      const keep = [...state.members].filter((member) => member !== community.pubkey && !excluded.includes(member));
      await community.refound({ keep, exclude: excluded });
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
        {members.map((member) => {
          const standing = community.standingOf(member);
          const disabled = !community.canDo(PERM.BAN, standing.position);
          return (
            <label key={member} className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
              <input type="checkbox" className="checkbox checkbox-sm" checked={excluded.includes(member)} disabled={disabled} onChange={() => toggle(member)} />
              Exclude <code>{shortId(nip19.npubEncode(member))}</code>
            </label>
          );
        })}
      </div>
      <button className="btn btn-error" disabled={excluded.length === 0 || busy} onClick={refound}>
        {busy ? "Refounding..." : `Refound and exclude ${excluded.length}`}
      </button>
    </section>
  );
}

function AdminPanel({ client, communityId }: { client: ConcordClient; communityId: string }) {
  const community = client.getCommunity(communityId);
  const state = use$(() => community?.state$, [community]);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  if (!community || !state) return null;

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

      {tab === "overview" && <OverviewTab community={community} state={state} />}
      {tab === "info" && <InfoTab community={community} state={state} onError={setError} />}
      {tab === "members" && <MembersTab community={community} state={state} onError={setError} />}
      {tab === "roles" && <RolesTab community={community} state={state} onError={setError} />}
      {tab === "channels" && <ChannelsTab community={community} state={state} onError={setError} />}
      {tab === "security" && <SecurityTab community={community} state={state} onError={setError} />}
    </div>
  );
}

function ConcordAdminManager({ signer, pubkey }: { signer: ISigner; pubkey: string }) {
  const [client, setClient] = useState<ConcordClient | null>(null);
  const [communityId, setCommunityId] = useState("");

  useEffect(() => {
    const next = new ConcordClient({
      signer,
      pubkey,
      pool,
      eventStore,
      storage: Storage.memoryStorage(),
      relays: STOCK_RELAYS,
      autoUnlock: true,
    });

    setClient(next);
    void next.start();
    return () => next.stop();
  }, [signer, pubkey]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4">
      <div>
        <h1 className="text-3xl font-semibold">Concord Admin Management</h1>
        <p className="mt-2 text-base-content/70">
          Select a joined community where your synced roster grants admin authority. The client uses in-memory storage so
          this page tests a fresh full sync each session.
        </p>
      </div>

      {client && <StatusLine client={client} />}
      {client && <CommunitySelector client={client} selected={communityId} onSelect={setCommunityId} />}
      {client && communityId && <AdminPanel client={client} communityId={communityId} />}
    </div>
  );
}

export default function ConcordAdminManagementExample() {
  const [account, setAccount] = useState<{ signer: ISigner; pubkey: string } | null>(null);

  if (!account) return <LoginView onLogin={(signer, pubkey) => setAccount({ signer, pubkey })} />;
  return <ConcordAdminManager signer={account.signer} pubkey={account.pubkey} />;
}
