import { CastRefEventStore, EventCast } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { HiddenContentSigner } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { watchEventUpdates } from "applesauce-core/observable";
import { of } from "rxjs";
import { map } from "rxjs/operators";
import {
  getWalletMints,
  getWalletPrivateKey,
  getWalletRelays,
  isValidWallet,
  isWalletUnlocked,
  unlockWallet,
  WALLET_BACKUP_KIND,
  WalletEvent,
} from "../helpers/wallet.js";
import { WalletHistoryModel } from "../models/history.js";
import { WalletBalanceModel, WalletTokensModel } from "../models/tokens.js";
import { WalletHistory } from "./wallet-history.js";
import { WalletToken } from "./wallet-token.js";
import { ReceivedNutzapsModel } from "../models/nutzap.js";

/** A cast for a NIP-60 wallet event */
export class Wallet extends EventCast<WalletEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidWallet(event)) throw new Error("Invalid wallet event");
    super(event, store);
  }

  // Direct getters (return undefined if locked)
  get mints() {
    return getWalletMints(this.event);
  }
  get relays() {
    return getWalletRelays(this.event);
  }
  get privateKey() {
    return getWalletPrivateKey(this.event);
  }

  // Unlocking pattern
  get unlocked() {
    return isWalletUnlocked(this.event);
  }
  async unlock(signer: HiddenContentSigner) {
    return unlockWallet(this.event, signer);
  }

  // Observable that emits when wallet is unlocked
  get mints$() {
    return this.$$ref("mints$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getWalletMints(event)),
      ),
    );
  }
  get relays$() {
    return this.$$ref("relays$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getWalletRelays(event)),
      ),
    );
  }
  get balance$() {
    return this.$$ref("balance$", (store) => store.model(WalletBalanceModel, this.event.pubkey));
  }
  /** The p2pk locking private key for this wallet */
  get privateKey$() {
    return this.$$ref("privateKey$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getWalletPrivateKey(event)),
      ),
    );
  }

  // Observables for related events
  get tokens$() {
    return this.$$ref("tokens$", (store) =>
      store.model(WalletTokensModel, this.event.pubkey).pipe(castTimelineStream(WalletToken, store)),
    );
  }
  get history$() {
    return this.$$ref("history$", (store) =>
      store.model(WalletHistoryModel, this.event.pubkey).pipe(castTimelineStream(WalletHistory, store)),
    );
  }
  get backups$() {
    return this.$$ref("backups$", (store) =>
      store.timeline({
        kinds: [WALLET_BACKUP_KIND],
        authors: [this.event.pubkey],
      }),
    );
  }
  get received$() {
    return this.$$ref("received$", (store) => store.model(ReceivedNutzapsModel, this.event.pubkey));
  }
}
