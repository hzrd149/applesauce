import { Model } from "applesauce-core/event-store";
import { AddressPointer, NostrEvent } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers/model";

/** A model that returns all chat messages for a stream */
export function StreamChatMessagesModel(stream: AddressPointer | NostrEvent): Model<NostrEvent[]> {
  return (events) => events.timeline(buildCommonEventRelationFilters({ kinds: [kinds.LiveChatMessage] }, stream));
}
