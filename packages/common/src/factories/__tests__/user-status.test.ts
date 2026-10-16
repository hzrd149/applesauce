import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { UserStatusFactory } from "../user-status.js";

const user = new FakeUser();

describe("UserStatusFactory", () => {
  it("creates a general status", async () => {
    const event = await UserStatusFactory.create("general", "Working").link("https://nostr.world");
    expect(event.kind).toBe(30315);
    expect(event.content).toBe("Working");
    expect(event.tags).toEqual([
      ["d", "general"],
      ["r", "https://nostr.world"],
    ]);
  });

  it("creates a music status with an expiration", async () => {
    const event = await UserStatusFactory.music("Intergalatic - Beastie Boys", 1692845589);
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ["d", "music"],
        ["expiration", "1692845589"],
      ]),
    );
  });

  it("includes custom emoji tags", async () => {
    const emoji = { shortcode: "wave", url: "https://example.com/wave.png" };
    const event = await UserStatusFactory.create().status("Hi :wave:", [emoji]);
    expect(event.tags).toContainEqual(["emoji", "wave", "https://example.com/wave.png"]);
  });

  it("clears an existing status", async () => {
    const existing = user.event({
      kind: 30315,
      content: "Hi :wave:",
      tags: [
        ["d", "general"],
        ["r", "https://nostr.world"],
        ["emoji", "wave", "https://example.com/wave.png"],
        ["expiration", "1692845589"],
      ],
    });
    const event = await UserStatusFactory.modify(existing).clear();
    expect(event.content).toBe("");
    expect(event.tags).toEqual([["d", "general"]]);
  });
});
