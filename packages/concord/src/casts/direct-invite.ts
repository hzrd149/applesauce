// CORD-05 §6 Direct Invite cast — a rich accessor over an unwrapped kind 3313
// rumor.
//
// Unlike the other concord casts, this one wraps the *inner rumor* of a standard
// NIP-59 gift wrap: unwrapping a Direct Invite with applesauce-common's
// `unlockGiftWrap`/`getGiftWrapRumor` yields the kind 3313 rumor, and that rumor
// is what we cast. A rumor is unsigned (`Rumor = UnsignedEvent & { id }`, no
// `sig`), so it isn't structurally a `NostrEvent` and the `EventCast<T extends
// NostrEvent>` bound rejects it at the type level — but `EventCast` never reads
// `sig` at runtime, so a single localized assertion lets a rumor ride the normal
// cast machinery. In exchange we inherit `author: User` (the inviter, resolvable
// to a profile from the store), `id`/`kind`/`uid`/`createdAt`/`pointer`, and
// core's per-event dedupe cache — hence a mandatory `store`, exactly as `author`
// needs.
//
// The gift-wrap decode already verified the seal signature and the author binding
// (`rumor.pubkey === seal.pubkey`) before returning the rumor, so `event.pubkey`
// IS the cryptographically-proven inviter.

import type { CastRefEventStore } from "applesauce-core/casts";
import { EventCast, castEvent } from "applesauce-core/casts";
import type { DirectInviteRumor } from "../helpers/direct-invite.js";
import { getDirectInviteBundle, isValidDirectInviteRumor } from "../helpers/direct-invite.js";
import type { InviteBundle, Rumor } from "../types.js";

/** A cast for a CORD-05 §6 Direct Invite (an unwrapped kind 3313 rumor). */

// @ts-ignore Tmp fix for the rumor type
export class ConcordDirectInvite extends EventCast<DirectInviteRumor> {
  constructor(event: Rumor, store: CastRefEventStore) {
    if (!isValidDirectInviteRumor(event)) throw new Error("Invalid Concord direct invite rumor (expected kind 3313)");
    super(event, store);
  }

  /** The unwrapped rumor (an alias for `event`, narrowed to a Direct Invite rumor). */
  get rumor(): DirectInviteRumor {
    return this.event as unknown as DirectInviteRumor;
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

  /** Optional unix-ms expiry; past it the preview still renders but joining refuses (CORD-05 §1). */
  get expiresAt(): number | undefined {
    return this.bundle?.expires_at;
  }

  /** Whether the invite has expired as of `now` (unix ms). Always false when no expiry is set. */
  expired(now = Date.now()): boolean {
    const exp = this.expiresAt;
    return exp !== undefined && now > exp;
  }
}

/**
 * Cast an unwrapped gift-wrap rumor (kind 3313) into a {@link ConcordDirectInvite},
 * reusing core's per-event dedupe cache. Throws if the rumor is not a Direct Invite
 * — guard with {@link isValidDirectInviteRumor} when scanning a mixed giftwrap inbox.
 * The `store` powers the inherited `author` accessor (the inviter's profile).
 */
export function castDirectInvite(rumor: Rumor, store: CastRefEventStore): ConcordDirectInvite {
  // @ts-ignore Tmp fix for the rumor type
  return castEvent(rumor, ConcordDirectInvite, store);
}
