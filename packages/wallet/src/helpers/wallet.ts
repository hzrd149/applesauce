import { hexToBytes } from "@noble/hashes/utils";
import {
  getHiddenTags,
  HiddenContentSigner,
  isHiddenTagsUnlocked,
  lockHiddenTags,
  notifyEventUpdate,
  setHiddenTagsEncryptionMethod,
  UnlockedHiddenTags,
  unlockHiddenTags,
} from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";

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
    Reflect.has(wallet, WalletPrivateKeySymbol) &&
    Reflect.has(wallet, WalletMintsSymbol)
  );
}

/** Returns the wallets mints */
export function getWalletMints(wallet: UnlockedWallet): string[];
export function getWalletMints(wallet: NostrEvent): string[];
export function getWalletMints<T extends NostrEvent>(wallet: T): string[] | undefined {
  // Return cached value if it exists
  if (Reflect.has(wallet, WalletMintsSymbol)) return Reflect.get(wallet, WalletMintsSymbol) as string[];

  // Get hidden tags
  const tags = getHiddenTags(wallet);
  if (!tags) return undefined;

  // Get mints
  const mints = tags.filter((t) => t[0] === "mint").map((t) => t[1]);

  // Set the cached value
  Reflect.set(wallet, WalletMintsSymbol, mints);

  return mints;
}

/** Returns the wallets private key as a string */
export function getWalletPrivateKey(wallet: UnlockedWallet): Uint8Array;
export function getWalletPrivateKey(wallet: NostrEvent): Uint8Array | undefined;
export function getWalletPrivateKey<T extends NostrEvent>(wallet: T): Uint8Array | undefined {
  if (Reflect.has(wallet, WalletPrivateKeySymbol)) return Reflect.get(wallet, WalletPrivateKeySymbol) as Uint8Array;

  // Get hidden tags
  const tags = getHiddenTags(wallet);
  if (!tags) return undefined;

  // Parse private key
  const privkey = tags.find((t) => t[0] === "privkey" && t[1])?.[1];
  const key = privkey ? hexToBytes(privkey) : undefined;

  // Set the cached value
  Reflect.set(wallet, WalletPrivateKeySymbol, key);

  return key;
}

/** Unlocks a wallet and returns the hidden tags */
export async function unlockWallet(
  wallet: NostrEvent,
  signer: HiddenContentSigner,
): Promise<{ mints: string[]; privateKey?: Uint8Array }> {
  if (isWalletUnlocked(wallet)) return { mints: getWalletMints(wallet), privateKey: getWalletPrivateKey(wallet) };

  // Unlock hidden tags if needed
  await unlockHiddenTags(wallet, signer);

  // Read the wallet mints and private key
  const mints = getWalletMints(wallet);
  if (!mints) throw new Error("Failed to unlock wallet mints");
  const key = getWalletPrivateKey(wallet);

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
