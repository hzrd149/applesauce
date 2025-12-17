import { EventCast } from "applesauce-common/casts";
import { castUser } from "applesauce-common/casts/user";
import { NostrEvent } from "applesauce-core/helpers/event";
import { of } from "rxjs";
import {
  getNutzapAddressPointer,
  getNutzapAmount,
  getNutzapComment,
  getNutzapEventPointer,
  getNutzapMint,
  getNutzapProofs,
  getNutzapRecipient,
  isValidNutzap,
  NutzapEvent,
} from "../helpers/nutzap.js";

export class Nutzap extends EventCast<NutzapEvent> {
  constructor(event: NostrEvent) {
    if (!isValidNutzap(event)) throw new Error("Invalid nutzap");
    super(event);
  }

  get proofs() {
    return getNutzapProofs(this.event);
  }
  get mint() {
    return getNutzapMint(this.event);
  }
  get amount() {
    return getNutzapAmount(this.event);
  }
  get recipient() {
    return castUser(getNutzapRecipient(this.event), this.store);
  }
  get sender() {
    return this.author;
  }
  get comment() {
    return getNutzapComment(this.event);
  }

  /** The pointer to the event that was zapped */
  get pointer() {
    return getNutzapAddressPointer(this.event) ?? getNutzapEventPointer(this.event);
  }

  /** The event that was zapped */
  get zapped$() {
    return this.$$ref("zapped$", (store) => (this.pointer ? store.event(this.pointer) : of(undefined)));
  }
}
