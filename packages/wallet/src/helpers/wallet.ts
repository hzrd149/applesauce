import {
  getHiddenTags,
  hasHiddenTags,
  HiddenContentSigner,
  isHiddenTagsUnlocked,
  lockHiddenTags,
  notifyEventUpdate,
  relaySet,
  setHiddenTagsEncryptionMethod,
  UnlockedHiddenTags,
  unlockHiddenTags,
} from "applesauce-core/helpers";
import { hexToBytes, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

export const WALLET_KIND = 17375;
export const WALLET_BACKUP_KIND = 375;

/** Validated wallet event */
export type WalletEvent = KnownEvent<typeof WALLET_KIND>;

/** Checks if an event is a valid wallet event */
export function isValidWallet(event: NostrEvent): event is WalletEvent {
  return event.kind === WALLET_KIND && hasHiddenTags(event);
}

// Enable hidden content for wallet kinds
setHiddenTagsEncryptionMethod(WALLET_KIND, "nip44");
setHiddenTagsEncryptionMethod(WALLET_BACKUP_KIND, "nip44");

export const WalletPrivateKeySymbol = Symbol.for("wallet-private-key");
export const WalletMintsSymbol = Symbol.for("wallet-mints");
export const WalletRelaysSymbol = Symbol.for("wallet-relays");

/** Type for unlocked wallet events */
export type UnlockedWallet = UnlockedHiddenTags & {
  [WalletPrivateKeySymbol]?: Uint8Array | null;
  [WalletMintsSymbol]?: string[];
  [WalletRelaysSymbol]?: string[];
};

/** Returns if a wallet is unlocked */
export function isWalletUnlocked<T extends NostrEvent>(wallet: T): wallet is T & UnlockedWallet {
  // No need for try catch or proactivly parsing here since it only depends on hidden tags
  return isHiddenTagsUnlocked(wallet);
}

/** Returns the wallets mints */
export function getWalletMints(wallet: UnlockedWallet): string[];
export function getWalletMints(wallet: NostrEvent): string[];
export function getWalletMints<T extends NostrEvent>(wallet: T): string[] | undefined {
  // Return cached value if it exists
  if (WalletMintsSymbol in wallet) return wallet[WalletMintsSymbol] as string[];

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
export function getWalletPrivateKey(wallet: UnlockedWallet): Uint8Array | null;
export function getWalletPrivateKey(wallet: NostrEvent): Uint8Array | undefined | null;
export function getWalletPrivateKey<T extends NostrEvent>(wallet: T): Uint8Array | undefined | null {
  if (WalletPrivateKeySymbol in wallet) return wallet[WalletPrivateKeySymbol] as Uint8Array | null;

  // Get hidden tags
  const tags = getHiddenTags(wallet);
  if (!tags) return undefined;

  // Parse private key
  const privkey = tags.find((t) => t[0] === "privkey" && t[1])?.[1];
  const key = privkey ? hexToBytes(privkey) : null;

  // Set the cached value
  Reflect.set(wallet, WalletPrivateKeySymbol, key);

  return key;
}

/** Returns the wallets relays */
export function getWalletRelays(wallet: UnlockedWallet): string[];
export function getWalletRelays(wallet: NostrEvent): string[] | undefined;
export function getWalletRelays<T extends NostrEvent>(wallet: T): string[] | undefined {
  // Return cached value if it exists
  if (WalletRelaysSymbol in wallet) return wallet[WalletRelaysSymbol] as string[];

  // Get hidden tags
  const tags = getHiddenTags(wallet);
  if (!tags) return undefined;

  // Get relays
  const urls = tags.filter((t) => t[0] === "relay" && t[1]).map((t) => t[1]);
  const relays = relaySet(urls);

  // Set the cached value
  Reflect.set(wallet, WalletRelaysSymbol, relays);

  return relays;
}

/** Unlocks a wallet and returns the hidden tags */
export async function unlockWallet(
  wallet: NostrEvent,
  signer: HiddenContentSigner,
): Promise<{ mints: string[]; privateKey: Uint8Array | null; relays: string[] }> {
  if (WalletPrivateKeySymbol in wallet && WalletMintsSymbol in wallet && WalletRelaysSymbol in wallet)
    return {
      mints: wallet[WalletMintsSymbol] as string[],
      privateKey: wallet[WalletPrivateKeySymbol] as Uint8Array | null,
      relays: wallet[WalletRelaysSymbol] as string[],
    };

  // Unlock hidden tags if needed
  await unlockHiddenTags(wallet, signer);

  // Read the wallet mints and private key
  const mints = getWalletMints(wallet);
  if (!mints) throw new Error("Failed to unlock wallet mints");

  const relays = getWalletRelays(wallet);
  if (!relays) throw new Error("Failed to unlock wallet relays");
  const key = getWalletPrivateKey(wallet) ?? null;

  // Notify the event store
  notifyEventUpdate(wallet);

  return { mints, privateKey: key, relays };
}

/** Locks a wallet event */
export function lockWallet(wallet: NostrEvent) {
  Reflect.deleteProperty(wallet, WalletPrivateKeySymbol);
  Reflect.deleteProperty(wallet, WalletMintsSymbol);
  lockHiddenTags(wallet);
}
