import { EventTemplate, NostrEvent, UnsignedEvent } from "nostr-tools";
import { build } from "../../../factory/src/event-factory.jsnt-factory.js";
import { MetaTagOptions } from "../../../factory/src/operations/common.js-operations/common.js";
import { giftWrap } from "../../../factory/src/operations/gift-wrap.jsns/gift-wrap.js";
import { EventBlueprint } from "../../../factory/src/types.jscore/factory-types.js";

/** Creates a gift wrapped event based on a blueprint */
export function GiftWrapBlueprint(
  pubkey: string,
  blueprint: EventBlueprint | EventTemplate | UnsignedEvent | NostrEvent,
  opts?: MetaTagOptions,
): EventBlueprint<NostrEvent> {
  return async (ctx) =>
    (await build(
      typeof blueprint === "function" ? await blueprint(ctx) : blueprint,
      ctx,
      giftWrap(pubkey, opts),
    )) as NostrEvent;
}
