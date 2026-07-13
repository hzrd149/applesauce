import { kinds } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getReplaceableAddress, isEvent } from "../event.js";

const user = new FakeUser();

describe("getReplaceableAddress", () => {
  it("should return null for non-replaceable events", () => {
    const normalEvent = user.note("Hello world");

    expect(getReplaceableAddress(normalEvent)).toBeNull();
  });

  it("should return the correct address for replaceable events", () => {
    const replaceableEvent = user.event({
      kind: kinds.Metadata,
      content: JSON.stringify({ name: "Test User" }),
      tags: [],
    });

    const expectedAddress = `${kinds.Metadata}:${user.pubkey}:`;
    expect(getReplaceableAddress(replaceableEvent)).toBe(expectedAddress);
  });

  it("should include the identifier for addressable events", () => {
    const identifier = "test-profile";
    const addressableEvent = user.event({
      kind: 30000, // Parameterized replaceable event
      content: "Test content",
      tags: [["d", identifier]],
    });

    const expectedAddress = `30000:${user.pubkey}:${identifier}`;
    expect(getReplaceableAddress(addressableEvent)).toBe(expectedAddress);
  });
});

describe("isEvent", () => {
  const valid = user.note("gm");

  it("accepts a valid signed event", () => {
    expect(isEvent(valid)).toBe(true);
  });

  it("rejects null and undefined", () => {
    expect(isEvent(null)).toBe(false);
    expect(isEvent(undefined)).toBe(false);
  });

  it("rejects an event whose id is a non-string of length 64", () => {
    // event.id?.length === 64 matched any length-64 object, e.g. an array.
    expect(isEvent({ ...valid, id: new Array(64) })).toBe(false);
  });

  it("rejects a fractional or non-finite created_at", () => {
    expect(isEvent({ ...valid, created_at: 0.5 })).toBe(false);
    expect(isEvent({ ...valid, created_at: Infinity })).toBe(false);
  });
});
