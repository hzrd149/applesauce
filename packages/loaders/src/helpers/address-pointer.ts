import { isAddressableKind, isReplaceableKind } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { AddressPointer, AddressPointerWithoutD } from "applesauce-core/helpers/pointers";
import { unique } from "./array.js";

/**
 * Converts an array of address pointers to a filter
 * @note the filter matches every author and identifier combination, use {@link createFiltersFromAddressPointers} for exact matches
 */
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

  const addGroupFilters = (group: AddressPointerWithoutD[]) => {
    if (group.length === 0) return;

    const groups = groupAddressPointersByPubkeyOrKind(group);
    filters.push(...Array.from(groups.values()).map(createFilterFromAddressPointers));
  };

  addGroupFilters(replaceable);
  for (const group of groupAddressPointersByKind(addressable).values())
    filters.push(...createExactAddressableFilters(group));

  return filters;
}

/** Groups keys by the set of values they map to, returning [keys, values] pairs */
function groupBySharedValues(map: Map<string, Set<string>>): [string[], string[]][] {
  const groups = new Map<string, [string[], string[]]>();
  for (const [key, values] of map) {
    const sorted = Array.from(values).sort();
    const id = sorted.join(",");
    const group = groups.get(id);
    if (group) group[0].push(key);
    else groups.set(id, [[key], sorted]);
  }
  return Array.from(groups.values());
}

/** Creates filters for addressable pointers of one kind that only match the requested author and identifier pairs */
function createExactAddressableFilters(pointers: AddressPointerWithoutD[]): Filter[] {
  const kind = pointers[0].kind;
  const byAuthor = new Map<string, Set<string>>();
  const byIdentifier = new Map<string, Set<string>>();

  for (const { pubkey, identifier } of pointers) {
    if (identifier === undefined) continue;
    if (!byAuthor.has(pubkey)) byAuthor.set(pubkey, new Set());
    byAuthor.get(pubkey)!.add(identifier);
    if (!byIdentifier.has(identifier)) byIdentifier.set(identifier, new Set());
    byIdentifier.get(identifier)!.add(pubkey);
  }

  // Both groupings are exact, use whichever needs fewer filters since relays limit filters per request
  const authorGroups = groupBySharedValues(byAuthor).map(([authors, identifiers]) => ({ authors, identifiers }));
  const identifierGroups = groupBySharedValues(byIdentifier).map(([identifiers, authors]) => ({
    authors,
    identifiers,
  }));
  const groups = identifierGroups.length < authorGroups.length ? identifierGroups : authorGroups;

  return groups.map(({ authors, identifiers }) => ({ kinds: [kind], authors, "#d": identifiers }));
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
