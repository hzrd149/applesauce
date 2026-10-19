import { insertEventIntoDescendingList } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { NostrEvent } from "../../helpers/event.js";
import { TimeIndex } from "../time-index.js";

let next = 0;
const event = (created_at: number) => ({ id: String(next++), created_at }) as NostrEvent;

/** Fills an index and a plain sorted array with the same events */
function fill(count: number, spread: number) {
  const index = new TimeIndex<NostrEvent>();
  const reference: NostrEvent[] = [];
  for (let i = 0; i < count; i++) {
    const e = event(Math.floor(Math.random() * spread));
    index.insert(e);
    insertEventIntoDescendingList(reference, e);
  }
  return { index, reference };
}

describe("TimeIndex", () => {
  it("should keep the same order as a sorted array across many buckets", () => {
    // A small spread makes long runs of tied timestamps that cross bucket splits
    const { index, reference } = fill(5000, 50);

    expect(Array.from(index.range())).toEqual(reference);
    expect(index.size).toBe(5000);
  });

  it("should remove events, including ties split across buckets", () => {
    const { index, reference } = fill(5000, 20);

    for (const e of [...reference].sort(() => Math.random() - 0.5).slice(0, 3000)) {
      expect(index.remove(e)).toBe(true);
      reference.splice(reference.indexOf(e), 1);
    }

    expect(Array.from(index.range())).toEqual(reference);
    expect(index.size).toBe(2000);
    expect(index.remove(event(5))).toBe(false);
  });

  it("should count and iterate inclusive time ranges", () => {
    const { index, reference } = fill(4000, 1000);

    for (const [since, until] of [
      [100, 200],
      [500, 500],
      [undefined, 300],
      [700, undefined],
      [2000, 3000],
      [300, 100],
    ] as const) {
      const expected = reference.filter(
        (e) => (since === undefined || e.created_at >= since) && (until === undefined || e.created_at <= until),
      );
      expect(Array.from(index.range(since, until))).toEqual(expected);
      expect(index.count(since, until)).toBe(expected.length);
    }
  });

  it("should be empty after clear", () => {
    const { index } = fill(100, 10);
    index.clear();

    expect(index.size).toBe(0);
    expect(Array.from(index.range())).toEqual([]);
    expect(index.count(0, 10)).toBe(0);
  });
});
