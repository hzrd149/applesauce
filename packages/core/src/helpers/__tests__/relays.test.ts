import { describe, expect, it } from "vitest";
import { isSafeRelayURL, mergeRelaySets } from "../relays.js";

describe("isSafeRelayURL", () => {
  it("should correctly filter URLs", () => {
    // safe URLs
    expect(isSafeRelayURL("wss://relay.damus.io/")).toBe(true);
    expect(isSafeRelayURL("wss://nostrue.com")).toBe(true);
    expect(isSafeRelayURL("ws://192.168.0.194:8080")).toBe(true);
    expect(isSafeRelayURL("ws://localhost:4869/ws")).toBe(true);
    expect(isSafeRelayURL("ws://localhost/testing")).toBe(true);
    expect(isSafeRelayURL("ws://437fqnfqtcaquzvs5sd43ugznw7dsoatvtskoowgnpn6q5vqkljcrsyd.onion")).toBe(true);
    expect(isSafeRelayURL("ws://hypr1fk4trjnhjf62r6hhkpettmvxhxx2uvkkg4u4ea44va2fvxvfkl4s82m6dy.hyper")).toBe(true);

    // bad URLs
    expect(isSafeRelayURL("")).toBe(false);
    expect(isSafeRelayURL("bad")).toBe(false);
    expect(isSafeRelayURL("bad wss://nostr.wine")).toBe(false);
    expect(isSafeRelayURL("http://nostr.wine")).toBe(false);
    expect(isSafeRelayURL("http://cache-relay.com")).toBe(false);
    expect(isSafeRelayURL("wss://nostr.wine,wss://relayable.com")).toBe(false);
  });
});

describe("mergeRelaySets", () => {
  it("should merge arrays of relay URLs", () => {
    const result = mergeRelaySets(
      ["wss://relay.damus.io/", "wss://nostrue.com/"],
      ["wss://nostr.wine/", "wss://relayable.org/"],
    );

    expect(result).toHaveLength(4);
    expect(result).toContain("wss://relay.damus.io/");
    expect(result).toContain("wss://nostrue.com/");
    expect(result).toContain("wss://nostr.wine/");
    expect(result).toContain("wss://relayable.org/");
  });

  it("should handle single string URLs", () => {
    const result = mergeRelaySets("wss://relay.damus.io/", "wss://nostrue.com/");

    expect(result).toHaveLength(2);
    expect(result).toContain("wss://relay.damus.io/");
    expect(result).toContain("wss://nostrue.com/");
  });

  it("should remove duplicate URLs", () => {
    const result = mergeRelaySets(
      ["wss://relay.damus.io/", "wss://nostrue.com/"],
      ["wss://relay.damus.io/", "wss://nostr.wine/"],
      "wss://nostrue.com/",
    );

    expect(result).toHaveLength(3);
    expect(result).toContain("wss://relay.damus.io/");
    expect(result).toContain("wss://nostrue.com/");
    expect(result).toContain("wss://nostr.wine/");
  });

  it("should handle undefined values", () => {
    const result = mergeRelaySets(["wss://relay.damus.io/"], undefined, "wss://nostrue.com/", undefined, [
      "wss://nostr.wine/",
    ]);

    expect(result).toHaveLength(3);
    expect(result).toContain("wss://relay.damus.io/");
    expect(result).toContain("wss://nostrue.com/");
    expect(result).toContain("wss://nostr.wine/");
  });

  it("should handle empty arrays", () => {
    const result = mergeRelaySets([], ["wss://relay.damus.io/"], [], "wss://nostrue.com/");

    expect(result).toHaveLength(2);
    expect(result).toContain("wss://relay.damus.io/");
    expect(result).toContain("wss://nostrue.com/");
  });

  it("should ignore invalid URLs", () => {
    const result = mergeRelaySets(["wss://relay.damus.io/", "invalid-url", "not-a-url"], "wss://nostrue.com/", [
      "http://bad-protocol.com",
      "wss://nostr.wine/",
    ]);

    // Should only include valid websocket URLs
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("wss://relay.damus.io/");
    expect(result).toContain("wss://nostrue.com/");
    expect(result).toContain("wss://nostr.wine/");
    expect(result).not.toContain("invalid-url");
    expect(result).not.toContain("not-a-url");
    expect(result).not.toContain("http://bad-protocol.com");
  });

  it("should handle mixed iterables (Sets, arrays)", () => {
    const set1 = new Set(["wss://relay.damus.io/", "wss://nostrue.com/"]);
    const array1 = ["wss://nostr.wine/", "wss://relayable.org/"];

    const result = mergeRelaySets(set1, array1, "wss://example.com/");

    expect(result).toHaveLength(5);
    expect(result).toContain("wss://relay.damus.io/");
    expect(result).toContain("wss://nostrue.com/");
    expect(result).toContain("wss://nostr.wine/");
    expect(result).toContain("wss://relayable.org/");
    expect(result).toContain("wss://example.com/");
  });

  it("should normalize URLs (remove trailing slashes, etc.)", () => {
    const result = mergeRelaySets(["wss://relay.damus.io/", "wss://relay.damus.io"], "wss://nostrue.com/", [
      "wss://nostrue.com",
    ]);

    // Should deduplicate normalized URLs
    expect(result).toHaveLength(2);
    expect(result.some((url) => url.includes("relay.damus.io"))).toBe(true);
    expect(result.some((url) => url.includes("nostrue.com"))).toBe(true);
  });

  it("should handle no arguments", () => {
    const result = mergeRelaySets();

    expect(result).toEqual([]);
  });

  it("should handle only undefined arguments", () => {
    const result = mergeRelaySets(undefined, undefined, undefined);

    expect(result).toEqual([]);
  });

  it("should handle large number of arguments", () => {
    const args = [
      ["wss://relay1.com/"],
      "wss://relay2.com/",
      ["wss://relay3.com/", "wss://relay4.com/"],
      undefined,
      "wss://relay5.com/",
      new Set(["wss://relay6.com/", "wss://relay7.com/"]),
      [],
      "wss://relay8.com/",
    ];

    const result = mergeRelaySets(...args);

    expect(result).toHaveLength(8);
    for (let i = 1; i <= 8; i++) {
      expect(result).toContain(`wss://relay${i}.com/`);
    }
  });
});
