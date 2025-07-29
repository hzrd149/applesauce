import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "createATagFromAddressPointer",
        "createCommentTagsForEvent",
        "createCommentTagsFromCommentPointer",
        "createETagFromEventPointer",
        "createETagWithMarkerFromEventPointer",
        "createGroupHTagFromGroupPointer",
        "createGroupTagFromGroupPointer",
        "createPTagFromProfilePointer",
        "createQTagFromEventPointer",
        "ensureAddressPointerTag",
        "ensureEventPointerTag",
        "ensureKTag",
        "ensureMarkedAddressPointerTag",
        "ensureMarkedEventPointerTag",
        "ensureMarkedProfilePointerTag",
        "ensureNamedValueTag",
        "ensureProfilePointerTag",
        "ensureQuoteEventPointerTag",
        "ensureSingletonTag",
        "eventPipe",
        "fillAndTrimTag",
        "getContentPointers",
        "identity",
        "pipeFromAsyncArray",
        "skip",
        "tagPipe",
      ]
    `);
  });
});
