import { ChainableObservable } from "applesauce-core";
import { castUser, User } from "applesauce-core/casts/user";
import { getExpirationTimestamp } from "applesauce-core/helpers/expiration";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { addRelayHintsToPointer } from "applesauce-core/helpers";
import { map, of } from "rxjs";
import {
  getUserStatusPointer,
  getUserStatusType,
  isUserStatusCleared,
  isValidUserStatus,
  UserStatusEvent,
  UserStatusPointer,
} from "../helpers/user-status.js";
import { castEventStream, castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast for NIP-38 user status events (kind 30315) */
export class UserStatus extends EventCast<UserStatusEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidUserStatus(event)) throw new Error("Invalid user status");
    super(event, store);
  }

  /** The status type ("general", "music", etc) */
  get type() {
    return getUserStatusType(this.event);
  }

  /** The status text */
  get content() {
    return this.event.content;
  }

  /** Whether the status has been cleared (empty content) */
  get cleared() {
    return isUserStatusCleared(this.event);
  }

  /** The unix timestamp when the status expires */
  get expiration() {
    return getExpirationTimestamp(this.event);
  }

  /** The URL, profile, event, or address the status links to */
  get link(): UserStatusPointer | null {
    return getUserStatusPointer(this.event);
  }

  /** The URL the status links to */
  get url(): string | undefined {
    const pointer = this.link;
    return pointer?.type === "url" ? pointer.data : undefined;
  }

  /** The user the status links to */
  get user(): User | undefined {
    const pointer = this.link;
    return pointer?.type === "nprofile" ? castUser(pointer.data, this.store) : undefined;
  }

  /** The event the status links to */
  get linkedEvent$(): ChainableObservable<NostrEvent | undefined> {
    return this.$$ref("linkedEvent$", (store) => {
      const pointer = this.link;
      if (pointer?.type !== "nevent" && pointer?.type !== "naddr") return of(undefined);
      return store.event(addRelayHintsToPointer(pointer.data, this.seen));
    });
  }
}

Object.defineProperty(User.prototype, "status$", {
  get(this: User) {
    return this.$$ref("status$", (store) =>
      store.replaceable({ kind: kinds.UserStatuses, pubkey: this.pubkey, identifier: "general" }).pipe(
        castEventStream(UserStatus, store),
        map((status) => (status && !status.cleared ? status : undefined)),
      ),
    );
  },
  configurable: true,
  enumerable: false,
});

Object.defineProperty(User.prototype, "statuses$", {
  get(this: User) {
    return this.$$ref("statuses$", (store) =>
      store.timeline({ kinds: [kinds.UserStatuses], authors: [this.pubkey] }).pipe(
        castTimelineStream(UserStatus, store),
        map((statuses) => statuses.filter((status) => !status.cleared)),
      ),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "applesauce-core/casts" {
  interface User {
    /** The user's "general" status */
    get status$(): ChainableObservable<UserStatus | undefined>;
    /** All of the user's statuses that have not been cleared */
    get statuses$(): ChainableObservable<UserStatus[]>;
  }
}
