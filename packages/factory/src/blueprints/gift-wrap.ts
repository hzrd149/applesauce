import { EventTemplate, NostrEvent, UnsignedEvent } from "nostr-tools";
import { build } from "../event-factory.js";
import { MetaTagOptions } from "../operations/common.js";
import { giftWrap } from "../operations/gift-wrap.js";
import { EventBlueprint } from "../types.js";

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
