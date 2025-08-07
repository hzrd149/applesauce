import {
  getHiddenContent,
  getOrComputeCachedValue,
  getTagValue,
  HiddenContentSigner,
  isHiddenContentLocked,
  isNIP04Encrypted,
  setHiddenContentEncryptionMethod,
  unixNow,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { WalletMethods } from "./methods.js";
import { EncryptionMethods } from "./encryption.js";

export const WALLET_REQUEST_KIND = 23194;

// Set the encryption method to use for request kind
setHiddenContentEncryptionMethod(WALLET_REQUEST_KIND, "nip44");

/** A symbol used to cache the wallet request on the event */
export const WalletRequestSymbol = Symbol("wallet-request");

/** TLV record for keysend payments */
export interface TLVRecord {
  /** TLV type */
  type: number;
  /** Hex encoded TLV value */
  value: string;
}

/** Base request structure for all NIP-47 requests */
export interface BaseWalletRequest<TMethod extends WalletMethods, TParams> {
  /** The method to call */
  method: TMethod;
  /** Parameters for the method */
  params: TParams;
}

// Request Parameter Types

/** Parameters for pay_invoice method */
export interface PayInvoiceParams {
  /** BOLT11 invoice */
  invoice: string;
  /** Invoice amount in msats, optional */
  amount?: number;
}

export type PayInvoiceRequest = BaseWalletRequest<"pay_invoice", PayInvoiceParams>;

/** Parameters for multi_pay_invoice method */
export interface MultiPayInvoiceParams {
  /** Array of invoices to pay */
  invoices: Array<{
    /** ID to identify this invoice in the response */
    id?: string;
    /** BOLT11 invoice */
    invoice: string;
    /** Invoice amount in msats, optional */
    amount?: number;
  }>;
}

export type MultiPayInvoiceRequest = BaseWalletRequest<"multi_pay_invoice", MultiPayInvoiceParams>;

/** Parameters for pay_keysend method */
export interface PayKeysendParams {
  /** Amount in msats, required */
  amount: number;
  /** Payee pubkey, required */
  pubkey: string;
  /** Preimage of the payment, optional */
  preimage?: string;
  /** TLV records, optional */
  tlv_records?: TLVRecord[];
}

export type PayKeysendRequest = BaseWalletRequest<"pay_keysend", PayKeysendParams>;

/** Parameters for multi_pay_keysend method */
export interface MultiPayKeysendParams {
  /** Array of keysend payments */
  keysends: Array<{
    /** ID to identify this keysend in the response */
    id?: string;
    /** Payee pubkey, required */
    pubkey: string;
    /** Amount in msats, required */
    amount: number;
    /** Preimage of the payment, optional */
    preimage?: string;
    /** TLV records, optional */
    tlv_records?: TLVRecord[];
  }>;
}

export type MultiPayKeysendRequest = BaseWalletRequest<"multi_pay_keysend", MultiPayKeysendParams>;

/** Parameters for make_invoice method */
export interface MakeInvoiceParams {
  /** Value in msats */
  amount: number;
  /** Invoice's description, optional */
  description?: string;
  /** Invoice's description hash, optional */
  description_hash?: string;
  /** Expiry in seconds from time invoice is created, optional */
  expiry?: number;
}

export type MakeInvoiceRequest = BaseWalletRequest<"make_invoice", MakeInvoiceParams>;

/** Parameters for lookup_invoice method */
export interface LookupInvoiceParams {
  /** Payment hash of the invoice, one of payment_hash or invoice is required */
  payment_hash?: string;
  /** Invoice to lookup */
  invoice?: string;
}

export type LookupInvoiceRequest = BaseWalletRequest<"lookup_invoice", LookupInvoiceParams>;

/** Parameters for list_transactions method */
export interface ListTransactionsParams {
  /** Starting timestamp in seconds since epoch (inclusive), optional */
  from?: number;
  /** Ending timestamp in seconds since epoch (inclusive), optional */
  until?: number;
  /** Maximum number of invoices to return, optional */
  limit?: number;
  /** Offset of the first invoice to return, optional */
  offset?: number;
  /** Include unpaid invoices, optional, default false */
  unpaid?: boolean;
  /** "incoming" for invoices, "outgoing" for payments, undefined for both */
  type?: "incoming" | "outgoing";
}

export type ListTransactionsRequest = BaseWalletRequest<"list_transactions", ListTransactionsParams>;

/** Parameters for get_balance method */
export interface GetBalanceParams {}

export type GetBalanceRequest = BaseWalletRequest<"get_balance", GetBalanceParams>;

/** Parameters for get_info method */
export interface GetInfoParams {}

export type GetInfoRequest = BaseWalletRequest<"get_info", GetInfoParams>;

/** Union type for all NIP-47 request types */
export type WalletRequest =
  | PayInvoiceRequest
  | MultiPayInvoiceRequest
  | PayKeysendRequest
  | MultiPayKeysendRequest
  | MakeInvoiceRequest
  | LookupInvoiceRequest
  | ListTransactionsRequest
  | GetBalanceRequest
  | GetInfoRequest;

/** Checks if a kind 23194 event is locked */
export function isWalletRequestLocked(request: NostrEvent) {
  return isHiddenContentLocked(request);
}

/** Unlocks a kind 23194 event */
export async function unlockWalletRequest(
  request: NostrEvent,
  signer: HiddenContentSigner,
): Promise<WalletRequest | undefined | null> {
  await unlockHiddenContent(request, signer);

  return getWalletRequest(request);
}

/** Gets the wallet request from a kind 23194 event */
export function getWalletRequest(request: NostrEvent): WalletRequest | undefined | null {
  if (isWalletRequestLocked(request)) return undefined;

  return getOrComputeCachedValue(request, WalletRequestSymbol, () => {
    const content = getHiddenContent(request);
    if (!content) return null;

    return JSON.parse(content) as WalletRequest;
  });
}

/** Returns the wallet service pubkey from a request */
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
export function getWalletRequestEncryption(request: NostrEvent): EncryptionMethods {
  const encryption = getTagValue(request, "encryption");
  return encryption ? (encryption as EncryptionMethods) : isNIP04Encrypted(request.content) ? "nip04" : "nip44_v2";
}
