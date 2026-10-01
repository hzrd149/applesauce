import { describe, expect, it } from "vitest";
import { selectOptimalRelays, selectRelaysPerAuthor } from "../relay-selection.js";

describe("selectOptimalRelays", () => {
  describe("count++ bug regression", () => {
    it("should enforce maxRelaysPerUser and remove users from pool after limit", () => {
      // User A has relays R1, R2, R3. With maxRelaysPerUser=2, after two of
      // their relays are selected, A should be removed from the pool so the
      // algorithm stops optimizing for A.
      const users = [
        { pubkey: "alice", relays: ["wss://r1/", "wss://r2/", "wss://r3/"] },
        { pubkey: "bob", relays: ["wss://r1/", "wss://r4/"] },
        { pubkey: "carol", relays: ["wss://r2/", "wss://r5/"] },
      ];

      const result = selectOptimalRelays(users, {
        maxConnections: 10,
        maxRelaysPerUser: 2,
      });

      // Alice should have at most 2 relays in the returned result
      const alice = result.find((u) => u.pubkey === "alice");
      expect(alice).toBeDefined();
      expect(alice!.relays!.length).toBeLessThanOrEqual(2);
      expect(alice!.relays!.length).toBeGreaterThan(0);
    });

    it("should cap returned relays per user even when more are globally selected", () => {
      // All 3 of alice's relays will be globally selected (each covers a unique user).
      // With maxRelaysPerUser=2, the output must still cap alice at 2.
      const users = [
        { pubkey: "alice", relays: ["wss://r1/", "wss://r2/", "wss://r3/"] },
        { pubkey: "bob", relays: ["wss://r1/"] },
        { pubkey: "carol", relays: ["wss://r2/"] },
        { pubkey: "dave", relays: ["wss://r3/"] },
      ];

      const result = selectOptimalRelays(users, {
        maxConnections: 10,
        maxRelaysPerUser: 2,
      });

      const alice = result.find((u) => u.pubkey === "alice");
      expect(alice!.relays!.length).toBeLessThanOrEqual(2);
    });

    it("should keep users in pool when under the limit", () => {
      const users = [
        { pubkey: "alice", relays: ["wss://r1/", "wss://r2/", "wss://r3/"] },
        { pubkey: "bob", relays: ["wss://r1/"] },
      ];

      const result = selectOptimalRelays(users, {
        maxConnections: 1,
        maxRelaysPerUser: 3,
      });

      // With maxConnections=1, only R1 should be selected (covers both users)
      const alice = result.find((u) => u.pubkey === "alice");
      expect(alice!.relays).toEqual(["wss://r1/"]);
    });
  });

  it("should select relays that cover the most users", () => {
    const users = [
      { pubkey: "a", relays: ["wss://popular/", "wss://rare/"] },
      { pubkey: "b", relays: ["wss://popular/"] },
      { pubkey: "c", relays: ["wss://popular/"] },
    ];

    const result = selectOptimalRelays(users, { maxConnections: 1 });

    // All users should have popular relay
    for (const user of result) {
      expect(user.relays).toContain("wss://popular/");
    }
  });

  it("should respect maxConnections", () => {
    const users = [
      { pubkey: "a", relays: ["wss://r1/", "wss://r2/", "wss://r3/"] },
    ];

    const result = selectOptimalRelays(users, { maxConnections: 2 });

    const selectedRelays = new Set(result.flatMap((u) => u.relays ?? []));
    expect(selectedRelays.size).toBeLessThanOrEqual(2);
  });

  it("should accept a custom score function", () => {
    const users = [
      { pubkey: "a", relays: ["wss://r1/", "wss://r2/"] },
      { pubkey: "b", relays: ["wss://r1/", "wss://r2/"] },
    ];

    // Force r2 to always win by giving it a high score
    const result = selectOptimalRelays(users, {
      maxConnections: 1,
      score: (relay) => (relay === "wss://r2/" ? 100 : 0),
    });

    for (const user of result) {
      if (user.relays && user.relays.length > 0) {
        expect(user.relays).toContain("wss://r2/");
        expect(user.relays).not.toContain("wss://r1/");
      }
    }
  });
});

describe("selectRelaysPerAuthor", () => {
  it("should select top-N relays per user", () => {
    const users = [
      { pubkey: "a", relays: ["wss://r1/", "wss://r2/", "wss://r3/"] },
      { pubkey: "b", relays: ["wss://r1/", "wss://r4/"] },
    ];

    const result = selectRelaysPerAuthor(users, { maxRelaysPerUser: 2 });

    for (const user of result) {
      expect(user.relays!.length).toBeLessThanOrEqual(2);
    }
  });

  it("should preserve users without relays", () => {
    const users = [
      { pubkey: "a", relays: ["wss://r1/"] },
      { pubkey: "b" },
      { pubkey: "c", relays: [] },
    ];

    const result = selectRelaysPerAuthor(users, { maxRelaysPerUser: 2 });

    expect(result.find((u) => u.pubkey === "b")!.relays).toBeUndefined();
    expect(result.find((u) => u.pubkey === "c")!.relays).toEqual([]);
  });

  it("should use coverage-based scoring by default", () => {
    // r1 is used by both users, r2 only by user a → r1 should score higher
    const users = [
      { pubkey: "a", relays: ["wss://r1/", "wss://r2/"] },
      { pubkey: "b", relays: ["wss://r1/"] },
    ];

    const result = selectRelaysPerAuthor(users, { maxRelaysPerUser: 1 });
    const userA = result.find((u) => u.pubkey === "a");
    expect(userA!.relays).toEqual(["wss://r1/"]);
  });

  it("should accept a custom score function", () => {
    const users = [
      { pubkey: "a", relays: ["wss://r1/", "wss://r2/", "wss://r3/"] },
    ];

    // Force r3 to always win
    const result = selectRelaysPerAuthor(users, {
      maxRelaysPerUser: 1,
      score: (relay) => (relay === "wss://r3/" ? 100 : 0),
    });

    expect(result[0].relays).toEqual(["wss://r3/"]);
  });

  it("should handle tie-breaking deterministically by URL", () => {
    const users = [
      { pubkey: "a", relays: ["wss://zzz/", "wss://aaa/"] },
    ];

    // Equal coverage, equal score → should sort by URL ascending
    const result = selectRelaysPerAuthor(users, {
      maxRelaysPerUser: 1,
      score: () => 0.5,
    });

    expect(result[0].relays).toEqual(["wss://aaa/"]);
  });
});
