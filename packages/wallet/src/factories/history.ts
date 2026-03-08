import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { HistoryContent, WALLET_HISTORY_KIND } from "../helpers/history.js";
import { setHistoryContent, setHistoryRedeemed } from "../operations/history.js";

export type WalletHistoryTemplate = KnownEventTemplate<typeof WALLET_HISTORY_KIND>;

export class WalletHistoryFactory extends EventFactory<typeof WALLET_HISTORY_KIND, WalletHistoryTemplate> {
  static create(content: HistoryContent): WalletHistoryFactory {
    return new WalletHistoryFactory((res) => res(blankEventTemplate(WALLET_HISTORY_KIND))).historyContent(content);
  }

  historyContent(content: HistoryContent): this {
    let result: this;
    result = this.chain((draft) => setHistoryContent(content, result.signer)(draft));
    return result;
  }

  redeemed(items: (string | EventPointer)[]) {
    return this.chain((draft) => setHistoryRedeemed(items)(draft));
  }
}
