import { blueprint, EventBlueprint } from "applesauce-factory";
import { includeSingletonTag } from "applesauce-factory/operations";
import { setEncryptedContent } from "applesauce-factory/operations/content";

import { WALLET_REQUEST_KIND, WalletRequest } from "../helpers/request.js";
import { EncryptionMethod } from "../helpers/encryption.js";

/**
 * Creates a walelt request event
 * @param service - The service pubkey
 * @param request - The request to create an event for
 */
export function WalletRequestBlueprint<TRequest extends WalletRequest>(
  service: string,
  request: TRequest,
  encryption: EncryptionMethod = "nip44_v2",
): EventBlueprint {
  return blueprint(
    WALLET_REQUEST_KIND,
    setEncryptedContent(service, JSON.stringify(request), encryption === "nip44_v2" ? "nip44" : "nip04"),
    includeSingletonTag(["p", service]),
    includeSingletonTag(["encryption", encryption]),
  );
}
