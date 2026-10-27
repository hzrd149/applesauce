import { firstValueFrom } from "rxjs";
import { EventStore } from "applesauce-core/event-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { RootNsiteFactory } from "../../factories/root-nsite.js";
import { NamedNsiteFactory } from "../../factories/named-nsite.js";
import { NsiteSnapshotFactory } from "../../factories/nsite-snapshot.js";
import { NSITE_ROOT_KIND } from "../../helpers/nsite.js";
import { NsiteModel, NsitesByHashModel, RootNsiteModel, UserNsitesModel } from "../nsite.js";

const user = new FakeUser();
const files = [{ path: "/index.html", sha256: "a".repeat(64) }];

describe("nsite models", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("resolves site and snapshot pointers and queries aggregate hashes", async () => {
    const store = new EventStore();
    const site = await NamedNsiteFactory.create("blog", files).sign(user);
    const snapshot = await NsiteSnapshotFactory.create(site).sign(user);
    store.add(site);
    store.add(snapshot);
    expect(
      (await firstValueFrom(store.model(NsiteModel, { kind: site.kind, pubkey: user.pubkey, identifier: "blog" })))?.id,
    ).toBe(site.id);
    expect((await firstValueFrom(store.model(NsiteModel, { id: snapshot.id })))?.id).toBe(snapshot.id);
    const hash = site.tags.find((tag) => tag[0] === "x")![1];
    expect((await firstValueFrom(store.model(NsitesByHashModel, hash))).map((event) => event.id).sort()).toEqual(
      [site.id, snapshot.id].sort(),
    );
  });
  it("reacts to replacements and filters malformed manifests", async () => {
    const store = new EventStore();
    const emissions: (string | undefined)[] = [];
    const subscription = store.model(RootNsiteModel, user.pubkey).subscribe((event) => emissions.push(event?.id));
    const root = await RootNsiteFactory.create(files).sign(user);
    store.add(root);
    const replacement = user.event({
      ...root,
      created_at: root.created_at + 1,
      tags: [...root.tags, ["title", "New"]],
    });
    store.add(replacement);
    expect(emissions).toEqual([undefined, root.id, replacement.id]);
    const invalid = user.event({ kind: NSITE_ROOT_KIND, tags: [], created_at: root.created_at + 2 });
    store.add(invalid);
    expect(emissions.at(-1)).toBeUndefined();
    subscription.unsubscribe();
  });
  it("reacts to new named sites and excludes snapshots and other authors", async () => {
    const store = new EventStore();
    const emissions: string[][] = [];
    const sub = store
      .model(UserNsitesModel, { pubkey: user.pubkey })
      .subscribe((events) => emissions.push(events.map((e) => e.id)));
    const site = await NamedNsiteFactory.create("blog", files).sign(user);
    store.add(site);
    store.add(await NsiteSnapshotFactory.create(site).sign(user));
    store.add(await RootNsiteFactory.create(files).sign(new FakeUser()));
    await vi.advanceTimersByTimeAsync(16);
    expect(emissions.at(-1)).toEqual([site.id]);
    sub.unsubscribe();
  });
});
