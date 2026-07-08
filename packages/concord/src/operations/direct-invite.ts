// CORD-05 §6 Direct Invites — the build half.
//
// A Direct Invite is a *standard* NIP-59 giftwrap (rumor -> kind 13 seal ->
// ephemeral kind 1059 wrap), NOT CORD-01's reversed stream envelope: it rides
// person-addressed NIP-59 to a known npub, so it reuses applesauce-common's
// standard `toRumor`/`sealRumor` verbatim and only replaces the final wrap step
// to carry the `["k","3313"]` index tag (which common's meta-tag options can't
// emit) plus an optional NIP-40 `expiration`. The parse/validate half and the
// bundle bounds live in ../helpers/direct-invite.js and ../helpers/invite-bundle.js.

import { GiftWrap } from "applesauce-common/operations";
import type { EventOperation, EventSigner } from "applesauce-core/factories";
import { nip44 } from "applesauce-core/helpers/encryption";
import { finalizeEvent, type EventTemplate, type NostrEvent, type UnsignedEvent } from "applesauce-core/helpers/event";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { eventPipe } from "applesauce-core/helpers/pipeline";
import { unixNow } from "applesauce-core/helpers/time";

import { DIRECT_INVITE_INDEX, DIRECT_INVITE_KIND } from "../helpers/direct-invite.js";
import { GIFT_WRAP_KIND } from "../helpers/gift-wrap.js";
import type { InviteBundle } from "../types.js";

export type DirectInviteWrapOptions = {
  /** Override the wrap's `created_at`; defaults to a randomized recent past (NIP-59 tweak). */
  created_at?: number;
  /** Optional NIP-40 expiration (unix seconds) so relays may prune the invite (CORD-05 §6). */
  expiration?: number;
};

/** A recent-past timestamp with a random ≤1h offset — NIP-59's timestamp tweak. */
function randomNow(): number {
  return unixNow() - Math.floor(Math.random() * 60 * 60);
}

/** Stamp a blank draft into a kind 3313 Direct Invite rumor carrying the §1 bundle JSON. */
export function setDirectInviteBundle(bundle: InviteBundle): EventOperation {
  return async (draft) => ({ ...draft, kind: DIRECT_INVITE_KIND, content: JSON.stringify(bundle), tags: [] });
}

/**
 * Wrap a standard NIP-59 seal in a Direct Invite giftwrap (kind 1059) addressed
 * to `recipient`: the seal is NIP-44-encrypted under a fresh ephemeral↔recipient
 * conversation key, the outer tags carry the recipient `p` and the `["k","3313"]`
 * index tag (CORD-05 §6), plus an optional NIP-40 `expiration`. Signed by the
 * single-use ephemeral key. The final step of the pipeline.
 */
export function wrapDirectInvite(
  recipient: string,
  opts: DirectInviteWrapOptions = {},
): EventOperation<NostrEvent, NostrEvent> {
  return (seal) => {
    const eph = generateSecretKey();
    const convKey = nip44.getConversationKey(eph, recipient);
    const tags: string[][] = [
      ["p", recipient],
      ["k", DIRECT_INVITE_INDEX],
    ];
    if (opts.expiration) tags.push(["expiration", String(opts.expiration)]);
    return finalizeEvent(
      {
        kind: GIFT_WRAP_KIND,
        content: nip44.encrypt(JSON.stringify(seal), convKey),
        tags,
        created_at: opts.created_at ?? randomNow(),
      },
      eph,
    );
  };
}

/**
 * Build a full Direct Invite from a bundle: rumor(3313) -> standard NIP-59
 * seal(13) -> Direct Invite wrap(1059) with the `k` index tag. Composes common's
 * standard `toRumor`/`sealRumor` (encrypting the seal sender↔recipient) with
 * {@link wrapDirectInvite}. Chain onto a bundle draft or apply to a template.
 */
export function directInvite(
  bundle: InviteBundle,
  recipient: string,
  signer?: EventSigner,
  opts: DirectInviteWrapOptions = {},
): EventOperation<EventTemplate | UnsignedEvent | NostrEvent, NostrEvent> {
  return eventPipe(
    setDirectInviteBundle(bundle),
    GiftWrap.toRumor(signer),
    // @ts-expect-error the rumor -> seal step changes the event type mid-pipe
    GiftWrap.sealRumor(recipient, signer),
    wrapDirectInvite(recipient, opts),
  ) as EventOperation<EventTemplate | UnsignedEvent | NostrEvent, NostrEvent>;
}
