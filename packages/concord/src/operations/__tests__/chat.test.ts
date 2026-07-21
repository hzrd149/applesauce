import { describe, expect, it } from "vitest";

import { kinds } from "applesauce-core/helpers/event";
import { includeChannelBinding, includeMediaEncryption, includeMs } from "../channel.js";

const blank = (kind: number) => ({ kind, content: "", tags: [] as string[][], created_at: 0 });

describe("chat operations", () => {
  it("includeChannelBinding adds channel + epoch tags", async () => {
    const draft = await includeChannelBinding("chan", 3)(blank(kinds.ChatMessage));
    expect(draft.tags).toContainEqual(["channel", "chan"]);
    expect(draft.tags).toContainEqual(["epoch", "3"]);
  });

  it("includeMs adds an ms tag in [0,999]", async () => {
    const draft = await includeMs(12_345)(blank(kinds.ChatMessage));
    const ms = draft.tags.find((t) => t[0] === "ms")![1];
    expect(Number(ms)).toBe(345);
  });

  it("includeMs overrides created_at from the same single clock read (TIME-01)", async () => {
    // Choke point: bindToChannel/KickFactory/JoinLeaveFactory all chain
    // includeMs, so this override propagates to every consumer with no
    // further edits at their call sites.
    const value = 1_700_000_000_700;
    const draft = await includeMs(value)(blank(kinds.ChatMessage));
    const ms = draft.tags.find((t) => t[0] === "ms")![1];

    expect(draft.created_at).toBe(Math.floor(value / 1000));
    expect(draft.created_at * 1000 + Number(ms)).toBe(value);
  });

  describe("includeMediaEncryption", () => {
    const withImeta = (url: string) => ({
      kind: kinds.ChatMessage,
      content: "",
      created_at: 0,
      tags: [["imeta", `url ${url}`, "m image/png"]],
    });

    it("appends encryption fields to the matching imeta tag", async () => {
      const draft = await includeMediaEncryption([
        { url: "https://x/1", algorithm: "aes-gcm", key: "a".repeat(64), nonce: "b".repeat(32) },
      ])(withImeta("https://x/1"));

      const imeta = draft.tags.find((t) => t[0] === "imeta")!;
      expect(imeta).toContain(`decryption-key ${"a".repeat(64)}`);
      expect(imeta).toContain(`decryption-nonce ${"b".repeat(32)}`);
      expect(imeta).toContain("encryption-algorithm aes-gcm");
    });

    it("leaves non-matching imeta tags untouched", async () => {
      const draft = await includeMediaEncryption([
        { url: "https://other", algorithm: "aes-gcm", key: "a".repeat(64), nonce: "b".repeat(32) },
      ])(withImeta("https://x/1"));

      const imeta = draft.tags.find((t) => t[0] === "imeta")!;
      expect(imeta.some((p) => p.startsWith("decryption-key"))).toBe(false);
    });

    it("is a no-op with no entries", async () => {
      const input = withImeta("https://x/1");
      const draft = await includeMediaEncryption()(input);
      expect(draft.tags).toEqual(input.tags);
    });
  });
});
