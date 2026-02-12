import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AsyncDeleteManager",
        "AsyncEventStore",
        "BehaviorSubject",
        "DeleteBlueprint",
        "DeleteFactory",
        "DeleteManager",
        "EventFactory",
        "EventMemory",
        "EventModels",
        "EventStore",
        "ExpirationManager",
        "Factories",
        "Helpers",
        "LegacyEventFactory",
        "MailboxesFactory",
        "Models",
        "Observable",
        "Operations",
        "ProfileFactory",
        "ReplaySubject",
        "Subject",
        "TimeoutError",
        "blankEventTemplate",
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
        "toEventTemplate",
        "watchEventUpdates",
        "watchEventsUpdates",
        "watchTimelineUpdates",
        "withImmediateValueOrDefault",
      ]
    `);
  });
});
