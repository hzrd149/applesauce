import { blueprint, EventBlueprint } from "applesauce-factory";
import { includeSingletonTag } from "applesauce-factory/operations";
import { setEncryptedContent } from "applesauce-factory/operations/content";
import { NostrEvent } from "nostr-tools";

import { getWalletRequestEncryption } from "../helpers/request.js";
import { WALLET_RESPONSE_KIND, WalletResponse } from "../helpers/response.js";

/** Creates a wallet response event */
export function WalletResponseBlueprint(request: NostrEvent, response: WalletResponse): EventBlueprint {
  const encryption = getWalletRequestEncryption(request);
  return blueprint(
    WALLET_RESPONSE_KIND,
    setEncryptedContent(request.pubkey, JSON.stringify(response), encryption === "nip44_v2" ? "nip44" : "nip04"),
    includeSingletonTag(["e", request.id]),
    includeSingletonTag(["p", request.pubkey]),
  );
}
