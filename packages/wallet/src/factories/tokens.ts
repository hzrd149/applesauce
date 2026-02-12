import { type Token } from "@cashu/cashu-ts";
import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, EventTemplate } from "applesauce-core/helpers";
import { WALLET_TOKEN_KIND } from "../helpers/tokens.js";
import { setToken } from "../operations/tokens.js";

export type WalletTokenTemplate = KnownEventTemplate<typeof WALLET_TOKEN_KIND>;

export class WalletTokenFactory extends EventFactory<typeof WALLET_TOKEN_KIND, WalletTokenTemplate> {
  static create(token: Token, deleted: string[] = []): WalletTokenFactory {
    return new WalletTokenFactory((res) => res(blankEventTemplate(WALLET_TOKEN_KIND)))
      .token(token, deleted);
  }

  token(token: Token, deleted: string[] = []) {
    return this.chain((draft) => setToken(token, deleted, this.signer)(draft));
  }
}

// Legacy blueprint function for backwards compatibility
export function WalletTokenBlueprint(token: Token, deleted: string[] = []) {
  return async (_services: any): Promise<EventTemplate> => {
    return WalletTokenFactory.create(token, deleted);
  };
}
