import { describe, expect, it } from "vitest";
import { getContentWarning } from "../content";
import { FakeUser } from "../../__tests__/fixtures";

describe("getContentWarning", () => {
  const user = new FakeUser();

  it("should return false when no content-warning tag exists", () => {
    const event = user.event({
      tags: [
        ["p", "some-pubkey"],
        ["e", "some-event-id"],
      ],
      content: "test content",
    });

    const result = getContentWarning(event);
    expect(result).toBe(false);
  });

  it("should return true when content-warning tag exists without reason", () => {
    const event = user.event({
      tags: [["content-warning"], ["p", "some-pubkey"]],
      content: "test content",
    });

    const result = getContentWarning(event);
    expect(result).toBe(true);
  });

  it("should return true when content-warning tag exists with empty reason", () => {
    const event = user.event({
      tags: [
        ["content-warning", ""],
        ["p", "some-pubkey"],
      ],
      content: "test content",
    });

    const result = getContentWarning(event);
    expect(result).toBe(true);
  });

  it("should return the reason string when content-warning tag exists with reason", () => {
    const event = user.event({
      tags: [
        ["content-warning", "sensitive content"],
        ["p", "some-pubkey"],
      ],
      content: "test content",
    });

    const result = getContentWarning(event);
    expect(result).toBe("sensitive content");
  });

  it("should return the first content-warning tag when multiple exist", () => {
    const event = user.event({
      tags: [
        ["content-warning", "first warning"],
        ["content-warning", "second warning"],
        ["p", "some-pubkey"],
      ],
      content: "test content",
    });

    const result = getContentWarning(event);
    expect(result).toBe("first warning");
  });
});
