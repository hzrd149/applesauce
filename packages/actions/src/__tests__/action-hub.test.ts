import { from, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EventFactory } from "applesauce-core";
import { EventStore } from "applesauce-core";

import { FakeUser } from "./fake-user.js";
import { ActionHub } from "../action-hub.js";
import { CreateProfile } from "../actions/profile.js";
import { NostrEvent } from "applesauce-core/helpers/event";

const user = new FakeUser();
let events = new EventStore();
let factory = new EventFactory({ signer: user });

beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: user });
});

describe("runAction", () => {
  it("should handle action that return observables", async () => {
    const e = [user.note(), user.profile({ name: "testing" })];
    const action = () => from(e);

    const spy = subscribeSpyTo(ActionHub.runAction({ events, factory, self: await user.getPublicKey() }, action));
    await spy.onComplete();

    expect(spy.getValues()).toEqual(e);
  });

  it("should handle action that return AsyncIterable", async () => {
    const e = [user.note(), user.profile({ name: "testing" })];
    async function* action() {
      for (const event of e) yield event;
    }

    const spy = subscribeSpyTo(ActionHub.runAction({ events, factory, self: await user.getPublicKey() }, action));
    await spy.onComplete();

    expect(spy.getValues()).toEqual(e);
  });

  it("should handle action that return Iterable", async () => {
    const e = [user.note(), user.profile({ name: "testing" })];
    function* action() {
      for (const event of e) yield event;
    }

    const spy = subscribeSpyTo(ActionHub.runAction({ events, factory, self: await user.getPublicKey() }, action));
    await spy.onComplete();

    expect(spy.getValues()).toEqual(e);
  });
});

describe("run", () => {
  it("should throw if publish is not set", async () => {
    const hub = new ActionHub(events, factory);
    await expect(async () => hub.run(CreateProfile, { name: "fiatjaf" })).rejects.toThrow();
  });

  it("should call publish with all events", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);

    const hub = new ActionHub(events, factory, publish);
    await hub.run(CreateProfile, { name: "fiatjaf" });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ content: JSON.stringify({ name: "fiatjaf" }) }));
  });
});

describe("exec", () => {
  it("should support forEach to stream to publish", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);

    const hub = new ActionHub(events, factory);
    await hub.exec(CreateProfile, { name: "fiatjaf" }).forEach(publish);

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ content: JSON.stringify({ name: "fiatjaf" }) }));
  });

  it("should support streaming to a publish subject", async () => {
    const publish = new Subject<NostrEvent>();

    const spy = subscribeSpyTo(publish);

    const hub = new ActionHub(events, factory);
    await hub.exec(CreateProfile, { name: "fiatjaf" }).forEach((v) => publish.next(v));

    expect(spy.getValues()).toEqual([expect.objectContaining({ content: JSON.stringify({ name: "fiatjaf" }) })]);
  });
});
