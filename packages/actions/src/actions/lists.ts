import { ListFactory } from "applesauce-common/factories";
import { IEventStoreRead } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, isAddressPointer } from "applesauce-core/helpers/pointers";
import { Action } from "../action-runner.js";

function getList(events: IEventStoreRead, address: NostrEvent | AddressPointer) {
  const list = isAddressPointer(address)
    ? events.getReplaceable(address.kind, address.pubkey, address.identifier)
    : address;
  if (!list) throw new Error("Can't find list");
  return list;
}

/** An action that sets or removes a NIP-51 list information */
export function SetListMetadata(
  list: NostrEvent | AddressPointer,
  info: {
    title?: string;
    description?: string;
    image?: string;
  },
): Action {
  return async ({ events, signer, publish }) => {
    list = getList(events, list);

    const signed = await ListFactory.modify(list)
      .title(info.title ?? null)
      .description(info.description ?? null)
      .image(info.image ?? null)
      .sign(signer);

    await publish(signed);
  };
}
