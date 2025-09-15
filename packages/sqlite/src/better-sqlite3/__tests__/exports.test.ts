import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "BetterSqlite3EventDatabase",
        "createTables",
        "deleteEvent",
        "deleteSearchContent",
        "getEvent",
        "getEventsByFilters",
        "getReplaceable",
        "getReplaceableHistory",
        "hasEvent",
        "hasReplaceable",
        "insertEvent",
        "insertEventTags",
        "insertSearchContent",
        "rebuildSearchIndex",
        "searchEvents",
      ]
    `);
  });
});
