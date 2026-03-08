import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";
import { TWalletMethod } from "../helpers/methods.js";
import { getWalletRequestEncryption } from "../helpers/request.js";
import { WALLET_RESPONSE_KIND } from "../helpers/response.js";

export type WalletResponseTemplate = KnownEventTemplate<typeof WALLET_RESPONSE_KIND>;

export class WalletResponseFactory extends EventFactory<typeof WALLET_RESPONSE_KIND, WalletResponseTemplate> {
  static create<Method extends TWalletMethod>(
    request: NostrEvent,
    response: Method["response"] | Method["error"],
  ): WalletResponseFactory {
    const encryption = getWalletRequestEncryption(request);
    return new WalletResponseFactory((res) => res(blankEventTemplate(WALLET_RESPONSE_KIND)))
      .requestEvent(request.id)
      .client(request.pubkey)
      .response(response, request.pubkey, encryption === "nip44_v2" ? "nip44" : "nip04");
  }

  requestEvent(eventId: string) {
    return this.chain((draft) => includeSingletonTag(["e", eventId])(draft));
  }

  client(pubkey: string) {
    return this.chain((draft) => includeSingletonTag(["p", pubkey])(draft));
  }

  response<T>(response: T, recipient: string, encryption: "nip44" | "nip04" = "nip44"): this {
    let result: this;
    result = this.chain(async (draft) => {
      return setEncryptedContent(recipient, JSON.stringify(response), result.signer, encryption)(draft);
    });
    return result;
  }
}
