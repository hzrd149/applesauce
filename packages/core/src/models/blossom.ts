import { map } from "rxjs/operators";
import { ProfilePointer } from "nostr-tools/nip19";

import { Model } from "../event-store/interface.js";
import { BLOSSOM_SERVER_LIST_KIND, getBlossomServersFromList } from "../helpers/blossom.js";

/** A model that returns a users blossom servers */
export function UserBlossomServersModel(user: string | ProfilePointer): Model<URL[]> {
  if (typeof user === "string") user = { pubkey: user };

  return (store) =>
    store
      .replaceable({ kind: BLOSSOM_SERVER_LIST_KIND, pubkey: user.pubkey, relays: user.relays })
      .pipe(map((event) => (event ? getBlossomServersFromList(event) : [])));
}
