import { describe, expect, it } from "vitest";
import { NostrEvent } from "applesauce-core/helpers/event";
import { getNutzapMint } from "../nutzap.js";

describe("getNutzapMint", () => {
  it("should return the mint URL", () => {
    const event = { tags: [["u", "https://mint.com"]] } as NostrEvent;
    expect(getNutzapMint(event)).toBe("https://mint.com");
  });

  it("should return undefined for invalid URL", () => {
    const event = { tags: [["u", "invalid"]] } as NostrEvent;
    expect(getNutzapMint(event)).toBeUndefined();
  });
});
