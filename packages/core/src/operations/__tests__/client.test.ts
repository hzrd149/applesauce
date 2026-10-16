import { describe, expect, it } from "vitest";
import { kinds } from "../../helpers/event.js";
import { setClient } from "../client.js";

const pubkey = "a".repeat(64);
const draft = (kind: number, tags: string[][] = []) => ({ kind, content: "", tags, created_at: 0 });

describe("setClient", () => {
  it("adds a name-only client tag", async () => {
    expect((await setClient("app")(draft(kinds.ShortTextNote))).tags).toEqual([["client", "app"]]);
  });

  it("adds the handler address and a normalized relay hint", async () => {
    const result = await setClient("app", { pubkey, identifier: "x", relays: ["wss://relay.example.com"] })(draft(1));
    expect(result.tags).toEqual([
      ["client", "app", `${kinds.Handlerinformation}:${pubkey}:x`, "wss://relay.example.com/"],
    ]);
  });

  it("skips unsafe relay hints", async () => {
    const result = await setClient("app", { pubkey, identifier: "x", relays: ["http://bad"] })(draft(1));
    expect(result.tags).toEqual([["client", "app", `${kinds.Handlerinformation}:${pubkey}:x`]]);
  });

  it("never tags private message kinds", async () => {
    for (const kind of [kinds.EncryptedDirectMessage, kinds.Seal, kinds.PrivateDirectMessage, kinds.GiftWrap]) {
      expect((await setClient("app")(draft(kind))).tags).toEqual([]);
    }
  });

  it("only replaces an existing tag when replace is true", async () => {
    const existing = draft(1, [["client", "old"]]);
    expect((await setClient("app")(existing)).tags).toEqual([["client", "app"]]);
    expect((await setClient("app", undefined, false)(existing)).tags).toEqual([["client", "old"]]);
  });
});
