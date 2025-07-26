import { Model } from "applesauce-core";
import { getReplaceableAddress, isReplaceable } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";
import { map } from "rxjs";

import { getNutzapPointer, NUTZAP_KIND } from "../helpers/nutzap.js";

/** A model that returns all nutzap events for an event */
export function EventNutZapzModel(event: NostrEvent): Model<NostrEvent[]> {
  return (events) =>
    isReplaceable(event.kind)
      ? events.timeline({ kinds: [NUTZAP_KIND], "#e": [event.id] })
      : events.timeline({ kinds: [NUTZAP_KIND], "#a": [getReplaceableAddress(event)] });
}

/** A model that returns all nutzaps for a users profile */
export function ProfileNutZapzModel(pubkey: string): Model<NostrEvent[]> {
  return (events) =>
    events
      .timeline({ kinds: [NUTZAP_KIND], "#p": [pubkey] })
      // filter out nutzaps that are for events
      .pipe(map((zaps) => zaps.filter((zap) => getNutzapPointer(zap) === undefined)));
}
