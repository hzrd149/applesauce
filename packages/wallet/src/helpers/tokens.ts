import { Proof } from "@cashu/cashu-ts";
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
import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { ignoreDuplicateProofs } from "./cashu.js";

export const WALLET_TOKEN_KIND = 7375;

/** Validated wallet token event */
export type WalletTokenEvent = KnownEvent<typeof WALLET_TOKEN_KIND>;

/** Checks if an event is a valid wallet token event */
export function isValidWalletToken(event: NostrEvent): event is WalletTokenEvent {
  return event.kind === WALLET_TOKEN_KIND;
}

// Enable hidden content for wallet token kind
setHiddenContentEncryptionMethod(WALLET_TOKEN_KIND, "nip44");

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

/** Returns if token details are locked */
export function isTokenContentUnlocked<T extends NostrEvent>(token: T): token is T & UnlockedTokenContent {
  // Wrap in try catch to avoid throwing validation errors
  try {
    return TokenContentSymbol in token || (isHiddenContentUnlocked(token) && getTokenContent(token) !== undefined);
  } catch {}
  return false;
}

/**
 * Returns the decrypted and parsed details of a 7375 token event
 * @throws {Error} If the token content is invalid
 */
export function getTokenContent(token: UnlockedTokenContent): TokenContent;
export function getTokenContent(token: NostrEvent): TokenContent | undefined;
export function getTokenContent<T extends NostrEvent>(token: T): TokenContent | undefined {
  if (TokenContentSymbol in token) return token[TokenContentSymbol] as TokenContent;

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

/** Decrypts a k:7375 token event */
export async function unlockTokenContent(token: NostrEvent, signer: HiddenContentSigner): Promise<TokenContent> {
  if (TokenContentSymbol in token) return token[TokenContentSymbol] as TokenContent;

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
 * If mint is undefined, finds a mint with sufficient balance and selects only from that mint
 * @throws {Error} If there are insufficient funds
 */
export function dumbTokenSelection(
  tokens: NostrEvent[],
  minAmount: number,
  mint?: string,
): { events: NostrEvent[]; proofs: Proof[] } {
  // If mint is not specified, find a mint with sufficient balance
  let targetMint = mint;
  if (!targetMint) {
    // Group tokens by mint and calculate total balance per mint
    const tokensByMint = new Map<string, NostrEvent[]>();
    for (const token of tokens) {
      const content = getTokenContent(token);
      if (!content) continue; // Skip locked tokens
      const tokenMint = content.mint;
      if (!tokenMint) continue;
      if (!tokensByMint.has(tokenMint)) {
        tokensByMint.set(tokenMint, []);
      }
      tokensByMint.get(tokenMint)!.push(token);
    }

    // Find a mint with sufficient balance
    let foundMint: string | undefined;
    for (const [mintKey, mintTokens] of tokensByMint) {
      const seen = new Set<string>();
      let total = 0;
      for (const token of mintTokens) {
        const content = getTokenContent(token);
        if (!content) continue;
        const proofs = content.proofs.filter(ignoreDuplicateProofs(seen));
        total += proofs.reduce((t, p) => t + p.amount, 0);
      }
      if (total >= minAmount) {
        foundMint = mintKey;
        break;
      }
    }

    if (!foundMint) throw new Error("Insufficient funds in any mint");

    targetMint = foundMint;
  }

  // Filter tokens by the target mint and sort newest to oldest
  const sorted = tokens
    .filter((token) => {
      const content = getTokenContent(token);
      return content?.mint === targetMint;
    })
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

    // Verify mint matches (should always match due to filter, but double-check for safety)
    if (content.mint !== targetMint) {
      throw new Error(`Token mint mismatch: expected ${targetMint}, got ${content.mint}`);
    }

    // Get proofs and total
    const proofs = content.proofs.filter(ignoreDuplicateProofs(seen));
    const total = proofs.reduce((t, p) => t + p.amount, 0);

    selectedTokens.push(token);
    selectedProofs.push(...proofs);
    amount += total;
  }

  return { events: selectedTokens, proofs: selectedProofs };
}
