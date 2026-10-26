import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { NappletHandlersFactory } from "../../factories/napplet-handlers.js";
import { NappletHandlersModel, RecommendedNappletHandlersModel } from "../napplet-handlers.js";

const dev = new FakeUser();
const alice = new FakeUser();
const bob = new FakeUser();
const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";

function manifest(identifier: string, intents: string[] = []) {
  return dev.event({
    kind: 35129,
    content: identifier,
    tags: [["d", identifier], ["x", HASH], ["z", "profile"], ...intents.map((intent) => ["i", intent])],
  });
}

describe("napplet handler models", () => {
  it("queries preferences by archetype and author", async () => {
    const store = new EventStore();
    store.add(await NappletHandlersFactory.create("profile").handler(manifest("a")).sign(alice));
    store.add(await NappletHandlersFactory.create("feed").handler(manifest("a")).sign(alice));

    expect((await firstValueFrom(store.model(NappletHandlersModel, "profile"))).length).toBe(1);
    expect((await firstValueFrom(store.model(NappletHandlersModel, "profile", [bob.pubkey]))).length).toBe(0);
  });

  it("ranks public recommendations by recommender count", async () => {
    const store = new EventStore();
    const a = manifest("a");
    const b = manifest("b");
    store.add(a);
    store.add(b);
    store.add(await NappletHandlersFactory.create("profile").handler(a).handler(b).sign(alice));
    store.add(await NappletHandlersFactory.create("profile").handler(b).sign(bob));

    const ranked = await firstValueFrom(store.model(RecommendedNappletHandlersModel, "profile"));
    expect(ranked.map((r) => r.napplet.id)).toEqual([b.id, a.id]);
    expect(ranked[0].recommenders.sort()).toEqual([alice.pubkey, bob.pubkey].sort());
  });

  it("ignores private entries and napplets without the requested convention", async () => {
    const store = new EventStore();
    const editor = manifest("editor", ["napplet:profile/edit"]);
    const viewer = manifest("viewer");
    const hidden = manifest("hidden", ["napplet:profile/edit"]);
    [editor, viewer, hidden].forEach((e) => store.add(e));
    store.add(
      await NappletHandlersFactory.create("profile")
        .as(alice)
        .handler(viewer)
        .intentHandler("edit", editor)
        .handler(hidden, true)
        .sign(),
    );

    const ranked = await firstValueFrom(
      store.model(RecommendedNappletHandlersModel, "profile", undefined, "napplet:profile/edit"),
    );
    expect(ranked.map((r) => r.napplet.id)).toEqual([editor.id]);
  });

  it("emits an empty array without recommendations", async () => {
    const store = new EventStore();
    expect(await firstValueFrom(store.model(RecommendedNappletHandlersModel, "profile"))).toEqual([]);
  });
});
