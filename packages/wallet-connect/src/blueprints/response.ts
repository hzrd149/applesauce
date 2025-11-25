import { blueprint, EventBlueprint } from "applesauce-factory";
import { includeSingletonTag } from "applesauce-factory/operations";
import { setEncryptedContent } from "applesauce-factory/operations/content";
import { NostrEvent } from "applesauce-core/helpers/event";

import { TWalletMethod } from "../helpers/methods.js";
import { getWalletRequestEncryption } from "../helpers/request.js";
import { WALLET_RESPONSE_KIND } from "../helpers/response.js";

/** Creates a wallet response event */
export function WalletResponseBlueprint<Method extends TWalletMethod>(
  request: NostrEvent,
  response: Method["response"] | Method["error"],
): EventBlueprint {
  const encryption = getWalletRequestEncryption(request);
  return blueprint(
    WALLET_RESPONSE_KIND,
    setEncryptedContent(request.pubkey, JSON.stringify(response), encryption === "nip44_v2" ? "nip44" : "nip04"),
    includeSingletonTag(["e", request.id]),
    includeSingletonTag(["p", request.pubkey]),
  );
}
