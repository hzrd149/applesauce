// CORD-05 §6 Direct Invite factory: a standard NIP-59 giftwrap (kind 1059)
// handing the §1 bundle to a known npub, indexed by the `["k","3313"]` tag. The
// inviter signs the seal with their real key, so `create` needs a signer and
// yields a fully-signed wrap the caller publishes to the recipient's 10050 inbox
// (NIP-17) — not a template. The bundle codec + parse path live in
// ../helpers/direct-invite.js; the envelope pipeline in ../operations/direct-invite.js.

import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import type { EventSigner } from "applesauce-core/factories";
import { kinds } from "applesauce-core/helpers";
import type { KnownEvent, KnownEventTemplate } from "applesauce-core/helpers";
import { DIRECT_INVITE_KIND } from "../helpers/direct-invite.js";
import { directInvite, type DirectInviteWrapOptions } from "../operations/direct-invite.js";
import type { InviteBundle } from "../types.js";

/** A factory for a CORD-05 §6 Direct Invite giftwrap (kind 1059 wrap / kind 3313 rumor). */
export class DirectInviteFactory extends EventFactory<kinds.GiftWrap, KnownEventTemplate<kinds.GiftWrap>> {
  /**
   * Builds a signed Direct Invite giftwrap addressed to `recipient`.
   * @param bundle - The §1 CommunityInvite bundle to hand over.
   * @param recipient - The invitee's real pubkey (the wrap's `p` target).
   * @param signer - The inviter's signer (seals the kind 3313 rumor with their real key).
   * @param opts - Optional `created_at` / NIP-40 `expiration`.
   */
  static create(
    bundle: InviteBundle,
    recipient: string,
    signer: EventSigner,
    opts?: DirectInviteWrapOptions,
  ): Promise<KnownEvent<kinds.GiftWrap>> {
    return directInvite(bundle, recipient, signer, opts)(blankEventTemplate(DIRECT_INVITE_KIND)) as Promise<
      KnownEvent<kinds.GiftWrap>
    >;
  }
}
