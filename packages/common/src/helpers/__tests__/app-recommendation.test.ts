import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getRecommendationKind, getRecommendedHandlers, isValidAppRecommendation } from "../app-recommendation.js";

const user = new FakeUser();
const recommendation = user.event({
  kind: 31989,
  tags: [
    ["d", "31337"],
    ["a", `31990:${user.pubkey}:web-app`, "wss://relay.example.com", "web"],
    ["a", `31990:${user.pubkey}:bare`],
    ["a", `30023:${user.pubkey}:article`],
  ],
});

describe("app recommendation helpers", () => {
  it("validates the kind and numeric d tag", () => {
    expect(isValidAppRecommendation(recommendation)).toBe(true);
    expect(isValidAppRecommendation(user.event({ kind: 31989, tags: [["d", "notes"]] }))).toBe(false);
    expect(getRecommendationKind(recommendation)).toBe(31337);
  });
  it("returns only handler pointers with their platforms", () => {
    expect(getRecommendedHandlers(recommendation)).toEqual([
      {
        pointer: { kind: 31990, pubkey: user.pubkey, identifier: "web-app", relays: ["wss://relay.example.com/"] },
        platform: "web",
      },
      { pointer: { kind: 31990, pubkey: user.pubkey, identifier: "bare" } },
    ]);
  });
});
