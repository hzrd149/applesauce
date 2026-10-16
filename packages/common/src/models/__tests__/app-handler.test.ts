import { EventStore } from "applesauce-core/event-store";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { AppHandlerFactory } from "../../factories/app-handler.js";
import { AppRecommendationFactory } from "../../factories/app-recommendation.js";
import { AppHandlersModel, AppRecommendationsModel, RecommendedAppHandlersModel } from "../app-handler.js";

const app = new FakeUser();
const alice = new FakeUser();
const bob = new FakeUser();

describe("app handler models", () => {
  it("queries handlers by supported kind and recommendations by author", async () => {
    const store = new EventStore();
    const handler = await AppHandlerFactory.create("a").kind(30023).sign(app);
    const other = await AppHandlerFactory.create("b").kind(1).sign(app);
    const rec = await AppRecommendationFactory.create(30023).handler(getAddressPointerForEvent(handler)!).sign(alice);
    [handler, other, rec].forEach((e) => store.add(e));

    expect((await firstValueFrom(store.model(AppHandlersModel, 30023))).map((e) => e.id)).toEqual([handler.id]);
    expect((await firstValueFrom(store.model(AppRecommendationsModel, 30023, [alice.pubkey]))).length).toBe(1);
    expect((await firstValueFrom(store.model(AppRecommendationsModel, 30023, [bob.pubkey]))).length).toBe(0);
  });

  it("ranks recommended handlers by how many authors recommend them", async () => {
    const store = new EventStore();
    const a = await AppHandlerFactory.create("a").kind(30023).sign(app);
    const b = await AppHandlerFactory.create("b").kind(30023).sign(app);
    const pa = getAddressPointerForEvent(a)!;
    const pb = getAddressPointerForEvent(b)!;
    store.add(a);
    store.add(b);
    // Alice lists `a` for two platforms, which should still count once
    store.add(
      await AppRecommendationFactory.create(30023).handler(pa, "web").handler(pa, "ios").handler(pb).sign(alice),
    );
    store.add(await AppRecommendationFactory.create(30023).handler(pb).sign(bob));

    const handlers = await firstValueFrom(store.model(RecommendedAppHandlersModel, 30023, [alice.pubkey, bob.pubkey]));
    expect(handlers.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("emits an empty array without recommendations", async () => {
    const store = new EventStore();
    expect(await firstValueFrom(store.model(RecommendedAppHandlersModel, 30023))).toEqual([]);
  });
});
