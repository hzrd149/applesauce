import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getNsiteParentPointer,
  getNsiteRootPointer,
  isValidNsite,
  NSITE_KIND,
  NSITE_ROOT_KIND,
  NSITE_SNAPSHOT_KIND,
  verifyNsiteAggregateHash,
} from "../../helpers/nsite.js";
import { NsiteFactory } from "../nsite.js";

const user = new FakeUser();
const HASH = "a".repeat(64);
const files = [{ path: "/index.html", sha256: HASH }];

describe("NsiteFactory", () => {
  it("creates root and named manifests with aggregate hashes", async () => {
    const named = await NsiteFactory.create("blog", files)
      .title("Blog")
      .description("A blog")
      .server("https://blossom.example.com")
      .source("https://example.com/src")
      .sign(user);
    const root = await NsiteFactory.createRoot(files).sign(user);
    expect(named.kind).toBe(NSITE_KIND);
    expect(named.content).toBe("");
    expect(named.tags).toContainEqual(["description", "A blog"]);
    expect(root.kind).toBe(NSITE_ROOT_KIND);
    expect(root.tags.some((t) => t[0] === "d")).toBe(false);
    for (const event of [named, root]) {
      expect(isValidNsite(event)).toBe(true);
      expect(verifyNsiteAggregateHash(event)).toBe(true);
    }
  });
  it("modifies manifests with refreshed hashes", async () => {
    const original = await NsiteFactory.createRoot(files).sign(user);
    const modified = await NsiteFactory.modify(original)
      .file("/about.html", "b".repeat(64))
      .removeFile("/index.html")
      .title("Updated")
      .sign(user);
    expect(modified.tags).toContainEqual(["path", "/about.html", "b".repeat(64)]);
    expect(verifyNsiteAggregateHash(modified)).toBe(true);
    expect(original.tags).toContainEqual(["path", "/index.html", HASH]);
  });
  it("snapshots a site with exactly its hash and no invented origin tag", async () => {
    const site = await NsiteFactory.create("blog", files).sign(user);
    const snapshot = await NsiteFactory.snapshot(site).sign(user);
    expect(snapshot.kind).toBe(NSITE_SNAPSHOT_KIND);
    expect(snapshot.tags.find((t) => t[0] === "x")).toEqual(site.tags.find((t) => t[0] === "x"));
    expect(snapshot.tags.some((t) => t[0] === "A" || t[0] === "d")).toBe(false);
    expect(getNsiteParentPointer(snapshot)).toEqual({ kind: NSITE_KIND, pubkey: user.pubkey, identifier: "blog" });
    expect(isValidNsite(snapshot)).toBe(true);
    expect(() => NsiteFactory.snapshot(snapshot)).toThrow();
  });
  it("preserves the origin tag and relay hint across copies and snapshots", async () => {
    const author = new FakeUser();
    const origin = await NsiteFactory.createRoot(files).sign(user);
    const rootPointer = {
      kind: NSITE_ROOT_KIND,
      pubkey: user.pubkey,
      identifier: "",
      relays: ["wss://relay.example.com"],
    };
    const copy = await NsiteFactory.copy(origin, "copy").root(rootPointer).sign(author);
    const derived = await NsiteFactory.copy(copy).sign(new FakeUser());
    const snapshot = await NsiteFactory.snapshot(derived).sign(author);
    const originTag = copy.tags.find((t) => t[0] === "A");
    expect(derived.tags.find((t) => t[0] === "A")).toEqual(originTag);
    expect(snapshot.tags.find((t) => t[0] === "A")).toEqual(originTag);
    expect(getNsiteRootPointer(derived)).toEqual({ ...rootPointer, relays: ["wss://relay.example.com/"] });
    expect(getNsiteParentPointer(derived)?.pubkey).toBe(author.pubkey);
    for (const event of [copy, derived, snapshot]) expect(isValidNsite(event)).toBe(true);
  });
  it("rejects invalid sources and empty manifests", async () => {
    expect(() => NsiteFactory.createRoot([])).toThrow();
    expect(() => NsiteFactory.modify(user.note("hi"))).toThrow();
    expect(() => NsiteFactory.copy(user.note("hi"))).toThrow();
    const unhashed = user.event({ kind: NSITE_ROOT_KIND, tags: [["path", "/index.html", HASH]] });
    expect(() => NsiteFactory.snapshot(unhashed)).toThrow();
  });
});
