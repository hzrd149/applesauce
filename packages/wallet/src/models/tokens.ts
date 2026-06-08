import { Model, watchEventsUpdates } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { combineLatest, identity, map } from "rxjs";

import { ignoreDuplicateProofs } from "../helpers/cashu.js";
import { getTokenContent, getTokenDeletedIds, isTokenContentUnlocked, WALLET_TOKEN_KIND } from "../helpers/tokens.js";

/**
 * Collects the set of token event ids that newer token events have marked as deleted. Reads the public
 * `del` tags first so the events do not need to be decrypted, falling back to the decrypted content for
 * older events that only stored the deleted ids inside the encrypted content.
 */
function collectDeletedIds(tokens: NostrEvent[]): Set<string> {
  const deleted = new Set<string>();
  for (const token of tokens) {
    // Public `del` tags do not require decryption
    for (const id of getTokenDeletedIds(token)) deleted.add(id);
    // Fall back to the decrypted content for older events without public `del` tags
    if (isTokenContentUnlocked(token)) for (const id of getTokenContent(token).del) deleted.add(id);
  }
  return deleted;
}

/**
 * A model that returns the set of token event ids that have been marked as deleted by other token events.
 * Reads the public `del` tags first so it works without decryption, and falls back to the decrypted content
 * for unlocked events written by apps that only store the deleted ids inside the encrypted content (the
 * public `del` tags are an applesauce extension and are not part of NIP-60). The other token models depend
 * on this model so the deleted set is always collected from the full timeline.
 */
export function WalletDeletedTokenIdsModel(pubkey: string): Model<Set<string>> {
  return (events) => {
    return events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] }).pipe(
      // Re-collect when a token unlocks so the decrypted-content fallback stays accurate
      watchEventsUpdates(events),
      map(collectDeletedIds),
    );
  };
}

/** A model that subscribes to all token events for a wallet, passing unlocked will filter by token unlocked status */
export function WalletTokensModel(pubkey: string, unlocked?: boolean | undefined): Model<NostrEvent[]> {
  return (events) => {
    return combineLatest([
      events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] }),
      events.model(WalletDeletedTokenIdsModel, pubkey),
    ]).pipe(
      // remove deleted events
      map(([tokens, deleted]) => tokens.filter((token) => !deleted.has(token.id))),
      // filter out locked tokens
      unlocked !== undefined ? map((tokens) => tokens.filter((t) => isTokenContentUnlocked(t) === unlocked)) : identity,
    );
  };
}

/**
 * A model that returns token events which have been marked as deleted by a newer token event's `del`
 * field but are still present in the store. These are the events that {@link CleanupDeletedTokens} (or
 * a NIP-09 delete event) can safely remove from relays.
 */
export function WalletDeletedTokensModel(pubkey: string): Model<NostrEvent[]> {
  return (events) => {
    return combineLatest([
      events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] }),
      events.model(WalletDeletedTokenIdsModel, pubkey),
    ]).pipe(map(([tokens, deleted]) => tokens.filter((token) => deleted.has(token.id))));
  };
}

/** A model that returns the visible balance of a wallet for each mint */
export function WalletBalanceModel(pubkey: string): Model<Record<string, number>> {
  return (events) => {
    return combineLatest([
      // Watch for updates to the tokens so the balance recounts when a token unlocks
      events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] }).pipe(watchEventsUpdates(events)),
      events.model(WalletDeletedTokenIdsModel, pubkey),
    ]).pipe(
      // Ignore deleted tokens
      map(([tokens, deleted]) => tokens.filter((token) => !deleted.has(token.id))),
      // Ignore locked tokens
      map((tokens) => tokens.filter(isTokenContentUnlocked)),
      // map tokens to totals
      map((tokens) => {
        // ignore duplicate proofs
        const seen = new Set<string>();

        return tokens.reduce(
          (totals, token) => {
            const details = getTokenContent(token);
            const total = details.proofs.filter(ignoreDuplicateProofs(seen)).reduce((t, p) => t + p.amount, 0);
            return { ...totals, [details.mint]: (totals[details.mint] ?? 0) + total };
          },
          {} as Record<string, number>,
        );
      }),
    );
  };
}
