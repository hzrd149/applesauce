import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getForumThreadTitle, isValidForumThread } from "../forum-thread.js";

const user = new FakeUser();

describe("forum thread helpers", () => {
  it("isValidForumThread accepts kind 11", () => {
    expect(isValidForumThread(user.event({ kind: 11, content: "hi", tags: [["title", "GM"]] }))).toBe(true);
  });

  it("isValidForumThread rejects other kinds", () => {
    expect(isValidForumThread(user.event({ kind: 1, content: "hi", tags: [] }))).toBe(false);
  });

  it("getForumThreadTitle reads the title tag", () => {
    expect(getForumThreadTitle(user.event({ kind: 11, content: "", tags: [["title", "GM"]] }))).toBe("GM");
    expect(getForumThreadTitle(user.event({ kind: 11, content: "", tags: [] }))).toBeUndefined();
  });
});
