import { kinds, NostrEvent } from "nostr-tools";
import { blueprint } from "../event-factory.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setShareTags, embedSharedEvent, setShareKind } from "../operations/share.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

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
