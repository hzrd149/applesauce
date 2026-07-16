import { kinds } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  EventUIDSymbol,
  fakeVerifyEvent,
  FromCacheSymbol,
  getEventUID,
  getReplaceableAddress,
  markFromCache,
  verifiedSymbol,
} from "../event.js";

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

describe("getEventUID (D-12 hot-path lift)", () => {
  it("writes the UID memo non-enumerable and a spread copy drops it", () => {
    const event = user.note("Hello world");
    const uid = getEventUID(event);
    expect(uid).toBe(event.id);

    const descriptor = Object.getOwnPropertyDescriptor(event, EventUIDSymbol);
    expect(descriptor?.enumerable).toBe(false);

    const copy = { ...event };
    expect(Object.prototype.hasOwnProperty.call(copy, EventUIDSymbol)).toBe(false);
  });
});

describe("fakeVerifyEvent", () => {
  it("marks the event verified non-enumerable and a spread copy drops it", () => {
    const event = user.note("Hello world");
    expect(fakeVerifyEvent(event)).toBe(true);

    const descriptor = Object.getOwnPropertyDescriptor(event, verifiedSymbol);
    expect(descriptor?.enumerable).toBe(false);

    const copy = { ...event };
    expect(Object.prototype.hasOwnProperty.call(copy, verifiedSymbol)).toBe(false);
  });
});

describe("markFromCache", () => {
  it("marks the event from-cache non-enumerable and a spread copy drops it", () => {
    const event = user.note("Hello world");
    markFromCache(event);

    const descriptor = Object.getOwnPropertyDescriptor(event, FromCacheSymbol);
    expect(descriptor?.enumerable).toBe(false);

    const copy = { ...event };
    expect(Object.prototype.hasOwnProperty.call(copy, FromCacheSymbol)).toBe(false);
  });
});
