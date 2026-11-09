import { describe, expect, it } from "vitest";
import { buildNdrChatMessage, createStoredNdrMessage } from "../message.js";

describe("NDR custom emojis", () => {
  const emoji = {
    shortcode: "wave",
    url: "https://example.com/wave.png",
    address: { kind: 30030, pubkey: "a".repeat(64), identifier: "pack" },
  };

  it("preserves used emoji definitions alongside replies and attachments", async () => {
    const draft = await buildNdrChatMessage({
      content: ":wave: :unknown:",
      emojis: [emoji, { shortcode: "unused", url: "https://example.com/unused.png" }],
      replyTo: "parent",
      attachments: [{ url: "https://example.com/file" }],
    });
    expect(draft.content).toBe(":wave: :unknown:\nhttps://example.com/file");
    expect(draft.tags).toContainEqual(["e", "parent"]);
    expect(draft.tags.filter((tag) => tag[0] === "emoji")).toEqual([
      ["emoji", emoji.shortcode, emoji.url, `30030:${emoji.address.pubkey}:pack`],
    ]);

    const stored = createStoredNdrMessage(
      { ...draft, kind: 14, pubkey: "a".repeat(64), id: "message", created_at: 100 },
      { conversationId: "peer", sender: "a".repeat(64), delivery: "received" },
    );
    expect(stored.emojis).toEqual([emoji]);
    expect(stored.replyTo).toBe("parent");
    expect(stored.attachments?.[0].url).toBe("https://example.com/file");
  });

  it.each([undefined, []])("leaves undefined shortcodes as text (%s)", async (emojis) => {
    const draft = await buildNdrChatMessage({ content: ":wave:", emojis });
    expect(draft).toEqual({ content: ":wave:", tags: [] });
  });
});
