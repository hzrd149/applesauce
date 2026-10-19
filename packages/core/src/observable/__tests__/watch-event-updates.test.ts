import { beforeEach, describe, expect, it } from "vitest";
import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { defer, EMPTY, of, Subject } from "rxjs";
import { NostrEvent } from "../../helpers/event.js";

import { EventStore } from "../../event-store/event-store.js";
import { watchEventUpdates, watchEventsUpdates } from "../watch-event-updates.js";
import { FakeUser } from "../../__tests__/fixtures.js";

let eventStore: EventStore;
let user: FakeUser;
let event: NostrEvent;

beforeEach(() => {
  eventStore = new EventStore();
  user = new FakeUser();
  event = user.note("original content");
});

describe("watchEventsUpdates", () => {
  function streams() {
    const update$ = new Subject<NostrEvent>();
    return { insert$: EMPTY, remove$: EMPTY, update$ };
  }

  it("re-emits the original array only for matching event objects", () => {
    const store = streams();
    const timeline = [event, event];
    const spy = subscribeSpyTo(of(timeline).pipe(watchEventsUpdates(store)));
    expect(spy.getValues()).toEqual([timeline]);
    store.update$.next({ ...event });
    store.update$.next(user.note("unrelated"));
    expect(spy.getValuesLength()).toBe(1);
    store.update$.next(event);
    expect(spy.getValuesLength()).toBe(2);
    expect(spy.getLastValue()).toBe(timeline);
    spy.unsubscribe();
    expect(store.update$.observed).toBe(false);
  });

  it("rebuilds membership when the same array is emitted after additions, removals, or replacements", () => {
    const store = streams();
    const source = new Subject<NostrEvent[]>();
    const spy = subscribeSpyTo(source.pipe(watchEventsUpdates(store)));
    const other = user.note("other");
    const timeline = [event];
    source.next(timeline);
    timeline.push(other);
    store.update$.next(other);
    expect(spy.getValuesLength()).toBe(1);
    source.next(timeline);
    store.update$.next(other);
    expect(spy.getValuesLength()).toBe(3);

    timeline.shift();
    source.next(timeline);
    store.update$.next(event);
    expect(spy.getValuesLength()).toBe(4);

    const replacement = { ...other };
    timeline[0] = replacement;
    source.next(timeline);
    store.update$.next(other);
    expect(spy.getValuesLength()).toBe(5);
    store.update$.next(replacement);
    expect(spy.getValuesLength()).toBe(6);
    expect(spy.getLastValue()).toBe(timeline);

    source.next([]);
    store.update$.next(replacement);
    expect(spy.getValuesLength()).toBe(7);
    spy.unsubscribe();
    expect(source.observed).toBe(false);
    expect(store.update$.observed).toBe(false);
  });

  it("keeps cold-source membership separate for simultaneous subscriptions", () => {
    const store = streams();
    const other = user.note("second subscriber");
    let subscriptions = 0;
    const watched = defer(() => of([subscriptions++ === 0 ? event : other])).pipe(watchEventsUpdates(store));
    const first = subscribeSpyTo(watched);
    const second = subscribeSpyTo(watched);
    store.update$.next(event);
    expect(first.getValuesLength()).toBe(2);
    expect(second.getValuesLength()).toBe(1);
    store.update$.next(other);
    expect(first.getValuesLength()).toBe(2);
    expect(second.getValuesLength()).toBe(2);
    first.unsubscribe();
    second.unsubscribe();
    expect(store.update$.observed).toBe(false);
  });

  it("starts each subscription empty until its source emits", () => {
    const store = streams();
    const source = new Subject<NostrEvent[]>();
    const watched = source.pipe(watchEventsUpdates(store));
    const first = subscribeSpyTo(watched);
    source.next([event]);
    const late = subscribeSpyTo(watched);
    store.update$.next(event);
    expect(first.getValuesLength()).toBe(2);
    expect(late.getValuesLength()).toBe(0);
    first.unsubscribe();
    late.unsubscribe();

    const fresh = subscribeSpyTo(watched);
    store.update$.next(event);
    expect(fresh.getValuesLength()).toBe(0);
    fresh.unsubscribe();
    expect(source.observed).toBe(false);
    expect(store.update$.observed).toBe(false);
  });
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
