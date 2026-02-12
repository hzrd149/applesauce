import { buildEvent, EventFactoryServices } from "applesauce-core";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { HistoryContent, WALLET_HISTORY_KIND } from "../helpers/history.js";
import { setHistoryContent, setHistoryRedeemed } from "../operations/history.js";

/** A blueprint that creates a wallet history event */
export function WalletHistoryBlueprint(content: HistoryContent, redeemed?: (string | EventPointer)[]) {
  return async (services: EventFactoryServices) => {
    return buildEvent(
      { kind: WALLET_HISTORY_KIND },
      services,
      // set the encrypted tags on the event
      setHistoryContent(content, services.signer),
      // set the public redeemed tags
      redeemed ? setHistoryRedeemed(redeemed) : undefined,
    );
  };
}
