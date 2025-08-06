/** NIP-47 error codes as defined in the specification */
export type WalletErrorCode =
  | "RATE_LIMITED"
  | "NOT_IMPLEMENTED"
  | "INSUFFICIENT_BALANCE"
  | "QUOTA_EXCEEDED"
  | "RESTRICTED"
  | "UNAUTHORIZED"
  | "INTERNAL"
  | "UNSUPPORTED_ENCRYPTION"
  | "PAYMENT_FAILED"
  | "NOT_FOUND"
  | "OTHER";

/** Base class for all NIP-47 wallet connect errors */
export abstract class WalletBaseError extends Error {
  abstract readonly code: WalletErrorCode;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** The client is sending commands too fast. It should retry in a few seconds. */
export class RateLimitedError extends WalletBaseError {
  readonly code = "RATE_LIMITED" as const;
}

/** The command is not known or is intentionally not implemented. */
export class NotImplementedError extends WalletBaseError {
  readonly code = "NOT_IMPLEMENTED" as const;
}

/** The wallet does not have enough funds to cover a fee reserve or the payment amount. */
export class InsufficientBalanceError extends WalletBaseError {
  readonly code = "INSUFFICIENT_BALANCE" as const;
}

/** The wallet has exceeded its spending quota. */
export class QuotaExceededError extends WalletBaseError {
  readonly code = "QUOTA_EXCEEDED" as const;
}

/** This public key is not allowed to do this operation. */
export class RestrictedError extends WalletBaseError {
  readonly code = "RESTRICTED" as const;
}

/** This public key has no wallet connected. */
export class UnauthorizedError extends WalletBaseError {
  readonly code = "UNAUTHORIZED" as const;
}

/** An internal error. */
export class InternalError extends WalletBaseError {
  readonly code = "INTERNAL" as const;
}

/** The encryption type of the request is not supported by the wallet service. */
export class UnsupportedEncryptionError extends WalletBaseError {
  readonly code = "UNSUPPORTED_ENCRYPTION" as const;
}

/** The payment failed. This may be due to a timeout, exhausting all routes, insufficient capacity or similar. */
export class PaymentFailedError extends WalletBaseError {
  readonly code = "PAYMENT_FAILED" as const;
}

/** The invoice could not be found by the given parameters. */
export class NotFoundError extends WalletBaseError {
  readonly code = "NOT_FOUND" as const;
}

/** Other error. */
export class OtherError extends WalletBaseError {
  readonly code = "OTHER" as const;
}

/** Union type of all NIP-47 error classes */
export type WalletErrorClass =
  | RateLimitedError
  | NotImplementedError
  | InsufficientBalanceError
  | QuotaExceededError
  | RestrictedError
  | UnauthorizedError
  | InternalError
  | UnsupportedEncryptionError
  | PaymentFailedError
  | NotFoundError
  | OtherError;

/** Factory function to create NWC error instances from error code and message */
export function createWalletError(code: WalletErrorCode, message: string): WalletErrorClass {
  switch (code) {
    case "RATE_LIMITED":
      return new RateLimitedError(message);
    case "NOT_IMPLEMENTED":
      return new NotImplementedError(message);
    case "INSUFFICIENT_BALANCE":
      return new InsufficientBalanceError(message);
    case "QUOTA_EXCEEDED":
      return new QuotaExceededError(message);
    case "RESTRICTED":
      return new RestrictedError(message);
    case "UNAUTHORIZED":
      return new UnauthorizedError(message);
    case "INTERNAL":
      return new InternalError(message);
    case "UNSUPPORTED_ENCRYPTION":
      return new UnsupportedEncryptionError(message);
    case "PAYMENT_FAILED":
      return new PaymentFailedError(message);
    case "NOT_FOUND":
      return new NotFoundError(message);
    case "OTHER":
      return new OtherError(message);
    default:
      // This should never happen with proper typing, but provides a fallback
      return new OtherError(message);
  }
}
