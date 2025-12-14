import { Model } from "applesauce-core/event-store";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers/model";

export function SharesModel(event: NostrEvent): Model<NostrEvent[]> {
  return (events) =>
    events.timeline(buildCommonEventRelationFilters({ kinds: [kinds.Repost, kinds.GenericRepost] }, event));
}
