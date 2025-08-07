import { blueprint, EventBlueprint } from "applesauce-factory";
import { setContent } from "applesauce-factory/operations/content";
import { includeSingletonTag } from "applesauce-factory/operations";

import { WALLET_INFO_KIND, WalletSupport } from "../helpers/support.js";

/** Creates a wallet info event */
export function WalletInfoBlueprint(info: WalletSupport): EventBlueprint {
  return blueprint(
    WALLET_INFO_KIND,
    setContent(info.methods.join(" ")),
    info.encryption ? includeSingletonTag(["encryption", info.encryption.join(" ")]) : undefined,
    info.notifications ? includeSingletonTag(["notifications", info.notifications.join(" ")]) : undefined,
  );
}
