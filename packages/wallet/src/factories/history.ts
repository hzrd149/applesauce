import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, EventTemplate } from "applesauce-core/helpers";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { HistoryContent, WALLET_HISTORY_KIND } from "../helpers/history.js";
import { setHistoryContent, setHistoryRedeemed } from "../operations/history.js";

export type WalletHistoryTemplate = KnownEventTemplate<typeof WALLET_HISTORY_KIND>;

export class WalletHistoryFactory extends EventFactory<typeof WALLET_HISTORY_KIND, WalletHistoryTemplate> {
  static create(content: HistoryContent): WalletHistoryFactory {
    return new WalletHistoryFactory((res) => res(blankEventTemplate(WALLET_HISTORY_KIND)))
      .historyContent(content);
  }

  historyContent(content: HistoryContent) {
    return this.chain((draft) => setHistoryContent(content, this.signer)(draft));
  }

  redeemed(items: (string | EventPointer)[]) {
    return this.chain((draft) => setHistoryRedeemed(items)(draft));
  }
}

// Legacy blueprint function for backwards compatibility
export function WalletHistoryBlueprint(content: HistoryContent, redeemed?: (string | EventPointer)[]) {
  return async (_services: any): Promise<EventTemplate> => {
    const factory = WalletHistoryFactory.create(content);
    if (redeemed) factory.redeemed(redeemed);
    return factory;
  };
}
