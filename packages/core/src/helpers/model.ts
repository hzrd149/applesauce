import { getReplaceableAddress, isEvent, NostrEvent } from "./event.js";
import { Filter } from "./filter.js";
import {
  AddressPointer,
  EventPointer,
  getReplaceableAddressFromPointer,
  isAddressPointer,
  isEventPointer,
} from "./pointers.js";

/** Build an array of filters that match other events "e" or "a" tagging this event */
export function buildCommonEventRelationFilters(
  base: Filter,
  pointer: string | EventPointer | AddressPointer | NostrEvent,
): Filter[] {
  const filters: Filter[] = [];
  const id = typeof pointer === "string" ? pointer : isEventPointer(pointer) ? pointer.id : undefined;
  if (id) filters.push({ ...base, "#e": [id] });
  const address = isAddressPointer(pointer)
    ? getReplaceableAddressFromPointer(pointer)
    : isEvent(pointer)
      ? getReplaceableAddress(pointer)
      : undefined;
  if (address) filters.push({ ...base, "#a": [address] });

  return filters;
}
