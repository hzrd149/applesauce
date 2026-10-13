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
import { RootNsiteFactory } from "../root-nsite.js";
import { NamedNsiteFactory } from "../named-nsite.js";
import { NsiteSnapshotFactory } from "../nsite-snapshot.js";

const user = new FakeUser();
const HASH = "a".repeat(64);
const files = [{ path: "/index.html", sha256: HASH }];

describe("nsite factories", () => {
  it("creates root and named manifests with aggregate hashes", async () => {
    const named = await NamedNsiteFactory.create("blog", files)
      .title("Blog")
      .description("A blog")
      .server("https://blossom.example.com")
      .source("https://example.com/src")
      .sign(user);
    const root = await RootNsiteFactory.create(files).sign(user);
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
    const original = await RootNsiteFactory.create(files).sign(user);
    const modified = await RootNsiteFactory.modify(original)
      .file("/about.html", "b".repeat(64))
      .removeFile("/index.html")
      .title("Updated")
      .sign(user);
    expect(modified.tags).toContainEqual(["path", "/about.html", "b".repeat(64)]);
    expect(verifyNsiteAggregateHash(modified)).toBe(true);
    expect(original.tags).toContainEqual(["path", "/index.html", HASH]);
  });
  it("snapshots a site with exactly its hash and no invented origin tag", async () => {
    const site = await NamedNsiteFactory.create("blog", files).sign(user);
    const snapshot = await NsiteSnapshotFactory.create(site).sign(user);
    expect(snapshot.kind).toBe(NSITE_SNAPSHOT_KIND);
    expect(snapshot.tags.find((t) => t[0] === "x")).toEqual(site.tags.find((t) => t[0] === "x"));
    expect(snapshot.tags.some((t) => t[0] === "A" || t[0] === "d")).toBe(false);
    expect(getNsiteParentPointer(snapshot)).toEqual({ kind: NSITE_KIND, pubkey: user.pubkey, identifier: "blog" });
    expect(isValidNsite(snapshot)).toBe(true);
    expect(() => NsiteSnapshotFactory.create(snapshot)).toThrow();
  });
  it("preserves the origin tag and relay hint across copies and snapshots", async () => {
    const author = new FakeUser();
    const origin = await RootNsiteFactory.create(files).sign(user);
    const rootPointer = {
      kind: NSITE_ROOT_KIND,
      pubkey: user.pubkey,
      identifier: "",
      relays: ["wss://relay.example.com"],
    };
    const copy = await NamedNsiteFactory.copy(origin, "copy").root(rootPointer).sign(author);
    const derived = await RootNsiteFactory.copy(copy).sign(new FakeUser());
    const snapshot = await NsiteSnapshotFactory.create(derived).sign(author);
    const originTag = copy.tags.find((t) => t[0] === "A");
    expect(derived.tags.find((t) => t[0] === "A")).toEqual(originTag);
    expect(snapshot.tags.find((t) => t[0] === "A")).toEqual(originTag);
    expect(getNsiteRootPointer(derived)).toEqual({ ...rootPointer, relays: ["wss://relay.example.com/"] });
    expect(getNsiteParentPointer(derived)?.pubkey).toBe(author.pubkey);
    for (const event of [copy, derived, snapshot]) expect(isValidNsite(event)).toBe(true);
  });
  it("rejects invalid sources and empty manifests", async () => {
    expect(() => RootNsiteFactory.create([])).toThrow();
    expect(() => NamedNsiteFactory.modify(user.note("hi"))).toThrow();
    expect(() => NamedNsiteFactory.copy(user.note("hi"))).toThrow();
    const unhashed = user.event({ kind: NSITE_ROOT_KIND, tags: [["path", "/index.html", HASH]] });
    expect(() => NsiteSnapshotFactory.create(unhashed)).toThrow();
  });

  it("only modifies the kind belonging to each factory", async () => {
    const root = await RootNsiteFactory.create(files).sign(user);
    const named = await NamedNsiteFactory.create("blog", files).sign(user);
    const snapshot = await NsiteSnapshotFactory.create(named).sign(user);
    const events = [root, named, snapshot];
    const factories = [RootNsiteFactory, NamedNsiteFactory, NsiteSnapshotFactory];
    for (const [index, factory] of factories.entries()) {
      for (const [eventIndex, event] of events.entries()) {
        if (index !== eventIndex) expect(() => factory.modify(event)).toThrow();
        else {
          const modified = await factory.modify(event).title("Updated").sign(user);
          expect(modified.kind).toBe(event.kind);
          expect(modified.tags).toContainEqual(["title", "Updated"]);
          expect(isValidNsite(modified)).toBe(true);
          expect(event.tags).not.toContainEqual(["title", "Updated"]);
        }
      }
      expect(() => factory.modify(user.note("hi"))).toThrow();
    }
  });
  it("only exposes identifiers on named factories", () => {
    expect(RootNsiteFactory.prototype).not.toHaveProperty("identifier");
    expect(NsiteSnapshotFactory.prototype).not.toHaveProperty("identifier");
    expect(NamedNsiteFactory.prototype).toHaveProperty("identifier");
  });

  it("copies into the explicit destination kind and rejects snapshot copies", async () => {
    const original = await NamedNsiteFactory.create("blog", files).sign(user);
    const snapshot = await NsiteSnapshotFactory.create(original).sign(user);
    const root = await RootNsiteFactory.copy(original).sign(user);
    const named = await NamedNsiteFactory.copy(original, "mirror").sign(user);
    expect(root.kind).toBe(NSITE_ROOT_KIND);
    expect(root.tags.some((tag) => tag[0] === "d")).toBe(false);
    expect(named.kind).toBe(NSITE_KIND);
    expect(named.tags).toContainEqual(["d", "mirror"]);
    for (const event of [root, named]) {
      expect(verifyNsiteAggregateHash(event)).toBe(true);
      expect(getNsiteParentPointer(event)?.identifier).toBe("blog");
      expect(getNsiteRootPointer(event)?.identifier).toBe("blog");
    }
    expect(() => RootNsiteFactory.copy(snapshot)).toThrow();
    expect(() => NamedNsiteFactory.copy(snapshot, "mirror")).toThrow();
  });
});
