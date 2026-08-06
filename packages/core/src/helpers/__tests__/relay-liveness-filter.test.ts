import { describe, expect, it } from "vitest";
import { firstValueFrom, of, Subject } from "rxjs";
import { classifyRelays, normalizeRelayUrl, removeDeadRelays } from "../relay-liveness-filter.js";
import { ignoreDeadRelays } from "../../observable/relay-selection.js";

describe("normalizeRelayUrl", () => {
  it("should strip trailing slash", () => {
    expect(normalizeRelayUrl("wss://relay.example.com/")).toBe("wss://relay.example.com");
  });

  it("should lowercase hostname", () => {
    expect(normalizeRelayUrl("wss://Relay.Example.COM")).toBe("wss://relay.example.com");
  });

  it("should upgrade ws to wss", () => {
    expect(normalizeRelayUrl("ws://relay.example.com")).toBe("wss://relay.example.com");
  });

  it("should upgrade http/https to wss", () => {
    expect(normalizeRelayUrl("https://relay.example.com")).toBe("wss://relay.example.com");
    expect(normalizeRelayUrl("http://relay.example.com")).toBe("wss://relay.example.com");
  });

  it("should return malformed URLs as-is", () => {
    expect(normalizeRelayUrl("not-a-url")).toBe("not-a-url");
  });

  it("should preserve paths beyond /", () => {
    expect(normalizeRelayUrl("wss://relay.example.com/nostr")).toBe("wss://relay.example.com/nostr");
  });
});

describe("classifyRelays", () => {
  it("should classify relay in alive set as alive", () => {
    const alive = new Set(["wss://relay.example.com"]);
    const result = classifyRelays(["wss://relay.example.com"], alive);
    expect(result.alive.has("wss://relay.example.com")).toBe(true);
    expect(result.dead).toEqual([]);
  });

  it("should classify relay not in alive set as dead (bench behavior, no monitoredRelays)", () => {
    const alive = new Set(["wss://alive.relay.com"]);
    const result = classifyRelays(["wss://dead.relay.com"], alive);
    expect(result.dead).toEqual(["wss://dead.relay.com"]);
    expect(result.alive.size).toBe(0);
  });

  it("should classify relay in monitoredRelays but not alive as dead", () => {
    const alive = new Set(["wss://alive.relay.com"]);
    const monitored = new Set(["wss://alive.relay.com", "wss://dead.relay.com"]);
    const result = classifyRelays(["wss://dead.relay.com"], alive, { monitoredRelays: monitored });
    expect(result.dead).toEqual(["wss://dead.relay.com"]);
  });

  it("should classify relay NOT in monitoredRelays as unmonitored (kept)", () => {
    const alive = new Set(["wss://alive.relay.com"]);
    const monitored = new Set(["wss://alive.relay.com"]);
    const result = classifyRelays(["wss://personal.relay.com"], alive, { monitoredRelays: monitored });
    expect(result.unmonitored).toEqual(["wss://personal.relay.com"]);
    expect(result.dead).toEqual([]);
  });

  it("should preserve .onion relays by default", () => {
    const alive = new Set(["wss://alive.relay.com"]);
    const result = classifyRelays(["wss://hidden.onion"], alive);
    expect(result.alive.has("wss://hidden.onion")).toBe(true);
    expect(result.onionPreserved).toBe(1);
  });

  it("should preserve .i2p relays by default", () => {
    const alive = new Set(["wss://alive.relay.com"]);
    const result = classifyRelays(["wss://hidden.i2p"], alive);
    expect(result.alive.has("wss://hidden.i2p")).toBe(true);
    expect(result.onionPreserved).toBe(1);
  });

  it("should not preserve .onion relays when preserveOnion is false", () => {
    const alive = new Set(["wss://alive.relay.com"]);
    const result = classifyRelays(["wss://hidden.onion"], alive, { preserveOnion: false });
    expect(result.alive.has("wss://hidden.onion")).toBe(false);
    expect(result.dead).toEqual(["wss://hidden.onion"]);
  });

  it("should preserve malformed URLs", () => {
    const alive = new Set(["wss://alive.relay.com"]);
    const result = classifyRelays(["not-a-url"], alive);
    expect(result.alive.has("not-a-url")).toBe(true);
    expect(result.malformedPreserved).toBe(1);
  });

  it("should classify all as alive when alive set is empty", () => {
    const alive = new Set<string>();
    const result = classifyRelays(["wss://r1.com", "wss://r2.com"], alive);
    expect(result.alive.size).toBe(2);
    expect(result.dead).toEqual([]);
  });

  it("should handle URL normalization mismatch (trailing slash)", () => {
    const alive = new Set(["wss://relay.example.com"]);
    const result = classifyRelays(["wss://relay.example.com/"], alive);
    expect(result.alive.has("wss://relay.example.com/")).toBe(true);
  });
});

describe("removeDeadRelays", () => {
  // Helper to build a set of N alive relays
  function makeAliveSet(n: number): Set<string> {
    const s = new Set<string>();
    for (let i = 0; i < n; i++) s.add(`wss://alive-${i}.relay.com`);
    return s;
  }

  it("should keep alive relays and remove dead ones", () => {
    const alive = makeAliveSet(200);
    alive.add("wss://keep.relay.com");

    const users = [
      { pubkey: "a", relays: ["wss://keep.relay.com", "wss://dead.relay.com"] },
    ];

    const result = removeDeadRelays(users, alive);
    expect(result[0].relays).toEqual(["wss://keep.relay.com"]);
  });

  it("should return users unchanged when alive set is empty (spec requirement 1)", () => {
    const users = [
      { pubkey: "a", relays: ["wss://r1.com", "wss://r2.com"] },
    ];
    const result = removeDeadRelays(users, new Set());
    expect(result).toBe(users); // same reference
  });

  it("should return users unchanged when alive set is below minAliveSetSize (rogue monitor)", () => {
    const alive = new Set(["wss://only-one.relay.com"]);
    const users = [
      { pubkey: "a", relays: ["wss://only-one.relay.com", "wss://r2.com"] },
    ];
    const result = removeDeadRelays(users, alive);
    expect(result).toBe(users); // same reference, no filtering
  });

  it("should filter when alive set meets custom minAliveSetSize", () => {
    const alive = new Set(["wss://r1.com", "wss://r2.com"]);
    const users = [
      { pubkey: "a", relays: ["wss://r1.com", "wss://dead.com"] },
    ];
    const result = removeDeadRelays(users, alive, { minAliveSetSize: 2 });
    expect(result[0].relays).toEqual(["wss://r1.com"]);
  });

  it("maxFilterRatio: user with 5 relays, 4 dead (4/5=0.8) → at threshold, filtered", () => {
    const alive = makeAliveSet(200);
    alive.add("wss://keep.relay.com");

    const users = [
      {
        pubkey: "a",
        relays: [
          "wss://keep.relay.com",
          "wss://dead1.com",
          "wss://dead2.com",
          "wss://dead3.com",
          "wss://dead4.com",
        ],
      },
    ];

    const result = removeDeadRelays(users, alive);
    // 4/5 = 0.8, NOT strictly greater than 0.8, so filtering applies
    expect(result[0].relays).toEqual(["wss://keep.relay.com"]);
  });

  it("maxFilterRatio: user with 5 relays, all 5 dead (5/5=1.0 > 0.8) → skipped", () => {
    const alive = makeAliveSet(200);

    const users = [
      {
        pubkey: "a",
        relays: [
          "wss://dead1.com",
          "wss://dead2.com",
          "wss://dead3.com",
          "wss://dead4.com",
          "wss://dead5.com",
        ],
      },
    ];

    const result = removeDeadRelays(users, alive);
    // 5/5 = 1.0 > 0.8, user keeps all relays
    expect(result[0].relays).toEqual(users[0].relays);
  });

  it("maxFilterRatio: user with 1 relay, relay dead (1/1=1.0 > 0.8) → skipped", () => {
    const alive = makeAliveSet(200);

    const users = [{ pubkey: "a", relays: ["wss://dead.com"] }];

    const result = removeDeadRelays(users, alive);
    // 1/1 = 1.0 > 0.8, user keeps their relay
    expect(result[0].relays).toEqual(["wss://dead.com"]);
  });

  it("should preserve unmonitored relays when monitoredRelays is provided", () => {
    const alive = makeAliveSet(200);
    alive.add("wss://alive.relay.com");
    const monitored = new Set(alive);
    monitored.add("wss://dead.relay.com");

    const users = [
      {
        pubkey: "a",
        relays: ["wss://alive.relay.com", "wss://dead.relay.com", "wss://personal.relay.com"],
      },
    ];

    const result = removeDeadRelays(users, alive, { monitoredRelays: monitored });
    expect(result[0].relays).toContain("wss://alive.relay.com");
    expect(result[0].relays).not.toContain("wss://dead.relay.com");
    expect(result[0].relays).toContain("wss://personal.relay.com");
  });

  it("should pass through users without relays unchanged", () => {
    const alive = makeAliveSet(200);
    const users = [
      { pubkey: "a" },
      { pubkey: "b", relays: [] as string[] },
    ];
    const result = removeDeadRelays(users, alive);
    expect(result[0].relays).toBeUndefined();
    expect(result[1].relays).toEqual([]);
  });

  it("should preserve .onion relays", () => {
    const alive = makeAliveSet(200);
    alive.add("wss://clearnet.relay.com");

    const users = [
      { pubkey: "a", relays: ["wss://clearnet.relay.com", "wss://hidden.onion"] },
    ];

    const result = removeDeadRelays(users, alive);
    expect(result[0].relays).toContain("wss://hidden.onion");
  });
});

describe("ignoreDeadRelays operator", () => {
  it("should work with a static Set input", async () => {
    const alive = new Set<string>();
    for (let i = 0; i < 200; i++) alive.add(`wss://alive-${i}.relay.com`);
    alive.add("wss://keep.relay.com");

    const users = [
      { pubkey: "a", relays: ["wss://keep.relay.com", "wss://dead.relay.com"] },
    ];

    const source = of(users);
    const result = await firstValueFrom(source.pipe(ignoreDeadRelays(alive)));
    expect(result[0].relays).toEqual(["wss://keep.relay.com"]);
  });

  it("should work with an Observable Set and not block (startWith empty)", async () => {
    const alive = new Set<string>();
    for (let i = 0; i < 200; i++) alive.add(`wss://alive-${i}.relay.com`);
    alive.add("wss://keep.relay.com");

    const users = [
      { pubkey: "a", relays: ["wss://keep.relay.com", "wss://dead.relay.com"] },
    ];

    // Subject that hasn't emitted yet
    const aliveSubject = new Subject<ReadonlySet<string>>();
    const source = of(users);

    // Should emit immediately with empty alive set (no filtering)
    const result = await firstValueFrom(source.pipe(ignoreDeadRelays(aliveSubject)));
    // Empty alive set = pass-through
    expect(result[0].relays).toEqual(["wss://keep.relay.com", "wss://dead.relay.com"]);
  });

  it("should pass through when alive set is empty", async () => {
    const users = [
      { pubkey: "a", relays: ["wss://r1.com", "wss://r2.com"] },
    ];

    const result = await firstValueFrom(of(users).pipe(ignoreDeadRelays(new Set())));
    expect(result[0].relays).toEqual(["wss://r1.com", "wss://r2.com"]);
  });
});
