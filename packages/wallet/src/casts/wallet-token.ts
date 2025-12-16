import { sumProofs } from "@cashu/cashu-ts";
import { EventCast } from "applesauce-common/casts";
import { HiddenContentSigner } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { defined, watchEventUpdates } from "applesauce-core/observable";
import { of } from "rxjs";
import { map } from "rxjs/operators";
import {
  getTokenContent,
  isTokenContentUnlocked,
  isValidWalletToken,
  unlockTokenContent,
  WalletTokenEvent,
} from "../helpers/tokens.js";

export class WalletToken extends EventCast<WalletTokenEvent> {
  constructor(event: NostrEvent) {
    if (!isValidWalletToken(event)) throw new Error("Invalid wallet token");
    super(event);
  }

  get meta() {
    return getTokenContent(this.event);
  }

  // Direct getters (return undefined if locked)
  get proofs() {
    return this.meta?.proofs;
  }
  get mint() {
    return this.meta?.mint;
  }
  get amount() {
    return this.proofs && sumProofs(this.proofs);
  }
  get deleted() {
    return this.meta?.del;
  }

  // Unlocking pattern
  get unlocked() {
    return isTokenContentUnlocked(this.event);
  }
  async unlock(signer: HiddenContentSigner) {
    return unlockTokenContent(this.event, signer);
  }

  // Observable that emits when token is unlocked
  get meta$() {
    return this.$$ref("meta$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getTokenContent(event)),
        defined(),
      ),
    );
  }

  get mint$() {
    return this.$$ref("mint$", () => this.meta$.pipe(map((meta) => meta?.mint)));
  }
  get proofs$() {
    return this.$$ref("proofs$", () => this.meta$.pipe(map((meta) => meta?.proofs)));
  }
  get amount$() {
    return this.$$ref("amount$", () => this.proofs$.pipe(map(sumProofs)));
  }
  get deleted$() {
    return this.$$ref("deleted$", () => this.meta$.pipe(map((meta) => meta?.del)));
  }
}
