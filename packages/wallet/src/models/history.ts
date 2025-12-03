import { combineLatest, filter, map, scan, startWith } from "rxjs";
import { Model } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";

import { getHistoryRedeemed, isHistoryContentUnlocked, WALLET_HISTORY_KIND } from "../helpers/history.js";

/** A model that returns an array of redeemed event ids for a wallet */
export function WalletRedeemedModel(pubkey: string): Model<string[]> {
  return (events) =>
    events
      .filters({ kinds: [WALLET_HISTORY_KIND], authors: [pubkey] })
      .pipe(scan((ids, history) => [...ids, ...getHistoryRedeemed(history)], [] as string[]));
}

/** A model that returns a timeline of wallet history events */
export function WalletHistoryModel(pubkey: string, locked?: boolean | undefined): Model<NostrEvent[]> {
  return (events) => {
    const updates = events.update$.pipe(
      filter((e) => e.kind === WALLET_HISTORY_KIND && e.pubkey === pubkey),
      startWith(undefined),
    );
    const timeline = events.timeline({ kinds: [WALLET_HISTORY_KIND], authors: [pubkey] });

    return combineLatest([updates, timeline]).pipe(
      map(([_, history]) => {
        if (locked === undefined) return history;
        else return history.filter((entry) => isHistoryContentUnlocked(entry) === locked);
      }),
    );
  };
}
