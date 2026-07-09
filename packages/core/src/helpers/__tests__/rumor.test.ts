import { describe, expect, it } from "vitest";
import { getEventHash, Rumor, verifyRumor } from "../event.js";

function buildRumor(overrides?: Partial<Rumor>): Rumor {
  const unsigned = {
    kind: 1,
    pubkey: "a".repeat(64),
    created_at: 1732999999,
    content: "hello rumor",
    tags: [],
  };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, ...overrides };
}

describe("verifyRumor", () => {
  it("should return true when the id matches the recomputed hash", () => {
    const rumor = buildRumor();
    expect(verifyRumor(rumor)).toBe(true);
  });

  it("should return false when the id does not match the recomputed hash", () => {
    const rumor = buildRumor({ id: "f".repeat(64) });
    expect(verifyRumor(rumor)).toBe(false);
  });
});
