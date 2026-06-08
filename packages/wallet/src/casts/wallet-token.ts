import { sumProofs } from "@cashu/cashu-ts";
import { CastRefEventStore, EventCast } from "applesauce-common/casts";
import { HiddenContentSigner } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { defined, watchEventUpdates } from "applesauce-core/observable";
import { of } from "rxjs";
import { map } from "rxjs/operators";
import {
  getTokenContent,
  getTokenDeletedIds,
  isTokenContentUnlocked,
  isValidWalletToken,
  unlockTokenContent,
  WalletTokenEvent,
} from "../helpers/tokens.js";

/** A cast for a NIP-60 wallet token event */
export class WalletToken extends EventCast<WalletTokenEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidWalletToken(event)) throw new Error("Invalid wallet token");
    super(event, store);
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
    return this.proofs && sumProofs(this.proofs).toNumber();
  }
  /** The token event ids this token marked as deleted, merging the public `del` tags with the encrypted content */
  get deleted() {
    return Array.from(new Set([...getTokenDeletedIds(this.event), ...(this.meta?.del ?? [])]));
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
    return this.$$ref("amount$", () => this.proofs$.pipe(map((proofs) => sumProofs(proofs).toNumber())));
  }
  get deleted$() {
    return this.$$ref("deleted$", () =>
      of(this.event).pipe(
        watchEventUpdates(this.store),
        map((event) => {
          const content = event && isTokenContentUnlocked(event) ? getTokenContent(event).del : [];
          return Array.from(new Set([...getTokenDeletedIds(this.event), ...content]));
        }),
      ),
    );
  }
}
