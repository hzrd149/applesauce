import { AddressPointerWithoutD, getReplaceableUID } from "applesauce-core/helpers";
import { Filter } from "nostr-tools";
import { isParameterizedReplaceableKind, isReplaceableKind } from "nostr-tools/kinds";

import { unique } from "./array.js";
import { AddressPointer } from "nostr-tools/nip19";

/** Converts an array of address pointers to a filter */
export function createFilterFromAddressPointers(pointers: AddressPointerWithoutD[] | AddressPointer[]): Filter {
  const filter: Filter = {};

  filter.kinds = unique(pointers.map((p) => p.kind));
  filter.authors = unique(pointers.map((p) => p.pubkey));
  const identifiers = unique(pointers.map((p) => p.identifier).filter((d) => !!d) as string[]);
  if (identifiers.length > 0) filter["#d"] = identifiers;

  return filter;
}

/** Takes a set of address pointers, groups them, then returns filters for the groups */
export function createFiltersFromAddressPointers(pointers: AddressPointerWithoutD[]): Filter[] {
  // split the points in to two groups so they they don't mix in the filters
  const parameterizedReplaceable = pointers.filter((p) => isParameterizedReplaceableKind(p.kind));
  const replaceable = pointers.filter((p) => isReplaceableKind(p.kind));

  const filters: Filter[] = [];

  if (replaceable.length > 0) {
    const groups = groupAddressPointersByPubkeyOrKind(replaceable);
    filters.push(...Array.from(groups.values()).map(createFilterFromAddressPointers));
  }

  if (parameterizedReplaceable.length > 0) {
    const groups = groupAddressPointersByPubkeyOrKind(parameterizedReplaceable);
    filters.push(...Array.from(groups.values()).map(createFilterFromAddressPointers));
  }

  return filters;
}

/** Checks if a relay will understand an address pointer */
export function isLoadableAddressPointer<T extends AddressPointerWithoutD>(pointer: T): boolean {
  if (isParameterizedReplaceableKind(pointer.kind)) return !!pointer.identifier;
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

export function getRelaysFromPointers(pointers: AddressPointerWithoutD[]) {
  const relays = new Set<string>();

  for (const pointer of pointers) {
    if (!pointer.relays) continue;
    for (const relay of pointer.relays) {
      relays.add(relay);
    }
  }

  return relays;
}

export function getAddressPointerId<T extends AddressPointerWithoutD>(pointer: T): string {
  return getReplaceableUID(pointer.kind, pointer.pubkey, pointer.identifier);
}

/** deduplicates an array of address pointers and merges their relays array */
export function consolidateAddressPointers<
  T extends { kind: number; pubkey: string; identifier?: string; relays?: string[]; force?: boolean },
>(pointers: T[]): T[] {
  const byCoordinate = new Map<string, T>();

  for (const pointer of pointers) {
    let cord = getAddressPointerId(pointer);
    let existing = byCoordinate.get(cord);

    if (existing) {
      // override force flag
      if (pointer.force) existing.force = pointer.force;

      // merge relays
      if (pointer.relays) {
        if (!existing.relays) existing.relays = [...pointer.relays];
        else existing.relays = [...existing.relays, ...pointer.relays.filter((r) => !existing.relays!.includes(r))];
      }
    } else {
      byCoordinate.set(cord, pointer);
    }
  }

  return Array.from(byCoordinate.values());
}
