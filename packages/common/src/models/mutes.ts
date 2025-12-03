import { Model } from "applesauce-core/event-store";
import { kinds } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { watchEventUpdates } from "applesauce-core/observable";
import { type Observable } from "rxjs";
import { map } from "rxjs/operators";

import { getHiddenMutedThings, getMutedThings, getPublicMutedThings, Mutes } from "../helpers/mute.js";

// Import EventModels as a value (class) to modify its prototype
import { EventModels } from "applesauce-core/event-store";

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

// Register this model with EventModels
EventModels.prototype.mutes = function (user: string | ProfilePointer) {
  if (typeof user === "string") user = { pubkey: user };
  return this.model(MuteModel, user);
};

// Type augmentation for EventModels
declare module "applesauce-core/event-store" {
  interface EventModels {
    /** Subscribe to a users mutes */
    mutes(user: string | ProfilePointer): Observable<Mutes | undefined>;
  }
}
