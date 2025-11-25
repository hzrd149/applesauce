import { beforeEach, describe, expect, it } from "vitest";
import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { of } from "rxjs";
import { NostrEvent } from "applesauce-core/helpers/event";

import { EventStore } from "../../event-store/event-store.js";
import { watchEventUpdates } from "../watch-event-updates.js";
import { FakeUser } from "../../__tests__/fixtures.js";

let eventStore: EventStore;
let user: FakeUser;
let event: NostrEvent;

beforeEach(() => {
  eventStore = new EventStore();
  user = new FakeUser();
  event = user.note("original content");
});

describe("watchEventUpdates", () => {
  it("should emit the initial event", () => {
    const source = of(event);
    const spy = subscribeSpyTo(source.pipe(watchEventUpdates(eventStore)));

    expect(spy.getValues()).toEqual([event]);
  });

  it("should emit the event again when it's updated in the event store", () => {
    // Add the event to the store first
    eventStore.add(event);

    // Create a source that emits the event
    const source = of(event);
    const spy = subscribeSpyTo(source.pipe(watchEventUpdates(eventStore)));

    // Create an updated version of the event
    Reflect.set(event, Symbol.for("new-prop"), "testing");

    // Update the event in the store
    eventStore.update(event);

    // Should have received both the original and updated event
    expect(spy.getValues()).toEqual([event, event]);
  });

  it("should not emit updates for other events", () => {
    // Add the event to the store
    eventStore.add(event);

    // Create a source that emits the event
    const source = of(event);
    const spy = subscribeSpyTo(source.pipe(watchEventUpdates(eventStore)));

    // Create a different event
    const otherEvent = user.note("other content");

    // Add the other event to the store
    eventStore.add(otherEvent);

    // Should only have received the original event
    expect(spy.getValues()).toEqual([event]);
  });

  it("should handle undefined initial event", () => {
    const source = of(undefined);
    const spy = subscribeSpyTo(source.pipe(watchEventUpdates(eventStore)));

    expect(spy.getValues()).toEqual([undefined]);

    // Adding events to the store should not trigger emissions
    eventStore.add(event);
    expect(spy.getValues()).toEqual([undefined]);
  });
});
