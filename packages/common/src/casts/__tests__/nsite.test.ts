import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { RootNsiteFactory } from "../../factories/root-nsite.js";
import { NamedNsiteFactory } from "../../factories/named-nsite.js";
import { NsiteSnapshotFactory } from "../../factories/nsite-snapshot.js";
import { BLOSSOM_SERVER_LIST_KIND } from "../../helpers/blossom.js";
import { COMMENT_KIND } from "../../helpers/comment.js";
import { NamedNsite, Nsite, NsiteSnapshot, RootNsite } from "../nsite.js";
import { Profile } from "../profile.js";
import { castUser } from "../user.js";

const user = new FakeUser();
const HASH = "a".repeat(64);
const files = [{ path: "/index.html", sha256: HASH }];
async function setup() {
  const store = new EventStore();
  const root = await RootNsiteFactory.create(files).sign(user);
  const named = await NamedNsiteFactory.create("blog", files)
    .title("Blog")
    .description("A blog")
    .server("https://hint.example.com")
    .app({ kind: 31990, pubkey: user.pubkey, identifier: "app", relays: ["wss://relay.example.com"] })
    .sign(user);
  const snapshot = await NsiteSnapshotFactory.create(named).sign(user);
  const copy = await NamedNsiteFactory.copy(named, "copy").sign(new FakeUser());
  for (const event of [root, named, snapshot, copy]) store.add(event);
  return { store, root, named, snapshot, copy };
}

describe("nsite casts", () => {
  it("validates generic and kind-specific casts", async () => {
    const { store, root, named, snapshot } = await setup();
    expect(() => new Nsite(user.note("hi"), store)).toThrow();
    expect(() => new RootNsite(named, store)).toThrow();
    expect(() => new NamedNsite(root, store)).toThrow();
    expect(() => new NsiteSnapshot(named, store)).toThrow();
    expect(new RootNsite(root, store).isRoot).toBe(true);
    expect(new NamedNsite(named, store).identifier).toBe("blog");
    expect(new NsiteSnapshot(snapshot, store).isSnapshot).toBe(true);
  });
  it("exposes file mappings, metadata, aggregate hashes and host URLs", async () => {
    const { store, named, snapshot, copy } = await setup();
    const site = new NamedNsite(named, store);
    expect(site.files).toEqual(files);
    expect(site.title).toBe("Blog");
    expect(site.description).toBe("A blog");
    expect(site.aggregateHash).toBe(site.computedAggregateHash);
    expect(site.resolvePath("/")?.sha256).toBe(HASH);
    expect(site.url("nsite.example").hostname).toBe(`${site.hostLabel}.nsite.example`);
    expect(site.address.startsWith("naddr1")).toBe(true);
    expect(new NsiteSnapshot(snapshot, store).address.startsWith("nevent1")).toBe(true);
    expect(await firstValueFrom(site.pointer$)).toMatchObject({ identifier: "blog" });
  });
  it("resolves snapshots, copies, parent and origin relationships", async () => {
    const { store, named, snapshot, copy } = await setup();
    const site = new NamedNsite(named, store);
    expect((await firstValueFrom(site.snapshots$)).map((s) => s.id)).toEqual([snapshot.id]);
    expect((await firstValueFrom(site.copies$)).map((s) => s.id)).toEqual([copy.id]);
    expect((await firstValueFrom(site.lineage$)).map((s) => s.id)).toEqual([copy.id]);
    const copied = new NamedNsite(copy, store);
    expect((await firstValueFrom(copied.parent$))?.id).toBe(named.id);
    expect((await firstValueFrom(copied.root$))?.id).toBe(named.id);
    expect((await firstValueFrom(new NsiteSnapshot(snapshot, store).parent$))?.id).toBe(named.id);
    expect(await firstValueFrom(site.root$)).toBeUndefined();
  });
  it("exposes upstream app pointers without resolving them", async () => {
    const { store, named } = await setup();
    expect(new NamedNsite(named, store).appPointers).toEqual([
      { kind: 31990, pubkey: user.pubkey, identifier: "app", relays: ["wss://relay.example.com/"] },
    ]);
  });
  it("merges manifest hints before the author's Blossom servers", async () => {
    const { store, named } = await setup();
    store.add(
      user.event({
        kind: BLOSSOM_SERVER_LIST_KIND,
        tags: [
          ["server", "https://author.example.com"],
          ["server", "https://hint.example.com"],
        ],
      }),
    );
    expect((await firstValueFrom(new Nsite(named, store).servers$)).map((s) => s.href)).toEqual([
      "https://hint.example.com/",
      "https://author.example.com/",
    ]);
  });
  it("augments User and Profile casts", async () => {
    const { store, root, named, snapshot } = await setup();
    const author = castUser(user.pubkey, store);
    expect((await firstValueFrom(author.nsite$))?.id).toBe(root.id);
    expect((await firstValueFrom(author.nsites$)).map((s) => s.id).sort()).toEqual([root.id, named.id].sort());
    expect((await firstValueFrom(author.nsiteSnapshots$)).map((s) => s.id)).toEqual([snapshot.id]);
    const profile = new Profile(user.event({ kind: 0, content: "{}" }), store);
    expect((await firstValueFrom(profile.nsite$))?.id).toBe(root.id);
    expect(await firstValueFrom(profile.nsites$)).toHaveLength(2);
  });
  it("resolves comments and exposes the other social relationships", async () => {
    const { store, named } = await setup();
    const site = new NamedNsite(named, store);
    const comment = user.event({
      kind: COMMENT_KIND,
      content: "Nice",
      tags: [
        ["A", site.coordinate],
        ["K", String(named.kind)],
        ["P", user.pubkey],
        ["a", site.coordinate],
        ["k", String(named.kind)],
        ["p", user.pubkey],
      ],
    });
    store.add(comment);
    expect((await firstValueFrom(site.comments$)).map((c) => c.id)).toEqual([comment.id]);
    for (const observable of [site.reactions$, site.shares$, site.zaps$])
      expect(await firstValueFrom(observable)).toEqual([]);
  });
});
