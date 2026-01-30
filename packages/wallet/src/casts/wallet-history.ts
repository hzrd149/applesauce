import { CastRefEventStore, EventCast } from "applesauce-common/casts";
import { HiddenContentSigner } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { watchEventUpdates } from "applesauce-core/observable";
import { of } from "rxjs";
import { map } from "rxjs/operators";
import {
  getHistoryContent,
  getHistoryRedeemed,
  isHistoryContentUnlocked,
  isValidWalletHistory,
  unlockHistoryContent,
  WalletHistoryEvent,
} from "../helpers/history.js";

/** A cast for a NIP-60 wallet history event */
export class WalletHistory extends EventCast<WalletHistoryEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidWalletHistory(event)) throw new Error("Invalid wallet history");
    super(event, store);
  }

  /** The embedded history metadata */
  get meta() {
    return getHistoryContent(this.event);
  }

  // Direct getters (return undefined if locked)
  get direction() {
    return this.meta?.direction;
  }
  get amount() {
    return this.meta?.amount;
  }
  get redeemed() {
    return getHistoryRedeemed(this.event);
  }

  // Unlocking pattern
  get unlocked() {
    return isHistoryContentUnlocked(this.event);
  }
  async unlock(signer: HiddenContentSigner) {
    return unlockHistoryContent(this.event, signer);
  }

  // Observable that emits when history is unlocked
  get meta$() {
    return this.$$ref("meta$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getHistoryContent(event)),
      ),
    );
  }
  get amount$() {
    return this.$$ref("amount$", () => this.meta$.pipe(map((meta) => meta?.amount)));
  }
}
