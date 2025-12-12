import { kinds, NostrEvent } from "applesauce-core/helpers";
import { of } from "rxjs";
import {
  getZapAddressPointer,
  getZapAmount,
  getZapEventPointer,
  getZapPayment,
  getZapPreimage,
  getZapRecipient,
  getZapRequest,
  getZapSender,
  getZapSplits,
  isValidZap,
} from "../helpers/zap.js";
import { castEvent } from "../observable/cast-event.js";
import { BaseCast, ref } from "./common.js";
import { Profile } from "./profile.js";

// NOTE: extending BaseCast since there is no need for author$ or comments$

/** Cast a kind 9735 event to a Zap */
export class Zap extends BaseCast<kinds.Zap> {
  constructor(event: NostrEvent) {
    if (!isValidZap(event)) throw new Error("Invalid zap");
    super(event);
  }
  get sender() {
    return getZapSender(this.event);
  }
  get recipient() {
    return getZapRecipient(this.event);
  }
  get payment() {
    return getZapPayment(this.event);
  }
  get amount() {
    return getZapAmount(this.event);
  }
  get preimage() {
    return getZapPreimage(this.event);
  }
  get request() {
    return getZapRequest(this.event);
  }
  get addressPointer() {
    return getZapAddressPointer(this.event);
  }
  get eventPointer() {
    return getZapEventPointer(this.event);
  }
  get splits() {
    return getZapSplits(this.event);
  }

  /** An observable of the zap sender */
  get sender$() {
    return ref(this, "sender$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.sender }).pipe(castEvent(Profile)),
    );
  }
  get recipient$() {
    return ref(this, "recipient$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.recipient }).pipe(castEvent(Profile)),
    );
  }

  /** An observable of the zapped event */
  get event$() {
    return ref(this, "event$", (store) => {
      if (this.addressPointer) return store.replaceable(this.addressPointer);
      if (this.eventPointer) return store.event(this.eventPointer.id);
      return of(undefined);
    });
  }
}
