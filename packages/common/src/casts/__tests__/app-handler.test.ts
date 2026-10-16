import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { AppHandlerFactory } from "../../factories/app-handler.js";
import { AppRecommendationFactory } from "../../factories/app-recommendation.js";
import { NamedNsiteFactory } from "../../factories/named-nsite.js";
import { AppHandler } from "../app-handler.js";
import { AppRecommendation } from "../app-recommendation.js";
import { Note } from "../note.js";
import { castUser } from "../user.js";

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

  it("falls back to the author's profile when it has no metadata", async () => {
    const store = new EventStore();
    store.add(user.profile({ name: "Author" }));
    const bare = new AppHandler(await AppHandlerFactory.create("bare").sign(user), store);
    expect(bare.metadata).toBeUndefined();
    expect((await firstValueFrom(bare.metadata$))?.name).toBe("Author");
    const named = new AppHandler(await AppHandlerFactory.create("named").metadata({ name: "App" }).sign(user), store);
    expect((await firstValueFrom(named.metadata$))?.name).toBe("App");
  });
});

describe("User app handler getters", () => {
  it("subscribes to the user's handlers and recommendations", async () => {
    const { store, handler, recommendation } = await setup();
    const owner = castUser(user.pubkey, store);
    expect((await firstValueFrom(owner.appHandlers$)).map((h) => h.id)).toEqual([handler.id]);
    expect((await firstValueFrom(owner.appRecommendations$)).map((r) => r.id)).toEqual([recommendation.id]);
    expect(new AppHandler(handler, store).platforms).toEqual([]);
  });
});

describe("Note client", () => {
  it("parses the client tag and resolves its handler", async () => {
    const { store, handler } = await setup();
    const note = new Note(user.note("hi", { tags: [["client", "App", `31990:${user.pubkey}:app`]] }), store);
    expect(note.client?.name).toBe("App");
    expect((await firstValueFrom(note.client$))?.id).toBe(handler.id);
    expect(await firstValueFrom(new Note(user.note("hi"), store).client$)).toBeUndefined();
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
