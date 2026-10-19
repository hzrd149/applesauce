import type { SyncPair } from "./interface.js";
import {
  binarySearch,
  createReplaceableAddress,
  insertEventIntoDescendingList,
  isReplaceable,
  NostrEvent,
  StoreEvent,
} from "../helpers/event.js";
import { Filter, getIndexableTags, INDEXABLE_TAGS } from "../helpers/filter.js";
import { LRU } from "../helpers/lru.js";
import { logger } from "../logger.js";
import { IEventMemory } from "./interface.js";
import { TimeIndex } from "./time-index.js";

/** Returns the index sets for the keys that exist */
function getSets<K, E>(index: Map<K, Set<E>>, keys: K[]): Set<E>[] {
  const sets: Set<E>[] = [];
  for (const key of keys) {
    const events = index.get(key);
    if (events) sets.push(events);
  }
  return sets;
}

/** Returns the newest events, breaking ties by lowest id (NIP-01) */
function newest<E extends StoreEvent>(events: E[], limit: number): E[] {
  return events.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)).slice(0, limit);
}

/** An in-memory database of events */
export class EventMemory<E extends StoreEvent = NostrEvent> implements IEventMemory<E> {
  protected log = logger.extend("EventMemory");

  /** Indexes */
  protected kinds = new Map<number, Set<E>>();
  protected authors = new Map<string, Set<E>>();
  // Capped so queries for many distinct tag values do not grow the index forever, evicted indexes are rebuilt on demand
  protected tags = new LRU<Set<E>>(10_000);
  protected created_at = new TimeIndex<E>();

  /** Composite index for kind+author queries (common pattern) */
  protected kindAuthor = new Map<string, Set<E>>();

  /** LRU cache of last events touched */
  events = new LRU<E>();

  /** A sorted array of replaceable events by address */
  protected replaceable = new Map<string, E[]>();

  /** The number of events in the database */
  get size() {
    return this.events.size;
  }

  /** Checks if the database contains an event without touching it */
  hasEvent(id: string): boolean {
    return this.events.has(id);
  }
  /** Gets a single event based on id */
  getEvent(id: string): E | undefined {
    return this.events.get(id);
  }

  /** Checks if the event set has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean {
    const events = this.replaceable.get(createReplaceableAddress(kind, pubkey, identifier));
    return !!events && events.length > 0;
  }
  /** Gets the latest replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): E | undefined {
    const address = createReplaceableAddress(kind, pubkey, identifier);
    const events = this.replaceable.get(address);
    return events?.[0];
  }
  /** Gets the history of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): E[] | undefined {
    const address = createReplaceableAddress(kind, pubkey, identifier);
    return this.replaceable.get(address);
  }

  /** Gets all events that match the filters */
  getByFilters(filters: Filter | Filter[]): E[] {
    return Array.from(this.getEventsForFilters(Array.isArray(filters) ? filters : [filters]));
  }
  /** Gets matching sync pairs without populating event memory */
  getSyncPairs(filters: Filter | Filter[]): SyncPair[] {
    return Array.from(this.getEventsForFilters(Array.isArray(filters) ? filters : [filters]), ({ id, created_at }) => ({
      id,
      created_at,
    }));
  }

  /** Gets a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): E[] {
    const events = this.getByFilters(filters).sort((a, b) => b.created_at - a.created_at);

    // Sorted insertion put later encounters first when timestamps match, so take tied events in created_at index order
    for (let i = 0; i < events.length;) {
      let j = i + 1;
      while (j < events.length && events[j].created_at === events[i].created_at) j++;
      if (j - i > 1) {
        const tied = new Set(events.slice(i, j));
        let k = i;
        for (const event of this.created_at.range(events[i].created_at, events[i].created_at))
          if (tied.has(event)) events[k++] = event;
      }
      i = j;
    }

    return events;
  }

  /** Inserts an event into the database and notifies all subscriptions */
  add(event: E): E {
    const id = event.id;

    const current = this.events.get(id);
    if (current) return current;

    this.events.set(id, event);
    this.getKindIndex(event.kind).add(event);
    this.getAuthorsIndex(event.pubkey).add(event);
    this.getKindAuthorIndex(event.kind, event.pubkey).add(event);

    // Add the event to the tag indexes if they exist
    for (const tag of getIndexableTags(event)) {
      if (this.tags.has(tag)) this.getTagIndex(tag).add(event);
    }

    // Insert into time index
    this.created_at.insert(event);

    // Insert into replaceable index
    if (isReplaceable(event.kind)) {
      const identifier = event.tags.find((t) => t[0] === "d")?.[1];
      const address = createReplaceableAddress(event.kind, event.pubkey, identifier);

      let array = this.replaceable.get(address)!;
      if (!this.replaceable.has(address)) {
        // add an empty array if there is no array
        array = [];
        this.replaceable.set(address, array);
      }

      // insert the event into the sorted array
      insertEventIntoDescendingList(array as unknown as NostrEvent[], event as unknown as NostrEvent);
    }

    return event;
  }
  /** Removes an event from the database and notifies all subscriptions */
  remove(eventOrId: string | E): boolean {
    let event = typeof eventOrId === "string" ? this.events.get(eventOrId) : eventOrId;
    if (!event) return false;

    const id = event.id;

    // only remove events that are known
    if (!this.events.has(id)) return false;

    // Remove from author index, dropping the index entry when it becomes empty so
    // the map does not accumulate empty Sets keyed by every pubkey ever seen
    const authorIndex = this.authors.get(event.pubkey);
    if (authorIndex) {
      authorIndex.delete(event);
      if (authorIndex.size === 0) this.authors.delete(event.pubkey);
    }

    // Remove from kind index, dropping the index entry when it becomes empty
    const kindIndex = this.kinds.get(event.kind);
    if (kindIndex) {
      kindIndex.delete(event);
      if (kindIndex.size === 0) this.kinds.delete(event.kind);
    }

    // Remove from composite kind+author index, dropping the entry when empty
    const kindAuthorKey = `${event.kind}:${event.pubkey}`;
    const kindAuthorIndex = this.kindAuthor.get(kindAuthorKey);
    if (kindAuthorIndex) {
      kindAuthorIndex.delete(event);
      if (kindAuthorIndex.size === 0) this.kindAuthor.delete(kindAuthorKey);
    }

    for (const tag of getIndexableTags(event)) {
      if (this.tags.has(tag)) {
        const tagIndex = this.getTagIndex(tag);
        tagIndex.delete(event);
        // Drop the tag index when empty so it does not retain the key forever
        if (tagIndex.size === 0) this.tags.delete(tag);
      }
    }

    // remove from created_at index
    this.created_at.remove(event);

    this.events.delete(id);

    // remove from replaceable index using binary search
    if (isReplaceable(event.kind)) {
      const identifier = event.tags.find((t) => t[0] === "d")?.[1];
      const address = createReplaceableAddress(event.kind, event.pubkey, identifier);
      const array = this.replaceable.get(address);
      if (array) {
        this.removeFromSortedArray(array, event);
        // Drop the empty array so the map does not retain an address key forever
        if (array.length === 0) this.replaceable.delete(address);
      }
    }

    // remove any claims this event has
    this.claims.delete(event);

    return true;
  }

  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): number {
    const eventsToRemove = this.getByFilters(filters);
    let removedCount = 0;

    for (const event of eventsToRemove) {
      if (this.remove(event)) {
        removedCount++;
      }
    }

    return removedCount;
  }
  /** Notify the database that an event has updated */
  update(_event: E) {
    // Do nothing
  }

  /** A weak map of events to claim reference counts */
  protected claims = new WeakMap<E, number>();

  /** Moves an event to the top of the LRU cache */
  touch(event: E): void {
    // Make sure the event is in the database before adding it to the LRU
    if (!this.events.has(event.id)) return;

    // Move to the top of the LRU
    this.events.set(event.id, event);
  }

  /** Increments the claim count on the event and touches it */
  claim(event: E): void {
    const currentCount = this.claims.get(event) || 0;
    this.claims.set(event, currentCount + 1);

    // always touch event
    this.touch(event);
  }
  /** Checks if an event is claimed by anything */
  isClaimed(event: E): boolean {
    const count = this.claims.get(event);
    return count !== undefined && count > 0;
  }
  /** Decrements the claim count on an event */
  removeClaim(event: E): void {
    const currentCount = this.claims.get(event);
    if (currentCount !== undefined && currentCount > 0) {
      const newCount = currentCount - 1;
      if (newCount === 0) {
        this.claims.delete(event);
      } else {
        this.claims.set(event, newCount);
      }
    }
  }
  /** Removes all claims on an event */
  clearClaim(event: E): void {
    this.claims.delete(event);
  }
  /** Returns a generator of unclaimed events in order of least used */
  *unclaimed(): Generator<E> {
    let removed = 0;

    let cursor = this.events.first;
    while (cursor) {
      const event = cursor.value;
      if (!this.isClaimed(event)) yield event;
      cursor = cursor.next;
    }

    return removed;
  }
  /** Removes events that are not claimed (free up memory) */
  prune(limit?: number): number {
    let removed = 0;

    const unclaimed = this.unclaimed();
    for (const event of unclaimed) {
      this.remove(event);

      removed++;
      if (limit && removed >= limit) break;
    }

    return removed;
  }

  /** Index helper methods */
  protected getKindIndex(kind: number) {
    if (!this.kinds.has(kind)) this.kinds.set(kind, new Set());
    return this.kinds.get(kind)!;
  }
  protected getAuthorsIndex(author: string) {
    if (!this.authors.has(author)) this.authors.set(author, new Set());
    return this.authors.get(author)!;
  }
  protected getKindAuthorIndex(kind: number, pubkey: string) {
    const key = `${kind}:${pubkey}`;
    if (!this.kindAuthor.has(key)) this.kindAuthor.set(key, new Set());
    return this.kindAuthor.get(key)!;
  }
  protected getTagIndex(tagAndValue: string) {
    return this.tags.get(tagAndValue) ?? this.buildTagIndexes([tagAndValue]).get(tagAndValue)!;
  }

  /** Builds the indexes for any tag values that are not indexed yet with a single pass over the events */
  protected buildTagIndexes(tagAndValues: Iterable<string>): Map<string, Set<E>> {
    const built = new Map<string, Set<E>>();
    for (const key of tagAndValues) if (!this.tags.has(key)) built.set(key, new Set());
    if (built.size === 0) return built;

    const ts = Date.now();
    // Walk the LRU nodes directly, LRU.values() would reorder every event
    for (let item = this.events.first; item !== null; item = item.next) {
      for (const tag of getIndexableTags(item.value)) built.get(tag)?.add(item.value);
    }
    const took = Date.now() - ts;
    if (took > 100) this.log(`Built ${built.size} tag indexes took ${took}ms`);

    for (const [key, events] of built) this.tags.set(key, events);
    return built;
  }

  /**
   * Helper method to remove an event from a sorted array using binary search.
   * Falls back to indexOf if binary search doesn't find exact match.
   */
  protected removeFromSortedArray(array: E[], event: E): void {
    if (array.length === 0) return;

    // Use binary search to find the approximate position
    const result = binarySearch(array, (mid) => mid.created_at - event.created_at);

    if (result) {
      let index = result[0];

      // Binary search finds the position, but we need to find the exact event
      // since multiple events can have the same created_at timestamp.
      // Search backwards and forwards from the found position
      let found = false;

      // Check the found position first
      if (array[index] === event) {
        array.splice(index, 1);
        return;
      }

      // Search backwards
      for (let i = index - 1; i >= 0 && array[i].created_at === event.created_at; i--) {
        if (array[i] === event) {
          array.splice(i, 1);
          found = true;
          break;
        }
      }

      if (found) return;

      // Search forwards
      for (let i = index + 1; i < array.length && array[i].created_at === event.created_at; i++) {
        if (array[i] === event) {
          array.splice(i, 1);
          return;
        }
      }
    }

    // Fallback to indexOf if binary search doesn't find the event
    // This should rarely happen, but ensures correctness
    const idx = array.indexOf(event);
    if (idx !== -1) array.splice(idx, 1);
  }

  /** Iterates over all events by author */
  *iterateAuthors(authors: Iterable<string>): Generator<E> {
    for (const author of authors) {
      const events = this.authors.get(author);

      if (events) {
        for (const event of events) yield event;
      }
    }
  }

  /** Iterates over all events by indexable tag and value */
  *iterateTag(tag: string, values: Iterable<string>): Generator<E> {
    const keys = Array.from(values, (value) => tag + ":" + value);
    // Build all missing indexes in one pass, and read them from the result in case the LRU evicted them
    const built = this.buildTagIndexes(keys);

    for (const key of keys) {
      const events = built.get(key) ?? this.tags.get(key);

      if (events) {
        for (const event of events) yield event;
      }
    }
  }

  /** Iterates over all events by kind */
  *iterateKinds(kinds: Iterable<number>): Generator<E> {
    for (const kind of kinds) {
      const events = this.kinds.get(kind);

      if (events) {
        for (const event of events) yield event;
      }
    }
  }

  /** Iterates over all events by time */
  *iterateTime(since: number | undefined, until: number | undefined): Generator<E> {
    yield* this.created_at.range(since, until);
  }

  /** Iterates over all events by id */
  *iterateIds(ids: Iterable<string>): Generator<E> {
    for (const id of ids) {
      if (this.events.has(id)) yield this.events.get(id)!;
    }
  }

  /** Returns all events that match the filter */
  protected getEventsForFilter(filter: Filter): Set<E> {
    // search is not supported, return an empty set
    if (filter.search) return new Set();

    // Each condition is a union of index sets. They are intersected without copying the indexes.
    const conditions: Set<E>[][] = [];

    if (filter.ids) conditions.push([new Set(this.iterateIds(filter.ids))]);

    // Process AND tag filters (& prefix) first - NIP-91
    // AND takes precedence and requires ALL values to be present, so each value is its own condition
    for (const t of INDEXABLE_TAGS) {
      const values = filter[`&${t}` as `&${string}`];
      if (values?.length) for (const value of values) conditions.push(this.getTagSets(t, [value]));
    }

    // Process OR tag filters (# prefix)
    // Skip values that are in AND tags (NIP-91 rule)
    for (const t of INDEXABLE_TAGS) {
      const values = filter[`#${t}` as `#${string}`];
      if (values?.length) {
        const andValues = filter[`&${t}` as `&${string}`];
        const filteredValues = andValues ? values.filter((v) => !andValues.includes(v)) : values;

        // Only apply OR filter if there are values left after filtering
        if (filteredValues.length > 0) conditions.push(this.getTagSets(t, filteredValues));
      }
    }

    // Use the composite kind+author index when both are present and the cross-product is small
    if (filter.authors && filter.kinds && filter.authors.length * filter.kinds.length <= 20) {
      const sets: Set<E>[] = [];
      for (const kind of filter.kinds) {
        for (const author of filter.authors) {
          const events = this.kindAuthor.get(`${kind}:${author}`);
          if (events) sets.push(events);
        }
      }
      conditions.push(sets);
    } else {
      if (filter.authors) conditions.push(getSets(this.authors, filter.authors));
      if (filter.kinds) conditions.push(getSets(this.kinds, filter.kinds));
    }

    // A condition without any index sets matches nothing
    if (conditions.some((sets) => sets.length === 0)) return new Set();

    const { since, until, limit } = filter;
    const timed = since !== undefined || until !== undefined;

    // An empty filter returns every event in insertion order
    if (conditions.length === 0 && !timed && !limit) return new Set(this.events.values());

    // Check the smallest condition first and test the rest by membership
    const size = (sets: Set<E>[]) => sets.reduce((total, set) => total + set.size, 0);
    conditions.sort((a, b) => size(a) - size(b));
    const matches = (event: E) => conditions.every((sets) => sets.some((set) => set.has(event)));

    // Walking the time index finds the newest matches without sorting, and stops once the limit is reached.
    // Each step checks every condition, so it is weighted as twice the cost of a sort comparison.
    const base = conditions.length > 0 ? size(conditions[0]) : Infinity;
    const range = this.created_at.count(since, until);
    if (range <= base || (limit && (2 * limit * range) / base < base * Math.log2(base))) {
      const found: E[] = [];
      for (const event of this.created_at.range(since, until)) {
        // Keep going past the limit while timestamps tie, so the tie-break below sees every candidate
        if (limit && found.length >= limit && event.created_at !== found[found.length - 1].created_at) break;
        if (matches(event)) found.push(event);
      }
      return new Set(limit && found.length > limit ? newest(found, limit) : found);
    }

    // A single index set with nothing else to check can be returned as is
    if (conditions.length === 1 && conditions[0].length === 1 && !timed && !(limit && base > limit))
      return conditions[0][0];

    const [first, ...rest] = conditions;
    const found = new Set<E>();
    for (const set of first) {
      for (const event of set) {
        if (since !== undefined && event.created_at < since) continue;
        if (until !== undefined && event.created_at > until) continue;
        if (rest.every((sets) => sets.some((other) => other.has(event)))) found.add(event);
      }
    }

    return limit && found.size > limit ? new Set(newest(Array.from(found), limit)) : found;
  }

  /** Returns the tag index sets for the values, building any that are missing */
  protected getTagSets(tag: string, values: string[]): Set<E>[] {
    const keys = values.map((value) => tag + ":" + value);
    // Read from the built map in case the LRU evicted an index while building
    const built = this.buildTagIndexes(keys);
    const sets: Set<E>[] = [];
    for (const key of keys) {
      const events = built.get(key) ?? this.tags.get(key);
      if (events) sets.push(events);
    }
    return sets;
  }

  /** Returns all events that match the filters */
  protected getEventsForFilters(filters: Filter[]): Set<E> {
    if (filters.length === 0) return new Set();

    let events = new Set<E>();

    for (const filter of filters) {
      const filtered = this.getEventsForFilter(filter);
      for (const event of filtered) events.add(event);
    }

    return events;
  }

  /** Resets the event set */
  reset(): void {
    this.events.clear();
    this.kinds.clear();
    this.authors.clear();
    this.kindAuthor.clear();
    this.tags.clear();
    this.created_at.clear();
    this.replaceable.clear();
    this.claims = new WeakMap();
  }
}
