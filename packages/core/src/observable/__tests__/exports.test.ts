import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "BehaviorSubject",
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
        "includeMailboxes",
        "lastValueFrom",
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
