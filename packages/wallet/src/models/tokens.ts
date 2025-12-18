import { Model, watchEventsUpdates } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { identity, map } from "rxjs";

import {
  getTokenContent,
  ignoreDuplicateProofs,
  isTokenContentUnlocked,
  WALLET_TOKEN_KIND,
} from "../helpers/tokens.js";

/** removes deleted events from sorted array */
function filterDeleted<T extends NostrEvent>(tokens: T[]): T[] {
  const deleted = new Set<string>();
  return Array.from(tokens)
    .reverse()
    .filter((token) => {
      // skip this event if it a newer event says its deleted
      if (deleted.has(token.id)) return false;

      // add ids to deleted array
      if (isTokenContentUnlocked(token)) {
        const details = getTokenContent(token)!;
        for (const id of details.del) deleted.add(id);
      }

      return true;
    })
    .reverse();
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
