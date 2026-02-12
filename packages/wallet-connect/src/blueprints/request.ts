import { buildEvent, EventBlueprint, EventFactoryServices } from "applesauce-core";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";

import { WALLET_REQUEST_KIND } from "../helpers/request.js";
import { WalletConnectEncryptionMethod } from "../helpers/encryption.js";
import { TWalletMethod } from "../helpers/methods.js";

/**
 * Creates a wallet request event
 * @param service - The service pubkey
 * @param request - The request to create an event for
 */
export function WalletRequestBlueprint<Method extends TWalletMethod>(
  service: string,
  request: Method["request"],
  encryption: WalletConnectEncryptionMethod = "nip44_v2",
): EventBlueprint {
  return async (services: EventFactoryServices) => {
    return buildEvent(
      { kind: WALLET_REQUEST_KIND },
      services,
      setEncryptedContent(
        service,
        JSON.stringify(request),
        services.signer,
        encryption === "nip44_v2" ? "nip44" : "nip04",
      ),
      includeSingletonTag(["p", service]),
      includeSingletonTag(["encryption", encryption]),
    );
  };
}
