import { kinds, NostrEvent } from "nostr-tools";
import { blueprint } from "../../../factory/src/event-factory.js";
import { MetaTagOptions, setMetaTags } from "../../../factory/src/operations/common.js";
import { setShareTags, embedSharedEvent, setShareKind } from "../../../factory/src/operations/share.js";
import { setZapSplit, ZapOptions } from "applesauce-common/operations/zap-split.js";

export type ShareBlueprintOptions = MetaTagOptions & ZapOptions;

/** Blueprint for a NIP-18 repost event */
export function ShareBlueprint(event: NostrEvent, options?: ShareBlueprintOptions) {
  return blueprint(
    kinds.Repost,
    setShareKind(event),
    embedSharedEvent(event),
    setShareTags(event),
    setMetaTags(options),
    setZapSplit(options),
  );
}
