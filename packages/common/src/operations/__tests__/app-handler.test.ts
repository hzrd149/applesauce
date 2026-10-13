import { EventTemplate } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import * as handler from "../app-handler.js";
import * as recommendation from "../app-recommendation.js";

const PUBKEY = "c".repeat(64);
const draft = (kind: number, tags: string[][] = []): EventTemplate => ({ kind, created_at: 0, content: "", tags });

describe("app handler operations", () => {
  it("sets and clears metadata", async () => {
    const next = await handler.setHandlerMetadata({ name: "App" })(draft(31990));
    expect(JSON.parse(next.content)).toEqual({ name: "App" });
    expect((await handler.setHandlerMetadata(null)(next)).content).toBe("");
  });
  it("adds and removes kinds and links", async () => {
    let next = await handler.addHandlerKind(1)(draft(31990));
    next = await handler.setHandlerLink("web", "https://a.com/<bech32>", "nevent")(next);
    next = await handler.setHandlerLink("web", "https://b.com/<bech32>", "nevent")(next);
    next = await handler.setHandlerLink("web", "https://a.com/any/<bech32>")(next);
    expect(next.tags).toEqual([
      ["k", "1"],
      ["web", "https://b.com/<bech32>", "nevent"],
      ["web", "https://a.com/any/<bech32>"],
    ]);
    next = await handler.removeHandlerLink("web")(await handler.removeHandlerKind(1)(next));
    expect(next.tags).toEqual([["web", "https://b.com/<bech32>", "nevent"]]);
  });
  it("only accepts named nsites for latest and next", async () => {
    const next = await handler.setHandlerLatest(`35128:${PUBKEY}:app`)(draft(31990, [["latest", "old"]]));
    expect(next.tags).toEqual([["latest", `35128:${PUBKEY}:app`]]);
    expect((await handler.setHandlerLatest(null)(next)).tags).toEqual([]);
    expect(() => handler.setHandlerNext(`15128:${PUBKEY}:`)).toThrow();
  });
});

describe("app recommendation operations", () => {
  const address = `31990:${PUBKEY}:app`;
  it("adds handlers per platform and keeps the relay slot positional", async () => {
    let next = await recommendation.addRecommendedHandler(address, "web")(draft(31989));
    next = await recommendation.addRecommendedHandler(address, "ios")(next);
    next = await recommendation.addRecommendedHandler(address, "web")(next);
    expect(next.tags).toEqual([
      ["a", address, "", "ios"],
      ["a", address, "", "web"],
    ]);
    expect((await recommendation.removeRecommendedHandler(address, "ios")(next)).tags).toEqual([
      ["a", address, "", "web"],
    ]);
    expect((await recommendation.removeRecommendedHandler(address)(next)).tags).toEqual([]);
    expect(() => recommendation.addRecommendedHandler(`30023:${PUBKEY}:x`)).toThrow();
  });
});
