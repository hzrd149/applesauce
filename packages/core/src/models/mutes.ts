import { kinds } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";
import { map } from "rxjs/operators";

import { Model } from "../event-store/interface.js";
import { getHiddenMutedThings, getMutedThings, getPublicMutedThings, Mutes } from "../helpers/mutes.js";
import { watchEventUpdates } from "../observable/watch-event-updates.js";

/** A model that returns all a users muted things */
export function MuteModel(user: string | ProfilePointer): Model<Mutes | undefined> {
  if (typeof user === "string") user = { pubkey: user };

  return (events) =>
    events.replaceable({ kind: kinds.Mutelist, pubkey: user.pubkey, relays: user.relays }).pipe(
      // listen for event updates (hidden tags unlocked)
      watchEventUpdates(events),
      // Get all muted things
      map((event) => event && getMutedThings(event)),
    );
}

/** A model that returns all a users public muted things */
export function PublicMuteModel(pubkey: string): Model<Mutes | undefined> {
  return (events) =>
    events.replaceable(kinds.Mutelist, pubkey).pipe(map((event) => event && getPublicMutedThings(event)));
}

/** A model that returns all a users hidden muted things */
export function HiddenMuteModel(pubkey: string): Model<Mutes | null | undefined> {
  return (events) =>
    events.replaceable(kinds.Mutelist, pubkey).pipe(
      // listen for event updates (hidden tags unlocked)
      watchEventUpdates(events),
      // Get hidden muted things
      map((event) => event && getHiddenMutedThings(event)),
    );
}
