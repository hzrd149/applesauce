import { describe, it, expect } from "vitest";
import { EventFactory } from "applesauce-core/event-factory";
import { ReactionBlueprint } from "../reaction.js";

describe("EventFactory", () => {
  const factory = new EventFactory();

  it('should include a "k" tag of event kind', async () => {
    expect(
      await factory.create(ReactionBlueprint, {
        kind: 1,
        content: "GM",
        tags: [],
        pubkey: "pubkey",
        created_at: 0,
        sig: "",
        id: "event-id",
      }),
      "+",
    ).toEqual(
      expect.objectContaining({
        kind: 7,
        content: "+",
        tags: [
          ["e", "event-id"],
          ["p", "pubkey"],
          ["k", "1"],
        ],
      }),
    );
  });

  it('should include an "a" tag for replacealbe events', async () => {
    expect(
      await factory.create(ReactionBlueprint, {
        kind: 30023,
        content: "long markdown article",
        tags: [["d", "hello-world"]],
        pubkey: "pubkey",
        created_at: 0,
        sig: "",
        id: "event-id",
      }),
      "+",
    ).toEqual(
      expect.objectContaining({
        kind: 7,
        content: "+",
        tags: [
          ["e", "event-id"],
          ["p", "pubkey"],
          ["a", "30023:pubkey:hello-world"],
          ["k", "30023"],
        ],
      }),
    );
  });

  it("should support custom emojis", async () => {
    expect(
      await factory.create(
        ReactionBlueprint,
        {
          kind: 1,
          content: "GM",
          tags: [],
          pubkey: "pubkey",
          created_at: 0,
          sig: "",
          id: "event-id",
        },
        {
          shortcode: "nostrudel",
          url: "https://cdn.hzrd149.com/303f018e613f29e3e43264529903b7c8c84debbd475f89368cb293ec23938981.png",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        kind: 7,
        content: ":nostrudel:",
        tags: [
          ["e", "event-id"],
          ["p", "pubkey"],
          ["k", "1"],
          [
            "emoji",
            "nostrudel",
            "https://cdn.hzrd149.com/303f018e613f29e3e43264529903b7c8c84debbd475f89368cb293ec23938981.png",
          ],
        ],
      }),
    );
  });

  it("should include relay hints", async () => {
    const factory = new EventFactory({
      getEventRelayHint: () => "wss://relay.example.com",
      getPubkeyRelayHint: () => "wss://user.example.com",
    });

    expect(
      await factory.create(ReactionBlueprint, {
        kind: 1,
        content: "GM",
        tags: [],
        pubkey: "pubkey",
        created_at: 0,
        sig: "",
        id: "event-id",
      }),
      "+",
    ).toEqual(
      expect.objectContaining({
        kind: 7,
        content: "+",
        tags: [
          ["e", "event-id", "wss://relay.example.com"],
          ["p", "pubkey", "wss://user.example.com"],
          ["k", "1"],
        ],
      }),
    );
  });
});
