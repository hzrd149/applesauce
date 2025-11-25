import { decode } from "light-bolt11-decoder";

export type ParsedInvoice = {
  paymentRequest: string;
  description: string;
  amount?: number;
  timestamp: number;
  expiry: number;
  paymentHash?: string;
};

/** Parses a lightning invoice */
export function parseBolt11(paymentRequest: string): ParsedInvoice {
  const decoded = decode(paymentRequest);
  const timestamp = (decoded.sections.find((s) => s.name === "timestamp") as { value: number } | undefined)?.value ?? 0;

  const description =
    (decoded.sections.find((s) => s.name === "description") as { value: string } | undefined)?.value ?? "";
  const amount = parseInt(
    (decoded.sections.find((s) => s.name === "amount") as { value: string } | undefined)?.value ?? "0",
  );
  const paymentHash = decoded.sections.find((s) => s.name === "payment_hash") as { value: string } | undefined;

  return {
    paymentRequest: decoded.paymentRequest,
    description: description,
    amount: amount,
    timestamp: timestamp,
    expiry: timestamp + decoded.expiry,
    paymentHash: paymentHash?.value,
  };
}
