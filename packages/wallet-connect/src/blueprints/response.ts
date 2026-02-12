import { buildEvent, EventBlueprint, EventFactoryServices } from "applesauce-core";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";
import { NostrEvent } from "applesauce-core/helpers/event";

import { TWalletMethod } from "../helpers/methods.js";
import { getWalletRequestEncryption } from "../helpers/request.js";
import { WALLET_RESPONSE_KIND } from "../helpers/response.js";

/** Creates a wallet response event */
export function WalletResponseBlueprint<Method extends TWalletMethod>(
  request: NostrEvent,
  response: Method["response"] | Method["error"],
): EventBlueprint {
  return async (services: EventFactoryServices) => {
    const encryption = getWalletRequestEncryption(request);
    return buildEvent(
      { kind: WALLET_RESPONSE_KIND },
      services,
      setEncryptedContent(
        request.pubkey,
        JSON.stringify(response),
        services.signer,
        encryption === "nip44_v2" ? "nip44" : "nip04",
      ),
      includeSingletonTag(["e", request.id]),
      includeSingletonTag(["p", request.pubkey]),
    );
  };
}
