import { WalletErrorCode } from "./error.js";
import { WalletSupport } from "./support.js";

/** Base request structure for all NIP-47 requests */
export interface TWalletRequest<Method extends string, Params> {
  /** The method to call */
  method: Method;
  /** Parameters for the method */
  params: Params;
}

/** Error object for wallet responses */
export interface TWalletResponseError {
  type: WalletErrorCode;
  message: string;
}

/** Base response structure for all NIP-47 responses */
export type TWalletErrorResponse<Method extends string> = {
  /** Indicates the structure of the result field */
  result_type: Method;
  /** Error object, non-null in case of error */
  error: TWalletResponseError;
  result: null;
};

export type TWalletSuccessResponse<Method extends string, Result> = {
  /** Indicates the structure of the result field */
  result_type: Method;
  error: null;
  /** Result object, null in case of error */
  result: Result;
};

/** Merged wallet response and request types, this is designed to only be used with typescript */
export type TWalletMethod<Method extends string = string, Params extends any = any, Result extends any = any> = {
  /** Method string */
  method: Method;
  /** Request type */
  request: TWalletRequest<Method, Params>;
  /** Response success type */
  response: TWalletSuccessResponse<Method, Result>;
  /** Response error type */
  error: TWalletErrorResponse<Method>;
};

// Common wallet methods

/** TLV record for keysend payments */
export interface TLVRecord {
  /** TLV type */
  type: number;
  /** Hex encoded TLV value */
  value: string;
}

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

// Wallet Method Definitions

export type PayInvoiceMethod = TWalletMethod<
  "pay_invoice",
  {
    /** BOLT11 invoice */
    invoice: string;
    /** Invoice amount in msats, optional */
    amount?: number;
  },
  {
    /** Preimage of the payment */
    preimage: string;
    /** Value in msats, optional */
    fees_paid?: number;
  }
>;

export type MultiPayInvoiceMethod = TWalletMethod<
  "multi_pay_invoice",
  {
    /** Array of invoices to pay */
    invoices: Array<{
      /** ID to identify this invoice in the response */
      id?: string;
      /** BOLT11 invoice */
      invoice: string;
      /** Invoice amount in msats, optional */
      amount?: number;
    }>;
  },
  {
    /** Preimage of the payment */
    preimage: string;
    /** Value in msats, optional */
    fees_paid?: number;
  }
>;

export type PayKeysendMethod = TWalletMethod<
  "pay_keysend",
  {
    /** Amount in msats, required */
    amount: number;
    /** Payee pubkey, required */
    pubkey: string;
    /** Preimage of the payment, optional */
    preimage?: string;
    /** TLV records, optional */
    tlv_records?: TLVRecord[];
  },
  {
    /** Preimage of the payment */
    preimage: string;
    /** Value in msats, optional */
    fees_paid?: number;
  }
>;

export type MultiPayKeysendMethod = TWalletMethod<
  "multi_pay_keysend",
  {
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
  },
  {
    /** Preimage of the payment */
    preimage: string;
    /** Value in msats, optional */
    fees_paid?: number;
  }
>;

export type MakeInvoiceMethod = TWalletMethod<
  "make_invoice",
  {
    /** Value in msats */
    amount: number;
    /** Invoice's description, optional */
    description?: string;
    /** Invoice's description hash, optional */
    description_hash?: string;
    /** Expiry in seconds from time invoice is created, optional */
    expiry?: number;
  },
  Transaction
>;

export type LookupInvoiceMethod = TWalletMethod<
  "lookup_invoice",
  {
    /** Payment hash of the invoice, one of payment_hash or invoice is required */
    payment_hash?: string;
    /** Invoice to lookup */
    invoice?: string;
  },
  Transaction
>;

export type ListTransactionsMethod = TWalletMethod<
  "list_transactions",
  {
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
  },
  {
    /** Array of transactions */
    transactions: Transaction[];
  }
>;

export type GetBalanceMethod = TWalletMethod<
  "get_balance",
  {},
  {
    /** User's balance in msats */
    balance: number;
  }
>;

/** Type for wallet get_info */
export type WalletInfo = Omit<WalletSupport, "encryption"> & {
  /** Node alias */
  alias?: string;
  /** Node color as hex string */
  color?: string;
  /** Node public key as hex string */
  pubkey?: string;
  /** Network type */
  network?: "mainnet" | "testnet" | "signet" | "regtest";
  /** Current block height */
  block_height?: number;
  /** Current block hash as hex string */
  block_hash?: string;
};

export type GetInfoMethod = TWalletMethod<"get_info", {}, WalletInfo>;

/** Union type for all wallet method definitions */
export type CommonWalletMethods =
  | PayInvoiceMethod
  | MultiPayInvoiceMethod
  | PayKeysendMethod
  | MultiPayKeysendMethod
  | MakeInvoiceMethod
  | LookupInvoiceMethod
  | ListTransactionsMethod
  | GetBalanceMethod
  | GetInfoMethod;
