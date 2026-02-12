import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, EventTemplate, NostrEvent, kinds } from "applesauce-core/helpers";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { giftWrap } from "../operations/gift-wrap.js";

export class GiftWrapFactory extends EventFactory<kinds.GiftWrap, KnownEventTemplate<kinds.GiftWrap>> {
  static async wrap(
    recipient: string,
    inner: EventFactory<any> | EventTemplate,
    opts?: MetaTagOptions,
  ): Promise<GiftWrapFactory> {
    const _innerEvent = inner instanceof EventFactory ? await inner : inner;
    const factory = new GiftWrapFactory((res) => res(blankEventTemplate(kinds.GiftWrap)));
    return factory.wrapEvent(recipient, _innerEvent, opts);
  }

  wrapEvent(pubkey: string, event: EventTemplate, opts?: MetaTagOptions) {
    return this.chain(async (_draft) => giftWrap(pubkey, this.signer, opts)(event as any));
  }
}

// Legacy blueprint function for backwards compatibility
export function GiftWrapBlueprint(recipient: string, inner: EventTemplate, opts?: MetaTagOptions) {
  return async (): Promise<NostrEvent> => {
    const factory = await GiftWrapFactory.wrap(recipient, inner, opts);
    // The giftWrap operation returns a signed event already
    return factory as any as Promise<NostrEvent>;
  };
}
