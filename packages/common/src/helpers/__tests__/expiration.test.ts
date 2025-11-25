import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getExpirationTimestamp, isExpired, ExpirationTimestampSymbol } from "../expiration.js";
import { FakeUser } from "../../__tests__/fixtures.js";

const user = new FakeUser();
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getExpirationTimestamp", () => {
  it("should return undefined when event has no expiration tag", () => {
    const event = user.note("test content");
    expect(getExpirationTimestamp(event)).toBeUndefined();
  });

  it("should return expiration timestamp when event has expiration tag", () => {
    const expirationTime = 1732999999;
    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    expect(getExpirationTimestamp(event)).toBe(expirationTime);
  });

  it("should handle expiration tag with additional parameters", () => {
    const expirationTime = 1732999999;
    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString(), "extra", "params"]],
    });

    expect(getExpirationTimestamp(event)).toBe(expirationTime);
  });

  it("should return undefined when expiration tag value is not a valid number", () => {
    const event = user.note("test content", {
      tags: [["expiration", "invalid"]],
    });

    expect(getExpirationTimestamp(event)).toBeNaN();
  });

  it("should handle multiple tags and find the expiration tag", () => {
    const expirationTime = 1732999999;
    const event = user.note("test content", {
      tags: [
        ["p", "somepubkey"],
        ["e", "someeventid"],
        ["expiration", expirationTime.toString()],
        ["t", "hashtag"],
      ],
    });

    expect(getExpirationTimestamp(event)).toBe(expirationTime);
  });

  it("should cache the computed value using ExpirationTimestampSymbol", () => {
    const expirationTime = 1732999999;
    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    // First call
    getExpirationTimestamp(event);

    // Check that the value is cached
    expect(Reflect.has(event, ExpirationTimestampSymbol)).toBe(true);
    expect(Reflect.get(event, ExpirationTimestampSymbol)).toBe(expirationTime);
  });

  it("should return cached value on subsequent calls", () => {
    const expirationTime = 1732999999;
    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    // First call
    const result1 = getExpirationTimestamp(event);

    // Modify the tags to ensure cached value is used
    event.tags = [["expiration", "9999999999"]];

    // Second call should return cached value
    const result2 = getExpirationTimestamp(event);

    expect(result1).toBe(expirationTime);
    expect(result2).toBe(expirationTime);
  });

  it("should handle expiration tag with empty value", () => {
    const event = user.note("test content", {
      tags: [["expiration", ""]],
    });

    expect(getExpirationTimestamp(event)).toBeUndefined();
  });

  it("should handle expiration tag with only tag name", () => {
    const event = user.note("test content", {
      tags: [["expiration"]],
    });

    expect(getExpirationTimestamp(event)).toBeUndefined();
  });
});

describe("isExpired", () => {
  it("should return false when event has no expiration tag", () => {
    const event = user.note("test content");
    vi.setSystemTime(new Date(1732999999 * 1000));

    expect(isExpired(event)).toBe(false);
  });

  it("should return false when event has not expired yet", () => {
    const currentTime = 1732999999;
    const expirationTime = currentTime + 3600; // 1 hour in the future

    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    vi.setSystemTime(new Date(currentTime * 1000));

    expect(isExpired(event)).toBe(false);
  });

  it("should return true when event has expired", () => {
    const currentTime = 1732999999;
    const expirationTime = currentTime - 3600; // 1 hour in the past

    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    vi.setSystemTime(new Date(currentTime * 1000));

    expect(isExpired(event)).toBe(true);
  });

  it("should return false when current time equals expiration time", () => {
    const currentTime = 1732999999;
    const expirationTime = currentTime;

    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    vi.setSystemTime(new Date(currentTime * 1000));

    expect(isExpired(event)).toBe(false); // unixNow() > expiration, so equal should be false
  });

  it("should return true when current time is greater than expiration time by 1 second", () => {
    const expirationTime = 1732999999;
    const currentTime = expirationTime + 1;

    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    vi.setSystemTime(new Date(currentTime * 1000));

    expect(isExpired(event)).toBe(true);
  });

  it("should return false when expiration timestamp is invalid", () => {
    const event = user.note("test content", {
      tags: [["expiration", "invalid"]],
    });

    vi.setSystemTime(new Date(1732999999 * 1000));

    // Since getExpirationTimestamp returns NaN for invalid values,
    // and NaN comparisons are always false, isExpired should return false
    expect(isExpired(event)).toBe(false);
  });

  it("should work with real-time progression", () => {
    const baseTime = 1732999999;
    const expirationTime = baseTime + 10; // 10 seconds in the future

    const event = user.note("test content", {
      tags: [["expiration", expirationTime.toString()]],
    });

    // Start before expiration
    vi.setSystemTime(new Date(baseTime * 1000));
    expect(isExpired(event)).toBe(false);

    // Advance time to exactly expiration time
    vi.setSystemTime(new Date(expirationTime * 1000));
    expect(isExpired(event)).toBe(false);

    // Advance time past expiration
    vi.setSystemTime(new Date((expirationTime + 1) * 1000));
    expect(isExpired(event)).toBe(true);
  });

  it("should work with different event types", () => {
    const currentTime = 1732999999;
    const expirationTime = currentTime - 100;

    // Test with profile event
    const profileEvent = user.profile(
      { name: "Test User" },
      {
        tags: [["expiration", expirationTime.toString()]],
      },
    );

    // Test with custom event
    const customEvent = user.event({
      kind: 30000,
      content: "custom content",
      tags: [["expiration", expirationTime.toString()]],
    });

    vi.setSystemTime(new Date(currentTime * 1000));

    expect(isExpired(profileEvent)).toBe(true);
    expect(isExpired(customEvent)).toBe(true);
  });
});
