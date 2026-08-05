// CORD-05 §4 Invite List factory (kind 13303): a creator's self-encrypted,
// replaceable bookkeeping of minted invite links. One per user, signed by their
// real key and NIP-44 encrypted to self. The full merged document is
// (re)published on every change.
//
// Per the spec there are only two mutations — mint a link and revoke one — and
// both are token-keyed merges (entries are immutable, tombstones union and are
// terminal). The decrypt-merge-re-encrypt logic lives in
// ../operations/invite-list.js; this factory just wires the chain's signer into
// it.

import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, type NostrEvent } from "applesauce-core/helpers";
import { INVITE_LIST_KIND } from "../helpers/invite-list.js";
import type { InviteListInvite } from "../types.js";
import { mintInvite, revokeInvite, modifyInviteList, type InviteListOperation } from "../operations/invite-list.js";
// Ensures kind 13303 encrypts with NIP-44 (self-encryption).
import "../helpers/register.js";

/** A factory for the kind 13303 Invite List (CORD-05 §4). */
export class InviteListFactory extends EventFactory<typeof INVITE_LIST_KIND> {
  /** Creates a fresh Invite List factory seeded with an empty, self-encrypted document */
  static create(): InviteListFactory {
    return new InviteListFactory((res) => res(blankEventTemplate(INVITE_LIST_KIND))).pipe();
  }

  /** Creates a factory that modifies an existing Invite List event, merging changes into its contents */
  static modify(event: NostrEvent): InviteListFactory {
    if (!isKind(event, INVITE_LIST_KIND)) throw new Error("Expected a Concord invite list event");
    return new InviteListFactory((res) => res(toEventTemplate(event)));
  }

  /** Mints a freshly-created invite link (immutable once minted) */
  mintInvite(invite: InviteListInvite): InviteListFactory {
    return this.pipe(mintInvite(invite));
  }

  /** Revokes an invite link by token — terminal, a revoked link never resurrects */
  revokeInvite(token: string, communityId: string): InviteListFactory {
    return this.pipe(revokeInvite(token, communityId));
  }

  /**
   * Chains one or more invite list operations into a single
   * decrypt-merge-re-encrypt over the self-encrypted contents, wiring in the
   * chain's signer. Operations are applied left-to-right.
   */
  pipe(...operations: InviteListOperation[]): InviteListFactory {
    const apply: InviteListOperation = (invites, tombstones) => {
      let state = { invites, tombstones };
      for (const operation of operations) state = operation(state.invites, state.tombstones);
      return state;
    };
    let result: InviteListFactory;
    result = this.chain((draft) => modifyInviteList(apply, result.signer)(draft)) as InviteListFactory;
    return result;
  }
}
