import { describe, it, expect } from "vitest";
import { decodeGroupPointer, encodeGroupPointer, GroupPointer } from "../groups.js";

describe("Group pointer utilities", () => {
  describe("decodeGroupPointer", () => {
    it("should decode a valid group pointer", () => {
      const pointer = decodeGroupPointer("relay.example.com'group123");
      expect(pointer).toEqual({
        relay: "wss://relay.example.com/",
        id: "group123",
      });
    });

    it("should add wss:// protocol if missing", () => {
      const pointer = decodeGroupPointer("relay.example.com'group123");
      expect(pointer.relay).toBe("wss://relay.example.com/");
    });

    it("should preserve existing protocol if present", () => {
      const pointer = decodeGroupPointer("wss://relay.example.com'group123");
      expect(pointer.relay).toBe("wss://relay.example.com/");

      const wsPointer = decodeGroupPointer("ws://relay.example.com'group123");
      expect(wsPointer.relay).toBe("ws://relay.example.com/");
    });

    it("should handle default group id", () => {
      const pointer = decodeGroupPointer("relay.example.com'");
      expect(pointer).toEqual({
        relay: "wss://relay.example.com/",
        id: "_",
      });
    });

    it("should throw error if relay is missing", () => {
      expect(() => decodeGroupPointer("'group123")).toThrow("Group pointer missing relay");
    });
  });

  describe("encodeGroupPointer", () => {
    it("should encode a valid group pointer", () => {
      const pointer: GroupPointer = {
        relay: "wss://relay.example.com",
        id: "group123",
      };
      expect(encodeGroupPointer(pointer)).toBe("relay.example.com'group123");
    });

    it("should strip protocol from relay", () => {
      const pointer: GroupPointer = {
        relay: "wss://relay.example.com",
        id: "group123",
      };
      expect(encodeGroupPointer(pointer)).toBe("relay.example.com'group123");

      const wsPointer: GroupPointer = {
        relay: "ws://relay.example.com",
        id: "group123",
      };
      expect(encodeGroupPointer(wsPointer)).toBe("relay.example.com'group123");
    });

    it("should handle invalid URLs by using the raw value", () => {
      const pointer: GroupPointer = {
        relay: "invalid-url",
        id: "group123",
      };
      expect(encodeGroupPointer(pointer)).toBe("invalid-url'group123");
    });
  });
});
