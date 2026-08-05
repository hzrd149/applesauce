// CORD-02 §8 Community List factory (kind 13302): a member's self-encrypted,
// replaceable membership document. One per user, signed by their real key and
// NIP-44 encrypted to self. The full merged document is (re)published on every
// change.
//
// Per the spec the mutations are atomic — join/refresh a membership and leave
// one — and each is a community_id-keyed merge (communities fold seed/current,
// tombstones union keeping the newest removal, liveness is derived). The
// decrypt-merge-re-encrypt logic lives in ../operations/community-list.js so
// callers never have to hand the whole document back; this factory just wires
// the chain's signer into it.

import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, type NostrEvent } from "applesauce-core/helpers";
import { COMMUNITY_LIST_KIND } from "../helpers/community-list.js";
import type { CommunityListCommunity, JoinMaterial } from "../types.js";
import {
  joinCommunity,
  leaveCommunity,
  refreshCommunity,
  modifyCommunityList,
  type CommunityListOperation,
} from "../operations/community-list.js";
// Ensures kind 13302 encrypts with NIP-44 (self-encryption).
import "../helpers/register.js";

/** A factory for the kind 13302 Community List (CORD-02 §8). */
export class CommunityListFactory extends EventFactory<typeof COMMUNITY_LIST_KIND> {
  /** Creates a fresh Community List factory seeded with an empty, self-encrypted document */
  static create(): CommunityListFactory {
    return new CommunityListFactory((res) => res(blankEventTemplate(COMMUNITY_LIST_KIND))).pipe();
  }

  /** Creates a factory that modifies an existing Community List event, merging changes into its contents */
  static modify(event: NostrEvent): CommunityListFactory {
    if (!isKind(event, COMMUNITY_LIST_KIND)) throw new Error("Expected a Concord community list event");
    return new CommunityListFactory((res) => res(toEventTemplate(event)));
  }

  /** Joins or refreshes a membership (community_id-keyed merge, resurrects a re-join) */
  join(community: CommunityListCommunity): CommunityListFactory {
    return this.pipe(joinCommunity(community));
  }

  /** Leaves a community by tombstoning the membership — a later join can still resurrect it */
  leave(communityId: string, removedAt: number = Date.now()): CommunityListFactory {
    return this.pipe(leaveCommunity(communityId, removedAt));
  }

  /** Replaces a membership's `current` snapshot in place (a caught-up rename or channel-key addition) */
  refresh(current: JoinMaterial): CommunityListFactory {
    return this.pipe(refreshCommunity(current));
  }

  /**
   * Chains one or more community list operations into a single
   * decrypt-merge-re-encrypt over the self-encrypted contents, wiring in the
   * chain's signer. Operations are applied left-to-right.
   */
  pipe(...operations: CommunityListOperation[]): CommunityListFactory {
    const apply: CommunityListOperation = (communities, tombstones) => {
      let state = { communities, tombstones };
      for (const operation of operations) state = operation(state.communities, state.tombstones);
      return state;
    };
    let result: CommunityListFactory;
    result = this.chain((draft) => modifyCommunityList(apply, result.signer)(draft)) as CommunityListFactory;
    return result;
  }
}
