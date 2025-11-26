import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AsyncEventStore",
        "BehaviorSubject",
        "EventFactory",
        "EventMemory",
        "EventModels",
        "EventStore",
        "Helpers",
        "Models",
        "Observable",
        "Operations",
        "ReplaySubject",
        "Subject",
        "TimeoutError",
        "blueprint",
        "buildEvent",
        "combineLatest",
        "createEvent",
        "defined",
        "filterDuplicateEvents",
        "filterOptimalRelays",
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
        "modifyEvent",
        "simpleTimeout",
        "watchEventUpdates",
        "watchEventsUpdates",
        "withImmediateValueOrDefault",
      ]
    `);
  });
});
