import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getHandlerLatestPointer, getHandlerSupportedKinds, isValidAppHandler } from "../../helpers/app-handler.js";
import { getRecommendationKind, getRecommendedHandlers } from "../../helpers/app-recommendation.js";
import { AppHandlerFactory } from "../app-handler.js";
import { AppRecommendationFactory } from "../app-recommendation.js";

const user = new FakeUser();

describe("AppHandlerFactory", () => {
  it("creates and modifies handlers", async () => {
    const handler = await AppHandlerFactory.create("app")
      .metadata({ name: "App" })
      .kind(1)
      .link("web", "https://app.com/<bech32>", "nevent")
      .latest(`35128:${user.pubkey}:app`)
      .sign(user);
    expect(isValidAppHandler(handler)).toBe(true);
    expect(getHandlerLatestPointer(handler)?.identifier).toBe("app");
    const modified = await AppHandlerFactory.modify(handler).kind(30023).removeKind(1).sign(user);
    expect(getHandlerSupportedKinds(modified)).toEqual([30023]);
    expect((await AppHandlerFactory.create().sign(user)).tags[0]?.[1]).toBeTruthy();
    expect(() => AppHandlerFactory.modify(user.note("hi"))).toThrow();
  });
});

describe("AppRecommendationFactory", () => {
  it("creates and modifies recommendations", async () => {
    const address = `31990:${user.pubkey}:app`;
    const rec = await AppRecommendationFactory.create(31337).handler(address, "web").sign(user);
    expect(getRecommendationKind(rec)).toBe(31337);
    expect(getRecommendedHandlers(rec)).toHaveLength(1);
    const modified = await AppRecommendationFactory.modify(rec).removeHandler(address).sign(user);
    expect(getRecommendedHandlers(modified)).toEqual([]);
  });
});
