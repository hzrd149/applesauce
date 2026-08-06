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
        "catchErrorInline",
        "chainable",
        "combineLatest",
        "combineLatestBy",
        "combineLatestByIndex",
        "combineLatestByKey",
        "combineLatestByValue",
        "defined",
        "filterDuplicateEvents",
        "filterOptimalRelays",
        "filterRelaysPerAuthor",
        "firstValueFrom",
        "getObservableValue",
        "ignoreBlacklistedRelays",
        "includeFallbackRelays",
        "includeMailboxes",
        "lastValueFrom",
        "mapEventsToStore",
        "mapEventsToTimeline",
        "merge",
        "simpleTimeout",
        "timeoutWithIgnore",
        "watchEventUpdates",
        "watchEventsUpdates",
        "watchTimelineUpdates",
        "withImmediateValueOrDefault",
      ]
    `);
  });
});
