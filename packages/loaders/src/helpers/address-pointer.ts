import { isAddressableKind, isReplaceableKind } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { AddressPointer, AddressPointerWithoutD } from "applesauce-core/helpers/pointers";
import { unique } from "./array.js";

/** Converts an array of address pointers to a filter */
export function createFilterFromAddressPointers(
  pointers: (AddressPointerWithoutD & { since?: number })[] | (AddressPointer & { since?: number })[],
): Filter {
  const filter: Filter = {};

  filter.kinds = unique(pointers.map((p) => p.kind));
  filter.authors = unique(pointers.map((p) => p.pubkey));
  const identifiers = unique(pointers.map((p) => p.identifier).filter((d) => d !== undefined) as string[]);
  if (identifiers.length > 0) filter["#d"] = identifiers;

  // Only apply `since` if every pointer in the group has one; otherwise some pointer
  // wants "any time" and we can't safely restrict. When all have it, take the min.
  if (pointers.every((p) => typeof p.since === "number"))
    filter.since = Math.min(...pointers.map((p) => p.since).filter((s) => s !== undefined));

  return filter;
}

/** Takes a set of address pointers, groups them, then returns filters for the groups */
export function createFiltersFromAddressPointers(pointers: (AddressPointerWithoutD & { since?: number })[]): Filter[] {
  // split the points in to two groups so they they don't mix in the filters
  const replaceable = pointers.filter((p) => isReplaceableKind(p.kind));
  const addressable = pointers.filter((p) => isAddressableKind(p.kind));

  const filters: Filter[] = [];

  const addGroupFilters = (group: (AddressPointerWithoutD & { since?: number })[]) => {
    if (group.length === 0) return;

    // Bucket by `since` first so each outgoing filter carries the exact since
    // value (or none). This keeps the filter count minimal while still querying
    // for exactly what each pointer asked for.
    const bySince = groupAddressPointersBySince(group);

    for (const bucket of bySince.values()) {
      const groups = groupAddressPointersByPubkeyOrKind(bucket);
      filters.push(...Array.from(groups.values()).map(createFilterFromAddressPointers));
    }
  };

  addGroupFilters(replaceable);
  addGroupFilters(addressable);

  return filters;
}

/** Checks if a relay will understand an address pointer */
export function isLoadableAddressPointer<T extends AddressPointerWithoutD>(pointer: T): boolean {
  if (isAddressableKind(pointer.kind)) return pointer.identifier !== undefined;
  else return isReplaceableKind(pointer.kind);
}

/** Group an array of address pointers by kind */
export function groupAddressPointersByKind<T extends AddressPointerWithoutD>(pointers: T[]): Map<number, T[]> {
  const byKind = new Map<number, T[]>();

  for (const pointer of pointers) {
    if (byKind.has(pointer.kind)) byKind.get(pointer.kind)!.push(pointer);
    else byKind.set(pointer.kind, [pointer]);
  }

  return byKind;
}

/** Group an array of address pointers by pubkey */
export function groupAddressPointersByPubkey<T extends AddressPointerWithoutD>(pointers: T[]): Map<string, T[]> {
  const byPubkey = new Map<string, T[]>();

  for (const pointer of pointers) {
    if (byPubkey.has(pointer.pubkey)) byPubkey.get(pointer.pubkey)!.push(pointer);
    else byPubkey.set(pointer.pubkey, [pointer]);
  }

  return byPubkey;
}

/** Groups address pointers by kind or pubkey depending on which is most optimal */
export function groupAddressPointersByPubkeyOrKind<T extends AddressPointerWithoutD>(pointers: T[]) {
  const kinds = new Set(pointers.map((p) => p.kind));
  const pubkeys = new Set(pointers.map((p) => p.pubkey));

  return pubkeys.size < kinds.size ? groupAddressPointersByPubkey(pointers) : groupAddressPointersByKind(pointers);
}

/**
 * Group an array of address pointers by their `since` value.
 * Pointers without `since` are bucketed under the key `undefined`.
 */
export function groupAddressPointersBySince<T extends AddressPointerWithoutD & { since?: number }>(
  pointers: T[],
): Map<number | undefined, T[]> {
  const bySince = new Map<number | undefined, T[]>();

  for (const pointer of pointers) {
    const key = pointer.since;
    if (bySince.has(key)) bySince.get(key)!.push(pointer);
    else bySince.set(key, [pointer]);
  }

  return bySince;
}
