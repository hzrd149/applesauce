import { EncryptionMethod } from "applesauce-core/helpers/encrypted-content";
import { isNIP04Encrypted } from "applesauce-core/helpers/encryption";
import { KnownEvent, NostrEvent, notifyEventUpdate } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event-tags";
import {
  HiddenContentSigner,
  isHiddenContentUnlocked,
  setHiddenContentEncryptionMethod,
  UnlockedHiddenContent,
  unlockHiddenContent,
} from "applesauce-core/helpers/hidden-content";

import { TWalletMethod } from "./methods.js";

export const WALLET_RESPONSE_KIND = 23195;

// Set the encryption method to use for response kind
setHiddenContentEncryptionMethod(WALLET_RESPONSE_KIND, "nip04");

/** A symbol used to cache the wallet response on the event */
export const WalletResponseSymbol = Symbol("wallet-response");

/** Type for events with unlocked hidden content */
export type UnlockedWalletResponse<Method extends TWalletMethod = TWalletMethod> = UnlockedHiddenContent & {
  [WalletResponseSymbol]: Method["response"];
};

/** Type for validated wallet response events */
export type WalletResponseEvent = KnownEvent<typeof WALLET_RESPONSE_KIND>;

/** Checks if a kind 23195 event is locked */
export function isWalletResponseUnlocked<Method extends TWalletMethod = TWalletMethod>(
  response: any,
): response is UnlockedWalletResponse<Method> {
  return isHiddenContentUnlocked(response) && Reflect.has(response, WalletResponseSymbol) === true;
}

/** Unlocks a kind 23195 event */
export async function unlockWalletResponse<Method extends TWalletMethod = TWalletMethod>(
  response: NostrEvent,
  signer: HiddenContentSigner,
  override?: EncryptionMethod,
): Promise<Method["response"] | undefined> {
  if (isWalletResponseUnlocked(response)) return response[WalletResponseSymbol] as Method["response"];

  const encryption = override ?? (!isNIP04Encrypted(response.content) ? "nip44" : "nip04");
  const content = await unlockHiddenContent(response, signer, encryption);
  const parsed = JSON.parse(content) as Method["response"];

  // Save the parsed content
  Reflect.set(response, WalletResponseSymbol, parsed);
  notifyEventUpdate(response);

  return parsed;
}

/** Gets the wallet response from a kind 23195 event */
export function getWalletResponse<Method extends TWalletMethod = TWalletMethod>(
  response: NostrEvent,
): Method["response"] | undefined {
  if (isWalletResponseUnlocked(response)) return response[WalletResponseSymbol] as Method["response"];
  else return undefined;
}

/** Returns the client pubkey of client this response is for */
export function getWalletResponseClientPubkey(response: WalletResponseEvent): string;
export function getWalletResponseClientPubkey(response: NostrEvent): string | undefined;
export function getWalletResponseClientPubkey(response: NostrEvent): string | undefined {
  return getTagValue(response, "p");
}

/** Returns the request id of the request this response is for */
export function getWalletResponseRequestId(response: WalletResponseEvent): string;
export function getWalletResponseRequestId(response: NostrEvent): string | undefined;
export function getWalletResponseRequestId(response: NostrEvent): string | undefined {
  return getTagValue(response, "e");
}

/** Checks if event is a valid wallet response event */
export function isValidWalletResponse(response: NostrEvent): response is WalletResponseEvent {
  return (
    response.kind === WALLET_RESPONSE_KIND &&
    getWalletResponseRequestId(response) !== undefined &&
    getWalletResponseClientPubkey(response) !== undefined
  );
}
