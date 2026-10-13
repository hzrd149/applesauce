import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { AppHandlerFactory } from "../../factories/app-handler.js";
import { AppRecommendationFactory } from "../../factories/app-recommendation.js";
import { NamedNsiteFactory } from "../../factories/named-nsite.js";
import { AppHandler } from "../app-handler.js";
import { AppRecommendation } from "../app-recommendation.js";

const user = new FakeUser();
const files = [{ path: "/index.html", sha256: "a".repeat(64) }];

async function setup() {
  const store = new EventStore();
  const handler = await AppHandlerFactory.create("app").kind(1).latest(`35128:${user.pubkey}:app`).sign(user);
  const site = await NamedNsiteFactory.create("app", files).app(`31990:${user.pubkey}:app`).sign(user);
  const recommendation = await AppRecommendationFactory.create(1)
    .handler(`31990:${user.pubkey}:app`, "web")
    .handler(`31990:${user.pubkey}:missing`)
    .sign(user);
  for (const event of [handler, site, recommendation]) store.add(event);
  return { store, handler, site, recommendation };
}

describe("AppHandler", () => {
  it("validates the event and resolves its nsites", async () => {
    const { store, handler, site } = await setup();
    expect(() => new AppHandler(user.note("hi"), store)).toThrow();
    const cast = new AppHandler(handler, store);
    expect(cast.supportedKinds).toEqual([1]);
    expect((await firstValueFrom(cast.latest$))?.id).toBe(site.id);
    expect(await firstValueFrom(cast.next$)).toBeUndefined();
    expect((await firstValueFrom(cast.nsites$)).map((s) => s.id)).toEqual([site.id]);
  });
});

describe("AppRecommendation", () => {
  it("resolves recommended handlers in order", async () => {
    const { store, handler, recommendation } = await setup();
    const cast = new AppRecommendation(recommendation, store);
    expect(cast.supportedKind).toBe(1);
    const [found, missing] = await firstValueFrom(cast.handlers$);
    expect(found).toBeInstanceOf(AppHandler);
    expect(found?.id).toBe(handler.id);
    expect(missing).toBeUndefined();
  });
});
