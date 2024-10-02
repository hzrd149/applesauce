import { kinds } from "nostr-tools";
import { Query } from "applesauce-core";
import { EventPointer } from "nostr-tools/nip19";

import { getPinnedNotes } from "../helpers/pin.js";

export function UserPinnedNotesQuery(pubkey: string): Query<EventPointer[] | undefined> {
  return {
    key: pubkey,
    run: (store) => store.replaceable(kinds.Pinlist, pubkey).map((event) => event && getPinnedNotes(event)),
  };
}