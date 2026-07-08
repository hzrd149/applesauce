import { EventCast } from "applesauce-core/casts";
import { naddrEncode, type NostrEvent } from "applesauce-core/helpers";
import { watchEventUpdates } from "applesauce-core/observable";
import type { ChainableObservable } from "applesauce-core/observable";
import { map, of } from "rxjs";

import {
  buildInviteLink,
  getInviteBundleContent,
  getInviteBundlePointer,
  getInviteBundleVsk,
  isInviteBundleRevoked,
  isInviteBundleUnlocked,
  isValidInviteBundle,
  unlockInviteBundle,
  type InviteBundleEvent,
} from "../helpers/invite.js";
import type { InviteBundle } from "../types.js";

/**
 * A cast for a Concord CORD-05 addressable invite bundle event (kind 33301).
 *
 * Unlike the invite/community list casts, a bundle is authored by a throwaway
 * `link_signer` (not the member) and is decrypted with the unlock token carried
 * in the invite link fragment — never with a user's signer. It is located by its
 * naddr, so there is no `User.concord*$` accessor.
 */
export class ConcordInviteBundle extends EventCast<InviteBundleEvent> {
  constructor(event: NostrEvent, store: ConstructorParameters<typeof EventCast>[1]) {
    if (!isValidInviteBundle(event)) throw new Error("Invalid Concord invite bundle event");
    super(event, store);
  }

  /** The bundle's `vsk` edition tag (6 live, 9 revoked). */
  get vsk(): number {
    return getInviteBundleVsk(this.event);
  }

  /** Whether the bundle is a revocation tombstone (vsk 9). */
  get revoked(): boolean {
    return isInviteBundleRevoked(this.event);
  }

  /** Whether the bundle is a live, joinable edition (vsk 6). */
  get live(): boolean {
    return !this.revoked;
  }

  /** The addressable pointer (kind 33301, link_signer, `""`) locating this bundle. */
  get pointer() {
    return getInviteBundlePointer(this.event);
  }

  /** The naddr encoding of the bundle's coordinate. */
  get address(): string {
    return naddrEncode(this.pointer);
  }

  /** Builds the shareable invite link for this bundle from its unlock token and bootstrap relays. */
  link(base: string, token: Uint8Array, relays: string[]): string {
    return buildInviteLink(base, this.event.pubkey, token, relays);
  }

  /** Whether the bundle's encrypted contents have been decrypted and cached on the event. */
  get unlocked(): boolean {
    return isInviteBundleUnlocked(this.event);
  }

  /** The decrypted bundle contents, if the event has been unlocked. */
  get bundle(): InviteBundle | undefined {
    return getInviteBundleContent(this.event);
  }

  /** The decrypted bundle contents as an observable — emits `undefined` until unlocked, then re-emits on unlock. */
  get bundle$(): ChainableObservable<InviteBundle | undefined> {
    return this.$$ref("bundle$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getInviteBundleContent(event)),
      ),
    );
  }

  /**
   * Decrypts the bundle with the link's unlock token (from the invite fragment), caches it on the event,
   * and notifies subscribers so {@link bundle$} re-emits. Returns the cached bundle if already unlocked.
   */
  unlock(token: Uint8Array): InviteBundle {
    return unlockInviteBundle(this.event, token);
  }
}
