import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "EventSet",
        "EventStore",
        "Helpers",
        "InMemoryEventDatabase",
        "Models",
        "TimeoutError",
        "defined",
        "filterDuplicateEvents",
        "firstValueFrom",
        "getObservableValue",
        "lastValueFrom",
        "logger",
        "mapEventsToStore",
        "mapEventsToTimeline",
        "simpleTimeout",
        "watchEventUpdates",
        "watchEventsUpdates",
        "withImmediateValueOrDefault",
      ]
    `);
  });
});
