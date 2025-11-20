import equal from "fast-deep-equal";
import { Filter, NostrEvent } from "nostr-tools";
import { getIndexableTags } from "./event-tags.js";

// Re-export type Filter from nostr-tools
export { Filter } from "nostr-tools/filter";

/**
 * Extended Filter type that supports NIP-91 AND operator
 * Uses `&` prefix for tag filters that require ALL values to match (AND logic)
 * @example
 * {
 *   kinds: [1],
 *   "&t": ["meme", "cat"],  // Must have BOTH "meme" AND "cat" tags
 *   "#t": ["black", "white"] // Must have "black" OR "white" tags
 * }
 */
export type FilterWithAnd = Filter & {
  [key: `&${string}`]: string[] | undefined;
};

/**
 * Copied from nostr-tools and modified to use {@link getIndexableTags}
 * Extended to support NIP-91 AND operator with `&` prefix
 * @see https://github.com/nbd-wtf/nostr-tools/blob/a61cde77eacc9518001f11d7f67f1a50ae05fd80/filter.ts
 */
export function matchFilter(filter: FilterWithAnd, event: NostrEvent): boolean {
  if (filter.ids && filter.ids.indexOf(event.id) === -1) return false;
  if (filter.kinds && filter.kinds.indexOf(event.kind) === -1) return false;
  if (filter.authors && filter.authors.indexOf(event.pubkey) === -1) return false;
  if (filter.since && event.created_at < filter.since) return false;
  if (filter.until && event.created_at > filter.until) return false;

  // Process AND tag filters (& prefix) first - NIP-91
  // AND takes precedence and requires ALL values to be present
  for (let f in filter) {
    if (f[0] === "&") {
      let tagName = f.slice(1);
      let values = (filter as FilterWithAnd)[f as `&${string}`];
      if (values && values.length > 0) {
        const tags = getIndexableTags(event);
        // ALL values must be present (AND logic)
        for (const value of values) {
          if (!tags.has(tagName + ":" + value)) {
            return false;
          }
        }
      }
    }
  }

  // Process OR tag filters (# prefix)
  // Skip values that are in AND tags (NIP-91 rule)
  for (let f in filter) {
    if (f[0] === "#") {
      let tagName = f.slice(1);
      let values = filter[f as `#${string}`];
      if (values) {
        // Check if there's a corresponding AND filter for this tag
        const andKey = `&${tagName}` as `&${string}`;
        const andValues = (filter as FilterWithAnd)[andKey];

        // Filter out values that are in AND tags (NIP-91 rule)
        const filteredValues = andValues ? values.filter((v) => !andValues.includes(v)) : values;

        // If there are no values left after filtering, skip this check
        if (filteredValues.length === 0) continue;

        const tags = getIndexableTags(event);
        if (filteredValues.some((v) => tags.has(tagName + ":" + v)) === false) return false;
      }
    }
  }

  return true;
}

/** Copied from nostr-tools and modified to use {@link matchFilter} */
export function matchFilters(filters: FilterWithAnd[], event: NostrEvent): boolean {
  for (let i = 0; i < filters.length; i++) {
    if (matchFilter(filters[i], event)) return true;
  }
  return false;
}

/** Copied from nostr-tools and modified to support undefined values and NIP-91 AND operator */
export function mergeFilters(...filters: FilterWithAnd[]): FilterWithAnd {
  let result: FilterWithAnd = {};
  for (let i = 0; i < filters.length; i++) {
    let filter = filters[i];
    Object.entries(filter).forEach(([property, values]) => {
      // skip undefined
      if (values === undefined) return;

      if (
        property === "kinds" ||
        property === "ids" ||
        property === "authors" ||
        property[0] === "#" ||
        property[0] === "&"
      ) {
        // @ts-ignore
        result[property] = result[property] || [];
        // @ts-ignore
        for (let v = 0; v < values.length; v++) {
          // @ts-ignore
          let value = values[v];
          // @ts-ignore
          if (!result[property].includes(value)) result[property].push(value);
        }
      }
    });

    if (filter.limit && (!result.limit || filter.limit > result.limit)) result.limit = filter.limit;
    if (filter.until && (!result.until || filter.until > result.until)) result.until = filter.until;
    if (filter.since && (!result.since || filter.since < result.since)) result.since = filter.since;
  }

  return result;
}

/** Check if two filters are equal */
export function isFilterEqual(a: FilterWithAnd | FilterWithAnd[], b: FilterWithAnd | FilterWithAnd[]): boolean {
  return equal(a, b);
}
