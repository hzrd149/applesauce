import { EventOperation } from "applesauce-core/factories";
import { NostrEvent, tagPipe } from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import { setSingletonTag } from "applesauce-core/operations/tag/common";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { isValidZapRequest } from "../helpers/zap.js";

/** Tags that are copied from the zap request to the zap receipt */
const COPIED_TAGS = ["p", "e", "a", "k", "amount"];

/** Sets the bolt11 invoice tag on a zap event */
export function setBolt11(invoice: string): EventOperation {
  return includeSingletonTag(["bolt11", invoice], true);
}

/**
 * Sets the zap request on a zap event. Validates the request, then sets the
 * description tag (JSON-encoded), P tag (sender), and copies the p, e, a, k,
 * and amount tags from the zap request
 */
export function setRequest(zapRequest: NostrEvent): EventOperation {
  if (!isValidZapRequest(zapRequest)) throw new Error("Invalid zap request event");

  return modifyPublicTags(
    tagPipe(
      // Set the description tag and sender P tags
      setSingletonTag(["description", JSON.stringify(zapRequest)], true),
      setSingletonTag(["P", zapRequest.pubkey], true),
      // Copy each singleton tag from the zap request
      (tags) => [
        // Keep tags that won't be replaced
        ...tags.filter((tag) => !COPIED_TAGS.includes(tag[0])),
        // Append copied tags from the zap request
        ...zapRequest.tags.filter((tag) => COPIED_TAGS.includes(tag[0])),
      ],
    ),
  );
}

/** Sets the preimage tag on a zap event */
export function setPreimage(preimage: string): EventOperation {
  return includeSingletonTag(["preimage", preimage], true);
}
