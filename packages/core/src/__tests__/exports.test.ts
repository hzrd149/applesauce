import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AsyncEventStore",
        "BehaviorSubject",
        "EventMemory",
        "EventStore",
        "Helpers",
        "Models",
        "Observable",
        "ReplaySubject",
        "Subject",
        "TimeoutError",
        "combineLatest",
        "defined",
        "filterDuplicateEvents",
        "firstValueFrom",
        "getObservableValue",
        "ignoreBlacklistedRelays",
        "includeFallbackRelays",
        "includeMailboxes",
        "lastValueFrom",
        "logger",
        "mapEventsToStore",
        "mapEventsToTimeline",
        "merge",
        "simpleTimeout",
        "watchEventUpdates",
        "watchEventsUpdates",
        "withImmediateValueOrDefault",
      ]
    `);
  });
});
