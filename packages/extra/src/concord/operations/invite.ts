// CORD-05 Invite-bundle rumor operations: the encrypted bundle event and its
// revocation. Composed into kind 33301 templates by ../factories/invite.js.
// The link codec + bundle crypto live in ../helpers/invite.js.

import type { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags } from "applesauce-core/operations";
import { setSingletonTag } from "applesauce-core/operations/tag/common";
import { encryptBundle } from "../helpers/invite.js";
import type { InviteBundle } from "../types.js";

/** Set an addressable invite-bundle's encrypted content + `d`/`vsk` tags. */
export function setInviteBundle(bundle: InviteBundle, token: Uint8Array): EventOperation {
  const tags = modifyPublicTags(setSingletonTag(["d", ""]), setSingletonTag(["vsk", "6"]));
  return async (draft) => ({ ...(await tags(draft)), content: encryptBundle(bundle, token) });
}

/** Replace an invite bundle with an empty revocation edition (vsk 9). */
export function setRevocation(): EventOperation {
  const tags = modifyPublicTags(setSingletonTag(["d", ""]), setSingletonTag(["vsk", "9"]));
  return async (draft) => ({ ...(await tags(draft)), content: "" });
}
