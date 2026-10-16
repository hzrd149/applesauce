import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EventStore } from "applesauce-core/event-store";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { UserStatusesModel, UserStatusModel } from "../user-status.js";

const user = new FakeUser();

let store: EventStore;
beforeEach(() => {
  store = new EventStore();
});

describe("UserStatusModel", () => {
  it("returns text-only statuses", () => {
    const event = store.add(user.event({ kind: 30315, content: "Working", tags: [["d", "general"]] }))!;
    const spy = subscribeSpyTo(store.model(UserStatusModel, user.pubkey));
    expect(spy.getLastValue()).toEqual({ event, content: "Working" });
  });

  it("returns the link pointer", () => {
    store.add(
      user.event({
        kind: 30315,
        content: "Sign up for nostrasia!",
        tags: [
          ["d", "general"],
          ["r", "https://nostr.world"],
        ],
      }),
    );
    const spy = subscribeSpyTo(store.model(UserStatusModel, user.pubkey));
    expect(spy.getLastValue()).toEqual(expect.objectContaining({ type: "url", data: "https://nostr.world" }));
  });

  it("returns undefined for a cleared status", () => {
    store.add(user.event({ kind: 30315, content: "", tags: [["d", "general"]] }));
    const spy = subscribeSpyTo(store.model(UserStatusModel, user.pubkey));
    expect(spy.getLastValue()).toBeUndefined();
  });
});

describe("UserStatusesModel", () => {
  it("returns statuses by type and skips cleared ones", () => {
    store.add(user.event({ kind: 30315, content: "Working", tags: [["d", "general"]] }));
    store.add(user.event({ kind: 30315, content: "", tags: [["d", "music"]] }));
    const spy = subscribeSpyTo(store.model(UserStatusesModel, user.pubkey));
    expect(Object.keys(spy.getLastValue()!)).toEqual(["general"]);
  });
});
