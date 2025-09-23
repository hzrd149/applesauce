import { combineLatest, filter, map, startWith } from "rxjs";
import { Model } from "applesauce-core";
import { NostrEvent } from "nostr-tools";

import {
  getTokenContent,
  ignoreDuplicateProofs,
  isTokenContentUnlocked,
  WALLET_TOKEN_KIND,
} from "../helpers/tokens.js";

/** removes deleted events from sorted array */
function filterDeleted(tokens: NostrEvent[]) {
  const deleted = new Set<string>();
  return Array.from(tokens)
    .reverse()
    .filter((token) => {
      // skip this event if it a newer event says its deleted
      if (deleted.has(token.id)) return false;

      // add ids to deleted array
      if (!isTokenContentUnlocked(token)) {
        const details = getTokenContent(token)!;
        for (const id of details.del) deleted.add(id);
      }

      return true;
    })
    .reverse();
}

/** A model that subscribes to all token events for a wallet, passing locked will filter by token locked status */
export function WalletTokensModel(pubkey: string, locked?: boolean | undefined): Model<NostrEvent[]> {
  return (events) => {
    const updates = events.update$.pipe(
      filter((e) => e.kind === WALLET_TOKEN_KIND && e.pubkey === pubkey),
      startWith(undefined),
    );
    const timeline = events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] });

    return combineLatest([updates, timeline]).pipe(
      // filter out locked tokens
      map(([_, tokens]) => {
        if (locked === undefined) return tokens;
        else return tokens.filter((t) => isTokenContentUnlocked(t) === locked);
      }),
      // remove deleted events
      map(filterDeleted),
    );
  };
}

/** A model that returns the visible balance of a wallet for each mint */
export function WalletBalanceModel(pubkey: string): Model<Record<string, number>> {
  return (events) => {
    const updates = events.update$.pipe(
      filter((e) => e.kind === WALLET_TOKEN_KIND && e.pubkey === pubkey),
      startWith(undefined),
    );
    const timeline = events.timeline({ kinds: [WALLET_TOKEN_KIND], authors: [pubkey] });

    return combineLatest([updates, timeline]).pipe(
      map(([_, tokens]) => tokens.filter((t) => !isTokenContentUnlocked(t))),
      // filter out deleted tokens
      map(filterDeleted),
      // map tokens to totals
      map((tokens) => {
        // ignore duplicate proofs
        const seen = new Set<string>();

        return tokens.reduce(
          (totals, token) => {
            const details = getTokenContent(token)!;
            const total = details.proofs.filter(ignoreDuplicateProofs(seen)).reduce((t, p) => t + p.amount, 0);
            return { ...totals, [details.mint]: (totals[details.mint] ?? 0) + total };
          },
          {} as Record<string, number>,
        );
      }),
    );
  };
}
