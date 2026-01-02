import { NostrEvent } from "applesauce-core/helpers";
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
  isValidZap,
  ZapEvent,
} from "../helpers/zap.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { castUser } from "./user.js";

/** Cast a kind 9735 event to a Zap */
export class Zap extends EventCast<ZapEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidZap(event)) throw new Error("Invalid zap");
    super(event, store);
  }
  get sender() {
    return castUser(getZapSender(this.event), this.store);
  }
  get recipient() {
    return castUser(getZapRecipient(this.event), this.store);
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

  /** An observable of the zapped event */
  get event$() {
    return this.$$ref("event$", (store) => {
      if (this.addressPointer) return store.replaceable(this.addressPointer);
      if (this.eventPointer) return store.event(this.eventPointer.id);
      return of(undefined);
    });
  }
}
