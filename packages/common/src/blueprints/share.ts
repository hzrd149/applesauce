import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { embedSharedEvent, setShareKind, setShareTags } from "../operations/share.js";
import { blueprint } from "applesauce-core/event-factory";
import { EventTemplate, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

// Import EventFactory as a value (class) to modify its prototype
import { EventFactory } from "applesauce-core/event-factory";

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

// Register this blueprint with EventFactory
EventFactory.prototype.share = function (event: NostrEvent, options?: ShareBlueprintOptions) {
  return this.create(ShareBlueprint, event, options);
};

// Type augmentation for EventFactory
declare module "applesauce-core/event-factory" {
  interface EventFactory {
    /** Create a NIP-18 repost event */
    share(event: NostrEvent, options?: ShareBlueprintOptions): Promise<EventTemplate>;
  }
}
