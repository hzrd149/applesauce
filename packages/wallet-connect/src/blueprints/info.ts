import { blueprint, EventBlueprint } from "applesauce-factory";
import { WALLET_INFO_KIND, WalletInfo } from "../helpers/info.js";
import { setContent } from "applesauce-factory/operations/content";
import { includeSingletonTag } from "applesauce-factory/operations";

/** Creates a wallet info event */
export function WalletInfoBlueprint(info: WalletInfo): EventBlueprint {
  return blueprint(
    WALLET_INFO_KIND,
    setContent(info.methods.join(" ")),
    info.encryption_methods ? includeSingletonTag(["encryption", info.encryption_methods.join(" ")]) : undefined,
    info.notifications ? includeSingletonTag(["notifications", info.notifications.join(" ")]) : undefined,
  );
}
