import {
  EncryptionMethod,
  getHiddenContent,
  getOrComputeCachedValue,
  getTagValue,
  HiddenContentSigner,
  isHiddenContentLocked,
  isNIP04Encrypted,
  setHiddenContentEncryptionMethod,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { WalletErrorCode } from "./error.js";
import { WalletMethod } from "./support.js";
import { NotificationType } from "./notification.js";

export const WALLET_RESPONSE_KIND = 23195;

// Set the encryption method to use for response kind
setHiddenContentEncryptionMethod(WALLET_RESPONSE_KIND, "nip04");

/** A symbol used to cache the wallet response on the event */
export const WalletResponseSymbol = Symbol("wallet-response");

/** Error object for wallet responses */
export interface WalletResponseError {
  type: WalletErrorCode;
  message: string;
}

/** Base response structure for all NIP-47 responses */
export type BaseWalletResponse<TResultType extends WalletMethod, TResult> =
  | {
      /** Indicates the structure of the result field */
      result_type: TResultType;
      /** Error object, non-null in case of error */
      error: WalletResponseError;
      result: null;
    }
  | {
      /** Indicates the structure of the result field */
      result_type: TResultType;
      error: null;
      /** Result object, null in case of error */
      result: TResult;
    };

/** Transaction object used in multiple response types */
export interface Transaction {
  /** Type of transaction */
  type: "incoming" | "outgoing";
  /** State of the transaction */
  state: "pending" | "settled" | "expired" | "failed";
  /** Value in msats */
  amount: number;
  /** Value in msats */
  fees_paid: number;
  /** Invoice/payment creation unix timestamp */
  created_at: number;

  /** Encoded invoice, optional */
  invoice?: string;
  /** Invoice's description, optional */
  description?: string;
  /** Invoice's description hash, optional */
  description_hash?: string;
  /** Payment's preimage, optional if unpaid */
  preimage?: string;
  /** Payment hash for the payment, optional */
  payment_hash?: string;
  /** Invoice expiration unix timestamp, optional if not applicable */
  expires_at?: number;
  /** Invoice/payment settlement unix timestamp, optional if unpaid */
  settled_at?: number;
  /** Generic metadata that can be used to add things like zap/boostagram details */
  metadata?: Record<string, any>;
}

// Response Types

/** Response for pay_invoice method */
export interface PayInvoiceResult {
  /** Preimage of the payment */
  preimage: string;
  /** Value in msats, optional */
  fees_paid?: number;
}

export type PayInvoiceResponse = BaseWalletResponse<"pay_invoice", PayInvoiceResult>;

/** Response for multi_pay_invoice method */
export interface MultiPayInvoiceResult {
  /** Preimage of the payment */
  preimage: string;
  /** Value in msats, optional */
  fees_paid?: number;
}

export type MultiPayInvoiceResponse = BaseWalletResponse<"multi_pay_invoice", MultiPayInvoiceResult>;

/** Response for pay_keysend method */
export interface PayKeysendResult {
  /** Preimage of the payment */
  preimage: string;
  /** Value in msats, optional */
  fees_paid?: number;
}

export type PayKeysendResponse = BaseWalletResponse<"pay_keysend", PayKeysendResult>;

/** Response for multi_pay_keysend method */
export interface MultiPayKeysendResult {
  /** Preimage of the payment */
  preimage: string;
  /** Value in msats, optional */
  fees_paid?: number;
}

export type MultiPayKeysendResponse = BaseWalletResponse<"multi_pay_keysend", MultiPayKeysendResult>;

/** Response for make_invoice method */
export type MakeInvoiceResult = Transaction;

export type MakeInvoiceResponse = BaseWalletResponse<"make_invoice", MakeInvoiceResult>;

/** Response for lookup_invoice method */
export type LookupInvoiceResult = Transaction;

export type LookupInvoiceResponse = BaseWalletResponse<"lookup_invoice", LookupInvoiceResult>;

/** Response for list_transactions method */
export interface ListTransactionsResult {
  /** Array of transactions */
  transactions: Transaction[];
}

export type ListTransactionsResponse = BaseWalletResponse<"list_transactions", ListTransactionsResult>;

/** Response for get_balance method */
export interface GetBalanceResult {
  /** User's balance in msats */
  balance: number;
}

export type GetBalanceResponse = BaseWalletResponse<"get_balance", GetBalanceResult>;

/** Response for get_info method */
export interface GetInfoResult {
  /** Node alias */
  alias: string;
  /** Node color as hex string */
  color: string;
  /** Node public key as hex string */
  pubkey: string;
  /** Network type */
  network: "mainnet" | "testnet" | "signet" | "regtest";
  /** Current block height */
  block_height: number;
  /** Current block hash as hex string */
  block_hash: string;
  /** List of supported methods for this connection */
  methods: WalletMethod[];
  /** List of supported notifications for this connection, optional */
  notifications?: NotificationType[];
}

export type GetInfoResponse = BaseWalletResponse<"get_info", GetInfoResult>;

/** Union type for all NIP-47 response types */
export type WalletResponse =
  | PayInvoiceResponse
  | MultiPayInvoiceResponse
  | PayKeysendResponse
  | MultiPayKeysendResponse
  | MakeInvoiceResponse
  | LookupInvoiceResponse
  | ListTransactionsResponse
  | GetBalanceResponse
  | GetInfoResponse;

/** Checks if a kind 23195 event is locked */
export function isWalletResponseLocked(response: NostrEvent) {
  return isHiddenContentLocked(response);
}

/** Unlocks a kind 23195 event */
export async function unlockWalletResponse(
  response: NostrEvent,
  signer: HiddenContentSigner,
  override?: EncryptionMethod,
): Promise<WalletResponse | undefined | null> {
  const encryption = override ?? (!isNIP04Encrypted(response.content) ? "nip44" : "nip04");
  await unlockHiddenContent(response, signer, encryption);

  return getWalletResponse(response);
}

/** Gets the wallet response from a kind 23195 event */
export function getWalletResponse(response: NostrEvent): WalletResponse | undefined | null {
  if (isWalletResponseLocked(response)) return undefined;

  return getOrComputeCachedValue(response, WalletResponseSymbol, () => {
    const content = getHiddenContent(response);
    if (!content) return null;

    return JSON.parse(content) as WalletResponse;
  });
}

/** Returns the client pubkey of client this response is for */
export function getWalletResponseClientPubkey(response: NostrEvent): string | undefined {
  return getTagValue(response, "p");
}

/** Returns the request id of the request this response is for */
export function getWalletResponseRequestId(response: NostrEvent): string | undefined {
  return getTagValue(response, "e");
}
