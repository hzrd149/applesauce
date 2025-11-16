import { Filter, NostrEvent } from "nostr-tools";
import { binarySearch, insertEventIntoDescendingList } from "nostr-tools/utils";

import { getIndexableTags, INDEXABLE_TAGS } from "../helpers/event-tags.js";
import { createReplaceableAddress, isReplaceable } from "../helpers/event.js";
import { LRU } from "../helpers/lru.js";
import { logger } from "../logger.js";
import { IEventMemory } from "./interface.js";

/** An in-memory database of events */
export class EventMemory implements IEventMemory {
  protected log = logger.extend("EventMemory");

  /** Indexes */
  protected kinds = new Map<number, Set<NostrEvent>>();
  protected authors = new Map<string, Set<NostrEvent>>();
  protected tags = new LRU<Set<NostrEvent>>();
  protected created_at: NostrEvent[] = [];

  /** Composite index for kind+author queries (common pattern) */
  protected kindAuthor = new Map<string, Set<NostrEvent>>();

  /** LRU cache of last events touched */
  events = new LRU<NostrEvent>();

  /** A sorted array of replaceable events by address */
  protected replaceable = new Map<string, NostrEvent[]>();

  /** The number of events in the database */
  get size() {
    return this.events.size;
  }

  /** Checks if the database contains an event without touching it */
  hasEvent(id: string): boolean {
    return this.events.has(id);
  }
  /** Gets a single event based on id */
  getEvent(id: string): NostrEvent | undefined {
    return this.events.get(id);
  }

  /** Checks if the event set has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean {
    const events = this.replaceable.get(createReplaceableAddress(kind, pubkey, identifier));
    return !!events && events.length > 0;
  }
  /** Gets the latest replaceable event */
  getReplaceable(kind: number, pubkey: string, identifier?: string): NostrEvent | undefined {
    const address = createReplaceableAddress(kind, pubkey, identifier);
    const events = this.replaceable.get(address);
    return events?.[0];
  }
  /** Gets the history of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): NostrEvent[] | undefined {
    const address = createReplaceableAddress(kind, pubkey, identifier);
    return this.replaceable.get(address);
  }

  /** Gets all events that match the filters */
  getByFilters(filters: Filter | Filter[]): NostrEvent[] {
    return Array.from(this.getEventsForFilters(Array.isArray(filters) ? filters : [filters]));
  }
  /** Gets a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): NostrEvent[] {
    const timeline: NostrEvent[] = [];
    const events = this.getByFilters(filters);
    for (const event of events) insertEventIntoDescendingList(timeline, event);
    return timeline;
  }

  /** Inserts an event into the database and notifies all subscriptions */
  add(event: NostrEvent): NostrEvent {
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
    insertEventIntoDescendingList(this.created_at, event);

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
      insertEventIntoDescendingList(array, event);
    }

    return event;
  }
  /** Removes an event from the database and notifies all subscriptions */
  remove(eventOrId: string | NostrEvent): boolean {
    let event = typeof eventOrId === "string" ? this.events.get(eventOrId) : eventOrId;
    if (!event) return false;

    const id = event.id;

    // only remove events that are known
    if (!this.events.has(id)) return false;

    this.getAuthorsIndex(event.pubkey).delete(event);
    this.getKindIndex(event.kind).delete(event);

    // Remove from composite kind+author index
    const kindAuthorKey = `${event.kind}:${event.pubkey}`;
    if (this.kindAuthor.has(kindAuthorKey)) {
      this.kindAuthor.get(kindAuthorKey)!.delete(event);
    }

    for (const tag of getIndexableTags(event)) {
      if (this.tags.has(tag)) {
        this.getTagIndex(tag).delete(event);
      }
    }

    // remove from created_at index using binary search
    this.removeFromSortedArray(this.created_at, event);

    this.events.delete(id);

    // remove from replaceable index using binary search
    if (isReplaceable(event.kind)) {
      const identifier = event.tags.find((t) => t[0] === "d")?.[1];
      const address = createReplaceableAddress(event.kind, event.pubkey, identifier);
      const array = this.replaceable.get(address);
      if (array) this.removeFromSortedArray(array, event);
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
  update(_event: NostrEvent) {
    // Do nothing
  }

  /** A weak map of events to claim reference counts */
  protected claims = new WeakMap<NostrEvent, number>();

  /** Moves an event to the top of the LRU cache */
  touch(event: NostrEvent): void {
    // Make sure the event is in the database before adding it to the LRU
    if (!this.events.has(event.id)) return;

    // Move to the top of the LRU
    this.events.set(event.id, event);
  }

  /** Increments the claim count on the event and touches it */
  claim(event: NostrEvent): void {
    const currentCount = this.claims.get(event) || 0;
    this.claims.set(event, currentCount + 1);

    // always touch event
    this.touch(event);
  }
  /** Checks if an event is claimed by anything */
  isClaimed(event: NostrEvent): boolean {
    const count = this.claims.get(event);
    return count !== undefined && count > 0;
  }
  /** Decrements the claim count on an event */
  removeClaim(event: NostrEvent): void {
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
  clearClaim(event: NostrEvent): void {
    this.claims.delete(event);
  }
  /** Returns a generator of unclaimed events in order of least used */
  *unclaimed(): Generator<NostrEvent> {
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
    if (!this.tags.has(tagAndValue)) {
      // build new tag index from existing events
      const events = new Set<NostrEvent>();

      const ts = Date.now();
      for (const event of this.events.values()) {
        if (getIndexableTags(event).has(tagAndValue)) {
          events.add(event);
        }
      }
      const took = Date.now() - ts;
      if (took > 100) this.log(`Built index ${tagAndValue} took ${took}ms`);

      this.tags.set(tagAndValue, events);
    }
    return this.tags.get(tagAndValue)!;
  }

  /**
   * Helper method to remove an event from a sorted array using binary search.
   * Falls back to indexOf if binary search doesn't find exact match.
   */
  protected removeFromSortedArray(array: NostrEvent[], event: NostrEvent): void {
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
  *iterateAuthors(authors: Iterable<string>): Generator<NostrEvent> {
    for (const author of authors) {
      const events = this.authors.get(author);

      if (events) {
        for (const event of events) yield event;
      }
    }
  }

  /** Iterates over all events by indexable tag and value */
  *iterateTag(tag: string, values: Iterable<string>): Generator<NostrEvent> {
    for (const value of values) {
      const events = this.getTagIndex(tag + ":" + value);

      if (events) {
        for (const event of events) yield event;
      }
    }
  }

  /** Iterates over all events by kind */
  *iterateKinds(kinds: Iterable<number>): Generator<NostrEvent> {
    for (const kind of kinds) {
      const events = this.kinds.get(kind);

      if (events) {
        for (const event of events) yield event;
      }
    }
  }

  /** Iterates over all events by time */
  *iterateTime(since: number | undefined, until: number | undefined): Generator<NostrEvent> {
    let startIndex = 0;
    let endIndex = this.created_at.length - 1;

    // If until is set, use binary search to find better start index
    let start = until
      ? binarySearch(this.created_at, (mid) => {
          return mid.created_at - until;
        })
      : undefined;
    if (start) startIndex = start[0];

    // If since is set, use binary search to find better end index
    const end = since
      ? binarySearch(this.created_at, (mid) => {
          return mid.created_at - since;
        })
      : undefined;
    if (end) endIndex = end[0];

    // Yield events in the range, filtering by exact bounds
    for (let i = startIndex; i <= endIndex; i++) {
      const event = this.created_at[i];
      if (until !== undefined && event.created_at > until) continue;
      if (since !== undefined && event.created_at < since) break;
      yield event;
    }
  }

  /** Iterates over all events by id */
  *iterateIds(ids: Iterable<string>): Generator<NostrEvent> {
    for (const id of ids) {
      if (this.events.has(id)) yield this.events.get(id)!;
    }
  }

  /** Returns all events that match the filter */
  protected getEventsForFilter(filter: Filter): Set<NostrEvent> {
    // search is not supported, return an empty set
    if (filter.search) return new Set();

    let first = true;
    let events = new Set<NostrEvent>();
    const and = (iterable: Iterable<NostrEvent>) => {
      const set = iterable instanceof Set ? iterable : new Set(iterable);
      if (first) {
        events = set;
        first = false;
      } else {
        for (const event of events) {
          if (!set.has(event)) events.delete(event);
        }
      }
      return events;
    };

    if (filter.ids) and(this.iterateIds(filter.ids));

    let time: NostrEvent[] | null = null;

    // query for time first if since is set
    if (filter.since !== undefined) {
      time = Array.from(this.iterateTime(filter.since, filter.until));
      and(time);
    }

    for (const t of INDEXABLE_TAGS) {
      const key = `#${t}`;
      const values = filter[key as `#${string}`];
      if (values?.length) and(this.iterateTag(t, values));
    }

    // Optimize: Use composite kind+author index when both are present and the cross-product is small
    if (filter.authors && filter.kinds && filter.authors.length * filter.kinds.length <= 20) {
      const combined = new Set<NostrEvent>();
      for (const kind of filter.kinds) {
        for (const author of filter.authors) {
          const key = `${kind}:${author}`;
          const kindAuthorEvents = this.kindAuthor.get(key);
          if (kindAuthorEvents) {
            for (const event of kindAuthorEvents) combined.add(event);
          }
        }
      }
      and(combined);
    } else {
      // Use separate indexes
      if (filter.authors) and(this.iterateAuthors(filter.authors));
      if (filter.kinds) and(this.iterateKinds(filter.kinds));
    }

    // query for time last if only until is set
    if (filter.since === undefined && filter.until !== undefined) {
      time = Array.from(this.iterateTime(filter.since, filter.until));
      and(time);
    }

    // If no filters were applied (empty filter), return all events
    if (first) {
      return new Set(this.events.values());
    }

    // if the filter queried on time and has a limit. truncate the events now
    if (filter.limit && time) {
      const limited = new Set<NostrEvent>();
      for (const event of time) {
        if (limited.size >= filter.limit) break;
        if (events.has(event)) limited.add(event);
      }
      return limited;
    }

    return events;
  }

  /** Returns all events that match the filters */
  protected getEventsForFilters(filters: Filter[]): Set<NostrEvent> {
    if (filters.length === 0) return new Set();

    let events = new Set<NostrEvent>();

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
    this.created_at = [];
    this.replaceable.clear();
    this.claims = new WeakMap();
  }
}
