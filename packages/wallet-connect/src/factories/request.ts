import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";
import { WALLET_REQUEST_KIND } from "../helpers/request.js";
import { WalletConnectEncryptionMethod } from "../helpers/encryption.js";
import { TWalletMethod } from "../helpers/methods.js";

export type WalletRequestTemplate = KnownEventTemplate<typeof WALLET_REQUEST_KIND>;

export class WalletRequestFactory extends EventFactory<typeof WALLET_REQUEST_KIND, WalletRequestTemplate> {
  static create<Method extends TWalletMethod>(
    service: string,
    request: Method["request"],
    encryption: WalletConnectEncryptionMethod = "nip44_v2"
  ): WalletRequestFactory {
    return new WalletRequestFactory((res) => res(blankEventTemplate(WALLET_REQUEST_KIND)))
      .service(service)
      .request(request, encryption);
  }

  service(pubkey: string) {
    return this.chain((draft) => includeSingletonTag(["p", pubkey])(draft));
  }

  request<T>(request: T, encryption: WalletConnectEncryptionMethod = "nip44_v2") {
    return this.chain(async (draft) => {
      const encrypted = await setEncryptedContent(
        draft.tags.find(t => t[0] === "p")?.[1] || "",
        JSON.stringify(request),
        this.signer,
        encryption === "nip44_v2" ? "nip44" : "nip04"
      )(draft);
      return includeSingletonTag(["encryption", encryption])(encrypted);
    });
  }
}

// Legacy blueprint function for backwards compatibility
import type { EventTemplate } from "applesauce-core/helpers";

export function WalletRequestBlueprint<Method extends TWalletMethod>(
  service: string,
  request: Method["request"],
  encryption: WalletConnectEncryptionMethod = "nip44_v2"
) {
  return async (_services: any): Promise<EventTemplate> => {
    return WalletRequestFactory.create(service, request, encryption);
  };
}
