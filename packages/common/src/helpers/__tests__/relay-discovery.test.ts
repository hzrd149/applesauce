import { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import {
  getRelayDiscoveryGeohash,
  getRelayDiscoveryGeohashes,
  getRelayDiscoveryTypes,
  RELAY_DISCOVERY_KIND,
} from "../relay-discovery.js";

function discovery(tags: string[][]): NostrEvent {
  return {
    id: "id",
    pubkey: "pubkey".padStart(64, "0"),
    sig: "sig".padStart(128, "0"),
    created_at: 1,
    kind: RELAY_DISCOVERY_KIND,
    content: "",
    tags: [["d", "wss://relay.example.com/"], ...tags],
  };
}

describe("getRelayDiscoveryTypes", () => {
  it("returns all T tag values", () => {
    expect(getRelayDiscoveryTypes(discovery([["T", "PublicOutbox"], ["T", "Search"], ["T"]]))).toEqual([
      "PublicOutbox",
      "Search",
    ]);
  });

  it("returns an empty array when there are no T tags", () => {
    expect(getRelayDiscoveryTypes(discovery([]))).toEqual([]);
  });
});

describe("getRelayDiscoveryGeohashes", () => {
  it("returns every g tag value", () => {
    const event = discovery([
      ["g", "u4pruy"],
      ["g", "u4pr"],
    ]);
    expect(getRelayDiscoveryGeohashes(event)).toEqual(["u4pruy", "u4pr"]);
    expect(getRelayDiscoveryGeohash(event)).toBe("u4pruy");
  });

  it("returns an empty array when there are no g tags", () => {
    expect(getRelayDiscoveryGeohashes(discovery([]))).toEqual([]);
  });
});
