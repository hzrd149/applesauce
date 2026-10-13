import { NostrEvent } from "applesauce-core/helpers/event";
import {
  ExternalIdentitiesEvent,
  getExternalIdentities,
  isValidExternalIdentities,
} from "../helpers/external-identities.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast for NIP-39 external identity lists */
export class ExternalIdentities extends EventCast<ExternalIdentitiesEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidExternalIdentities(event)) throw new Error("Invalid external identities event");
    super(event, store);
  }

  /** The external identities claimed by the user */
  get identities() {
    return getExternalIdentities(this.event);
  }
}
