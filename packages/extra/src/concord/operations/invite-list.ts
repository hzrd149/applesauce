// CORD-05 §4 Invite List (kind 13303) content operations. The list is a
// replaceable document a user encrypts to themselves, so every mutation is a
// token-keyed merge applied to the *current* contents. To honor "preserve what
// you don't understand" (CORD-02 §6) without forcing the caller to hand the whole
// list back, `modifyInviteList` decrypts the draft's current content in-chain,
// applies an operation, and re-encrypts. Composed by ../factories/invite-list.js.
//
// An `InviteListOperation` is a pure `(invites, tombstones) => next` delta over
// the decrypted arrays; the atomic ones below (mint/revoke) are the building
// blocks the factory chains and can be composed together.
//
// `modifyInviteList` uses the hidden-content (self-encryption) family
// exclusively: reads go through `getHiddenContent` and the write through
// `setHiddenContent`, which always encrypts to the signer's own pubkey and never
// takes a target — so the document can never be sealed to a different or unknown
// pubkey.

import type { EventOperation, EventSigner } from "applesauce-core/factories";
import { getHiddenContent, getHiddenContentEncryptionMethods } from "applesauce-core/helpers";
import { setHiddenContent } from "applesauce-core/operations/hidden-content";
import { mergeInvites, mergeTombstones, parseInviteList } from "../helpers/invite-list.js";
import type { InviteListInvite, InviteListTombstone } from "../types.js";

/** A token-keyed merge over the current invites and tombstones. */
export type InviteListOperation = (
  invites: InviteListInvite[],
  tombstones: InviteListTombstone[],
) => { invites: InviteListInvite[]; tombstones: InviteListTombstone[] };

/**
 * Mint a freshly-created invite link into the entries. An entry is immutable once
 * minted, so a token already present is left untouched (first-seen wins) — there
 * is no way to edit or delete a minted entry, only to revoke it (CORD-05 §4).
 */
export function mintInvite(invite: InviteListInvite): InviteListOperation {
  return (invites, tombstones) => ({ invites: mergeInvites(invites, [invite]), tombstones });
}

/**
 * Revoke an invite link by unioning in a tombstone. A tombstone is terminal and
 * always beats an entry, so a revoked link can never be resurrected — there is
 * deliberately no "un-revoke" (CORD-05 §4).
 */
export function revokeInvite(token: string, communityId: string): InviteListOperation {
  return (invites, tombstones) => ({
    invites,
    tombstones: mergeTombstones(tombstones, [{ token, community_id: communityId }]),
  });
}

/**
 * Decrypt the current self-encrypted invite list, apply an invite list operation,
 * and re-encrypt it to self. On an empty draft (a fresh list) the operation
 * receives empty arrays; on an existing event the prior contents are read from the
 * plaintext cached on the draft, falling back to a decrypt with the author's own
 * pubkey.
 */
export function modifyInviteList(apply: InviteListOperation, signer?: EventSigner): EventOperation {
  return async (draft) => {
    if (!signer) throw new Error("Signer required to encrypt the invite list");

    // Prefer the plaintext cached on the draft (carried across chained
    // mutations), otherwise decrypt the existing content with our own pubkey (the
    // draft template carries no pubkey, so we derive it from the signer).
    let json = getHiddenContent(draft);
    if (json === undefined && draft.content) {
      const { decrypt } = getHiddenContentEncryptionMethods(draft.kind, signer);
      json = await decrypt(await signer.getPublicKey(), draft.content);
    }

    const { invites, tombstones } = parseInviteList(json);
    const next = apply(invites, tombstones);
    const document = JSON.stringify({ entries: next.invites, tombstones: next.tombstones });
    return setHiddenContent(document, signer)(draft);
  };
}
