import { kinds } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  EventUIDSymbol,
  fakeVerifyEvent,
  FromCacheSymbol,
  getEventUID,
  getReplaceableAddress,
  isEvent,
  isRumor,
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

describe("isEvent / isRumor field validation", () => {
  // A malformed event can never hash or verify correctly, so the guards reject it on shape
  // instead of leaving every consumer to do its own ad-hoc validation (upstream issue #60)
  const validEvent = user.note("Hello world");

  const baseRumor = {
    id: "a".repeat(64),
    pubkey: user.pubkey,
    created_at: 1700000000,
    kind: kinds.ShortTextNote,
    tags: [] as string[][],
    content: "Hello world",
  };

  it("accepts well-formed events and rumors", () => {
    expect(isEvent(validEvent)).toBe(true);
    expect(isRumor(baseRumor)).toBe(true);
  });

  it.each([
    ["non-hex id", { ...baseRumor, id: "z".repeat(64) }],
    ["short id", { ...baseRumor, id: "a".repeat(63) }],
    ["uppercase id", { ...baseRumor, id: "A".repeat(64) }],
    ["non-hex pubkey", { ...baseRumor, pubkey: "g".repeat(64) }],
    ["uppercase pubkey", { ...baseRumor, pubkey: user.pubkey.toUpperCase() }],
  ])("rejects a rumor with a %s", (_name, rumor) => {
    expect(isRumor(rumor)).toBe(false);
  });

  it.each([
    ["non-hex id", { ...validEvent, id: "z".repeat(64) }],
    ["uppercase id", { ...validEvent, id: validEvent.id.toUpperCase() }],
    ["non-hex pubkey", { ...validEvent, pubkey: "g".repeat(64) }],
    ["short signature", { ...validEvent, sig: "0".repeat(127) }],
    ["non-hex signature", { ...validEvent, sig: "h".repeat(128) }],
    ["missing signature", { ...validEvent, sig: undefined }],
  ])("rejects an event with a %s", (_name, event) => {
    expect(isEvent(event)).toBe(false);
  });
});
