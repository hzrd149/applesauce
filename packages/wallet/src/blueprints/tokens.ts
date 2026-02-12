import { Token } from "@cashu/cashu-ts";
import { buildEvent, EventFactoryServices } from "applesauce-core";
import { WALLET_TOKEN_KIND } from "../helpers/tokens.js";
import { setToken } from "../operations/tokens.js";

/**
 * A blueprint for a wallet token event, takes a cashu token and previous deleted token event ids
 * @param token the cashu token to store
 * @param [del=[]] an array of previous token event ids that are deleted
 */
export function WalletTokenBlueprint(token: Token, del: string[] = []) {
  return async (services: EventFactoryServices) => {
    return buildEvent({ kind: WALLET_TOKEN_KIND }, services, setToken(token, del, services.signer));
  };
}
