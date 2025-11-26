import { Model } from "applesauce-core/event-store";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { type Observable } from "rxjs";
import { map } from "rxjs/operators";

import { BLOSSOM_SERVER_LIST_KIND, getBlossomServersFromList } from "../helpers/blossom.js";

// Import EventModels as a value (class) to modify its prototype
import { EventModels } from "applesauce-core/event-store";

/** A model that returns a users blossom servers */
export function UserBlossomServersModel(user: string | ProfilePointer): Model<URL[]> {
  if (typeof user === "string") user = { pubkey: user };

  return (store) =>
    store
      .replaceable({ kind: BLOSSOM_SERVER_LIST_KIND, pubkey: user.pubkey, relays: user.relays })
      .pipe(map((event) => (event ? getBlossomServersFromList(event) : [])));
}

// Register this model with EventModels
EventModels.prototype.blossomServers = function (user: string | ProfilePointer) {
  if (typeof user === "string") user = { pubkey: user };
  return this.model(UserBlossomServersModel, user);
};

// Type augmentation for EventModels
declare module "applesauce-core/event-store" {
  interface EventModels {
    /** Subscribe to a users blossom servers */
    blossomServers(user: string | ProfilePointer): Observable<URL[]>;
  }
}
