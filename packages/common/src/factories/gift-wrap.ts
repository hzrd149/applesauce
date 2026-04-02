import { EventFactory } from "applesauce-core/factories";
import { EventSigner } from "applesauce-core/factories";
import { EventTemplate, KnownEvent, KnownEventTemplate, kinds } from "applesauce-core/helpers";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { Rumor } from "../helpers/gift-wrap.js";
import { giftWrap } from "../operations/gift-wrap.js";

export class GiftWrapFactory extends EventFactory<kinds.GiftWrap, KnownEventTemplate<kinds.GiftWrap>> {
  /**
   * Creates a signed gift wrap event for a recipient.
   * @param signer - The signer to use for the gift wrap (ephemeral key will be generated internally)
   * @param recipient - The pubkey of the recipient
   * @param rumor - The inner rumor event or factory to wrap
   * @param opts - Optional meta tag options
   */
  static async create(
    signer: EventSigner,
    recipient: string,
    rumor: EventFactory<any> | EventTemplate | Rumor,
    opts?: MetaTagOptions,
  ): Promise<KnownEvent<kinds.GiftWrap>> {
    const _innerEvent = rumor instanceof EventFactory ? await rumor : rumor;
    return giftWrap(recipient, signer, opts)(_innerEvent as any) as Promise<KnownEvent<kinds.GiftWrap>>;
  }

  /** Sets the inner rumor event of the gift wrap */
  wrapEvent(pubkey: string, event: EventTemplate | Rumor, opts?: MetaTagOptions): this {
    let result: this;
    result = this.chain(async (_draft) => giftWrap(pubkey, result.signer, opts)(event as any));
    return result;
  }
}
