import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { unixNow } from "../../helpers";
import { includeReplaceableIdentifier, stamp } from "../event.js";

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

describe("stamp", () => {
  it("should not mutate the caller's original draft (CR-05)", async () => {
    const user = new FakeUser();
    const signedEvent = user.note("hello world");

    // capture identity/values before calling stamp
    const originalId = signedEvent.id;
    const originalSig = signedEvent.sig;

    const result = await stamp(user)(signedEvent);

    // the caller's original object must retain id/sig — stamp must not mutate its input
    expect(signedEvent.id).toBe(originalId);
    expect(signedEvent.sig).toBe(originalSig);

    // the returned draft (the operation's own copy) has id/sig removed and the new pubkey
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("sig");
    expect(result.pubkey).toBe(user.pubkey);
  });
});
