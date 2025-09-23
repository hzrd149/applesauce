import { getDecodedToken, getEncodedToken, Proof, Token } from "@cashu/cashu-ts";
import {
  getHiddenContent,
  HiddenContentSigner,
  isHiddenContentUnlocked,
  lockHiddenContent,
  notifyEventUpdate,
  setHiddenContentEncryptionMethod,
  UnlockedHiddenContent,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

export const WALLET_TOKEN_KIND = 7375;

// Enable hidden content for wallet token kind
setHiddenContentEncryptionMethod(WALLET_TOKEN_KIND, "nip44");

/** Internal method for creating a unique id for each proof */
export function getProofUID(proof: Proof): string {
  return proof.id + proof.amount + proof.C + proof.secret;
}

/** Internal method to filter out duplicate proofs */
export function ignoreDuplicateProofs(seen = new Set<string>()): (proof: Proof) => boolean {
  return (proof) => {
    const id = getProofUID(proof);
    if (seen.has(id)) return false;
    else {
      seen.add(id);
      return true;
    }
  };
}

export type TokenContent = {
  /** Cashu mint for the proofs */
  mint: string;
  /** Cashu proofs */
  proofs: { amount: number; secret: string; C: string; id: string }[];
  /** The cashu unit */
  unit?: string;
  /** tokens that were destroyed in the creation of this token (helps on wallet state transitions) */
  del: string[];
};

/** Symbol for caching token content */
export const TokenContentSymbol = Symbol.for("token-content");

/** Type for token events with unlocked content */
export type UnlockedTokenContent = UnlockedHiddenContent & {
  [TokenContentSymbol]: TokenContent;
};

/**
 * Returns the decrypted and parsed details of a 7375 token event
 * @throws {Error} If the token content is invalid
 */
export function getTokenContent(token: UnlockedTokenContent): TokenContent;
export function getTokenContent(token: NostrEvent): TokenContent | undefined;
export function getTokenContent<T extends NostrEvent>(token: T): TokenContent | undefined {
  if (isTokenContentUnlocked(token)) return token[TokenContentSymbol];

  // Get the hidden content
  const plaintext = getHiddenContent(token);
  if (!plaintext) return undefined;

  // Parse the content as a token content
  const details = JSON.parse(plaintext) as TokenContent;

  // Throw an error if the token content is invalid
  if (!details.mint) throw new Error("Token missing mint");
  if (!details.proofs) throw new Error("Token missing proofs");
  if (!details.del) details.del = [];

  // Set the cached value
  Reflect.set(token, TokenContentSymbol, details);

  return details;
}

/** Returns if token details are locked */
export function isTokenContentUnlocked<T extends NostrEvent>(token: T): token is T & UnlockedTokenContent {
  return isHiddenContentUnlocked(token) && Reflect.has(token, TokenContentSymbol) === true;
}

/** Decrypts a k:7375 token event */
export async function unlockTokenContent(token: NostrEvent, signer: HiddenContentSigner): Promise<TokenContent> {
  if (isTokenContentUnlocked(token)) return token[TokenContentSymbol];

  // Unlock the hidden content
  await unlockHiddenContent(token, signer);

  // Parse the content as a token content
  const parsed = getTokenContent(token);
  if (!parsed) throw new Error("Failed to unlock token content");

  // Trigger update for event
  notifyEventUpdate(token);

  return parsed;
}

/** Removes the unencrypted hidden content */
export function lockTokenContent(token: NostrEvent) {
  Reflect.deleteProperty(token, TokenContentSymbol);
  lockHiddenContent(token);
}

/**
 * Gets the totaled amount of proofs in a token event
 * @param token The token event to calculate the total
 */
export function getTokenProofsTotal(token: UnlockedTokenContent): number;
export function getTokenProofsTotal(token: NostrEvent): number | undefined;
export function getTokenProofsTotal<T extends NostrEvent>(token: T): number | undefined {
  const content = getTokenContent(token);
  if (!content) return undefined;
  return content.proofs.reduce((t, p) => t + p.amount, 0);
}

/**
 * Selects oldest tokens and proofs that total up to more than the min amount
 * @throws {Error} If there are insufficient funds
 */
export function dumbTokenSelection(
  tokens: NostrEvent[],
  minAmount: number,
  mint?: string,
): { events: NostrEvent[]; proofs: Proof[] } {
  // sort newest to oldest
  const sorted = tokens
    .filter((token) => (mint ? getTokenContent(token)?.mint === mint : true))
    .sort((a, b) => b.created_at - a.created_at);

  let amount = 0;
  const seen = new Set<string>();
  const selectedTokens: NostrEvent[] = [];
  const selectedProofs: Proof[] = [];

  while (amount < minAmount) {
    const token = sorted.pop();
    if (!token) throw new Error("Insufficient funds");

    const content = getTokenContent(token);

    // Skip locked tokens
    if (!content) continue;

    // Get proofs and total
    const proofs = content.proofs.filter(ignoreDuplicateProofs(seen));
    const total = proofs.reduce((t, p) => t + p.amount, 0);

    selectedTokens.push(token);
    selectedProofs.push(...proofs);
    amount += total;
  }

  return { events: selectedTokens, proofs: selectedProofs };
}

/**
 * Returns a decoded cashu token inside an unicode emoji
 * @see https://github.com/cashubtc/cashu.me/blob/1194a7b9ee2f43305e38304de7bef8839601ff4d/src/components/ReceiveTokenDialog.vue#L387
 */
export function decodeTokenFromEmojiString(str: string): Token | undefined {
  try {
    let decoded: string[] = [];
    const chars = Array.from(str);
    if (!chars.length) return undefined;

    const fromVariationSelector = function (char: string) {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) return null;

      // Handle Variation Selectors (VS1-VS16): U+FE00 to U+FE0F
      if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) {
        // Maps FE00->0, FE01->1, ..., FE0F->15
        const byteValue = codePoint - 0xfe00;
        return String.fromCharCode(byteValue);
      }

      // Handle Variation Selectors Supplement (VS17-VS256): U+E0100 to U+E01EF
      if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) {
        // Maps E0100->16, E0101->17, ..., E01EF->255
        const byteValue = codePoint - 0xe0100 + 16;
        return String.fromCharCode(byteValue);
      }

      // No Variation Selector
      return null;
    };

    // Check all input chars for peanut data
    for (const char of chars) {
      let byte = fromVariationSelector(char);
      if (byte === null && decoded.length > 0) {
        break;
      } else if (byte === null) {
        continue;
      }
      decoded.push(byte); // got some
    }
    // Switch out token if we found peanut data
    let decodedString = decoded.join("");

    return getDecodedToken(decodedString);
  } catch (error) {
    return undefined;
  }
}

/**
 * Encodes a token into an emoji char
 * @see https://github.com/cashubtc/cashu.me/blob/1194a7b9ee2f43305e38304de7bef8839601ff4d/src/components/SendTokenDialog.vue#L710
 */
export function encodeTokenToEmoji(token: Token | string, emoji = "🥜") {
  return (
    emoji +
    Array.from(typeof token === "string" ? token : getEncodedToken(token))
      .map((char) => {
        const byteValue = char.charCodeAt(0);
        // For byte values 0-15, use Variation Selectors (VS1-VS16): U+FE00 to U+FE0F
        if (byteValue >= 0 && byteValue <= 15) {
          return String.fromCodePoint(0xfe00 + byteValue);
        }

        // For byte values 16-255, use Variation Selectors Supplement (VS17-VS256): U+E0100 to U+E01EF
        if (byteValue >= 16 && byteValue <= 255) {
          return String.fromCodePoint(0xe0100 + (byteValue - 16));
        }

        return "";
      })
      .join("")
  );
}
