import { StoreEvent } from "../helpers/event.js";

// Buckets split in half when they grow past this, keeping inserts and removes to a short splice
const MAX_BUCKET = 1024;

/** A position in the index, as a bucket and an index inside it */
type Position = [bucket: number, index: number];

/** Events sorted newest first, stored in small buckets so inserts and removes stay cheap */
export class TimeIndex<E extends StoreEvent> {
  protected buckets: E[][] = [];
  size = 0;

  /** Returns the position of the first event that passes the test, which must go from false to true */
  protected find(test: (event: E) => boolean): Position {
    // Find the first bucket whose last event passes
    let low = 0;
    let high = this.buckets.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const bucket = this.buckets[mid];
      if (test(bucket[bucket.length - 1])) high = mid;
      else low = mid + 1;
    }
    if (low === this.buckets.length) return [low, 0];

    const bucket = this.buckets[low];
    let start = 0;
    let end = bucket.length - 1;
    while (start < end) {
      const mid = (start + end) >>> 1;
      if (test(bucket[mid])) end = mid;
      else start = mid + 1;
    }
    return [low, start];
  }

  /** Adds an event before any events with the same created_at */
  insert(event: E): void {
    const created_at = event.created_at;
    if (this.buckets.length === 0) {
      this.buckets.push([event]);
      this.size++;
      return;
    }

    let [b, i] = this.find((other) => other.created_at <= created_at);
    // Older than every event, append to the last bucket
    if (b === this.buckets.length) {
      b--;
      i = this.buckets[b].length;
    }

    const bucket = this.buckets[b];
    bucket.splice(i, 0, event);
    this.size++;
    if (bucket.length > MAX_BUCKET) this.buckets.splice(b + 1, 0, bucket.splice(bucket.length >>> 1));
  }

  /** Removes an event, returns false if it was not in the index */
  remove(event: E): boolean {
    const created_at = event.created_at;
    let [b, i] = this.find((other) => other.created_at <= created_at);

    // Search the events with the same created_at, which can continue into the next buckets
    for (; b < this.buckets.length; b++, i = 0) {
      const bucket = this.buckets[b];
      for (; i < bucket.length; i++) {
        if (bucket[i].created_at !== created_at) return false;
        if (bucket[i] !== event) continue;

        bucket.splice(i, 1);
        if (bucket.length === 0) this.buckets.splice(b, 1);
        this.size--;
        return true;
      }
    }
    return false;
  }

  /** Returns the start and end positions of the events between since and until (inclusive) */
  protected bounds(since?: number, until?: number): [Position, Position] {
    const start: Position = until === undefined ? [0, 0] : this.find((event) => event.created_at <= until);
    const end: Position =
      since === undefined ? [this.buckets.length, 0] : this.find((event) => event.created_at < since);
    return [start, end];
  }

  /** Counts the events between since and until (inclusive) */
  count(since?: number, until?: number): number {
    if (since === undefined && until === undefined) return this.size;

    const [[sb, si], [eb, ei]] = this.bounds(since, until);
    if (sb > eb || (sb === eb && si >= ei)) return 0;
    if (sb === eb) return ei - si;

    let count = this.buckets[sb].length - si + ei;
    for (let b = sb + 1; b < eb; b++) count += this.buckets[b].length;
    return count;
  }

  /** Iterates over the events between since and until (inclusive), newest first */
  *range(since?: number, until?: number): Generator<E> {
    const [[sb, si], [eb, ei]] = this.bounds(since, until);

    for (let b = sb, i = si; b < this.buckets.length && (b < eb || (b === eb && i < ei)); b++, i = 0) {
      const bucket = this.buckets[b];
      const last = b === eb ? ei : bucket.length;
      for (; i < last; i++) yield bucket[i];
    }
  }

  /** Removes all events */
  clear(): void {
    this.buckets = [];
    this.size = 0;
  }
}
