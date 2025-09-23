import { Model } from "applesauce-core";
import { filter, map, merge } from "rxjs";
import { getWalletMints, getWalletPrivateKey, isWalletUnlocked, WALLET_KIND } from "../helpers/wallet.js";
import { NostrEvent } from "nostr-tools";

export type WalletInfo =
  | { locked: true; event: NostrEvent }
  | {
      locked: false;
      event: NostrEvent;
      privateKey?: Uint8Array;
      mints: string[];
    };

/** A model to get the state of a NIP-60 wallet */
export function WalletModel(pubkey: string): Model<WalletInfo | undefined> {
  return (events) =>
    merge(
      // get the latest replaceable event
      events.replaceable(WALLET_KIND, pubkey),
      // and listen for any updates to matching events
      events.update$.pipe(filter((e) => e.kind === WALLET_KIND && e.pubkey === pubkey)),
    ).pipe(
      map((wallet) => {
        if (!wallet) return;

        if (isWalletUnlocked(wallet)) return { locked: true, event: wallet };

        const mints = getWalletMints(wallet);
        const privateKey = getWalletPrivateKey(wallet);

        return { locked: false, mints, privateKey, event: wallet };
      }),
    );
}
