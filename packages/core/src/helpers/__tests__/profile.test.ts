import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { kinds } from "../event.js";
import { npubEncode } from "../pointers.js";
import { getDisplayName, ProfileContent } from "../profile.js";

const user = new FakeUser();
const event = user.profile({
  name: "Test User",
  display_name: "Test User",
  about: "Test User",
  picture: "https://example.com/picture.png",
});

describe("getDisplayName", () => {
  it("should return undefined when metadata is undefined and no fallback is provided", () => {
    expect(getDisplayName(undefined)).toBeUndefined();
  });

  it("should return fallback when metadata is undefined", () => {
    expect(getDisplayName(undefined, "fallback")).toBe("fallback");
  });

  it("should return display_name from ProfileContent", () => {
    const profile: ProfileContent = {
      display_name: "Display Name",
      name: "Name",
    };
    expect(getDisplayName(profile)).toBe("Display Name");
  });

  it("should return displayName from ProfileContent if display_name is not available", () => {
    const profile: ProfileContent = {
      displayName: "Display Name",
      name: "Name",
    };
    expect(getDisplayName(profile)).toBe("Display Name");
  });

  it("should return name from ProfileContent if display_name and displayName are not available", () => {
    const profile: ProfileContent = {
      name: "Name",
    };
    expect(getDisplayName(profile)).toBe("Name");
  });

  it("should return fallback if no name properties are available in ProfileContent", () => {
    const profile: ProfileContent = {
      about: "About me",
    };
    expect(getDisplayName(profile, "fallback")).toBe("fallback");
  });

  it("should trim the returned name", () => {
    const profile: ProfileContent = {
      name: "  Name with spaces  ",
    };
    expect(getDisplayName(profile)).toBe("Name with spaces");
  });

  it("should extract profile content from a valid profile event", () => {
    expect(getDisplayName(event)).toBe("Test User");
  });

  it("should use npub as fallback for invalid profile event", async () => {
    const npub = npubEncode(user.pubkey);
    const expectedFallback = `${npub.slice(0, 5 + 4)}…${npub.slice(-4)}`;

    expect(getDisplayName(user.profile({}))).toBe(expectedFallback);
  });

  it("should use provided fallback for invalid profile event", () => {
    const event = {
      kind: kinds.Metadata,
      pubkey: "pubkey123",
      id: "id123",
      sig: "sig123",
      created_at: 123,
      tags: [],
      content: "Invalid JSON",
    };
    expect(getDisplayName(event, "Custom Fallback")).toBe("Custom Fallback");
  });
});
