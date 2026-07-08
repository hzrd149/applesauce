import { EventCast, User } from "applesauce-core/casts";
import { type HiddenContentSigner, type NostrEvent } from "applesauce-core/helpers";
import { castEventStream } from "applesauce-core/observable/cast-stream";
import { watchEventUpdates } from "applesauce-core/observable";
import type { ChainableObservable } from "applesauce-core/observable";
import "applesauce-common/casts";
import { map, of, switchMap } from "rxjs";

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

  /** The decrypted memberships as an observable — emits `undefined` until unlocked, then re-emits on unlock. */
  get communities$(): ChainableObservable<CommunityListCommunity[] | undefined> {
    return this.$$ref("communities$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getCommunityList(event)?.communities),
      ),
    );
  }

  /** The live memberships as an observable — emits `undefined` until unlocked, then re-emits on unlock. */
  get liveCommunities$(): ChainableObservable<CommunityListCommunity[] | undefined> {
    return this.$$ref("liveCommunities$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getLiveCommunities(event)),
      ),
    );
  }

  /** The decrypted tombstones (left communities) as an observable — emits `undefined` until unlocked. */
  get tombstones$(): ChainableObservable<CommunityTombstone[] | undefined> {
    return this.$$ref("tombstones$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getCommunityList(event)?.tombstones),
      ),
    );
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
