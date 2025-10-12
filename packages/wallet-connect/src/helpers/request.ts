import {
  getTagValue,
  HiddenContentSigner,
  isHiddenContentUnlocked,
  isNIP04Encrypted,
  KnownEvent,
  notifyEventUpdate,
  setHiddenContentEncryptionMethod,
  unixNow,
  UnlockedHiddenContent,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { WalletConnectEncryptionMethod } from "./encryption.js";
import { TWalletMethod } from "./methods.js";

export const WALLET_REQUEST_KIND = 23194;

// Set the encryption method to use for request kind
setHiddenContentEncryptionMethod(WALLET_REQUEST_KIND, "nip44");

export type WalletRequestEvent = KnownEvent<typeof WALLET_REQUEST_KIND>;

/** A symbol used to cache the wallet request on the event */
export const WalletRequestSymbol = Symbol("wallet-request");

/** Type for events with unlocked hidden content */
export type UnlockedWalletRequest<Method extends TWalletMethod = TWalletMethod> = UnlockedHiddenContent & {
  [WalletRequestSymbol]: Method["request"];
};

/** Checks if a kind 23194 event is locked */
export function isWalletRequestUnlocked<Method extends TWalletMethod = TWalletMethod>(
  request: any,
): request is UnlockedWalletRequest<Method> {
  return isHiddenContentUnlocked(request) && Reflect.has(request, WalletRequestSymbol) === true;
}

/** Unlocks a kind 23194 event */
export async function unlockWalletRequest<Method extends TWalletMethod = TWalletMethod>(
  request: NostrEvent,
  signer: HiddenContentSigner,
): Promise<Method["request"] | undefined> {
  if (isWalletRequestUnlocked(request)) return request[WalletRequestSymbol] as Method["request"];

  const content = await unlockHiddenContent(request, signer);
  const parsed = JSON.parse(content) as Method["request"];

  // Save the parsed content
  Reflect.set(request, WalletRequestSymbol, parsed);
  notifyEventUpdate(request);

  return parsed;
}

/** Gets the wallet request from a kind 23194 event */
export function getWalletRequest<Method extends TWalletMethod = TWalletMethod>(
  request: NostrEvent,
): Method["request"] | undefined {
  if (isWalletRequestUnlocked(request)) return request[WalletRequestSymbol] as Method["request"];
  else return undefined;
}

/** Returns the wallet service pubkey from a request */
export function getWalletRequestServicePubkey(request: WalletRequestEvent): string;
export function getWalletRequestServicePubkey(request: NostrEvent): string | undefined;
export function getWalletRequestServicePubkey(request: NostrEvent): string | undefined {
  return getTagValue(request, "p");
}

/** Returns the expiration timestamp from a request */
export function getWalletRequestExpiration(request: NostrEvent): number | undefined {
  const expiration = getTagValue(request, "expiration");
  return expiration ? parseInt(expiration, 10) : undefined;
}

/** Checks if a request has expired */
export function isWalletRequestExpired(request: NostrEvent): boolean {
  const expiration = getWalletRequestExpiration(request);
  if (!expiration) return false;

  return unixNow() > expiration;
}

/** Gets the encryption method used for a request */
export function getWalletRequestEncryption(request: NostrEvent): WalletConnectEncryptionMethod {
  const encryption = getTagValue(request, "encryption");
  return encryption
    ? (encryption as WalletConnectEncryptionMethod)
    : isNIP04Encrypted(request.content)
      ? "nip04"
      : "nip44_v2";
}

/** Checks if an event is a valid wallet request event */
export function isValidWalletRequest(request: NostrEvent): request is WalletRequestEvent {
  return request.kind === WALLET_REQUEST_KIND && getWalletRequestServicePubkey(request) !== undefined;
}
