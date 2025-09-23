import { bech32 } from "@scure/base";
import { parseBolt11 } from "./bolt11.js";

const decoder = new TextDecoder();

/** Parses a lightning address (lud16) into a LNURLp */
export function parseLightningAddress(address: string): URL | undefined {
  let [name, domain] = address.split("@");
  if (!name || !domain) return;
  return new URL(`https://${domain}/.well-known/lnurlp/${name}`);
}

/** Parses a LNURLp into a URL */
export function decodeLNURL(lnurl: string): URL | undefined {
  try {
    const { words, prefix } = bech32.decode<"lnurl">(lnurl as `lnurl1${string}`);
    if (prefix !== "lnurl") return;

    const str = decoder.decode(bech32.fromWords(words));
    return new URL(str);
  } catch (error) {}
  return undefined;
}

/** Parses a lightning address or LNURLp into a URL */
export function parseLNURLOrAddress(addressOrLNURL: string): URL | undefined {
  if (addressOrLNURL.includes("@")) return parseLightningAddress(addressOrLNURL);
  else return decodeLNURL(addressOrLNURL);
}

/** Requests a bolt11 invoice from a LNURLp callback URL */
export async function getInvoice(callback: URL): Promise<string> {
  const { pr: payRequest } = await fetch(callback).then((res) => res.json());

  const amount = callback.searchParams.get("amount");
  if (!amount) throw new Error("Missing amount");

  if (payRequest as string) {
    const parsed = parseBolt11(payRequest);
    if (parsed.amount !== parseInt(amount)) throw new Error("Incorrect amount");

    return payRequest as string;
  } else throw new Error("Failed to get invoice");
}
