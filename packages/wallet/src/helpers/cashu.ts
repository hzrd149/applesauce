import { getDecodedToken, getEncodedToken, Proof, Token } from "@cashu/cashu-ts";
import { safeParse } from "applesauce-core/helpers";

/** Internal method for creating a unique id for each proof */
export function getProofUID(proof: Proof): string {
  return proof.id + proof.amount + proof.C + proof.secret;
}

/**
 * Extracts the P2PK locking pubkey from a proof's secret
 * @param proof the cashu proof to extract the pubkey from
 * @returns the pubkey, or undefined if not P2PK locked
 */
export function getProofP2PKPubkey(proof: Proof): string | undefined {
  const secret = safeParse(proof.secret);
  if (!secret) return;
  if (!Array.isArray(secret)) return;
  if (secret[0] !== "P2PK") return;

  const proofPubkey = secret[1]?.data;
  if (!proofPubkey || typeof proofPubkey !== "string") return;

  return proofPubkey;
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
