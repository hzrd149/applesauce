import { NostrEvent } from "applesauce-core/helpers/event";
import {
  getEmbededSharedEvent,
  getSharedAddressPointer,
  getSharedEventPointer,
  isValidShare,
  ShareEvent,
} from "../helpers/share.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast class for kind 6 and 16 share events */
export class Share extends EventCast<ShareEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidShare(event)) throw new Error("Invalid share");
    super(event, store);
  }

  get sharedKind() {
    return getSharedEventPointer(this.event)?.kind;
  }
  get embedded() {
    return getEmbededSharedEvent(this.event);
  }

  get sharedAddressPointer() {
    return getSharedAddressPointer(this.event);
  }
  get sharedEventPointer() {
    return getSharedEventPointer(this.event);
  }
  get sharedPointer() {
    return this.sharedAddressPointer || this.sharedEventPointer;
  }

  get shared$() {
    return this.$$ref("shared$", (store) => store.event(this.sharedPointer));
  }
}
