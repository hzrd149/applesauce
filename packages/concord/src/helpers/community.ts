// High-level community model: key derivation, owner verification, genesis.

import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import {
  channelGroupKey,
  communityId,
  controlGroupKey,
  guestbookGroupKey,
  voiceGroupKey,
  voiceMediaKey,
} from "./crypto.js";
import type { GroupKey } from "./crypto.js";
import { EditionFactory } from "../factories/control.js";
import { JoinLeaveFactory } from "../factories/guestbook.js";
import type { RumorTemplate } from "../types.js";
import { VSK } from "../types.js";
import type { ChannelMetadata, CommunityMetadata, JoinMaterial } from "../types.js";

/** The set of stream keys a member holds for a community at its current epoch. */
export interface CommunityKeys {
  control: GroupKey;
  guestbook: GroupKey;
  /** channel_id -> group key (public derived from root; private from its key) */
  channels: Map<string, GroupKey>;
}

/**
 * The `(channel_secret, epoch)` pair that addresses a Channel's Chat Plane
 * (CORD-03 §1): the Channel's own key/epoch for a Private one, the
 * community_root at the root epoch for a Public one. Both the Chat key and the
 * voice keys (CORD-07 §1) derive from this same pair, so they rotate together.
 *
 * Total over the private branch (D-02/CHAN-01): `material.channels` is the ONLY
 * source of a private channel's key — a private channel with no held entry
 * derives NOTHING (`null`), never the public community_root address (H07).
 */
function channelSecret(
  material: JoinMaterial,
  channel: ChannelMetadata,
): { secret: Uint8Array; epoch: number } | null {
  if (channel.private) {
    const held = material.channels.find((c) => c.id === channel.channel_id);
    if (!held) return null; // CHAN-01: keyless private channel derives nothing
    return { secret: hexToBytes(held.key), epoch: held.epoch };
  }
  return { secret: hexToBytes(material.community_root), epoch: material.root_epoch };
}

export function channelKeyFor(material: JoinMaterial, channel: ChannelMetadata): GroupKey | null {
  const s = channelSecret(material, channel);
  return s ? channelGroupKey(s.secret, hexToBytes(channel.channel_id), s.epoch) : null;
}

/** A voice Channel's derived keys (CORD-07 §1): the SFU room signer + media root. */
export interface VoiceKeys {
  /** `pk` is the SFU room name; `sk` signs token grants (§2). */
  room: GroupKey;
  /** The 32-byte root of per-sender media encryption (§3). */
  mediaKey: Uint8Array;
}

export function voiceKeysFor(material: JoinMaterial, channel: ChannelMetadata): VoiceKeys | null {
  const s = channelSecret(material, channel);
  if (!s) return null;
  const channelId = hexToBytes(channel.channel_id);
  return {
    room: voiceGroupKey(s.secret, channelId, s.epoch),
    mediaKey: voiceMediaKey(s.secret, channelId, s.epoch),
  };
}

/** Whether `material` holds key material for a channel id (CHAN-06's shared
 *  "do I hold a key for this?" affordance — replaces ad-hoc `.channels.find(...)`
 *  lookups scattered across composer/invite/sendMessage guards). */
export function hasChannelKey(material: JoinMaterial, channelId: string): boolean {
  return material.channels.some((c) => c.id === channelId);
}

export function deriveKeys(material: JoinMaterial, channels: ChannelMetadata[]): CommunityKeys {
  const cid = hexToBytes(material.community_id);
  const root = hexToBytes(material.community_root);
  const channelKeys = new Map<string, GroupKey>();
  for (const ch of channels) {
    const gk = channelKeyFor(material, ch);
    if (gk) channelKeys.set(ch.channel_id, gk); // CHAN-01: keyless private channel skipped
  }
  return {
    control: controlGroupKey(root, cid, material.root_epoch),
    guestbook: guestbookGroupKey(root, cid, material.root_epoch),
    channels: channelKeys,
  };
}

/** Verify a community's owner proof: community_id == sha256(owner || salt). */
export function verifyOwner(material: JoinMaterial): boolean {
  const expected = bytesToHex(communityId(material.owner, hexToBytes(material.owner_salt)));
  return expected === material.community_id;
}

export interface Genesis {
  material: JoinMaterial;
  generalChannelId: string;
  /** control-plane editions to publish (plaintext seal at control_pk) */
  controlRumors: RumorTemplate[];
  /** guestbook rumors to publish (encrypted seal at guestbook_pk) */
  guestbookRumors: RumorTemplate[];
}

/**
 * Found a new community: mint the secrets and produce the two owner-signed
 * genesis editions (metadata + a public #general channel), plus the owner's
 * own Join (CORD-02 §1).
 */
export async function createCommunity(opts: {
  ownerPubkey: string;
  name: string;
  description?: string;
  relays: string[];
}): Promise<Genesis> {
  const ownerSalt = randomBytes(32);
  const communityRoot = randomBytes(32);
  const cid = bytesToHex(communityId(opts.ownerPubkey, ownerSalt));
  const generalChannelId = bytesToHex(randomBytes(32));

  const material: JoinMaterial = {
    community_id: cid,
    owner: opts.ownerPubkey,
    owner_salt: bytesToHex(ownerSalt),
    community_root: bytesToHex(communityRoot),
    root_epoch: 0,
    channels: [],
    // Canonicalize held_roots to [] so this genesis material is byte-identical to
    // what the engine's `buildChain` settles on after start() (epoch 0 has no prior
    // roots). Otherwise the missing field makes the Community List's post-start
    // `onMaterialChange` refresh look like a content change and publish 13302 a
    // second time — an extra signer.signEvent + nip44.encrypt on every create.
    held_roots: [],
    relays: opts.relays,
    name: opts.name,
  };

  const metadata: CommunityMetadata = {
    name: opts.name,
    description: opts.description,
    relays: opts.relays,
  };

  const controlRumors: RumorTemplate[] = [
    await EditionFactory.create({ vsk: VSK.METADATA, eid: cid, version: 1, content: JSON.stringify(metadata) }),
    await EditionFactory.create({
      vsk: VSK.CHANNEL,
      eid: generalChannelId,
      version: 1,
      content: JSON.stringify({ name: "general", private: false }),
    }),
  ];

  const guestbookRumors: RumorTemplate[] = [await JoinLeaveFactory.create("join")];

  return { material, generalChannelId, controlRumors, guestbookRumors };
}
