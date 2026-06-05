import { Mint, Wallet } from "@cashu/cashu-ts";

/** A function that returns a loaded cashu {@link Wallet} for a mint url */
export type CashuWalletProvider = (mint: string) => Promise<Wallet>;

/** Creates and loads a cashu {@link Wallet} for a mint (passed as a url or a cached {@link Mint} instance) */
export async function createCashuWallet(mint: string | Mint): Promise<Wallet> {
  const wallet = new Wallet(mint);
  await wallet.loadMint();
  return wallet;
}

/**
 * Returns a loaded cashu {@link Wallet} for a mint url. Uses the provider when one is given (so a caller
 * can supply a cached, wallet-specific instance), otherwise creates and loads a fresh wallet.
 */
export function loadCashuWallet(mint: string, provider?: CashuWalletProvider): Promise<Wallet> {
  return provider ? provider(mint) : createCashuWallet(mint);
}
