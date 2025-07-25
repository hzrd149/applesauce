import { IEventStoreRead } from "applesauce-core/event-store";
import { isAddressPointer } from "applesauce-core/helpers";
import { List } from "applesauce-factory/operations";
import { NostrEvent } from "nostr-tools";
import { AddressPointer } from "nostr-tools/nip19";

import { Action } from "../action-hub.js";

function getList(events: IEventStoreRead, address: NostrEvent | AddressPointer) {
  const list = isAddressPointer(address)
    ? events.getReplaceable(address.kind, address.pubkey, address.identifier)
    : address;
  if (!list) throw new Error("Can't find list");
  return list;
}

/** An action that sets or removes a NIP-15 list information */
export function SetListMetadata(
  list: NostrEvent | AddressPointer,
  info: {
    title?: string;
    description?: string;
    image?: string;
  },
): Action {
  return async function* ({ events, factory }) {
    list = getList(events, list);

    const draft = await factory.modify(
      list,
      List.setTitle(info.title ?? null),
      List.setDescription(info.description ?? null),
      List.setImage(info.image ?? null),
    );

    yield await factory.sign(draft);
  };
}
