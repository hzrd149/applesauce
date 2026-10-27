import { describe, expect, it } from "vitest";
import { npubEncode } from "applesauce-core/helpers";
import { WrappedMessageFactory } from "../wrapped-message.js";

describe("wrapped message recipient integrity", () => {
  it("preserves plaintext mentions without turning them into recipients on create, reply or text", async () => {
    const recipient = "1".repeat(64);
    const mentioned = "2".repeat(64);
    const content = `hello @${npubEncode(mentioned)} #private`;
    const factories = [
      WrappedMessageFactory.create(recipient, content),
      WrappedMessageFactory.reply("3".repeat(64), recipient, content),
      WrappedMessageFactory.create(recipient, "initial").text(content),
    ];
    for (const factory of factories) {
      const event = await factory;
      expect(event.content).toBe(content);
      expect(event.tags.filter((tag) => tag[0] === "p")).toEqual([["p", recipient]]);
    }
  });
});
