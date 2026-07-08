import { EventCast, User } from "applesauce-core/casts";
import { type HiddenContentSigner, type NostrEvent } from "applesauce-core/helpers";
import { castEventStream } from "applesauce-core/observable/cast-stream";
import type { ChainableObservable } from "applesauce-core/observable";
import "applesauce-common/casts";
import { switchMap } from "rxjs";

import "../helpers/register.js";
import {
  INVITE_LIST_KIND,
  getInviteList,
  getLiveInvites,
  isInviteListUnlocked,
  unlockInviteList,
  type ParsedInviteList,
} from "../helpers/invite-list.js";
import type { InviteListInvite, InviteListTombstone } from "../types.js";

/** A cast for a Concord CORD-05 encrypted Invite List event (kind 13303). */
export class ConcordInviteList extends EventCast {
  constructor(event: NostrEvent, store: ConstructorParameters<typeof EventCast>[1]) {
    if (event.kind !== INVITE_LIST_KIND) throw new Error("Invalid Concord invite list event");
    super(event, store);
  }

  /** Whether the self-encrypted invite list plaintext is cached on the event. */
  get unlocked(): boolean {
    return isInviteListUnlocked(this.event);
  }

  /** The decrypted invite entries, if the event has been unlocked. */
  get invites(): InviteListInvite[] | undefined {
    return getInviteList(this.event)?.invites;
  }

  /** The decrypted tombstones (revoked links), if the event has been unlocked. */
  get tombstones(): InviteListTombstone[] | undefined {
    return getInviteList(this.event)?.tombstones;
  }

  /** The live invite links derived from the unlocked invites and tombstones. */
  get liveInvites(): InviteListInvite[] | undefined {
    return getLiveInvites(this.event);
  }

  /** Unlock and parse the self-encrypted invite list using the owning user's signer. */
  async unlock(signer: HiddenContentSigner): Promise<ParsedInviteList> {
    return unlockInviteList(this.event, signer);
  }
}

declare module "applesauce-core/casts" {
  interface User {
    /** The user's Concord Invite List event (kind 13303), if present in the event store. */
    readonly concordInviteList$: ChainableObservable<ConcordInviteList | undefined>;
  }
}

if (!Object.getOwnPropertyDescriptor(User.prototype, "concordInviteList$")) {
  Object.defineProperty(User.prototype, "concordInviteList$", {
    get: function (this: User) {
      return this.$$ref("concordInviteList$", (store) =>
        this.outboxes$.pipe(
          switchMap((outboxes) =>
            store
              .replaceable({ kind: INVITE_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
              .pipe(castEventStream(ConcordInviteList, store)),
          ),
        ),
      );
    },
    enumerable: true,
    configurable: false,
  });
}
