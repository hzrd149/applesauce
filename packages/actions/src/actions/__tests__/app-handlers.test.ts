import { User } from "applesauce-common/casts";
import { getRecommendedHandlers } from "applesauce-common/helpers/app-recommendation";
import { EventStore } from "applesauce-core";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionRunner } from "../../action-runner.js";
import { RecommendAppHandler, RemoveAppHandlerRecommendation } from "../app-handlers.js";

const user = new FakeUser();
const app = new FakeUser();
const a = `31990:${app.pubkey}:a`;
const b = `31990:${app.pubkey}:b`;

let events: EventStore;
let publish: ReturnType<typeof vitest.fn>;
let hub: ActionRunner;
beforeEach(() => {
  events = new EventStore();
  publish = vitest.fn().mockResolvedValue(undefined);
  hub = new ActionRunner(events, user, publish);
  User.cache.clear();
  events.add(user.event({ kind: kinds.RelayList, tags: [["r", "wss://relay.example.com/"]] }));
});

const published = (): NostrEvent => publish.mock.lastCall![0];

// Seed an older recommendation so the action's replacement is always newer
function seed(...handlers: string[]) {
  const tags = [["d", "30023"], ...handlers.map((h) => ["a", h])];
  events.add(user.event({ kind: kinds.Handlerrecommendation, tags, created_at: unixNow() - 10 }));
}

describe("RecommendAppHandler", () => {
  it("creates a recommendation for the kind and publishes to outboxes", async () => {
    await hub.run(RecommendAppHandler, 30023, a, "web");
    expect(publish).toBeCalledWith(expect.objectContaining({ kind: kinds.Handlerrecommendation }), [
      "wss://relay.example.com/",
    ]);
    expect(published().tags).toContainEqual(["d", "30023"]);
    expect(getRecommendedHandlers(published())).toEqual([
      { pointer: expect.objectContaining({ identifier: "a" }), platform: "web" },
    ]);
  });

  it("adds to an existing recommendation", async () => {
    seed(a);
    await hub.run(RecommendAppHandler, 30023, b);
    expect(getRecommendedHandlers(published()).map((h) => h.pointer.identifier)).toEqual(["a", "b"]);
  });
});

describe("RemoveAppHandlerRecommendation", () => {
  it("removes a handler from the recommendation", async () => {
    seed(a, b);
    await hub.run(RemoveAppHandlerRecommendation, 30023, a);
    expect(getRecommendedHandlers(published()).map((h) => h.pointer.identifier)).toEqual(["b"]);
  });

  it("does nothing without a recommendation", async () => {
    await hub.run(RemoveAppHandlerRecommendation, 30023, a);
    expect(publish).not.toBeCalled();
  });
});
