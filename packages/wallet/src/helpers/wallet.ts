import { hexToBytes } from "@noble/hashes/utils";
import {
  HiddenContentSigner,
  isHiddenTagsUnlocked,
  lockHiddenTags,
  notifyEventUpdate,
  setHiddenTagsEncryptionMethod,
  UnlockedHiddenTags,
  unlockHiddenTags,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

export const WALLET_KIND = 17375;
export const WALLET_BACKUP_KIND = 375;

// Enable hidden content for wallet kinds
setHiddenTagsEncryptionMethod(WALLET_KIND, "nip44");
setHiddenTagsEncryptionMethod(WALLET_BACKUP_KIND, "nip44");

export const WalletPrivateKeySymbol = Symbol.for("wallet-private-key");
export const WalletMintsSymbol = Symbol.for("wallet-mints");

/** Type for unlocked wallet events */
export type UnlockedWallet = UnlockedHiddenTags & {
  [WalletPrivateKeySymbol]: Uint8Array;
  [WalletMintsSymbol]: string[];
};

/** Returns if a wallet is unlocked */
export function isWalletUnlocked<T extends NostrEvent>(wallet: T): wallet is T & UnlockedWallet {
  return (
    isHiddenTagsUnlocked(wallet) &&
    Reflect.has(wallet, WalletPrivateKeySymbol) === true &&
    Reflect.has(wallet, WalletMintsSymbol) === true
  );
}

/** Unlocks a wallet and returns the hidden tags */
export async function unlockWallet(
  wallet: NostrEvent,
  signer: HiddenContentSigner,
): Promise<{ mints: string[]; privateKey?: Uint8Array }> {
  if (isWalletUnlocked(wallet)) return { mints: wallet[WalletMintsSymbol], privateKey: wallet[WalletPrivateKeySymbol] };

  const tags = await unlockHiddenTags(wallet, signer);

  const mints = tags.filter((t) => t[0] === "mint").map((t) => t[1]);
  const privkey = tags.find((t) => t[0] === "privkey" && t[1])?.[1];
  const key = privkey ? hexToBytes(privkey) : undefined;

  // Set the cached values
  Reflect.set(wallet, WalletMintsSymbol, mints);
  Reflect.set(wallet, WalletPrivateKeySymbol, key);

  // Notify the event store
  notifyEventUpdate(wallet);

  return { mints, privateKey: key };
}

/** Locks a wallet event */
export function lockWallet(wallet: NostrEvent) {
  Reflect.deleteProperty(wallet, WalletPrivateKeySymbol);
  Reflect.deleteProperty(wallet, WalletMintsSymbol);
  lockHiddenTags(wallet);
}

/** Returns the wallets mints */
export function getWalletMints(wallet: NostrEvent): string[] {
  if (isWalletUnlocked(wallet)) return wallet[WalletMintsSymbol];
  else return [];
}

/** Returns the wallets private key as a string */
export function getWalletPrivateKey(wallet: UnlockedWallet): Uint8Array;
export function getWalletPrivateKey(wallet: NostrEvent): Uint8Array | undefined;
export function getWalletPrivateKey<T extends NostrEvent>(wallet: T): Uint8Array | undefined {
  if (isWalletUnlocked(wallet)) return wallet[WalletPrivateKeySymbol];
  else return undefined;
}
