import { buildEvent, EventBlueprint } from "applesauce-core/event-factory";
import { EventTemplate, NostrEvent, UnsignedEvent } from "applesauce-core/helpers/event";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { giftWrap } from "../operations/gift-wrap.js";

/** Creates a gift wrapped event based on a blueprint */
export function GiftWrapBlueprint(
  pubkey: string,
  blueprint: EventBlueprint | EventTemplate | UnsignedEvent | NostrEvent,
  opts?: MetaTagOptions,
): EventBlueprint<NostrEvent> {
  return async (services) =>
    (await buildEvent(
      typeof blueprint === "function" ? await blueprint(services) : blueprint,
      services,
      giftWrap(pubkey, services.signer, opts),
    )) as NostrEvent;
}
