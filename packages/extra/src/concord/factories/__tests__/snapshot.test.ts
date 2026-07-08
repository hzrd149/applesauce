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
});
