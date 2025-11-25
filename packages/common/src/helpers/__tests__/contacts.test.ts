import { describe, it, expect } from "vitest";
import { ProfilePointer } from "nostr-tools/nip19";
import { NostrEvent } from "applesauce-core/helpers/event";
import { mergeContacts, getRelaysFromContactsEvent } from "../contacts.js";

describe("mergeContacts", () => {
  it("should merge contacts and remove duplicates", () => {
    // Create some test profile pointers
    const pointer1: ProfilePointer = { pubkey: "pubkey1", relays: ["relay1"] };
    const pointer2: ProfilePointer = { pubkey: "pubkey2" }; // No relays
    const pointer3: ProfilePointer = { pubkey: "pubkey3", relays: ["relay3"] };
    const pointer4: ProfilePointer = { pubkey: "pubkey1" }; // Duplicate pubkey without relays

    // Test merging arrays of pointers
    const result1 = mergeContacts([pointer1, pointer2], [pointer3, pointer4]);

    // Should have 3 unique pubkeys
    expect(result1.length).toBe(3);

    // Check that the duplicate was handled correctly (last one should win)
    const pubkey1Entry = result1.find((p) => p.pubkey === "pubkey1");
    expect(pubkey1Entry).toBeDefined();
    expect(pubkey1Entry?.relays).toBeUndefined();

    // Test with undefined values
    const result2 = mergeContacts([pointer1], undefined, [pointer2, undefined]);
    expect(result2.length).toBe(2);

    // Test with single pointers
    const result3 = mergeContacts(pointer1, pointer2, pointer1);
    expect(result3.length).toBe(2);

    // Test with empty arrays
    const result4 = mergeContacts([], [pointer1], []);
    expect(result4.length).toBe(1);

    // Test with pointers that have and don't have relays
    const pointer5: ProfilePointer = { pubkey: "pubkey5", relays: ["relay5"] };
    const pointer6: ProfilePointer = { pubkey: "pubkey5" }; // Same pubkey without relays
    const result5 = mergeContacts([pointer5], [pointer6]);
    expect(result5.length).toBe(1);
    expect(result5[0].relays).toBeUndefined();
  });
});

describe("getRelaysFromContactsEvent", () => {
  const createMockEvent = (content: string): NostrEvent => ({
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 3,
    tags: [],
    content,
    sig: "test-sig",
  });

  it("should parse relay configuration with read and write flags", () => {
    const content = JSON.stringify({
      "wss://relay1.example.com": { read: true, write: true },
      "wss://relay2.example.com": { read: true, write: false },
      "wss://relay3.example.com": { read: false, write: true },
    });

    const event = createMockEvent(content);
    const result = getRelaysFromContactsEvent(event);

    expect(result).toBeInstanceOf(Map);
    expect(result?.size).toBe(3);
    expect(result?.get("wss://relay1.example.com")).toBe("all");
    expect(result?.get("wss://relay2.example.com")).toBe("inbox");
    expect(result?.get("wss://relay3.example.com")).toBe("outbox");
  });

  it("should handle empty relay configuration", () => {
    const content = JSON.stringify({});
    const event = createMockEvent(content);
    const result = getRelaysFromContactsEvent(event);

    expect(result).toBeInstanceOf(Map);
    expect(result?.size).toBe(0);
  });

  it("should return null for invalid JSON", () => {
    const event = createMockEvent("invalid json");
    const result = getRelaysFromContactsEvent(event);

    expect(result).toBeNull();
  });

  it("should return null for empty content", () => {
    const event = createMockEvent("");
    const result = getRelaysFromContactsEvent(event);

    expect(result).toBeNull();
  });

  it("should filter out relays with both read and write false", () => {
    const content = JSON.stringify({
      "wss://active-relay.example.com": { read: true, write: false },
      "wss://inactive-relay.example.com": { read: false, write: false },
    });

    const event = createMockEvent(content);
    const result = getRelaysFromContactsEvent(event);

    expect(result?.size).toBe(1);
    expect(result?.has("wss://active-relay.example.com")).toBe(true);
    expect(result?.has("wss://inactive-relay.example.com")).toBe(false);
  });
});
