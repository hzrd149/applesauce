import { blueprint, EventBlueprint } from "applesauce-factory";
import { setContent } from "applesauce-factory/operations/content";
import { includeSingletonTag } from "applesauce-factory/operations";

import { WALLET_INFO_KIND, WalletSupport } from "../helpers/support.js";

/**
 * Creates a wallet info event
 * @param info - The wallet support information
 * @param client - The client pubkey
 * @param overrideRelay - An optional relay to tell the client which relay to use (for nostr+walletauth URI connections)
 */
export function WalletSupportBlueprint(info: WalletSupport, client?: string, overrideRelay?: string): EventBlueprint {
  return blueprint(
    WALLET_INFO_KIND,
    setContent(info.methods.join(" ")),
    info.encryption ? includeSingletonTag(["encryption", info.encryption.join(" ")]) : undefined,
    info.notifications ? includeSingletonTag(["notifications", info.notifications.join(" ")]) : undefined,
    // An optional client pubkey to notify the service is created (used for nostr+walletauth URI connections)
    client ? includeSingletonTag(overrideRelay ? ["p", client, overrideRelay] : ["p", client]) : undefined,
  );
}
