import { EventOperation, TagOperation } from "applesauce-core/factories";
import { ensureMarkedEventPointerTag, EventPointer, Nip10TagMarker } from "applesauce-core/helpers";
import { setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations/tags";

import { HistoryContent } from "../helpers/history.js";

/** Includes "e" "created" tags in wallet history tags */
function includeHistoryCreatedTags(created: (string | EventPointer)[]): TagOperation {
  return (tags) => {
    for (const id of created) {
      tags = ensureMarkedEventPointerTag(tags, typeof id === "string" ? { id } : id, "created" as Nip10TagMarker);
    }
    return tags;
  };
}

/** Sets the encrypted tags of a wallet history event */
export function setHistoryContent(
  content: HistoryContent,
  signer?: import("applesauce-core/factories").EventSigner,
): EventOperation {
  const operations: TagOperation[] = [
    setSingletonTag(["direction", content.direction], true),
    setSingletonTag(["amount", String(content.amount)], true),
    includeHistoryCreatedTags(content.created),
  ];

  if (content.fee !== undefined && content.fee > 0)
    operations.push(setSingletonTag(["fee", String(content.fee)], true));
  if (content.mint !== undefined) operations.push(setSingletonTag(["mint", content.mint], true));

  return modifyHiddenTags(signer, ...operations);
}

/** Sets the "e" "redeemed" tags on a wallet history event */
export function setHistoryRedeemed(redeemed: (string | EventPointer)[]): EventOperation {
  return modifyPublicTags((tags) => {
    for (const id of redeemed) {
      tags = ensureMarkedEventPointerTag(tags, typeof id === "string" ? { id } : id, "redeemed" as Nip10TagMarker);
    }
    return tags;
  });
}
