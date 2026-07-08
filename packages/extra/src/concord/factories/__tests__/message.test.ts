// A Concord channel message is now built with the applesauce-common
// `ChatMessageFactory` (kind 9, NIP-C7), bound to a channel with `bindToChannel`,
// and its imeta tags decorated with per-file encryption keys by
// `includeMediaEncryption`. These tests exercise that composition end to end.

import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { ChatMessageFactory } from "applesauce-common/factories";
import { PrivateKeySigner } from "applesauce-signers";
import { hexToBytes } from "@noble/hashes/utils.js";

import { KIND } from "../../types.js";
import { bindToChannel, includeMediaEncryption } from "../../operations/chat.js";
import { checkChatBinding } from "../../helpers/chat.js";
import { controlGroupKey } from "../../helpers/crypto.js";
import { createStreamEvent, decodeStreamEvent } from "../../stream.js";

describe("channel message composition", () => {
  it("binds channel/epoch, p-tags mentions, emoji-tags shortcodes", async () => {
    const emoji = { shortcode: "cat", url: "https://x/cat.png" };
    const message = await ChatMessageFactory.create(`hi nostr:${npub()} :cat:`, { emojis: [emoji] });
    const t = await bindToChannel("chan", 2)(message);

    expect(t.kind).toBe(KIND.MESSAGE);
    expect(checkChatBinding(t.tags, "chan", 2)).toBe(true);
    expect(t.tags.some((tag) => tag[0] === "p")).toBe(true);
    expect(t.tags).toContainEqual(["emoji", "cat", "https://x/cat.png"]);
  });

  it("adds a q reply tag, imeta tags, and per-file encryption", async () => {
    const message = await ChatMessageFactory.create("yo")
      .replyTo({ id: "e1", author: "a1" })
      .attachments([{ url: "https://x/1", type: "image/png" }]);
    let t = await bindToChannel("chan", 0)(message);
    t = await includeMediaEncryption([
      { url: "https://x/1", algorithm: "aes-gcm", key: "a".repeat(64), nonce: "b".repeat(32) },
    ])(t);

    expect(t.tags).toContainEqual(["q", "e1", "", "a1"]);
    const imeta = t.tags.find((tag) => tag[0] === "imeta")!;
    expect(imeta).toContain("url https://x/1");
    expect(imeta).toContain(`decryption-key ${"a".repeat(64)}`);
  });

  it("round-trips through the envelope", async () => {
    const author = new PrivateKeySigner(generateSecretKey());
    const authorPub = await author.getPublicKey();
    const key = controlGroupKey(hexToBytes("11".repeat(32)), hexToBytes("22".repeat(32)), 0);
    const { wrap, rumorId } = await createStreamEvent({
      streamSk: key.sk,
      convKey: key.convKey,
      author,
      rumor: await bindToChannel("chan", 0)(await ChatMessageFactory.create("hello")),
    });
    const dec = decodeStreamEvent(wrap, key.convKey);
    expect(dec).not.toBeNull();
    expect(dec!.author).toBe(authorPub);
    expect(dec!.rumor.id).toBe(rumorId);
    expect(dec!.rumor.content).toBe("hello");
    expect(checkChatBinding(dec!.rumor.tags, "chan", 0)).toBe(true);
  });
});

/** A throwaway npub for mention testing. */
function npub(): string {
  return "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m";
}
