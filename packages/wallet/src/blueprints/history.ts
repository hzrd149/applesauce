import { blueprint } from "applesauce-core";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { HistoryContent, WALLET_HISTORY_KIND } from "../helpers/history.js";
import { setHistoryContent, setHistoryRedeemed } from "../operations/history.js";

/** A blueprint that creates a wallet history event */
export function WalletHistoryBlueprint(content: HistoryContent, redeemed: (string | EventPointer)[]) {
  return blueprint(
    WALLET_HISTORY_KIND,
    // set the encrypted tags on the event
    setHistoryContent(content),
    // set the public redeemed tags
    setHistoryRedeemed(redeemed),
  );
}
