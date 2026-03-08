import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AsyncDeleteManager",
        "AsyncEventStore",
        "BehaviorSubject",
        "DeleteFactory",
        "DeleteManager",
        "EventFactory",
        "EventMemory",
        "EventModels",
        "EventStore",
        "ExpirationManager",
        "Factories",
        "Helpers",
        "MailboxesFactory",
        "Models",
        "Observable",
        "Operations",
        "ProfileFactory",
        "ReplaySubject",
        "Subject",
        "TimeoutError",
        "blankEventTemplate",
        "combineLatest",
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
        "simpleTimeout",
        "toEventTemplate",
        "watchEventUpdates",
        "watchEventsUpdates",
        "watchTimelineUpdates",
        "withImmediateValueOrDefault",
      ]
    `);
  });
});
