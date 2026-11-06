import { describe, expect, it, vi } from "vitest";
import { pageTimeline, type TimelineWindow } from "../common/helpers.js";

type Item = { id: number; created_at: number };

/** Reads newest first from a fixed list, applying the window like an event store */
function reader(items: Item[]) {
  const sorted = [...items].sort((a, b) => b.created_at - a.created_at || a.id - b.id);

  return vi.fn((window: TimelineWindow) => {
    const matching = sorted.filter(
      (item) =>
        (window.since === undefined || item.created_at >= window.since) &&
        (window.until === undefined || item.created_at <= window.until),
    );
    return window.limit === undefined ? matching : matching.slice(0, window.limit);
  });
}

async function collect(items: AsyncIterable<Item>) {
  const collected: Item[] = [];
  for await (const item of items) collected.push(item);
  return collected;
}

describe("pageTimeline", () => {
  it("yields every item once when a page ends partway through a second", async () => {
    const items = [1, 2, 3, 4, 5].map((id) => ({ id, created_at: id <= 3 ? 10 : 20 }));

    const ids = (await collect(pageTimeline(reader(items), { pageSize: 3 }))).map((item) => item.id);

    expect(ids.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads only inside since and until", async () => {
    const items = [5, 10, 15, 20, 25].map((created_at) => ({ id: created_at, created_at }));
    const read = reader(items);

    const listed = await collect(pageTimeline(read, { since: 10, until: 20, pageSize: 2 }));

    expect(listed.map((item) => item.created_at)).toEqual([20, 15, 10]);
    expect(read.mock.calls[0][0]).toEqual({ since: 10, until: 20, limit: 2 });
  });

  it("omits undefined bounds from the window", async () => {
    const read = reader([]);

    await collect(pageTimeline(read, { pageSize: 5 }));

    expect(read).toHaveBeenCalledWith({ limit: 5 });
  });
});
