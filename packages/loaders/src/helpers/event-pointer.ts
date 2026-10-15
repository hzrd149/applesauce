import { mergeRelaySets } from "applesauce-core/helpers";

/** deduplicates an array of event pointers and merges their relays array and cache flag */
export function consolidateEventPointers<T extends { id: string; relays?: string[]; cache?: boolean }>(
  pointers: T[],
): T[] {
  const ids = new Map<string, T>();

  for (const pointer of pointers) {
    const existing = ids.get(pointer.id);

    if (!existing) {
      ids.set(pointer.id, { ...pointer });
      continue;
    }

    // merge relays
    if (pointer.relays?.length) existing.relays = mergeRelaySets(existing.relays, pointer.relays);

    // Any request that bypasses the cache makes the merged pointer bypass it
    if (pointer.cache === false) existing.cache = false;
  }

  return Array.from(ids.values());
}
