import { buildEvent } from "applesauce-core/event-factory";
import { EncryptedContentSymbol, getHiddenTags, unixNow } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import { modifyHiddenTags } from "applesauce-core/operations/tags";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";

describe("modifyHiddenTags", () => {
  let user: FakeUser;

  beforeEach(() => {
    user = new FakeUser();
  });

  it("should not modify event if no operations are provided", async () => {
    const draft = {
      kind: kinds.BookmarkList,
      content: "original content",
      tags: [["p", "pubkey"]],
      created_at: unixNow(),
    };

    const operation = modifyHiddenTags();
    const result = await operation(draft, { signer: user });

    expect(result).toEqual(draft);
  });

  it("should set EncryptedContentSymbol with plaintext hidden tags", async () => {
    const operation = modifyHiddenTags((tags) => [...tags, ["e", "test-id"]]);
    const draft = await operation(
      { kind: kinds.BookmarkList, content: "", tags: [], created_at: unixNow() },
      { signer: user },
    );

    expect(Reflect.get(draft, EncryptedContentSymbol)).toBe(JSON.stringify([["e", "test-id"]]));
  });

  it("should not override existing EncryptedContentSymbol when modifying hidden tags", async () => {
    // First create a draft with hidden content symbol
    const draft = {
      kind: kinds.BookmarkList,
      content: "",
      tags: [],
      created_at: unixNow(),
      [EncryptedContentSymbol]: JSON.stringify([["e", "old-id"]]),
    };

    // Modify the hidden tags
    const operation = modifyHiddenTags((tags) => [...tags, ["e", "new-id"]]);
    const result = await operation(draft, { signer: user });

    expect(Reflect.get(result, EncryptedContentSymbol)).toBe(JSON.stringify([["e", "new-id"]]));
    expect(Reflect.get(result, EncryptedContentSymbol)).not.toBe(Reflect.get(draft, EncryptedContentSymbol));
  });

  it("should set hidden tags", async () => {
    const draft = await buildEvent(
      { kind: 30000 },
      { signer: user },
      modifyHiddenTags((tags) => [...tags, ["e", "test-id"]]),
    );

    expect(getHiddenTags(draft)).toEqual([["e", "test-id"]]);
  });

  it("should work multiple times", async () => {
    const draft = await buildEvent(
      { kind: 30000 },
      { signer: user },
      modifyHiddenTags((tags) => [...tags, ["e", "test-id"]]),
      modifyHiddenTags((tags) => [...tags, ["e", "second-id"]]),
    );

    expect(getHiddenTags(draft)).toEqual([
      ["e", "test-id"],
      ["e", "second-id"],
    ]);
  });
});
