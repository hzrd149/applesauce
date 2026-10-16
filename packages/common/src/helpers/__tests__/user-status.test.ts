import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getUserStatusPointer, getUserStatusType, isUserStatusCleared, isValidUserStatus } from "../user-status.js";

const user = new FakeUser();
const friend = new FakeUser();

describe("isValidUserStatus", () => {
  it("requires kind 30315 and a d tag", () => {
    expect(isValidUserStatus(user.event({ kind: 30315, tags: [["d", "general"]] }))).toBe(true);
    expect(isValidUserStatus(user.event({ kind: 30315, tags: [] }))).toBe(false);
    expect(isValidUserStatus(user.event({ kind: 1, tags: [["d", "general"]] }))).toBe(false);
  });
});

describe("getUserStatusType", () => {
  it("returns the d tag", () => {
    expect(getUserStatusType(user.event({ kind: 30315, tags: [["d", "music"]] }))).toBe("music");
  });
});

describe("isUserStatusCleared", () => {
  it("returns true for empty or whitespace content", () => {
    expect(isUserStatusCleared(user.event({ kind: 30315, content: "  ", tags: [["d", "general"]] }))).toBe(true);
    expect(isUserStatusCleared(user.event({ kind: 30315, content: "Working", tags: [["d", "general"]] }))).toBe(false);
  });
});

describe("getUserStatusPointer", () => {
  it("returns null when the status has no link", () => {
    expect(getUserStatusPointer(user.event({ kind: 30315, content: "Hiking", tags: [["d", "general"]] }))).toBe(null);
  });

  it("returns a url pointer for an r tag", () => {
    const status = user.event({
      kind: 30315,
      tags: [
        ["d", "general"],
        ["r", "https://nostr.world"],
      ],
    });
    expect(getUserStatusPointer(status)).toEqual({ type: "url", data: "https://nostr.world" });
  });

  it("prefers a p tag over an r tag", () => {
    const status = user.event({
      kind: 30315,
      tags: [
        ["d", "general"],
        ["r", "https://nostr.world"],
        ["p", friend.pubkey],
      ],
    });
    expect(getUserStatusPointer(status)).toEqual({ type: "nprofile", data: { pubkey: friend.pubkey } });
  });
});
