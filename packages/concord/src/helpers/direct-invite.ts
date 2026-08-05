// CORD-05 §6 Direct Invites — the parse/validate half.
//
// A Direct Invite hands the §1 CommunityInvite bundle straight to a known npub
// over a *standard* NIP-59 giftwrap (ephemeral 1059 wrap, recipient in `p`, a
// kind 13 seal — NOT CORD-01's reversed 20013/20014 stream seal), its rumor kind
// 3313 with the bundle JSON as content. The outer `["k","3313"]` tag makes the
// invite indexed so a recipient can look up exactly their invites without
// decrypting every giftwrap p-tagged at them (NIP-17's cost).
//
// The tag is unsigned relay-visible bytes — a hint, never authority. An invite
// is whatever *unwraps* to a kind 3313 rumor, so the receive path validates the
// unwrapped rumor kind and honors an untagged 3313 all the same; the build path
// still emits the tag so it stays indexable. The bundle self-certifies exactly
// as a fetched one (owner proof + §1 bounds via {@link validateInviteBundle}).

import { EncryptedContentSigner, getExpirationTimestamp, safeParse } from "applesauce-core/helpers";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, kinds, KnownEvent, type NostrEvent } from "applesauce-core/helpers/event";
import type { InviteBundle, Rumor } from "../types.js";
import { validateInviteBundle } from "./invite-bundle.js";
import { isGiftWrapUnlocked, lockGiftWrap, unlockGiftWrap } from "applesauce-common/helpers";

/** Concord Direct Invite rumor kind (CORD-02 Appendix B). */
export const DIRECT_INVITE_KIND = 3313;

/** The outer wrap's `k` index-tag value naming the rumor's kind (CORD-05 §6). */
export const DIRECT_INVITE_INDEX = String(DIRECT_INVITE_KIND);

/** A rumor validated as a Concord Direct Invite (kind 3313). */
export type DirectInviteRumor = Omit<Rumor, "kind"> & { kind: typeof DIRECT_INVITE_KIND };

/** A validated Direct Invite gift wrap (kind 1059 with `p` + `k:3313` tags, CORD-05 §6). */
export type DirectInviteEvent = KnownEvent<typeof kinds.GiftWrap>;

/** Symbol for caching a parsed invite bundle on a Direct Invite rumor. */
export const DirectInviteBundleSymbol = Symbol.for("concord-direct-invite-bundle");

/**
 * The relay filter for a recipient's indexed Direct Invites (CORD-05 §6):
 * `{ kinds:[1059], "#p":[me], "#k":["3313"] }`. Surfaces invites even in a client
 * that syncs no other giftwrap traffic. A client scanning its general giftwrap
 * inbox honors an untagged 3313 all the same — this filter is the cheap path.
 */
export function directInviteFilter(recipient: string): {
  kinds: number[];
  "#p": string[];
  "#k": string[];
} {
  return { kinds: [kinds.GiftWrap], "#p": [recipient], "#k": [DIRECT_INVITE_INDEX] };
}

/**
 * Returns true if the event is a Direct Invite gift wrap: kind 1059 with the
 * indexed `k:3313` tag and a recipient `p` tag (CORD-05 §6).
 */
export function isValidDirectInvite(event?: NostrEvent): event is DirectInviteEvent {
  if (!event || event.kind !== kinds.GiftWrap) return false;
  if (!event.tags.some((t) => t[0] === "k" && t[1] === DIRECT_INVITE_INDEX)) return false;
  const recipient = getTagValue(event, "p");
  return !!recipient && /^[a-f0-9]{64}$/.test(recipient);
}

/** Returns the invitee's pubkey from a Direct Invite gift wrap's `p` tag. */
export function getDirectInviteRecipient(event: DirectInviteEvent): string;
export function getDirectInviteRecipient(event?: NostrEvent): string | undefined;
export function getDirectInviteRecipient(event?: NostrEvent): string | undefined {
  if (!isValidDirectInvite(event)) return undefined;
  return getTagValue(event, "p") || undefined;
}

/** Returns the NIP-40 expiration (unix seconds) from a Direct Invite gift wrap, if present. */
export function getDirectInviteExpiration(event?: NostrEvent): number | undefined {
  return event && getExpirationTimestamp(event);
}

/** Whether the Direct Invite gift wrap is unlocked. */
export function isDirectInviteUnlocked(event: NostrEvent): boolean {
  return isGiftWrapUnlocked(event);
}

/** Lock a Direct Invite gift wrap. */
export function lockDirectInvite(event: NostrEvent | DirectInviteEvent): void {
  lockGiftWrap(event);
}

/** Unlock a Direct Invite gift wrap and parse its bundle. */
export async function unlockDirectInvite(
  event: NostrEvent | DirectInviteEvent,
  signer: EncryptedContentSigner,
): Promise<InviteBundle | undefined> {
  const rumor = await unlockGiftWrap(event, signer);
  return isValidDirectInviteRumor(rumor) ? getDirectInviteBundle(rumor) : undefined;
}

/**
 * Returns true if the rumor is a valid Direct Invite: kind 3313 (CORD-05 §6).
 * The bundle payload is validated separately via {@link getDirectInviteBundle}.
 */
export function isValidDirectInviteRumor(rumor?: Rumor): rumor is DirectInviteRumor {
  return !!rumor && rumor.kind === DIRECT_INVITE_KIND;
}

/**
 * Parse and validate a Direct Invite rumor's payload into a bounded, self-
 * certified bundle (CORD-05 §6): rejects a non-3313 rumor, unparseable content,
 * or a bundle that fails the owner proof / §1 bounds. Returns the normalized
 * bundle or `undefined`. `expires_at` is a join-time refusal, not checked here.
 */
export function getDirectInviteBundle(rumor: DirectInviteRumor): InviteBundle;
export function getDirectInviteBundle(rumor?: Rumor): InviteBundle | undefined;
export function getDirectInviteBundle(rumor?: Rumor): InviteBundle | undefined {
  if (!isValidDirectInviteRumor(rumor)) return undefined;

  return getOrComputeCachedValue(rumor, DirectInviteBundleSymbol, () =>
    validateInviteBundle(safeParse<InviteBundle>(rumor.content)),
  );
}
