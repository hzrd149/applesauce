import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { COMMENT_KIND } from "../../helpers/comment.js";
import { NAPPLET_KIND, NAPPLET_ROOT_KIND, NAPPLET_SNAPSHOT_KIND } from "../../helpers/napplet.js";
import { NamedNapplet, Napplet, NappletSnapshot, RootNapplet } from "../napplet.js";
import { castUser } from "../user.js";

const user = new FakeUser();
const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";

function setup() {
  const store = new EventStore();
  const root = user.event({ kind: NAPPLET_ROOT_KIND, content: "Root", tags: [["x", HASH]] });
  const named = user.event({
    kind: NAPPLET_KIND,
    content: "A feed viewer",
    tags: [
      ["d", "feed"],
      ["x", HASH],
      ["title", "Feed"],
      ["z", "feed"],
      ["i", "napplet:feed/edit", "filters"],
      ["R", "relay"],
      ["O", "theme"],
    ],
  });
  const rootAddress = `${NAPPLET_ROOT_KIND}:${user.pubkey}:`;
  const namedAddress = `${NAPPLET_KIND}:${user.pubkey}:feed`;
  const snapshot = user.event({
    kind: NAPPLET_SNAPSHOT_KIND,
    content: "Feed v1",
    tags: [
      ["x", HASH],
      ["a", namedAddress],
      ["A", rootAddress],
    ],
  });
  for (const event of [root, named, snapshot]) store.add(event);
  return { store, root, named, snapshot };
}

describe("Napplet", () => {
  it("throws on invalid events", () => {
    expect(() => new Napplet(user.note("hi"), {} as any)).toThrow();
  });

  it("accepts every napplet kind", () => {
    const { store, root, named, snapshot } = setup();
    for (const event of [root, named, snapshot]) expect(new Napplet(event, store).artifactHash).toBe(HASH);
  });

  it("exposes manifest getters", () => {
    const { store, named } = setup();
    const napplet = new Napplet(named, store);

    expect(napplet.artifactHash).toBe(HASH);
    expect(napplet.title).toBe("Feed");
    expect(napplet.description).toBe("A feed viewer");
    expect(napplet.archetypes).toEqual(["feed"]);
    expect(napplet.intents).toEqual([{ intent: "napplet:feed/edit", params: ["filters"] }]);
    expect(napplet.requiredDomains).toEqual(["relay"]);
    expect(napplet.optionalDomains).toEqual(["theme"]);
    expect(napplet.isSnapshot).toBe(false);
    expect(napplet.isNamed).toBe(true);
    expect(napplet.address.startsWith("naddr1")).toBe(true);
  });

  it("uses an nevent for snapshots", () => {
    const { store, snapshot } = setup();
    const napplet = new Napplet(snapshot, store);

    expect(napplet.isSnapshot).toBe(true);
    expect(napplet.address.startsWith("nevent1")).toBe(true);
  });

  it("resolves comments$", async () => {
    const { store, named } = setup();
    const address = `${NAPPLET_KIND}:${user.pubkey}:feed`;
    const comment = user.event({
      kind: COMMENT_KIND,
      content: "nice",
      tags: [
        ["A", address],
        ["K", String(NAPPLET_KIND)],
        ["P", user.pubkey],
        ["a", address],
        ["k", String(NAPPLET_KIND)],
        ["p", user.pubkey],
      ],
    });
    store.add(comment);

    const comments = await firstValueFrom(new Napplet(named, store).comments$);
    expect(comments.map((c) => c.id)).toEqual([comment.id]);
  });
});

describe("RootNapplet", () => {
  it("only accepts kind 15129", () => {
    const { store, root, named } = setup();
    expect(new RootNapplet(root, store).isRoot).toBe(true);
    expect(() => new RootNapplet(named, store)).toThrow();
  });

  it("resolves lineage$ as snapshots", async () => {
    const { store, root, snapshot } = setup();
    const lineage = await firstValueFrom(new RootNapplet(root, store).lineage$);

    expect(lineage.map((s) => s.id)).toEqual([snapshot.id]);
    expect(lineage[0]).toBeInstanceOf(NappletSnapshot);
  });
});

describe("NamedNapplet", () => {
  it("only accepts kind 35129", () => {
    const { store, root } = setup();
    expect(() => new NamedNapplet(root, store)).toThrow();
  });

  it("exposes the identifier", () => {
    const { store, named } = setup();
    expect(new NamedNapplet(named, store).identifier).toBe("feed");
  });

  it("resolves snapshots$ as snapshots", async () => {
    const { store, named, snapshot } = setup();
    const snapshots = await firstValueFrom(new NamedNapplet(named, store).snapshots$);

    expect(snapshots.map((s) => s.id)).toEqual([snapshot.id]);
    expect(snapshots[0]).toBeInstanceOf(NappletSnapshot);
  });
});

describe("NappletSnapshot", () => {
  it("only accepts kind 5129", () => {
    const { store, named } = setup();
    expect(() => new NappletSnapshot(named, store)).toThrow();
  });

  it("resolves parent$ and root$", async () => {
    const { store, root, named, snapshot } = setup();
    const napplet = new NappletSnapshot(snapshot, store);

    expect(napplet.parentPointer?.identifier).toBe("feed");
    expect((await firstValueFrom(napplet.parent$))?.id).toBe(named.id);
    expect((await firstValueFrom(napplet.upstream$))?.id).toBe(named.id);
    expect((await firstValueFrom(napplet.root$))?.id).toBe(root.id);
  });
});

describe("User napplet getters", () => {
  it("resolves napplets$ and napplet$", async () => {
    const { store, root, named } = setup();
    const author = castUser(user.pubkey, store);

    const napplets = await firstValueFrom(author.napplets$);
    expect(napplets.map((n) => n.id).sort()).toEqual([root.id, named.id].sort());
    expect(await firstValueFrom(author.napplet$)).toBeInstanceOf(RootNapplet);
  });
});
