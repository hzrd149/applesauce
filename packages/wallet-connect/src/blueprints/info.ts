import { blueprint, EventBlueprint } from "applesauce-factory";
import { setContent } from "applesauce-factory/operations/content";
import { includeSingletonTag } from "applesauce-factory/operations";

import { WALLET_INFO_KIND, WalletInfo } from "../helpers/info.js";

/** Creates a wallet info event */
export function WalletInfoBlueprint(info: WalletInfo): EventBlueprint {
  return blueprint(
    WALLET_INFO_KIND,
    setContent(info.methods.join(" ")),
    info.encryption_methods ? includeSingletonTag(["encryption", info.encryption_methods.join(" ")]) : undefined,
    info.notifications ? includeSingletonTag(["notifications", info.notifications.join(" ")]) : undefined,
  );
}
