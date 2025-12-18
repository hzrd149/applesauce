import { Model } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { identity, map, scan } from "rxjs";

import { getHistoryRedeemed, isHistoryContentUnlocked, WALLET_HISTORY_KIND } from "../helpers/history.js";

/** A model that returns an array of redeemed event ids for a wallet */
export function WalletRedeemedModel(pubkey: string): Model<string[]> {
  return (events) =>
    events
      .filters({ kinds: [WALLET_HISTORY_KIND], authors: [pubkey] })
      .pipe(scan((ids, history) => [...ids, ...getHistoryRedeemed(history)], [] as string[]));
}

/** A model that returns a timeline of wallet history events */
export function WalletHistoryModel(pubkey: string, unlocked?: boolean | undefined): Model<NostrEvent[]> {
  return (events) => {
    return events
      .timeline({ kinds: [WALLET_HISTORY_KIND], authors: [pubkey] })
      .pipe(
        unlocked !== undefined
          ? map((events) => events.filter((e) => isHistoryContentUnlocked(e) === unlocked))
          : identity,
      );
  };
}
