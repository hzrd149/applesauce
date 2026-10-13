import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getNappletParentPointer,
  getNappletRootPointer,
  isValidNapplet,
  NAPPLET_KIND,
  NAPPLET_ROOT_KIND,
  NAPPLET_SNAPSHOT_KIND,
} from "../../helpers/napplet.js";
import { RootNappletFactory } from "../root-napplet.js";
import { NamedNappletFactory } from "../named-napplet.js";
import { NappletSnapshotFactory } from "../napplet-snapshot.js";

const user = new FakeUser();
const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";
const NEXT = "ae7a3bd1a3fa9d824d0e64a6f57fe6cb4dd80c423786b6a2ecb94d587c94c75a";

describe("napplet factories", () => {
  it("creates a named napplet", async () => {
    const draft = await NamedNappletFactory.create("feed", HASH, "A feed viewer")
      .title("Feed")
      .archetype("feed")
      .intent("napplet:feed/edit", ["filters", "relays"])
      .requires("relay")
      .optional("theme")
      .icon(NEXT, "image/png")
      .server("https://blossom.example.com")
      .source("https://github.com/example/feed");

    expect(draft.kind).toBe(NAPPLET_KIND);
    expect(draft.content).toBe("A feed viewer");
    expect(draft.tags).toEqual([
      ["d", "feed"],
      ["x", HASH],
      ["title", "Feed"],
      ["z", "feed"],
      ["i", "napplet:feed/edit", "filters", "relays"],
      ["R", "relay"],
      ["O", "theme"],
      ["icon", NEXT, "image/png"],
      ["server", "https://blossom.example.com"],
      ["source", "https://github.com/example/feed"],
    ]);
  });

  it("creates a root napplet without a d tag", async () => {
    const event = await RootNappletFactory.create(HASH, "Root napplet").sign(user);

    expect(event.kind).toBe(NAPPLET_ROOT_KIND);
    expect(event.tags).toEqual([["x", HASH]]);
    expect(isValidNapplet(event)).toBe(true);
  });

  it("snapshots a named napplet with lineage", async () => {
    const named = await NamedNappletFactory.create("feed", HASH, "A feed viewer").archetype("feed").sign(user);
    const snapshot = await NappletSnapshotFactory.create(named).sign(user);
    const address = { kind: NAPPLET_KIND, pubkey: user.pubkey, identifier: "feed" };

    expect(snapshot.kind).toBe(NAPPLET_SNAPSHOT_KIND);
    expect(snapshot.content).toBe("A feed viewer");
    expect(snapshot.tags.some((t) => t[0] === "d")).toBe(false);
    expect(snapshot.tags).toContainEqual(["z", "feed"]);
    expect(isValidNapplet(snapshot)).toBe(true);
    expect(getNappletParentPointer(snapshot)).toEqual(address);
    expect(getNappletRootPointer(snapshot)).toEqual(address);
  });

  it("keeps the root when snapshotting a snapshot", async () => {
    const root = await RootNappletFactory.create(HASH, "Root").sign(user);
    const first = await NappletSnapshotFactory.create(root).sign(user);
    const second = await NappletSnapshotFactory.create(first).sign(user);
    const address = { kind: NAPPLET_ROOT_KIND, pubkey: user.pubkey, identifier: "" };

    expect(getNappletRootPointer(second)).toEqual(address);
    expect(getNappletParentPointer(second)).toEqual(address);
    expect(second.tags.filter((t) => t[0] === "A")).toHaveLength(1);
  });

  it("modifies an existing napplet", async () => {
    const named = await NamedNappletFactory.create("feed", HASH, "A feed viewer").archetype("feed").sign(user);
    const modified = await NamedNappletFactory.modify(named)
      .artifact(NEXT)
      .removeArchetype("feed")
      .title("Feed v2")
      .sign(user);

    expect(modified.tags).toEqual([
      ["d", "feed"],
      ["x", NEXT],
      ["title", "Feed v2"],
    ]);
    expect(isValidNapplet(modified)).toBe(true);
  });

  it("throws when modifying an invalid event", () => {
    expect(() => NamedNappletFactory.modify(user.note("hi"))).toThrow();
  });

  it("only modifies the kind belonging to each factory", async () => {
    const root = await RootNappletFactory.create(HASH, "Root").sign(user);
    const named = await NamedNappletFactory.create("feed", HASH, "Feed").sign(user);
    const snapshot = await NappletSnapshotFactory.create(named).sign(user);
    const events = [root, named, snapshot];
    const factories = [RootNappletFactory, NamedNappletFactory, NappletSnapshotFactory];
    for (const [index, factory] of factories.entries()) {
      for (const [eventIndex, event] of events.entries()) {
        if (index !== eventIndex) expect(() => factory.modify(event)).toThrow();
        else {
          const modified = await factory.modify(event).title("Updated").sign(user);
          expect(modified.kind).toBe(event.kind);
          expect(modified.tags).toContainEqual(["title", "Updated"]);
          expect(isValidNapplet(modified)).toBe(true);
          expect(event.tags).not.toContainEqual(["title", "Updated"]);
        }
      }
      expect(() => factory.modify(user.note("hi"))).toThrow();
    }
  });
  it("only exposes identifiers on named factories", () => {
    expect(RootNappletFactory.prototype).not.toHaveProperty("identifier");
    expect(NappletSnapshotFactory.prototype).not.toHaveProperty("identifier");
    expect(NamedNappletFactory.prototype).toHaveProperty("identifier");
  });
});
