import { EventCast } from "applesauce-common/casts";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  getNutzapInfoMints,
  getNutzapInfoPubkey,
  getNutzapInfoRelays,
  isValidNutzapInfo,
  NutzapInfoEvent,
} from "../helpers/zap-info.js";

export class NutzapInfo extends EventCast<NutzapInfoEvent> {
  constructor(event: NostrEvent) {
    if (!isValidNutzapInfo(event)) throw new Error("Invalid nutzap info");
    super(event);
  }

  get relays() {
    return getNutzapInfoRelays(this.event);
  }
  get mints() {
    return getNutzapInfoMints(this.event);
  }

  /** The p2pk public key to use when zapping */
  get publicKey() {
    return getNutzapInfoPubkey(this.event);
  }
  get p2pk() {
    return this.publicKey;
  }
}
