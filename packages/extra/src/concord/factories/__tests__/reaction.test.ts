// A Concord channel reaction is the applesauce-common `ReactionFactory` (kind 7,
// NIP-25) bound to a channel with `bindToChannel`.

import { describe, expect, it } from "vitest";
import { ReactionFactory } from "applesauce-common/factories";

import { KIND } from "../../types.js";
import { bindToChannel } from "../../operations/chat.js";

const target = { id: "e", pubkey: "a", kind: KIND.MESSAGE };

describe("channel reaction composition", () => {
  it("handles a plain emoji and binds to the channel", async () => {
    const t = await bindToChannel("chan", 0)(await ReactionFactory.create(target, "+"));
    expect(t.kind).toBe(KIND.REACTION);
    expect(t.content).toBe("+");
    expect(t.tags).toContainEqual(["e", "e"]);
    expect(t.tags).toContainEqual(["p", "a"]);
    expect(t.tags).toContainEqual(["k", String(KIND.MESSAGE)]);
    expect(t.tags).toContainEqual(["channel", "chan"]);
  });

  it("handles a custom emoji", async () => {
    const t = await bindToChannel("chan", 0)(
      await ReactionFactory.create(target, { shortcode: "party", url: "https://x/p.png" }),
    );
    expect(t.content).toBe(":party:");
    expect(t.tags).toContainEqual(["emoji", "party", "https://x/p.png"]);
  });
});
