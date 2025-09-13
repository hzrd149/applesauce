import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "CREATE_EVENTS_TABLE",
        "CREATE_EVENT_TAGS_TABLE",
        "CREATE_INDEXES",
        "buildFilterConditions",
        "buildFiltersQuery",
        "createTables",
        "deleteEvent",
        "getEvent",
        "getEventsByFilters",
        "getReplaceable",
        "getReplaceableHistory",
        "hasEvent",
        "hasReplaceable",
        "insertEvent",
        "insertEventTags",
        "rowToEvent",
      ]
    `);
  });
});
