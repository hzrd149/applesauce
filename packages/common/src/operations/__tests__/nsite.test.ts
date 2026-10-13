import { EventTemplate } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { computeNsiteAggregateHash, NSITE_KIND, NSITE_ROOT_KIND } from "../../helpers/nsite.js";
import * as ops from "../nsite.js";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const PUBKEY = "c".repeat(64);
const address = `${NSITE_ROOT_KIND}:${PUBKEY}:`;
const draft = (tags: string[][] = []): EventTemplate => ({ kind: NSITE_KIND, created_at: 0, content: "", tags });

describe("nsite operations", () => {
  it("adds, replaces and removes files without mutating the draft", async () => {
    const input = draft([
      ["path", "/index.html", HASH],
      ["path", "/index.html", OTHER],
      ["title", "Site"],
    ]);
    const next = await ops.setNsiteFile("/index.html", OTHER)(input);
    expect(next.tags.filter((t) => t[0] === "path")).toEqual([["path", "/index.html", OTHER]]);
    expect(next.tags).toContainEqual(["x", computeNsiteAggregateHash(next), "aggregate"]);
    expect(input.tags).toHaveLength(3);
    expect(next.tags).toContainEqual(["title", "Site"]);
    const removed = await ops.removeNsiteFile("/index.html")(next);
    expect(removed.tags.some((t) => t[0] === "path")).toBe(false);
  });
  it.each([
    [ops.setNsiteTitle, "title"],
    [ops.setNsiteDescription, "description"],
    [ops.setNsiteSource, "source"],
  ])("sets, deduplicates and removes metadata", async (operation, name) => {
    const input = draft([
      [name, "old"],
      [name, "duplicate"],
    ]);
    expect((await operation("new")(input)).tags).toEqual([[name, "new"]]);
    expect((await operation(null)(input)).tags).toEqual([]);
  });
  it("sets identifiers only on named sites", async () => {
    expect(
      (
        await ops.setNsiteIdentifier("blog")(
          draft([
            ["d", "old"],
            ["d", "other"],
          ]),
        )
      ).tags,
    ).toEqual([["d", "blog"]]);
    expect(() => ops.setNsiteIdentifier("Bad")).toThrow();
    await expect(
      Promise.resolve().then(() => ops.setNsiteIdentifier("blog")({ ...draft(), kind: NSITE_ROOT_KIND })),
    ).rejects.toThrow();
  });
  it("adds and removes servers and app pointers", async () => {
    const server = "https://blossom.example.com";
    const app = { kind: 31990, pubkey: PUBKEY, identifier: "app", relays: ["wss://relay.example.com"] };
    const added = await ops.addNsiteApp(app)(await ops.addNsiteServer(server)(draft()));
    expect(added.tags).toContainEqual(["app", `31990:${PUBKEY}:app`, "wss://relay.example.com/"]);
    const removed = await ops.removeNsiteApp(app)(await ops.removeNsiteServer(server)(added));
    expect(removed.tags).toEqual([]);
  });
  it("sets and removes lineage without duplicate tags", async () => {
    for (const [op, name] of [
      [ops.setNsiteParent, "a"],
      [ops.setNsiteRoot, "A"],
    ] as const) {
      expect(
        (
          await op(address)(
            draft([
              [name, address],
              [name, address],
            ]),
          )
        ).tags,
      ).toEqual([[name, address]]);
      expect((await op(null)(draft([[name, address]]))).tags).toEqual([]);
      expect(() => op(`5128:${PUBKEY}:`)).toThrow();
    }
  });
  it("updates aggregate hashes and removes duplicate x tags", async () => {
    const input = draft([
      ["path", "/index.html", HASH],
      ["x", OTHER],
      ["x", OTHER],
    ]);
    expect((await ops.updateNsiteAggregateHash()(input)).tags.filter((t) => t[0] === "x")).toEqual([
      ["x", computeNsiteAggregateHash(input), "aggregate"],
    ]);
    expect((await ops.setNsiteAggregateHash(null)(input)).tags).toEqual([["path", "/index.html", HASH]]);
  });
  it("rejects invalid file mappings and pointers", () => {
    expect(() => ops.setNsiteFile("/index.html", "bad")).toThrow();
    expect(() => ops.setNsiteFile("index.html", HASH)).toThrow();
    expect(() => ops.setNsiteAggregateHash("bad")).toThrow();
    expect(() => ops.addNsiteApp(address)).toThrow();
    expect(() => ops.addNsiteApp({ kind: 31990, pubkey: "invalid", identifier: "app" })).toThrow();
    expect(() => ops.setNsiteParent("invalid")).toThrow();
  });
});
