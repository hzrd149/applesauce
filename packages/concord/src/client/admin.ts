// ConcordCommunityAdmin — every action that requires authority, in one place.
//
// This is the community-management API (`community.admin`), grouped by INTENT rather
// than by protocol. A caller wanting to remove someone finds `kick` and `ban` next to
// each other and never learns that one writes the guestbook and the other the control
// plane. Grouping by plane would run a seam right through that — which is precisely
// the knowledge an app shouldn't need.
//
// Two kinds of method live here:
//
//   - Control-plane editions (metadata, channels, roles, grants, banlist, invite
//     registry) are IMPLEMENTED here. Every CORD-04 authority action is a versioned
//     kind-3308 edition, so a write is never a bare publish: it must find the entity's
//     current head, bump its version, and chain to that head's hash. That machinery,
//     and the coordinate each vsk lives at, is this class's real job.
//
//   - Cross-plane composites (kick, invites, refounding, channel rotation/grants,
//     dissolution) are DELEGATED back to the community, which owns the key state, the
//     sub-engines, and the relay handles they need. The implementation stays there;
//     this class only presents it as part of one surface.
//
// It owns no fold and no subscription. Reads come from the community's folded
// snapshot through the `state` accessor, mirroring how ConcordPrivateChannel takes
// `material: () => JoinMaterial`.

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey } from "applesauce-core/helpers/keys";

import { EditionFactory } from "../factories/control.js";
import { CONTROL_KIND } from "../helpers/control.js";
import { banlistLocator, grantLocator, inviteLinksLocator } from "../helpers/crypto.js";
import { computeEditionHash } from "../helpers/editions.js";
import { canActOn, resolveStanding, type Standing } from "../helpers/permissions.js";
import {
  VSK,
  type BlobPointer,
  type CommunityMetadata,
  type CommunityState,
  type JoinMaterial,
  type Role,
  type RoleScope,
  type RumorTemplate,
} from "../types.js";
// Type-only: erased at runtime, so this doesn't create an import cycle with the
// community module that constructs us.
import type { ConcordCommunity } from "./community.js";
import type { ConcordInviteLink, CreateInviteOptions } from "./invite-manager.js";
import type { ConcordRumorStore, ConcordUploader } from "./storage.js";

/** Options for {@link ConcordCommunityAdmin.createChannel}. */
export interface CreateChannelOptions {
  /** Create a private (key-gated, invite-only) channel. Defaults to `false` — a public channel. */
  private?: boolean;
  /** Mark the channel as voice. Defaults to `false`. */
  voice?: boolean;
}

/** An entity's current head edition — what the next version must chain to. */
export interface EditionHead {
  version: number;
  /** The head's `edition_hash`, cited as the next edition's `ep` tag. */
  hash: string;
  content: string;
}

/** Options for a {@link ConcordCommunityAdmin}, wired by {@link ConcordCommunity}. */
export interface ConcordCommunityAdminOptions {
  /** The owning community. Backs the cross-plane composites, whose implementations
   *  need its key state, private-channel sub-engines, and relay handles. */
  community: ConcordCommunity;
  /** The Control Plane rumor store — scanned to find each entity's head edition. */
  store: ConcordRumorStore;
  /** The community's folded state, read as a snapshot at write time: roles/grants
   *  gate authority, and each edit patches the entity's current value. Never
   *  subscribed — the reactive surface lives on the community. */
  state: () => CommunityState;
  /** The logged-in user's hex pubkey. */
  pubkey: string;
  /** Media uploader (encrypt + upload). Required to set community images. */
  uploader?: ConcordUploader;
  /** Seal + wrap + publish a rumor onto the Control Plane (a plaintext seal, so a
   *  later Refounding can re-wrap the signed edition into the new epoch). */
  publish: (rumor: RumorTemplate) => Promise<string>;
  /** Mint + persist a private channel's key, before its edition is published — a
   *  key that never reaches `material` is lost on reload. */
  mintChannelKey: (channelId: string, name: string) => void;
}

export class ConcordCommunityAdmin {
  readonly pubkey: string;
  readonly invites: ConcordCommunityAdminInvites;

  private readonly opts: ConcordCommunityAdminOptions;

  constructor(options: ConcordCommunityAdminOptions) {
    this.opts = options;
    this.pubkey = options.pubkey;
    this.invites = new ConcordCommunityAdminInvites(this);
  }

  private get material(): JoinMaterial {
    return this.opts.state().material;
  }

  private get communityIdBytes(): Uint8Array {
    return hexToBytes(this.material.community_id);
  }

  // ---- edition chain -------------------------------------------------------

  /** The current head edition for `eid`, or undefined if the entity has none. */
  async latestEdition(eid: string): Promise<EditionHead | undefined> {
    let best: EditionHead | undefined;
    // `getByFilters` is synchronous for an in-memory store and a Promise for an
    // async-database-backed one — `Promise.resolve` normalizes both.
    const rumors = await Promise.resolve(this.opts.store.getByFilters([{ kinds: [CONTROL_KIND] }]));
    for (const rumor of rumors) {
      if (rumor.tags.find((t) => t[0] === "eid")?.[1] !== eid) continue;
      const version = parseInt(rumor.tags.find((t) => t[0] === "ev")?.[1] ?? "1", 10);
      if (!best || version > best.version) {
        const prev = rumor.tags.find((t) => t[0] === "ep")?.[1];
        // `vsk` is not in the edition_hash preimage, so any value reproduces the hash.
        const hash = computeEditionHash({ vsk: 0, eid, version, prevHash: prev, content: rumor.content });
        best = { version, hash, content: rumor.content };
      }
    }
    return best;
  }

  /** The `vac` citation of `actor`'s own Grant edition (CORD-04) — omitted for the
   *  owner, whose authority is proven by the community_id itself. Advisory: the
   *  fold re-derives standing from the roster and never reads this tag. */
  async vacFor(actor: string): Promise<[string, string, string] | undefined> {
    if (actor === this.material.owner) return undefined;
    const eid = grantLocator(this.communityIdBytes, actor);
    const latest = await this.latestEdition(eid);
    if (!latest) return undefined;
    return [eid, String(latest.version), latest.hash];
  }

  /** Publish the next version of an entity, chained to its current head. Versions
   *  must stay contiguous and cite the head's hash — an edition that doesn't link
   *  is an orphan the fold will only ever take as a bootstrap fallback. */
  async publishEdition(vsk: number, eid: string, content: string): Promise<void> {
    const latest = await this.latestEdition(eid);
    const version = latest ? latest.version + 1 : 1;
    const vac = await this.vacFor(this.pubkey);
    const rumor = await EditionFactory.create({ vsk, eid, version, prevHash: latest?.hash, content, vac });
    await this.opts.publish(rumor);
  }

  // ---- metadata (vsk 0) ----------------------------------------------------

  async editMetadata(patch: Partial<CommunityMetadata>): Promise<void> {
    const material = this.material;
    const current = this.opts.state().metadata ?? { name: material.name, relays: material.relays };
    const next: CommunityMetadata = { ...current, ...patch };
    await this.publishEdition(VSK.METADATA, material.community_id, JSON.stringify(next));
  }

  /** Encrypt an image via the uploader and publish it as the icon or banner. */
  async setCommunityImage(which: "icon" | "banner", file: Blob): Promise<void> {
    if (!this.opts.uploader) throw new Error("no uploader configured: cannot set community image");
    const att = await this.opts.uploader.upload(file, this.material.community_id);
    if (!att.encryption || !att.originalSha256 || !att.url)
      throw new Error("uploader did not return an encrypted attachment");
    const pointer: BlobPointer = {
      url: att.url,
      key: att.encryption.key,
      nonce: att.encryption.nonce,
      hash: att.originalSha256,
    };
    await this.editMetadata({ [which]: pointer });
  }

  async removeCommunityImage(which: "icon" | "banner"): Promise<void> {
    await this.editMetadata({ [which]: undefined });
  }

  // ---- channels (vsk 2) ----------------------------------------------------

  async createChannel(name: string, options: CreateChannelOptions = {}): Promise<string> {
    const isPrivate = options.private ?? false;
    const channelId = bytesToHex(generateSecretKey());
    if (isPrivate) this.opts.mintChannelKey(channelId, name);
    const content: Record<string, unknown> = { name, private: isPrivate };
    if (options.voice) content.voice = true;
    await this.publishEdition(VSK.CHANNEL, channelId, JSON.stringify(content));
    return channelId;
  }

  async deleteChannel(channelId: string): Promise<void> {
    const ch = this.opts.state().channels.find((c) => c.channel_id === channelId);
    if (!ch) return;
    await this.publishEdition(
      VSK.CHANNEL,
      channelId,
      JSON.stringify({ name: ch.name, private: ch.private, deleted: true }),
    );
  }

  // ---- roles & grants (vsk 1 / vsk 3) --------------------------------------

  /**
   * Mint a Role (CORD-04 §2). A server-scoped role (the default) grants rank
   * community-wide; a channel-scoped role (`{kind:"channel", channel_id}`) is the
   * spec's private-channel membership marker — its grant-holders are the intended
   * readership of that channel, kept in sync with key possession by the caller
   * (deliver on grant via `grantChannelAccess`, rekey on removal via
   * `rotateChannel`). A role mints no key, so this only records entitlement.
   */
  async createRole(
    name: string,
    position: number,
    permissions: bigint,
    scope: RoleScope = { kind: "server" },
  ): Promise<string> {
    const roleId = bytesToHex(generateSecretKey());
    const role: Role = {
      role_id: roleId,
      name,
      position,
      permissions: permissions.toString(),
      scope,
      color: 0,
    };
    await this.publishEdition(VSK.ROLE, roleId, JSON.stringify(role));
    return roleId;
  }

  async editRole(roleId: string, patch: Partial<Omit<Role, "role_id">>): Promise<void> {
    const current = this.opts.state().roles.find((r) => r.role_id === roleId);
    if (!current) throw new Error("role not found");
    const role: Role = { ...current, ...patch, role_id: roleId };
    await this.publishEdition(VSK.ROLE, roleId, JSON.stringify(role));
  }

  /**
   * Retire a Role (CORD-04). The role stays in {@link CommunityState.roles} flagged
   * `deleted` — so it remains visible and compactable — but confers no permissions
   * or rank, stripping its authority from every grant-holder. Reverse with
   * `editRole(roleId, { deleted: false })`. Existing grants are left untouched.
   */
  async deleteRole(roleId: string): Promise<void> {
    const current = this.opts.state().roles.find((r) => r.role_id === roleId);
    if (!current) return;
    await this.publishEdition(VSK.ROLE, roleId, JSON.stringify({ ...current, deleted: true }));
  }

  async grantRoles(member: string, roleIds: string[]): Promise<void> {
    const eid = grantLocator(this.communityIdBytes, member);
    await this.publishEdition(VSK.GRANT, eid, JSON.stringify({ member, role_ids: roleIds }));
  }

  // ---- banlist (vsk 4) -----------------------------------------------------

  async ban(member: string): Promise<void> {
    const current = new Set(this.opts.state().banlist);
    current.add(member);
    await this.publishEdition(VSK.BANLIST, banlistLocator(this.communityIdBytes), JSON.stringify([...current]));
    await this.grantRoles(member, []);
    // NOTE: full enforcement also requires a Refounding (rekey) — CORD-06.
  }

  async unban(member: string): Promise<void> {
    const current = new Set(this.opts.state().banlist);
    current.delete(member);
    await this.publishEdition(VSK.BANLIST, banlistLocator(this.communityIdBytes), JSON.stringify([...current]));
  }

  // ---- invite registry (vsk 8) ---------------------------------------------

  /** Register a link_signer coordinate into OUR registry (CORD-05 §5), so the link
   *  counts toward the community being Public. The bundle itself isn't a plane
   *  event, so publishing it stays with the community. */
  async registerInviteLink(linkPubkey: string): Promise<void> {
    const eid = inviteLinksLocator(this.communityIdBytes, this.pubkey);
    const existing = await this.latestEdition(eid);
    let links: string[] = [];
    try {
      if (existing) links = JSON.parse(existing.content) as string[];
    } catch {
      /* ignore */
    }
    if (!links.includes(linkPubkey)) links.push(linkPubkey);
    await this.publishEdition(VSK.INVITE_REGISTRY, eid, JSON.stringify(links));
  }

  /** Remove a link_signer coordinate from OUR registry (CORD-05 §5), usually
   *  after reposting the bundle coordinate as a revocation tombstone. */
  async unregisterInviteLink(linkPubkey: string): Promise<void> {
    const eid = inviteLinksLocator(this.communityIdBytes, this.pubkey);
    const existing = await this.latestEdition(eid);
    let links: string[] = [];
    try {
      if (existing) links = JSON.parse(existing.content) as string[];
    } catch {
      /* ignore */
    }
    const next = links.filter((link) => link !== linkPubkey);
    if (next.length === links.length) return;
    await this.publishEdition(VSK.INVITE_REGISTRY, eid, JSON.stringify(next));
  }

  // ---- cross-plane composites ---------------------------------------------
  //
  // Implemented on the community (they need its keys, sub-engines, and relays) and
  // surfaced here so `admin` is the whole management API rather than the subset that
  // happens to be one plane wide.

  /** Strip a member's roles and publish the Kick. */
  kick(member: string): Promise<void> {
    return this.opts.community.kick(member);
  }

  /** Mint a public invite link and register it (CORD-05 §5). */
  createInvite(options: CreateInviteOptions): Promise<ConcordInviteLink> {
    return this.opts.community.createInvite(options);
  }

  /** Retire a public invite link (bundle tombstone + registry removal). */
  revokeInvite(invite: ConcordInviteLink): Promise<ConcordInviteLink> {
    return this.opts.community.revokeInvite(invite);
  }

  /** Hand a member the current key for ONE private channel we hold (CORD-05 §6). */
  grantChannelAccess(channelId: string, member: string): Promise<void> {
    return this.opts.community.grantChannelAccess(channelId, member);
  }

  /** Rotate a private channel's key to sever the excluded members (CORD-06). */
  rotateChannel(channelId: string, opts: { keep: string[]; exclude?: string[] }): Promise<void> {
    return this.opts.community.rotateChannel(channelId, opts);
  }

  /** Rotate the community root — the enforcement step behind a ban (CORD-06). */
  refound(opts: {
    keep: string[];
    exclude?: string[];
    channelRekeys?: Array<{ channelId: string; keep: string[] }>;
  }): Promise<void> {
    return this.opts.community.refound(opts);
  }

  /** Shut the community down. Owner only, and irreversible. */
  dissolve(): Promise<void> {
    return this.opts.community.dissolve();
  }

  // ---- permissions (the roster authority that gates every write) -----------

  standingOf(member: string): Standing {
    const state = this.opts.state();
    const roles = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    return resolveStanding(member, state.material.owner, roles, state.grants);
  }

  /** Whether the logged-in user holds `perm` (and outranks `targetPosition`). */
  canDo(perm: bigint, targetPosition = 0xffffffff): boolean {
    return this.hasPerm(this.pubkey, perm, targetPosition);
  }

  /** Whether `member` holds `perm` — the roster authority check, e.g. for accepting
   *  a channel Rekey from a rotator. */
  hasPerm(member: string, perm: bigint, targetPosition = 0xffffffff): boolean {
    const standing = this.standingOf(member);
    return canActOn(standing, { permissions: 0n, position: targetPosition, isOwner: false, roleIds: [] }, perm);
  }
}

/** Community-scoped invite-link management, exposed at `community.admin.invites`. */
export class ConcordCommunityAdminInvites {
  constructor(private readonly admin: ConcordCommunityAdmin) {}

  create(options: CreateInviteOptions): Promise<ConcordInviteLink> {
    return this.admin.createInvite(options);
  }

  revoke(invite: ConcordInviteLink): Promise<ConcordInviteLink> {
    return this.admin.revokeInvite(invite);
  }
}
