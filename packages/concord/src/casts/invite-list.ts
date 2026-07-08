import { EventCast, User } from "applesauce-core/casts";
import { type HiddenContentSigner, type NostrEvent } from "applesauce-core/helpers";
import { castEventStream } from "applesauce-core/observable/cast-stream";
import { watchEventUpdates, withImmediateValueOrDefault } from "applesauce-core/observable";
import type { ChainableObservable } from "applesauce-core/observable";
import "applesauce-common/casts";
import { combineLatest, map, of, switchMap } from "rxjs";

import "../helpers/register.js";
import {
  INVITE_LIST_KIND,
  getInviteBundleLocator,
  getInviteList,
  getLiveInvites,
  isInviteListUnlocked,
  unlockInviteList,
  type ParsedInviteList,
} from "../helpers/invite-list.js";
import { ConcordInviteBundle } from "./invite-bundle.js";
import type { InviteListInvite, InviteListTombstone } from "../types.js";

/** An invite entry paired with its resolved bundle event (kind 33301), if present in the store. */
export interface InviteWithBundle {
  /** The invite entry from the user's invite list. */
  invite: InviteListInvite;
  /** The bundle event cast, or `undefined` while it is still loading or was not found. */
  bundle: ConcordInviteBundle | undefined;
}

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

  /** The decrypted invite entries as an observable — emits `undefined` until unlocked, then re-emits on unlock. */
  get invites$(): ChainableObservable<InviteListInvite[] | undefined> {
    return this.$$ref("invites$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getInviteList(event)?.invites),
      ),
    );
  }

  /** The live invite links as an observable — emits `undefined` until unlocked, then re-emits on unlock. */
  get liveInvites$(): ChainableObservable<InviteListInvite[] | undefined> {
    return this.$$ref("liveInvites$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getLiveInvites(event)),
      ),
    );
  }

  /** The decrypted tombstones (revoked links) as an observable — emits `undefined` until unlocked. */
  get tombstones$(): ChainableObservable<InviteListTombstone[] | undefined> {
    return this.$$ref("tombstones$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getInviteList(event)?.tombstones),
      ),
    );
  }

  /**
   * Each invite paired with its bundle event (kind 33301), resolved from the event store — and, when a
   * loader is attached, fetched from the network by proxy. Emits `undefined` until unlocked; each pairing's
   * `bundle` is `undefined` until it loads, then tracks the live/revoked edition.
   */
  get bundles$(): ChainableObservable<InviteWithBundle[] | undefined> {
    return this.$$ref("bundles$", (store) =>
      this.invites$.pipe(
        switchMap((invites) => {
          if (!invites) return of(undefined);
          if (invites.length === 0) return of([] as InviteWithBundle[]);
          // Each pairing seeds an immediate `{ invite, bundle: undefined }` so a slow or hanging bundle
          // lookup can never stall combineLatest — every invite renders at once and each bundle fills in
          // as it resolves.
          return combineLatest(
            invites.map((invite) =>
              store.replaceable(getInviteBundleLocator(invite)).pipe(
                castEventStream(ConcordInviteBundle, store),
                map((bundle) => ({ invite, bundle })),
                withImmediateValueOrDefault({ invite, bundle: undefined } as InviteWithBundle),
              ),
            ),
          );
        }),
      ),
    );
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
