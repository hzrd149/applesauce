import { isAddressableKind, isReplaceableKind } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { AddressPointer, AddressPointerWithoutD } from "applesauce-core/helpers/pointers";
import { unique } from "./array.js";

/** Converts an array of address pointers to a filter */
export function createFilterFromAddressPointers(pointers: AddressPointerWithoutD[] | AddressPointer[]): Filter {
  const filter: Filter = {};

  filter.kinds = unique(pointers.map((p) => p.kind));
  filter.authors = unique(pointers.map((p) => p.pubkey));
  const identifiers = unique(pointers.map((p) => p.identifier).filter((d) => d !== undefined) as string[]);
  if (identifiers.length > 0) filter["#d"] = identifiers;

  return filter;
}

/** Takes a set of address pointers, groups them, then returns filters for the groups */
export function createFiltersFromAddressPointers(pointers: AddressPointerWithoutD[]): Filter[] {
  // split the points in to two groups so they they don't mix in the filters
  const replaceable = pointers.filter((p) => isReplaceableKind(p.kind));
  const addressable = pointers.filter((p) => isAddressableKind(p.kind));

  const filters: Filter[] = [];

  if (replaceable.length > 0) {
    const groups = groupAddressPointersByPubkeyOrKind(replaceable);
    filters.push(...Array.from(groups.values()).map(createFilterFromAddressPointers));
  }

  if (addressable.length > 0) {
    const groups = groupAddressPointersByPubkeyOrKind(addressable);
    filters.push(...Array.from(groups.values()).map(createFilterFromAddressPointers));
  }

  return filters;
}

/** Checks if a relay will understand an address pointer */
export function isLoadableAddressPointer<T extends AddressPointerWithoutD>(pointer: T): boolean {
  if (isAddressableKind(pointer.kind)) return pointer.identifier !== undefined;
  else return isReplaceableKind(pointer.kind);
}

/** Group an array of address pointers by kind */
export function groupAddressPointersByKind(pointers: AddressPointerWithoutD[]): Map<number, AddressPointerWithoutD[]> {
  const byKind = new Map<number, AddressPointerWithoutD[]>();

  for (const pointer of pointers) {
    if (byKind.has(pointer.kind)) byKind.get(pointer.kind)!.push(pointer);
    else byKind.set(pointer.kind, [pointer]);
  }

  return byKind;
}

/** Group an array of address pointers by pubkey */
export function groupAddressPointersByPubkey(
  pointers: AddressPointerWithoutD[],
): Map<string, AddressPointerWithoutD[]> {
  const byPubkey = new Map<string, AddressPointerWithoutD[]>();

  for (const pointer of pointers) {
    if (byPubkey.has(pointer.pubkey)) byPubkey.get(pointer.pubkey)!.push(pointer);
    else byPubkey.set(pointer.pubkey, [pointer]);
  }

  return byPubkey;
}

/** Groups address pointers by kind or pubkey depending on which is most optimal */
export function groupAddressPointersByPubkeyOrKind(pointers: AddressPointerWithoutD[]) {
  const kinds = new Set(pointers.map((p) => p.kind));
  const pubkeys = new Set(pointers.map((p) => p.pubkey));

  return pubkeys.size < kinds.size ? groupAddressPointersByPubkey(pointers) : groupAddressPointersByKind(pointers);
}
