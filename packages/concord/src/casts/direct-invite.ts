// CORD-05 §6 Direct Invite cast — a rich accessor over an unwrapped kind 3313
// rumor.
//
// Unlike the other concord casts, this one wraps the *inner rumor* of a standard
// NIP-59 gift wrap: unwrapping a Direct Invite with applesauce-common's
// `unlockGiftWrap`/`getGiftWrapRumor` yields the kind 3313 rumor, and that rumor
// is what we cast. `EventCast` is bounded by `StoreEvent`, so it casts an unsigned
// `Rumor` natively — no assertion needed. We inherit `author: User` (the inviter,
// resolvable to a profile from the store), `id`/`kind`/`uid`/`createdAt`/`pointer`,
// and core's per-event dedupe cache — hence a mandatory `store`, exactly as
// `author` needs.
//
// The gift-wrap decode already verified the seal signature and the author binding
// (`rumor.pubkey === seal.pubkey`) before returning the rumor, so `event.pubkey`
// IS the cryptographically-proven inviter.

import type { CastRefEventStore } from "applesauce-core/casts";
import { EventCast } from "applesauce-core/casts";
import { unixNow } from "applesauce-core/helpers/time";
import type { DirectInviteRumor } from "../helpers/direct-invite.js";
import { getDirectInviteBundle, isValidDirectInviteRumor } from "../helpers/direct-invite.js";
import type { InviteBundle, Rumor } from "../types.js";

/** A cast for a CORD-05 §6 Direct Invite (an unwrapped kind 3313 rumor). */
export class ConcordDirectInvite extends EventCast<DirectInviteRumor> {
  constructor(event: Rumor, store: CastRefEventStore) {
    if (!isValidDirectInviteRumor(event)) throw new Error("Invalid Concord direct invite rumor (expected kind 3313)");
    super(event, store);
  }

  /** The unwrapped rumor (an alias for `event`, narrowed to a Direct Invite rumor). */
  get rumor(): DirectInviteRumor {
    return this.event;
  }

  /**
   * The inviter's real pubkey — the seal author. The gift-wrap decode enforces the
   * CORD-01 author binding, so this is the cryptographically-proven inviter.
   * (For the inviter as a resolvable profile, use the inherited `author`.)
   */
  get inviter(): string {
    return this.event.pubkey;
  }

  /**
   * The validated, self-certified §1 bundle, or `undefined` if the payload fails
   * the owner proof or the §1 bounds. Parsed once and memoized on the rumor by
   * {@link getDirectInviteBundle}.
   */
  get bundle(): InviteBundle | undefined {
    return getDirectInviteBundle(this.rumor);
  }

  /** Whether the invite carries a valid, self-certifying bundle. */
  get valid(): boolean {
    return this.bundle !== undefined;
  }

  /** The community id the invite grants access to, if the bundle is valid. */
  get communityId(): string | undefined {
    return this.bundle?.community_id;
  }

  /** Optional unix-seconds expiry (D-05); past it the preview still renders but joining refuses (CORD-05 §1). */
  get expiresAt(): number | undefined {
    return this.bundle?.expires_at;
  }

  /** Whether the invite has expired as of `now` (unix seconds). Always false when no expiry is set. */
  expired(now = unixNow()): boolean {
    const exp = this.expiresAt;
    return exp !== undefined && now > exp;
  }
}

// No dedicated cast helper: cast an unwrapped gift-wrap rumor (kind 3313) with core's generic
// `castEvent(rumor, ConcordDirectInvite, store)`. It throws if the rumor is not a Direct Invite
// (guard with `isValidDirectInviteRumor` when scanning a mixed giftwrap inbox); the `store`
// powers the inherited `author` accessor.
