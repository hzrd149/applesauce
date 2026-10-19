import equal from "fast-deep-equal";
import type { Filter as CoreFilter } from "nostr-tools/filter";
import { setCachedValue } from "./cache.js";
import { NostrEvent, StoreEvent } from "./event.js";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const INDEXABLE_TAGS = new Set((LETTERS + LETTERS.toUpperCase()).split(""));

export const EventIndexableTagsSymbol = Symbol.for("indexable-tags");

/** Returns a Set of tag names and values that are indexable */
export function getIndexableTags<E extends StoreEvent = NostrEvent>(event: E): Set<string> {
  let indexable = Reflect.get(event, EventIndexableTagsSymbol) as Set<string> | undefined;
  if (!indexable) {
    const tags = new Set<string>();

    for (const tag of event.tags) {
      if (tag.length >= 2 && tag[0].length === 1 && INDEXABLE_TAGS.has(tag[0])) {
        tags.add(tag[0] + ":" + tag[1]);
      }
    }

    indexable = tags;
    // Identity memo per cache.ts's one rule: written non-enumerable via setCachedValue, so a copy
    // built from `{ ...event, tags: newTags }` does NOT inherit this Set — the `if (!indexable)`
    // guard above recomputes from the copy's own tags on next access. This closes D-01/D-04's
    // shared-Set defect (a copy with different tags previously matched against the ORIGINAL's
    // indexable set). D-12: Phase 5's hot-path deferral for this site is intentionally lifted
    // here — "one rule" is exceptionless.
    setCachedValue(event, EventIndexableTagsSymbol, indexable);
  }

  return indexable;
}

/**
 * Extended Filter type that supports NIP-91 AND operator and NIP-50 search filter field
 */
export type Filter = CoreFilter & {
  /** NIP-91 AND operator support */
  [key: `&${string}`]: string[] | undefined;
  /** NIP-50 search filter field */
  search?: string;
};

/**
 * Copied from nostr-tools and modified to use {@link getIndexableTags}
 * Extended to support NIP-91 AND operator with `&` prefix
 * @see https://github.com/nbd-wtf/nostr-tools/blob/a61cde77eacc9518001f11d7f67f1a50ae05fd80/filter.ts
 */
export function matchFilter<E extends StoreEvent = NostrEvent>(filter: Filter, event: E): boolean {
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
      let values = (filter as Filter)[f as `&${string}`];
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
        const andValues = (filter as Filter)[andKey];

        // Filterout values that are in AND tags (NIP-91 rule)
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
export function matchFilters<E extends StoreEvent = NostrEvent>(filters: Filter[], event: E): boolean {
  for (let i = 0; i < filters.length; i++) {
    if (matchFilter(filters[i], event)) return true;
  }
  return false;
}

/** A precompiled check for whether an event matches a filter */
export type FilterMatcher<E extends StoreEvent = NostrEvent> = (event: E) => boolean;

// Lists longer than this are checked with a Set, shorter lists are faster to scan
const SET_THRESHOLD = 16;

function compileList<T>(values: T[]): (value: T) => boolean {
  if (values.length > SET_THRESHOLD) {
    const set = new Set(values);
    return (value) => set.has(value);
  }
  const list = Array.from(values);
  return (value) => list.indexOf(value) !== -1;
}

/**
 * Compiles a filter into a matcher with the same rules as {@link matchFilter}, for checking many events against one filter
 * @note The matcher is a snapshot of the filter, later changes to the filter are not seen
 */
export function compileFilter<E extends StoreEvent = NostrEvent>(filter: Filter): FilterMatcher<E> {
  const checks: FilterMatcher<E>[] = [];

  if (filter.ids) {
    const has = compileList(filter.ids);
    checks.push((event) => has(event.id));
  }
  if (filter.kinds) {
    const has = compileList(filter.kinds);
    checks.push((event) => has(event.kind));
  }
  if (filter.authors) {
    const has = compileList(filter.authors);
    checks.push((event) => has(event.pubkey));
  }
  if (filter.since) {
    const since = filter.since;
    checks.push((event) => event.created_at >= since);
  }
  if (filter.until) {
    const until = filter.until;
    checks.push((event) => event.created_at <= until);
  }

  // NIP-91 AND tags: every "name:value" must be present
  const all: string[] = [];
  for (const key of Object.keys(filter)) {
    if (key[0] !== "&") continue;
    const values = filter[key as `&${string}`];
    if (values) for (const value of values) all.push(key.slice(1) + ":" + value);
  }
  if (all.length > 0) {
    checks.push((event) => {
      const tags = getIndexableTags(event);
      for (const tag of all) if (!tags.has(tag)) return false;
      return true;
    });
  }

  // OR tags: at least one "name:value" per tag, ignoring values already required by AND (NIP-91)
  for (const key of Object.keys(filter)) {
    if (key[0] !== "#") continue;
    const values = filter[key as `#${string}`];
    if (!values) continue;

    const name = key.slice(1);
    const and = filter[`&${name}` as `&${string}`];
    const any = (and ? values.filter((v) => !and.includes(v)) : values).map((value) => name + ":" + value);
    if (any.length === 0) continue;

    checks.push((event) => {
      const tags = getIndexableTags(event);
      for (const tag of any) if (tags.has(tag)) return true;
      return false;
    });
  }

  if (checks.length === 0) return () => true;
  if (checks.length === 1) return checks[0];
  return (event) => {
    for (const check of checks) if (!check(event)) return false;
    return true;
  };
}

/**
 * Compiles filters into a matcher that passes when any filter matches, like {@link matchFilters}
 * @note The matcher is a snapshot of the filters, later changes to the filters are not seen
 */
export function compileFilters<E extends StoreEvent = NostrEvent>(filters: Filter[]): FilterMatcher<E> {
  const matchers = filters.map((filter) => compileFilter<E>(filter));
  if (matchers.length === 1) return matchers[0];

  return (event) => {
    for (const matcher of matchers) if (matcher(event)) return true;
    return false;
  };
}

/** Copied from nostr-tools and modified to support undefined values and NIP-91 AND operator */
export function mergeFilters(...filters: Filter[]): Filter {
  let result: Filter = {};
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
export function isFilterEqual(a: Filter | Filter[], b: Filter | Filter[]): boolean {
  return equal(a, b);
}
