import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { eventPipe } from "applesauce-core/helpers/pipeline";
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
    encryption: WalletConnectEncryptionMethod = "nip44_v2",
  ): WalletRequestFactory {
    return new WalletRequestFactory((res) => res(blankEventTemplate(WALLET_REQUEST_KIND)))
      .service(service)
      .request(request, encryption);
  }

  service(pubkey: string) {
    return this.chain((draft) => includeSingletonTag(["p", pubkey])(draft));
  }

  request<T>(request: T, encryption: WalletConnectEncryptionMethod = "nip44_v2"): this {
    let result: this;
    // Compose via eventPipe so the "encryption" tag's `{ ...draft }` spread cannot silently drop
    // the non-enumerable EncryptedContentSymbol that setEncryptedContent writes — the pipe's
    // same-kind carry-forward restores it. Sequencing these two operations by hand (encrypt then
    // spread) dropped the plaintext cache once the write became non-enumerable.
    result = this.chain((draft) =>
      eventPipe(
        setEncryptedContent(
          draft.tags.find((t) => t[0] === "p")?.[1] || "",
          JSON.stringify(request),
          result.signer,
          encryption === "nip44_v2" ? "nip44" : "nip04",
        ),
        includeSingletonTag(["encryption", encryption]),
      )(draft),
    );
    return result;
  }
}
