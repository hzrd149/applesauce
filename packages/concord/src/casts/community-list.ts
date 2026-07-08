import { EventCast, User } from "applesauce-core/casts";
import { type HiddenContentSigner, type NostrEvent } from "applesauce-core/helpers";
import { castEventStream } from "applesauce-core/observable/cast-stream";
import type { ChainableObservable } from "applesauce-core/observable";
import "applesauce-common/casts";
import { switchMap } from "rxjs";

import "../helpers/register.js";
import {
  COMMUNITY_LIST_KIND,
  getCommunityList,
  getLiveCommunities,
  isCommunityListUnlocked,
  unlockCommunityList,
  type ParsedCommunityList,
} from "../helpers/community-list.js";
import type { CommunityListCommunity, CommunityTombstone } from "../types.js";

/** A cast for a Concord CORD-02 encrypted Community List event (kind 13302). */
export class ConcordCommunityList extends EventCast {
  constructor(event: NostrEvent, store: ConstructorParameters<typeof EventCast>[1]) {
    if (event.kind !== COMMUNITY_LIST_KIND) throw new Error("Invalid Concord community list event");
    super(event, store);
  }

  /** Whether the self-encrypted community list plaintext is cached on the event. */
  get unlocked(): boolean {
    return isCommunityListUnlocked(this.event);
  }

  /** The decrypted membership communities, if the event has been unlocked. */
  get communities(): CommunityListCommunity[] | undefined {
    return getCommunityList(this.event)?.communities;
  }

  /** The decrypted tombstones (left communities), if the event has been unlocked. */
  get tombstones(): CommunityTombstone[] | undefined {
    return getCommunityList(this.event)?.tombstones;
  }

  /** The live community memberships derived from the unlocked communities and tombstones. */
  get liveCommunities(): CommunityListCommunity[] | undefined {
    return getLiveCommunities(this.event);
  }

  /** Unlock and parse the self-encrypted community list using the owning user's signer. */
  async unlock(signer: HiddenContentSigner): Promise<ParsedCommunityList> {
    return unlockCommunityList(this.event, signer);
  }
}

declare module "applesauce-core/casts" {
  interface User {
    /** The user's Concord Community List event (kind 13302), if present in the event store. */
    readonly concordCommunityList$: ChainableObservable<ConcordCommunityList | undefined>;
  }
}

if (!Object.getOwnPropertyDescriptor(User.prototype, "concordCommunityList$")) {
  Object.defineProperty(User.prototype, "concordCommunityList$", {
    get: function (this: User) {
      return this.$$ref("concordCommunityList$", (store) =>
        this.outboxes$.pipe(
          switchMap((outboxes) =>
            store
              .replaceable({ kind: COMMUNITY_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
              .pipe(castEventStream(ConcordCommunityList, store)),
          ),
        ),
      );
    },
    enumerable: true,
    configurable: false,
  });
}
