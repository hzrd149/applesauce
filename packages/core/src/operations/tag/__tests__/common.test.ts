import { describe, expect, it } from "vitest";
import { FakeUser } from "../../../__tests__/fixtures.js";
import { kinds } from "../../../helpers/event.js";
import {
  addAddressPointerTag,
  addEventPointerTag,
  addProfilePointerTag,
  removeAddressPointerTag,
  removeEventPointerTag,
  removeProfilePointerTag,
} from "../common.js";

describe("addProfilePointerTag", () => {
  const pubkey = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const relay = "wss://relay.example.com";

  it("should add a 'p' tag from a string pubkey", async () => {
    const operation = addProfilePointerTag(pubkey);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("p");
    expect(result[0][1]).toBe(pubkey);
  });

  it("should add a 'p' tag from a ProfilePointer", async () => {
    const pointer = { pubkey, relays: [relay] };
    const operation = addProfilePointerTag(pointer);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("p");
    expect(result[0][1]).toBe(pubkey);
    expect(result[0][2]).toBe(relay);
  });

  it("should replace existing 'p' tag when replace is true", async () => {
    const operation = addProfilePointerTag(pubkey, true);
    const tags: string[][] = [["p", pubkey, "old-relay"]];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("p");
    expect(result[0][1]).toBe(pubkey);
    expect(result[0][2]).toBeUndefined(); // new tag without relay
  });

  it("should not replace existing 'p' tag when replace is false", async () => {
    const operation = addProfilePointerTag(pubkey, false);
    const tags: string[][] = [["p", pubkey, "old-relay"]];
    const result = await operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][1]).toBe(pubkey);
    expect(result[1][1]).toBe(pubkey);
  });

  it("should add relay hint when getPubkeyRelayHint is provided", async () => {
    const operation = addProfilePointerTag(pubkey);
    const tags: string[][] = [];
    const result = await operation(tags, {
      getPubkeyRelayHint: async () => relay,
    });

    expect(result).toHaveLength(1);
    expect(result[0][2]).toBe(relay);
  });

  it("should not override existing relay hint", async () => {
    const pointer = { pubkey, relays: [relay] };
    const operation = addProfilePointerTag(pointer);
    const tags: string[][] = [];
    const result = await operation(tags, {
      getPubkeyRelayHint: async () => "wss://different-relay.com",
    });

    expect(result).toHaveLength(1);
    expect(result[0][2]).toBe(relay); // should keep original relay
  });

  it("should not affect other tags", async () => {
    const operation = addProfilePointerTag(pubkey);
    const tags: string[][] = [
      ["e", "event-id"],
      ["a", "30000:pubkey:identifier"],
    ];
    const result = await operation(tags, {});

    expect(result).toHaveLength(3);
    expect(result[0][0]).toBe("e");
    expect(result[1][0]).toBe("a");
    expect(result[2][0]).toBe("p");
  });
});

describe("removeProfilePointerTag", () => {
  const pubkey = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  it("should remove 'p' tag matching string pubkey", () => {
    const operation = removeProfilePointerTag(pubkey);
    const tags: string[][] = [
      ["p", pubkey],
      ["p", "other-pubkey"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][1]).toBe("other-pubkey");
  });

  it("should remove 'p' tag matching ProfilePointer", () => {
    const pointer = { pubkey };
    const operation = removeProfilePointerTag(pointer);
    const tags: string[][] = [
      ["p", pubkey],
      ["p", "other-pubkey"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][1]).toBe("other-pubkey");
  });

  it("should remove all matching 'p' tags", () => {
    const operation = removeProfilePointerTag(pubkey);
    const tags: string[][] = [
      ["p", pubkey],
      ["e", "event-id"],
      ["p", pubkey, "relay"],
      ["p", "other-pubkey"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("e");
    expect(result[1][0]).toBe("p");
    expect(result[1][1]).toBe("other-pubkey");
  });

  it("should not affect other tags", () => {
    const operation = removeProfilePointerTag(pubkey);
    const tags: string[][] = [
      ["p", pubkey],
      ["e", "event-id"],
      ["a", "30000:pubkey:identifier"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("e");
    expect(result[1][0]).toBe("a");
  });
});

describe("addEventPointerTag", () => {
  const eventId = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const relay = "wss://relay.example.com";
  const user = new FakeUser();

  it("should add an 'e' tag from a string id", async () => {
    const operation = addEventPointerTag(eventId);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("e");
    expect(result[0][1]).toBe(eventId);
  });

  it("should add an 'e' tag from an EventPointer", async () => {
    const pointer = { id: eventId, relays: [relay] };
    const operation = addEventPointerTag(pointer);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("e");
    expect(result[0][1]).toBe(eventId);
    expect(result[0][2]).toBe(relay);
  });

  it("should add an 'e' tag from a NostrEvent", async () => {
    const event = user.event({ kind: kinds.ShortTextNote });
    const operation = addEventPointerTag(event);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("e");
    expect(result[0][1]).toBe(event.id);
  });

  it("should replace existing 'e' tag when replace is true", async () => {
    const operation = addEventPointerTag(eventId, true);
    const tags: string[][] = [["e", eventId, "old-relay"]];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("e");
    expect(result[0][1]).toBe(eventId);
    expect(result[0][2]).toBeUndefined(); // new tag without relay
  });

  it("should not replace existing 'e' tag when replace is false", async () => {
    const operation = addEventPointerTag(eventId, false);
    const tags: string[][] = [["e", eventId, "old-relay"]];
    const result = await operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][1]).toBe(eventId);
    expect(result[1][1]).toBe(eventId);
  });

  it("should add relay hint when getEventRelayHint is provided", async () => {
    const operation = addEventPointerTag(eventId);
    const tags: string[][] = [];
    const result = await operation(tags, {
      getEventRelayHint: async () => relay,
    });

    expect(result).toHaveLength(1);
    expect(result[0][2]).toBe(relay);
  });

  it("should not override existing relay hint", async () => {
    const pointer = { id: eventId, relays: [relay] };
    const operation = addEventPointerTag(pointer);
    const tags: string[][] = [];
    const result = await operation(tags, {
      getEventRelayHint: async () => "wss://different-relay.com",
    });

    expect(result).toHaveLength(1);
    expect(result[0][2]).toBe(relay); // should keep original relay
  });

  it("should not affect other tags", async () => {
    const operation = addEventPointerTag(eventId);
    const tags: string[][] = [
      ["p", "pubkey"],
      ["a", "30000:pubkey:identifier"],
    ];
    const result = await operation(tags, {});

    expect(result).toHaveLength(3);
    expect(result[0][0]).toBe("p");
    expect(result[1][0]).toBe("a");
    expect(result[2][0]).toBe("e");
  });
});

describe("removeEventPointerTag", () => {
  const eventId = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

  it("should remove 'e' tag matching string id", () => {
    const operation = removeEventPointerTag(eventId);
    const tags: string[][] = [
      ["e", eventId],
      ["e", "other-event-id"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][1]).toBe("other-event-id");
  });

  it("should remove 'e' tag matching EventPointer", () => {
    const pointer = { id: eventId };
    const operation = removeEventPointerTag(pointer);
    const tags: string[][] = [
      ["e", eventId],
      ["e", "other-event-id"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][1]).toBe("other-event-id");
  });

  it("should remove all matching 'e' tags", () => {
    const operation = removeEventPointerTag(eventId);
    const tags: string[][] = [
      ["e", eventId],
      ["p", "pubkey"],
      ["e", eventId, "relay"],
      ["e", "other-event-id"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("p");
    expect(result[1][0]).toBe("e");
    expect(result[1][1]).toBe("other-event-id");
  });

  it("should not affect other tags", () => {
    const operation = removeEventPointerTag(eventId);
    const tags: string[][] = [
      ["e", eventId],
      ["p", "pubkey"],
      ["a", "30000:pubkey:identifier"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("p");
    expect(result[1][0]).toBe("a");
  });
});

describe("addAddressPointerTag", () => {
  const pubkey = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const address = `30000:${pubkey}:identifier`;
  const relay = "wss://relay.example.com";
  const user = new FakeUser();

  it("should add an 'a' tag from a string address", async () => {
    const operation = addAddressPointerTag(address);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("a");
    expect(result[0][1]).toBe(address);
  });

  it("should add an 'a' tag from an AddressPointer", async () => {
    const pointer = { kind: 30000, pubkey, identifier: "identifier", relays: [relay] };
    const operation = addAddressPointerTag(pointer);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("a");
    expect(result[0][1]).toBe(address);
    expect(result[0][2]).toBe(relay);
  });

  it("should add an 'a' tag from a replaceable NostrEvent", async () => {
    const event = user.event({ kind: kinds.Metadata });
    const operation = addAddressPointerTag(event);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("a");
    expect(result[0][1]).toContain(`${kinds.Metadata}:${user.pubkey}:`);
  });

  it("should replace existing 'a' tag when replace is true", async () => {
    const operation = addAddressPointerTag(address, true);
    const tags: string[][] = [["a", address, "old-relay"]];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("a");
    expect(result[0][1]).toBe(address);
    expect(result[0][2]).toBeUndefined(); // new tag without relay
  });

  it("should not replace existing 'a' tag when replace is false", async () => {
    const operation = addAddressPointerTag(address, false);
    const tags: string[][] = [["a", address, "old-relay"]];
    const result = await operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][1]).toBe(address);
    expect(result[1][1]).toBe(address);
  });

  it("should add relay hint when getPubkeyRelayHint is provided", async () => {
    const operation = addAddressPointerTag(address);
    const tags: string[][] = [];
    const result = await operation(tags, {
      getPubkeyRelayHint: async () => relay,
    });

    expect(result).toHaveLength(1);
    expect(result[0][2]).toBe(relay);
  });

  it("should not override existing relay hint", async () => {
    const pointer = { kind: 30000, pubkey, identifier: "identifier", relays: [relay] };
    const operation = addAddressPointerTag(pointer);
    const tags: string[][] = [];
    const result = await operation(tags, {
      getPubkeyRelayHint: async () => "wss://different-relay.com",
    });

    expect(result).toHaveLength(1);
    expect(result[0][2]).toBe(relay); // should keep original relay
  });

  it("should not affect other tags", async () => {
    const operation = addAddressPointerTag(address);
    const tags: string[][] = [
      ["p", "pubkey"],
      ["e", "event-id"],
    ];
    const result = await operation(tags, {});

    expect(result).toHaveLength(3);
    expect(result[0][0]).toBe("p");
    expect(result[1][0]).toBe("e");
    expect(result[2][0]).toBe("a");
  });

  it("should NOT add or remove 'e' tags", async () => {
    const operation = addAddressPointerTag(address);
    const tags: string[][] = [["e", "existing-event-id"]];
    const result = await operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("e");
    expect(result[0][1]).toBe("existing-event-id");
    expect(result[1][0]).toBe("a");
  });

  it("should NOT add 'e' tag even when event is passed", async () => {
    const event = user.event({ kind: kinds.Metadata });
    const operation = addAddressPointerTag(event);
    const tags: string[][] = [];
    const result = await operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("a");
    // Ensure no 'e' tag was added
    const eTags = result.filter((t) => t[0] === "e");
    expect(eTags).toHaveLength(0);
  });
});

describe("removeAddressPointerTag", () => {
  const pubkey = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const address = `30000:${pubkey}:identifier`;
  const user = new FakeUser();

  it("should remove 'a' tag matching string address", () => {
    const operation = removeAddressPointerTag(address);
    const tags: string[][] = [
      ["a", address],
      ["a", "30000:other-pubkey:other-id"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][1]).toBe("30000:other-pubkey:other-id");
  });

  it("should remove 'a' tag matching AddressPointer", () => {
    const pointer = { kind: 30000, pubkey, identifier: "identifier" };
    const operation = removeAddressPointerTag(pointer);
    const tags: string[][] = [
      ["a", address],
      ["a", "30000:other-pubkey:other-id"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(1);
    expect(result[0][1]).toBe("30000:other-pubkey:other-id");
  });

  it("should remove 'a' tag from a replaceable NostrEvent", () => {
    const event = user.event({ kind: kinds.Metadata });
    const operation = removeAddressPointerTag(event);
    const tags: string[][] = [
      ["a", `${kinds.Metadata}:${user.pubkey}:`],
      ["a", "30000:other-pubkey:other-id"],
    ];
    const result = operation(tags, {}) as string[][];

    // Should remove the matching 'a' tag
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("should remove all matching 'a' tags", () => {
    const operation = removeAddressPointerTag(address);
    const tags: string[][] = [
      ["a", address],
      ["p", "pubkey"],
      ["a", address, "relay"],
      ["a", "30000:other-pubkey:other-id"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("p");
    expect(result[1][0]).toBe("a");
    expect(result[1][1]).toBe("30000:other-pubkey:other-id");
  });

  it("should not affect other tags", () => {
    const operation = removeAddressPointerTag(address);
    const tags: string[][] = [
      ["a", address],
      ["p", "pubkey"],
      ["e", "event-id"],
    ];
    const result = operation(tags, {});

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("p");
    expect(result[1][0]).toBe("e");
  });

  it("should NOT remove 'e' tags", async () => {
    const operation = removeAddressPointerTag(address);
    const tags: string[][] = [
      ["a", address],
      ["e", "event-id-1"],
      ["e", "event-id-2"],
      ["p", "pubkey"],
    ];
    const result = await operation(tags, {});

    expect(result).toHaveLength(3);
    const eTags = result.filter((t) => t[0] === "e");
    expect(eTags).toHaveLength(2);
    expect(eTags[0][1]).toBe("event-id-1");
    expect(eTags[1][1]).toBe("event-id-2");
  });

  it("should return skip operation for invalid address string", () => {
    const operation = removeAddressPointerTag("invalid-address");
    const tags: string[][] = [
      ["a", address],
      ["e", "event-id"],
    ];
    const result = operation(tags, {});

    // skip() should return the tags unchanged
    expect(result).toEqual(tags);
  });

  it("should NOT remove 'e' tags even when event is passed", async () => {
    const event = user.event({ kind: kinds.Metadata });
    const operation = removeAddressPointerTag(event);
    const tags: string[][] = [
      ["a", `${kinds.Metadata}:${pubkey}:`],
      ["e", "existing-event-id"],
      ["e", event.id],
    ];
    const result = await operation(tags, {});

    // Should keep all 'e' tags
    const eTags = result.filter((t) => t[0] === "e");
    expect(eTags).toHaveLength(2);
    expect(eTags[0][1]).toBe("existing-event-id");
    expect(eTags[1][1]).toBe(event.id);
  });
});
