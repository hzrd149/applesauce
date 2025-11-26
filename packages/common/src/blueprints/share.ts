import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { embedSharedEvent, setShareKind, setShareTags } from "../operations/share.js";
import { blueprint } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type ShareBlueprintOptions = MetaTagOptions & ZapOptions;

/** Blueprint for a NIP-18 repost event */
export function ShareBlueprint(event: NostrEvent, options?: ShareBlueprintOptions) {
  return blueprint(
    kinds.Repost,
    // set the kind to 6 or 16 based on the kind of event being shared
    setShareKind(event),
    // embed the shared event as a JSON string
    embedSharedEvent(event),
    // include the NIP-18 repost tags
    setShareTags(event),
    // include the meta tags
    setMetaTags(options),
    // include the zap split tags
    setZapSplit(options),
  );
}
