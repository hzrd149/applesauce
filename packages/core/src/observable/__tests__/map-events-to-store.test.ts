import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { from, of, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { FakeUser } from "../../__tests__/fixtures.js";
import { AsyncEventStore } from "../../event-store/async-event-store.js";
import { EventStore } from "../../event-store/event-store.js";
import { mapEventsToStore } from "../map-events-to-store.js";

const user = new FakeUser();

describe("mapEventsToStore", () => {
  it("should filte rout invalid events", () => {
    const store = new EventStore();
    store.verifyEvent = () => false;

    const spy = subscribeSpyTo(of(user.profile({ name: "testing" })).pipe(mapEventsToStore(store)), {
      expectErrors: true,
    });

    expect(spy.getValues()).toEqual([]);
  });

  it("should map events to the cononical event in the store", () => {
    const store = new EventStore();

    const event = user.profile({ name: "testing" });
    store.add(event);

    const spy = subscribeSpyTo(of({ ...event }).pipe(mapEventsToStore(store)));

    expect(spy.getValueAt(0)).toBe(event);
  });

  it("should remove duplicates if requested", () => {
    const store = new EventStore();

    const event = user.profile({ name: "testing" });
    const spy = subscribeSpyTo(
      from([event, { ...event }, { ...event }, { ...event }]).pipe(mapEventsToStore(store, true)),
    );

    expect(spy.getValuesLength()).toBe(1);
    expect(spy.getValueAt(0)).toBe(event);
  });

  it("should keep duplicates if requested", () => {
    const store = new EventStore();

    const event = user.profile({ name: "testing" });
    const spy = subscribeSpyTo(
      from([event, { ...event }, { ...event }, { ...event }]).pipe(mapEventsToStore(store, false)),
    );

    expect(spy.getValuesLength()).toBe(4);
    expect(spy.getValues()).toEqual([event, event, event, event]);
  });

  it("should keep going after an event fails to insert", () => {
    const store = new EventStore();
    const [bad, good] = [user.note("bad"), user.note("good")];
    const add = store.add.bind(store);
    vi.spyOn(store, "add").mockImplementation((event) => {
      if (event.id === bad.id) throw new Error("insert failed");
      return add(event);
    });

    const spy = subscribeSpyTo(from([bad, good]).pipe(mapEventsToStore(store)));

    expect(spy.getValues()).toEqual([good]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should pass strings through in order", () => {
    const store = new EventStore();
    const event = user.note("hello");
    const spy = subscribeSpyTo(
      from<(string | typeof event)[]>(["EOSE", event, "CLOSED"]).pipe(mapEventsToStore(store)),
    );

    expect(spy.getValues()).toEqual(["EOSE", event, "CLOSED"]);
  });

  it("should forward source errors", () => {
    const store = new EventStore();
    const source = new Subject<ReturnType<typeof user.note>>();
    const spy = subscribeSpyTo(source.pipe(mapEventsToStore(store)), { expectErrors: true });
    const error = new Error("relay failed");
    source.error(error);

    expect(spy.getError()).toBe(error);
  });

  it("should complete after pending async inserts", async () => {
    const event = user.note("async");
    // An async store that returns the canonical instance like AsyncEventStore.add
    const store = { add: async () => event } as unknown as AsyncEventStore;
    const spy = subscribeSpyTo(of(event, { ...event }).pipe(mapEventsToStore(store)));
    expect(spy.receivedComplete()).toBe(false);

    await spy.onComplete();
    expect(spy.getValues()).toEqual([event]);
  });
});
