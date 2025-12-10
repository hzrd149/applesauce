import { NostrEvent } from "applesauce-core/helpers";
import { Observable, of } from "rxjs";
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
import { getStore } from "./common.js";
import { castProfile, createCast, InferCast, Profile } from "./index.js";

/** Cast a kind 9735 event to a Zap */
export const castZap = createCast(isValidZap, {
  get sender() {
    return getZapSender(this);
  },
  get recipient() {
    return getZapRecipient(this);
  },
  get payment() {
    return getZapPayment(this);
  },
  get amount() {
    return getZapAmount(this);
  },
  get preimage() {
    return getZapPreimage(this);
  },
  get request() {
    return getZapRequest(this);
  },
  get addressPointer() {
    return getZapAddressPointer(this);
  },
  get eventPointer() {
    return getZapEventPointer(this);
  },
  get splits() {
    return getZapSplits(this);
  },

  /** An observable of the zap sender */
  get sender$(): Observable<Profile | undefined> {
    return getStore(this).replaceable({ kind: 0, pubkey: this.sender }).pipe(castEvent(castProfile));
  },

  get recipient$(): Observable<Profile | undefined> {
    return getStore(this).replaceable({ kind: 0, pubkey: this.recipient }).pipe(castEvent(castProfile));
  },

  /** An observable of the zapped event */
  get event$(): Observable<NostrEvent | undefined> {
    const store = getStore(this);
    if (this.addressPointer) return store.replaceable(this.addressPointer);
    if (this.eventPointer) return store.event(this.eventPointer.id);
    return of(undefined);
  },
});

export type Zap = InferCast<typeof castZap>;
