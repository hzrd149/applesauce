import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import * as nsite from "../nsite.js";

const user = new FakeUser();
const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const paths = [
  ["path", "/index.html", HASH],
  ["path", "/blog/post.html", OTHER],
];
const root = () => user.event({ kind: nsite.NSITE_ROOT_KIND, tags: paths });
const coordinate = `${nsite.NSITE_ROOT_KIND}:${user.pubkey}:`;

describe("nsite validation", () => {
  it("accepts root, named and snapshot manifests", () => {
    expect(nsite.isValidNsite(root())).toBe(true);
    expect(nsite.isValidNamedNsite(user.event({ kind: nsite.NSITE_KIND, tags: [...paths, ["d", "blog"]] }))).toBe(true);
    expect(
      nsite.isValidNsiteSnapshot(
        user.event({ kind: nsite.NSITE_SNAPSHOT_KIND, tags: [...paths, ["a", coordinate], ["x", HASH, "aggregate"]] }),
      ),
    ).toBe(true);
    expect(nsite.isValidNsite(undefined)).toBe(false);
    expect(nsite.isValidNsite(user.note("hi"))).toBe(false);
  });
  it.each(
    [
      [],
      [["path", "index.html", HASH]],
      [["path", "/index.html", "bad"]],
      [["path", "/index.html", HASH, "extra"]],
      [...paths, ["d", "bad"]],
      [...paths, ["x", HASH]],
      [...paths, ["x", HASH, "aggregate"], ["x", OTHER, "aggregate"]],
      [...paths, ["a", coordinate]],
      [...paths, ["A", coordinate]],
      [...paths, ["a", `1:${user.pubkey}:`], ["A", coordinate]],
    ].map((tags) => ({ tags })),
  )("rejects invalid root tags $tags", ({ tags }) => {
    expect(nsite.isValidNsite(user.event({ kind: nsite.NSITE_ROOT_KIND, tags }))).toBe(false);
  });
  it.each(["", "Bad", "blog-", "this-is-too-long", "foo.bar"])("rejects named identifier %s", (identifier) => {
    expect(nsite.isValidNsite(user.event({ kind: nsite.NSITE_KIND, tags: [...paths, ["d", identifier]] }))).toBe(false);
  });
  it("requires snapshot hash and parent but permits an absent origin", () => {
    for (const extra of [[], [["a", coordinate]], [["x", HASH, "aggregate"]]]) {
      expect(nsite.isValidNsite(user.event({ kind: nsite.NSITE_SNAPSHOT_KIND, tags: [...paths, ...extra] }))).toBe(
        false,
      );
    }
  });
  it("accepts copy lineage on root and named manifests", () => {
    const event = user.event({
      kind: nsite.NSITE_KIND,
      tags: [...paths, ["d", "copy"], ["a", coordinate, "wss://relay.example.com"], ["A", coordinate]],
    });
    expect(nsite.isValidNsite(event)).toBe(true);
    expect(nsite.getNsiteParentPointer(event)).toEqual({
      kind: nsite.NSITE_ROOT_KIND,
      pubkey: user.pubkey,
      identifier: "",
      relays: ["wss://relay.example.com/"],
    });
  });
});

describe("nsite manifest helpers", () => {
  it("parses and caches files, servers and app pointers", () => {
    const event = user.event({
      kind: nsite.NSITE_ROOT_KIND,
      tags: [
        ...paths,
        ["server", "https://blossom.example.com"],
        ["server"],
        ["app", `31990:${user.pubkey}:app`, "wss://relay.example.com"],
        ["app", "invalid"],
        ["title", "Site"],
        ["description", "Description"],
        ["source", "https://example.com/src"],
      ],
    });
    expect(nsite.getNsiteFiles(event)).toEqual([
      { path: "/index.html", sha256: HASH },
      { path: "/blog/post.html", sha256: OTHER },
    ]);
    expect(nsite.getNsiteFiles(event)).toBe(nsite.getNsiteFiles(event));
    expect(nsite.getNsiteServers(event)).toEqual(["https://blossom.example.com"]);
    expect(nsite.getNsiteAppPointers(event)).toHaveLength(1);
    expect(nsite.getNsiteAppPointers(event)).toBe(nsite.getNsiteAppPointers(event));
    expect(nsite.getNsiteTitle(event)).toBe("Site");
    expect(nsite.getNsiteDescription(event)).toBe("Description");
    expect(nsite.getNsiteSource(event)).toBe("https://example.com/src");
  });
  it("hashes exact sorted UTF-8 lines independently of other tags and order", () => {
    const expected = createHash("sha256").update(`${HASH} /index.html\n${OTHER} /blog/post.html\n`).digest("hex");
    expect(nsite.computeNsiteAggregateHash({ tags: paths })).toBe(expected);
    const event = user.event({
      kind: nsite.NSITE_ROOT_KIND,
      tags: [paths[1], ["app", "ignored"], paths[0], ["x", expected, "aggregate"]],
    });
    expect(nsite.verifyNsiteAggregateHash(event)).toBe(true);
    expect(nsite.getComputedNsiteAggregateHash(event)).toBe(expected);
    expect(nsite.computeNsiteAggregateHash({ tags: [...paths, paths[0]] })).not.toBe(expected);
    expect(nsite.verifyNsiteAggregateHash(root())).toBe(false);
  });
  it("resolves index pages and the not-found fallback", () => {
    const event = user.event({
      kind: nsite.NSITE_ROOT_KIND,
      tags: [...paths, ["path", "/blog/index.html", HASH], ["path", "/404.html", OTHER]],
    });
    expect(nsite.resolveNsitePath(event, "/")?.path).toBe("/index.html");
    expect(nsite.resolveNsitePath(event, "/blog/")?.path).toBe("/blog/index.html");
    expect(nsite.resolveNsitePath(event, "/blog")?.path).toBe("/blog/index.html");
    expect(nsite.resolveNsitePath(event, "/blog/post.html")?.sha256).toBe(OTHER);
    expect(nsite.resolveNsitePath(event, "/missing")?.path).toBe("/404.html");
    expect(nsite.resolveNsitePath(root(), "/missing")).toBeUndefined();
  });
});

describe("nsite canonical host labels", () => {
  it("round trips root, named and snapshot pointers", () => {
    const events = [
      root(),
      user.event({ kind: nsite.NSITE_KIND, tags: [...paths, ["d", "blog"]] }),
      user.event({ kind: nsite.NSITE_SNAPSHOT_KIND, tags: [...paths, ["a", coordinate], ["x", HASH, "aggregate"]] }),
    ];
    for (const event of events) {
      const label = nsite.getNsiteHostLabel(event);
      const pointer = nsite.parseNsiteHostLabel(label);
      expect(pointer).toEqual(
        event.kind === nsite.NSITE_SNAPSHOT_KIND
          ? { id: event.id }
          : { kind: event.kind, pubkey: event.pubkey, identifier: event.kind === nsite.NSITE_KIND ? "blog" : "" },
      );
      expect(nsite.getNsiteURL(event, "nsite.example").hostname).toBe(`${label}.nsite.example`);
    }
  });
  it("preserves leading zero keys with the fixed 50-character boundary", () => {
    const event = { ...root(), kind: nsite.NSITE_KIND, pubkey: "0".repeat(63) + "1", tags: [...paths, ["d", "blog"]] };
    expect(nsite.getNsiteHostLabel(event)).toBe("0".repeat(49) + "1blog");
    expect(nsite.parseNsiteHostLabel(nsite.getNsiteHostLabel(event))).toEqual({
      kind: nsite.NSITE_KIND,
      pubkey: event.pubkey,
      identifier: "blog",
    });
  });
  it.each(["invalid", "npub1invalid", "v" + "z".repeat(50), "z".repeat(50) + "blog", "0".repeat(50) + "blog-"])(
    "rejects invalid host label %s",
    (label) => {
      expect(nsite.parseNsiteHostLabel(label)).toBeUndefined();
    },
  );
});
