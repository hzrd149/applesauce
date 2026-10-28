import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { getParsedContent, TextNoteContentSymbol } from "../content.js";
import { hashtags } from "../hashtag.js";

const user = new FakeUser();
const note = () => user.event({ content: "Hello #nostr", tags: [["t", "nostr"]] });

describe("getParsedContent", () => {
  it("should cache the default transformers under TextNoteContentSymbol", () => {
    const event = note();
    const root = getParsedContent(event);

    expect(Reflect.get(event, TextNoteContentSymbol)).toBe(root);
    expect(getParsedContent(event)).toBe(root);
  });

  it("should cache custom transformers separately from the default", () => {
    const event = note();
    const custom = [hashtags];
    const root = getParsedContent(event);

    expect(getParsedContent(event, undefined, custom)).not.toBe(root);
    expect(getParsedContent(event, undefined, custom)).toBe(getParsedContent(event, undefined, custom));
  });

  it("should not return the cached tree for a content override", () => {
    const event = note();
    getParsedContent(event);

    expect(getParsedContent(event, "Something else").children).toMatchObject([
      { type: "text", value: "Something else" },
    ]);
  });

  it("should use an explicit cache key", () => {
    const event = note();
    const key = Symbol("custom");
    const root = getParsedContent(event, undefined, [hashtags], key);

    expect(Reflect.get(event, key)).toBe(root);
  });
});
