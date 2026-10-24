import { EventStore } from "applesauce-core/event-store";
import { lockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { NappletHandlersFactory } from "../../factories/napplet-handlers.js";
import { NappletHandlers } from "../napplet-handlers.js";
import { castUser } from "../user.js";

const user = new FakeUser();
const dev = new FakeUser();
const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";

function manifest(identifier: string) {
  return dev.event({
    kind: 35129,
    content: identifier,
    tags: [
      ["d", identifier],
      ["x", HASH],
      ["z", "profile"],
      ["i", "napplet:profile/edit"],
    ],
  });
}

async function setup() {
  const store = new EventStore();
  const editor = manifest("editor");
  const viewer = manifest("viewer");
  const snapshot = dev.event({ kind: 5129, content: "v1", tags: [["x", HASH]] });

  const preferences = await NappletHandlersFactory.create("profile")
    .as(user)
    .handler(viewer)
    .preferHandler(snapshot)
    .intentHandler("edit", editor, true)
    .sign();

  // The factory leaves the private entries unlocked, so lock them like a freshly loaded event
  lockHiddenTags(preferences);

  for (const event of [editor, viewer, snapshot, preferences]) store.add(event);
  return { store, editor, viewer, snapshot, preferences };
}

describe("NappletHandlers", () => {
  it("throws on invalid events", () => {
    expect(() => new NappletHandlers(user.note(), {} as any)).toThrow();
  });

  it("exposes the archetype and public entries", async () => {
    const { store, preferences } = await setup();
    const handlers = new NappletHandlers(preferences, store);

    expect(handlers.archetype).toBe("profile");
    expect(handlers.publicEntries.handlers.map((ref) => ref.type)).toEqual(["snapshot", "address"]);
    expect(handlers.hasHidden).toBe(true);
    expect(handlers.unlocked).toBe(false);
  });

  it("resolves handlers$ in preference order", async () => {
    const { store, preferences, snapshot, viewer } = await setup();
    const napplets = await firstValueFrom(new NappletHandlers(preferences, store).handlers$);

    expect(napplets.map((n) => n?.event.id)).toEqual([snapshot.id, viewer.id]);
  });

  it("includes private intent handlers in candidates$ after unlocking", async () => {
    const { store, preferences, editor, snapshot, viewer } = await setup();
    const handlers = new NappletHandlers(preferences, store);

    expect((await firstValueFrom(handlers.candidates$("edit"))).map((n) => n?.event.id)).toEqual([
      snapshot.id,
      viewer.id,
    ]);

    await handlers.unlock(user);
    expect(handlers.candidates("edit").map((c) => c.hidden)).toEqual([true, false, false]);
    expect((await firstValueFrom(handlers.candidates$("edit"))).map((n) => n?.event.id)).toEqual([
      editor.id,
      snapshot.id,
      viewer.id,
    ]);
  });

  it("does not resolve a pin to a replaceable manifest", async () => {
    const { store, viewer } = await setup();
    // Simulate a malformed pin of a named manifest id
    const event = user.event({
      kind: 31129,
      tags: [
        ["d", "profile"],
        ["e", viewer.id],
      ],
    });
    store.add(event);

    expect(await firstValueFrom(new NappletHandlers(event, store).handlers$)).toEqual([undefined]);
  });

  it("adds user preference observables", async () => {
    const { store, preferences } = await setup();
    const owner = castUser(user.pubkey, store);

    expect((await firstValueFrom(owner.nappletHandlers$)).map((h) => h.id)).toEqual([preferences.id]);
    expect((await firstValueFrom(owner.nappletHandlers("profile")))?.id).toBe(preferences.id);
    expect(await firstValueFrom(owner.nappletHandlers("feed"))).toBeUndefined();
  });
});
