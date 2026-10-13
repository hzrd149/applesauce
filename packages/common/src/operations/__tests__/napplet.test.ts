import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { NAPPLET_KIND, NAPPLET_ROOT_KIND, NAPPLET_SNAPSHOT_KIND } from "../../helpers/napplet.js";
import {
  addNappletArchetype,
  addNappletIntent,
  addNappletOptionalDomain,
  addNappletRequiredDomain,
  addNappletServer,
  removeNappletArchetype,
  removeNappletIntent,
  removeNappletOptionalDomain,
  removeNappletRequiredDomain,
  removeNappletServer,
  setNappletArtifactHash,
  setNappletDescription,
  setNappletIcon,
  setNappletIdentifier,
  setNappletParent,
  setNappletRoot,
  setNappletSource,
  setNappletTitle,
} from "../napplet.js";

const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";
const ICON = "ae7a3bd1a3fa9d824d0e64a6f57fe6cb4dd80c423786b6a2ecb94d587c94c75a";
const PUBKEY = "a".repeat(64);

function draft(tags: string[][] = [], kind: number = NAPPLET_KIND): EventTemplate {
  return { kind, content: "", tags, created_at: unixNow() };
}

describe("napplet operations", () => {
  it("sets single-value fields", async () => {
    let d = await setNappletIdentifier("feed")(draft());
    d = await setNappletArtifactHash(HASH)(d);
    d = await setNappletDescription("A feed viewer")(d);
    d = await setNappletTitle("Feed")(d);
    d = await setNappletSource("https://github.com/example/feed")(d);

    expect(d.content).toBe("A feed viewer");
    expect(d.tags).toEqual([
      ["d", "feed"],
      ["x", HASH],
      ["title", "Feed"],
      ["source", "https://github.com/example/feed"],
    ]);

    d = await setNappletTitle(null)(await setNappletSource(null)(d));
    expect(d.tags).toEqual([
      ["d", "feed"],
      ["x", HASH],
    ]);
  });

  it("replaces duplicate x tags and rejects invalid hashes", async () => {
    const d = await setNappletArtifactHash(HASH)(
      draft([
        ["x", "a"],
        ["x", "b"],
      ]),
    );
    expect(d.tags).toEqual([["x", HASH]]);
    expect(() => setNappletArtifactHash("abc")).toThrow();
    expect(() => setNappletArtifactHash(HASH.toUpperCase())).toThrow();
  });

  it("adds and removes repeatable fields", async () => {
    let d = await addNappletArchetype("feed")(draft());
    d = await addNappletArchetype("feed")(d);
    d = await addNappletIntent("napplet:feed/open")(d);
    d = await addNappletIntent("napplet:feed/edit", ["filters", "relays"])(d);
    d = await addNappletRequiredDomain("relay")(d);
    d = await addNappletOptionalDomain("theme")(d);
    d = await addNappletServer("https://blossom.example.com")(d);

    expect(d.tags).toEqual([
      ["z", "feed"],
      ["i", "napplet:feed/open"],
      ["i", "napplet:feed/edit", "filters", "relays"],
      ["R", "relay"],
      ["O", "theme"],
      ["server", "https://blossom.example.com"],
    ]);

    // Re-adding an intent replaces its params
    d = await addNappletIntent("napplet:feed/edit", ["filters"])(d);
    expect(d.tags).toContainEqual(["i", "napplet:feed/edit", "filters"]);

    d = await removeNappletArchetype("feed")(d);
    d = await removeNappletIntent("napplet:feed/open")(d);
    d = await removeNappletIntent("napplet:feed/edit")(d);
    d = await removeNappletRequiredDomain("relay")(d);
    d = await removeNappletOptionalDomain("theme")(d);
    d = await removeNappletServer("https://blossom.example.com")(d);
    expect(d.tags).toEqual([]);
  });

  it("sets and removes the icon", async () => {
    let d = await setNappletIcon(ICON, "image/webp")(draft());
    expect(d.tags).toEqual([["icon", ICON, "image/webp"]]);

    d = await setNappletIcon(null)(d);
    expect(d.tags).toEqual([]);
  });

  it("rejects unsupported icon types", () => {
    expect(() => setNappletIcon(ICON, "image/svg+xml" as any)).toThrow();
    expect(() => setNappletIcon(ICON)).toThrow();
    expect(() => setNappletIcon("abc", "image/png")).toThrow();
  });

  it("sets lineage tags with relay hints", async () => {
    let d = await setNappletParent({
      kind: NAPPLET_KIND,
      pubkey: PUBKEY,
      identifier: "feed",
      relays: ["wss://relay.example.com"],
    })(draft([], NAPPLET_SNAPSHOT_KIND));
    d = await setNappletRoot(`${NAPPLET_ROOT_KIND}:${PUBKEY}:`)(d);

    expect(d.tags).toEqual([
      ["a", `${NAPPLET_KIND}:${PUBKEY}:feed`, "wss://relay.example.com/"],
      ["A", `${NAPPLET_ROOT_KIND}:${PUBKEY}:`],
    ]);

    d = await setNappletRoot(null)(await setNappletParent(null)(d));
    expect(d.tags).toEqual([]);
  });

  it("rejects invalid lineage addresses", () => {
    expect(() => setNappletParent("not-an-address")).toThrow();
  });
});
