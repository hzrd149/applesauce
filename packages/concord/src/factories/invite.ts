// CORD-05 Invite-bundle rumor factory: the addressable kind 33301 bundle event
// and its revocation, which share one coordinate (`d: ""`, authored by the
// link_signer). A revocation is the same event re-posted empty with a vsk 9 tag,
// so both states live on one factory. Signed with the link_signer key, not the
// member's signer, so this produces templates for the caller to finalize.

import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, type NostrEvent } from "applesauce-core/helpers";
import { INVITE_BUNDLE_KIND } from "../helpers/invite.js";
import type { InviteBundle } from "../types.js";
import { setInviteBundle, setRevocation } from "../operations/invite.js";

/** A factory for the addressable kind 33301 invite bundle and its revocation (CORD-05 §1-2). */
export class InviteBundleFactory extends EventFactory<typeof INVITE_BUNDLE_KIND> {
  /** Creates a fresh live invite bundle (vsk 6) */
  static create(bundle: InviteBundle, token: Uint8Array): InviteBundleFactory {
    return new InviteBundleFactory((res) => res(blankEventTemplate(INVITE_BUNDLE_KIND))).bundle(bundle, token);
  }

  /** Creates a fresh revocation tombstone (vsk 9) at the bundle's coordinate */
  static revoke(): InviteBundleFactory {
    return new InviteBundleFactory((res) => res(blankEventTemplate(INVITE_BUNDLE_KIND))).revoke();
  }

  /** Creates a factory configured to modify (refresh or revoke) an existing bundle event */
  static modify(event: NostrEvent): InviteBundleFactory {
    if (!isKind(event, INVITE_BUNDLE_KIND)) throw new Error("Expected an invite bundle event");
    return new InviteBundleFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the addressable invite-bundle's encrypted content + `d`/`vsk` tags (vsk 6) */
  bundle(bundle: InviteBundle, token: Uint8Array) {
    return this.chain(setInviteBundle(bundle, token));
  }

  /** Replaces the invite bundle with an empty revocation edition (vsk 9) */
  revoke() {
    return this.chain(setRevocation());
  }
}
