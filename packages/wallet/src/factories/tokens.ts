import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { WALLET_TOKEN_KIND } from "../helpers/tokens.js";
import { setToken, TokenInput } from "../operations/tokens.js";

export type WalletTokenTemplate = KnownEventTemplate<typeof WALLET_TOKEN_KIND>;

export class WalletTokenFactory extends EventFactory<typeof WALLET_TOKEN_KIND, WalletTokenTemplate> {
  static create(token: TokenInput, deleted: string[] = []): WalletTokenFactory {
    return new WalletTokenFactory((res) => res(blankEventTemplate(WALLET_TOKEN_KIND))).token(token, deleted);
  }

  token(token: TokenInput, deleted: string[] = []): this {
    let result: this;
    result = this.chain((draft) => setToken(token, deleted, result.signer)(draft));
    return result;
  }
}
