import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "CREATE_EVENTS_TABLE_STATEMENT",
        "CREATE_EVENT_TAGS_TABLE_STATEMENT",
        "CREATE_INDEXES_STATEMENTS",
        "CREATE_SEARCH_TABLE_STATEMENT",
        "DELETE_EVENT_STATEMENT",
        "DELETE_EVENT_TAGS_STATEMENT",
        "DELETE_SEARCH_CONTENT_STATEMENT",
        "GET_ALL_EVENTS_STATEMENT",
        "GET_EVENT_STATEMENT",
        "GET_REPLACEABLE_HISTORY_STATEMENT",
        "GET_REPLACEABLE_STATEMENT",
        "HAS_EVENT_STATEMENT",
        "HAS_REPLACEABLE_STATEMENT",
        "INSERT_EVENT_STATEMENT",
        "INSERT_EVENT_STATEMENT_WITH_IGNORE",
        "INSERT_EVENT_TAG_STATEMENT",
        "INSERT_SEARCH_CONTENT_STATEMENT",
        "buildDeleteFiltersQuery",
        "buildFilterConditions",
        "buildFiltersQuery",
        "defaultSearchContentFormatter",
        "enhancedSearchContentFormatter",
        "rowToEvent",
      ]
    `);
  });
});
