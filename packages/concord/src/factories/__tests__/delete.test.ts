import { describe, expect, it } from "vitest";

import { kinds } from "applesauce-core/helpers/event";
import { DeleteFactory } from "../chat.js";

describe("DeleteFactory", () => {
  it("targets a message", async () => {
    const del = await DeleteFactory.create("chan", 1, "target");
    expect(del.kind).toBe(kinds.EventDeletion);
    expect(del.tags).toContainEqual(["e", "target"]);
  });
});
