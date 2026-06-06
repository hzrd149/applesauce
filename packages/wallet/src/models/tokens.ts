import { Model, watchEventsUpdates } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { identity, map } from "rxjs";

import { ignoreDuplicateProofs } from "../helpers/cashu.js";
import { getTokenContent, isTokenContentUnlocked, WALLET_TOKEN_KIND } from "../helpers/tokens.js";

/** Collects the set of token event ids that newer (unlocked) token events have marked as deleted */
function collectDeletedIds(tokens: NostrEvent[]): Set<string> {
  const deleted = new Set<string>();
  for (const token of tokens) {
    if (isTokenContentUnlocked(token)) for (const id of getTokenContent(token)!.del) deleted.add(id);
  }
  return deleted;
}

/**
 * Removes token events that a newer token event has marked as deleted via its `del` field. Collects the
 * full deleted set up front so it is independent of the timeline's sort order and handles delete chains
 * (A deleted by B, B deleted by C) correctly.
 */
function filterDeleted<T extends NostrEvent>(tokens: T[]): T[] {
  const deleted = collectDeletedIds(tokens);
  return tokens.filter((token) => !deleted.has(token.id));
}

/** A model that subscribes to all token events for a wallet, passing unlocked will filter by token unlocked status */
export function WalletTokensModel(pubkey: string, unlocked?: boolean | undefined): Model<NostrEvent[]> {
  return (events) => {
    return events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] }).pipe(
      // filter out locked tokens
      unlocked !== undefined ? map((tokens) => tokens.filter((t) => isTokenContentUnlocked(t) === unlocked)) : identity,
      // remove deleted events
      map(filterDeleted),
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
    return events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] }).pipe(
      map((tokens) => {
        const deleted = collectDeletedIds(tokens);
        return tokens.filter((token) => deleted.has(token.id));
      }),
    );
  };
}

/** A model that returns the visible balance of a wallet for each mint */
export function WalletBalanceModel(pubkey: string): Model<Record<string, number>> {
  return (events) => {
    return events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] }).pipe(
      // Watch for updates to the tokens
      watchEventsUpdates(events),
      // Ignore locked tokens
      map((tokens) => tokens.filter((t) => isTokenContentUnlocked(t))),
      // filter out deleted tokens
      map(filterDeleted),
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
