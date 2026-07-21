import { describe, expect, it } from "vitest";

import { SnapshotFactory, buildSnapshotFactories } from "../guestbook.js";

describe("SnapshotFactory", () => {
  it("buildSnapshotFactories chunks members and shares the snapshot id", async () => {
    const members = Array.from({ length: 401 }, (_, i) => String(i));
    const factories = buildSnapshotFactories(members, "snapid");
    expect(factories).toHaveLength(2);
    const first = await factories[0];
    expect(first.tags).toContainEqual(["snap", "snapid", "1", "2"]);
    expect(JSON.parse(first.content)).toHaveLength(400);
    const single = await SnapshotFactory.create(["x"], "id", 1, 1);
    expect(JSON.parse(single.content)).toEqual(["x"]);
  });

  it("shares one created_at and one ms tag across all chunks (TIME-02/D-08)", async () => {
    // Hand-derived from splitTime's formula, not read back from the
    // implementation: floor(1700000000700 / 1000) = 1700000000,
    // 1700000000700 % 1000 = 700 (>=500 remainder, exercises the boundary
    // a per-chunk Date.now() read would be most likely to straddle).
    const nowMs = 1700000000700;
    const expectedCreatedAt = 1700000000;
    const expectedMs = "700";

    const members = Array.from({ length: 401 }, (_, i) => String(i));
    const factories = buildSnapshotFactories(members, "snapid", nowMs);
    expect(factories).toHaveLength(2);
    const chunks = await Promise.all(factories);

    // Non-vacuity: a per-chunk Date.now() read (the old behavior) would let
    // these two chunks disagree on created_at/ms; asserting equality across
    // ALL chunks (not just checking one) is what catches that regression.
    for (const chunk of chunks) {
      expect(chunk.created_at).toBe(expectedCreatedAt);
      expect(chunk.tags).toContainEqual(["ms", expectedMs]);
    }
  });
});
