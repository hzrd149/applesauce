// CORD-02 §8 Community List (kind 13302) content operations. The list is a
// replaceable document a user encrypts to themselves, so every mutation is a
// community_id-keyed merge applied to the *current* contents. To honor "preserve
// what you don't understand" (CORD-02 §6) without forcing the caller to hand the
// whole list back, `modifyCommunityList` decrypts the draft's current content
// in-chain, applies an operation, and re-encrypts. Composed by
// ../factories/community-list.js.
//
// A `CommunityListOperation` is a pure `(communities, tombstones) => next` delta
// over the decrypted arrays; the atomic ones below (join/leave/refresh) are the
// building blocks the factory chains and can be composed together.
//
// `modifyCommunityList` uses the hidden-content (self-encryption) family
// exclusively: reads go through `getHiddenContent` and the write through
// `setHiddenContent`, which always encrypts to the signer's own pubkey and never
// takes a target — so the document can never be sealed to a different or unknown
// pubkey.

import type { EventOperation, EventSigner } from "applesauce-core/factories";
import { getHiddenContent, getHiddenContentEncryptionMethods } from "applesauce-core/helpers";
import { setHiddenContent } from "applesauce-core/operations/hidden-content";
import { mergeCommunities, mergeCommunityTombstones, parseCommunityList } from "../helpers/community-list.js";
import type { CommunityListCommunity, CommunityTombstone, JoinMaterial } from "../types.js";

/** A community_id-keyed merge over the current communities and tombstones. */
export type CommunityListOperation = (
  communities: CommunityListCommunity[],
  tombstones: CommunityTombstone[],
) => { communities: CommunityListCommunity[]; tombstones: CommunityTombstone[] };

/**
 * Join or refresh a membership by merging it into the communities (community_id-keyed,
 * resurrects a re-joined tombstoned id — CORD-02 §8).
 */
export function joinCommunity(community: CommunityListCommunity): CommunityListOperation {
  return (communities, tombstones) => ({ communities: mergeCommunities(communities, [community]), tombstones });
}

/**
 * Leave a community by unioning in a tombstone (keeping the newest removal). The
 * entry stays in the document and a later join can still resurrect it (CORD-02 §8).
 */
export function leaveCommunity(communityId: string, removedAt: number = Date.now()): CommunityListOperation {
  return (communities, tombstones) => ({
    communities,
    tombstones: mergeCommunityTombstones(tombstones, [{ community_id: communityId, removed_at: removedAt }]),
  });
}

/**
 * Replace a membership's `current` snapshot in place (an authoritative local
 * refresh — a caught-up rename or a channel-key addition). Bypasses the
 * epoch-keyed `freshest` so a same-epoch update can't lose the canonical-bytes
 * tiebreak. Absent memberships are left untouched.
 */
export function refreshCommunity(current: JoinMaterial): CommunityListOperation {
  return (communities, tombstones) => {
    const idx = (communities ?? []).findIndex((e) => e.community_id === current.community_id);
    if (idx === -1) return { communities, tombstones };
    return { communities: communities.map((e, i) => (i === idx ? { ...e, current } : e)), tombstones };
  };
}

/**
 * Decrypt the current self-encrypted community list, apply a community list
 * operation, and re-encrypt it to self. On an empty draft (a fresh list) the
 * operation receives empty arrays; on an existing event the prior contents are
 * read from the plaintext cached on the draft, falling back to a decrypt with the
 * author's own pubkey.
 */
export function modifyCommunityList(apply: CommunityListOperation, signer?: EventSigner): EventOperation {
  return async (draft) => {
    if (!signer) throw new Error("Signer required to encrypt the community list");

    // Prefer the plaintext cached on the draft (carried across chained
    // mutations), otherwise decrypt the existing content with our own pubkey (the
    // draft template carries no pubkey, so we derive it from the signer).
    let json = getHiddenContent(draft);
    if (json === undefined && draft.content) {
      const { decrypt } = getHiddenContentEncryptionMethods(draft.kind, signer);
      json = await decrypt(await signer.getPublicKey(), draft.content);
    }

    const { communities, tombstones } = parseCommunityList(json);
    const next = apply(communities, tombstones);
    // The wire document keys the array as `entries` (armada-compatible).
    const document = JSON.stringify({ entries: next.communities, tombstones: next.tombstones });
    return setHiddenContent(document, signer)(draft);
  };
}
