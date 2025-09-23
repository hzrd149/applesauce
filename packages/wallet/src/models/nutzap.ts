import { Model } from "applesauce-core";
import { getReplaceableAddress, isReplaceable, KnownEvent } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";
import { map } from "rxjs";

import { getNutzapPointer, isValidNutzap, NUTZAP_KIND } from "../helpers/nutzap.js";

/** A model that returns all nutzap events for an event */
export function EventNutZapzModel(event: NostrEvent): Model<KnownEvent<typeof NUTZAP_KIND>[]> {
  return (events) =>
    (isReplaceable(event.kind)
      ? events.timeline({ kinds: [NUTZAP_KIND], "#e": [event.id] })
      : events.timeline({ kinds: [NUTZAP_KIND], "#a": [getReplaceableAddress(event)] })
    ).pipe(
      map((events) =>
        // Validate nutzap events
        events.filter(isValidNutzap),
      ),
    );
}

/** A model that returns all nutzaps for a users profile */
export function ProfileNutZapzModel(pubkey: string): Model<KnownEvent<typeof NUTZAP_KIND>[]> {
  return (events) =>
    events.timeline({ kinds: [NUTZAP_KIND], "#p": [pubkey] }).pipe(
      // Validate nutzap events
      map((zaps) => zaps.filter(isValidNutzap)),
      // filter out nutzaps that are for events
      map((zaps) => zaps.filter((zap) => getNutzapPointer(zap) === undefined)),
    );
}
