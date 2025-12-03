import { describe, expect, it } from "vitest";
import { unixNow } from "../../helpers";
import { includeReplaceableIdentifier } from "../event.js";

describe("includeReplaceableIdentifier", () => {
  it("should not override existing identifier", () => {
    expect(
      includeReplaceableIdentifier()({ tags: [["d", "testing"]], content: "", created_at: unixNow(), kind: 30000 }, {}),
    ).toEqual(expect.objectContaining({ tags: expect.arrayContaining([["d", "testing"]]) }));
  });

  it("should add identifier tag", () => {
    expect(
      includeReplaceableIdentifier()(
        { tags: [["r", "https://eample.com"]], content: "", created_at: unixNow(), kind: 30000 },
        {},
      ),
    ).toEqual(expect.objectContaining({ tags: expect.arrayContaining([["d", expect.any(String)]]) }));
  });

  it("should not add identifier tag to non-replaceable events", () => {
    expect(
      includeReplaceableIdentifier()(
        { tags: [["r", "https://eample.com"]], content: "", created_at: unixNow(), kind: 1 },
        {},
      ),
    ).not.toEqual(expect.objectContaining({ tags: expect.arrayContaining([["d", expect.any(String)]]) }));
  });

  it("should not add identifier tag to replaceable events", () => {
    expect(
      includeReplaceableIdentifier()(
        { tags: [["r", "https://eample.com"]], content: "", created_at: unixNow(), kind: 10000 },
        {},
      ),
    ).not.toEqual(expect.objectContaining({ tags: expect.arrayContaining([["d", expect.any(String)]]) }));
  });
});
