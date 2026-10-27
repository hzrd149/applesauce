import { Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventStore } from "../../event-store/event-store.js";
import { IEventStore } from "../../event-store/interface.js";
import { NostrEvent } from "../../helpers/event.js";
import { TimelineModel } from "../base.js";

function makeEvent(version: number, kind = 1): NostrEvent {
  return {
    id: version.toString(16).padStart(64, "0"),
    pubkey: "a".repeat(64),
    kind,
    created_at: version,
    tags: [],
    content: "",
    sig: "0".repeat(128),
  };
}

function createStore(initial: NostrEvent[] = [], asyncSnapshot = false) {
  const owners = new Map<NostrEvent, number>();
  const store = {
    insert$: new Subject<NostrEvent>(),
    remove$: new Subject<NostrEvent>(),
    getTimeline: () => (asyncSnapshot ? Promise.resolve(initial) : initial),
    claim: vi.fn((event: NostrEvent) => {
      owners.set(event, (owners.get(event) ?? 0) + 1);
    }),
    removeClaim: vi.fn((event: NostrEvent) => {
      const count = owners.get(event) ?? 0;
      expect(count).toBeGreaterThan(0);
      if (count === 1) owners.delete(event);
      else owners.set(event, count - 1);
    }),
  };

  return { store: store as unknown as IEventStore, owners, ...store };
}

afterEach(() => vi.useRealTimers());

describe.each([false, true])("TimelineModel claims (async snapshot: %s)", (asyncSnapshot) => {
  it("keeps initial members claimed until removal or unsubscribe", async () => {
    const first = makeEvent(1);
    const second = makeEvent(2);
    const test = createStore([second, first], asyncSnapshot);
    const sub = TimelineModel({ kinds: [1] })(test.store).subscribe();
    await Promise.resolve();

    expect(test.owners).toEqual(
      new Map([
        [first, 1],
        [second, 1],
      ]),
    );
    test.remove$.next(first);
    expect(test.owners).toEqual(new Map([[second, 1]]));

    sub.unsubscribe();
    expect(test.owners.size).toBe(0);
    expect(test.removeClaim).toHaveBeenCalledTimes(2);
  });

  it("releases superseded versions without claiming ignored inputs", async () => {
    const first = makeEvent(1, 0);
    const test = createStore([first], asyncSnapshot);
    let timeline: NostrEvent[] = [];
    const sub = TimelineModel(
      { kinds: [0] },
      { batchWindow: false },
    )(test.store).subscribe((value) => (timeline = value));
    await Promise.resolve();

    for (let version = 2; version <= 1000; version++) {
      const event = makeEvent(version, 0);
      test.insert$.next(event);
      expect(test.owners.size).toBe(1);
      expect(test.owners.get(event)).toBe(1);
    }

    test.insert$.next(first);
    test.remove$.next(first);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].created_at).toBe(1000);
    expect(test.claim).toHaveBeenCalledTimes(1000);
    expect(test.removeClaim).toHaveBeenCalledTimes(999);

    sub.unsubscribe();
    expect(test.owners.size).toBe(0);
    expect(test.removeClaim).toHaveBeenCalledTimes(1000);
  });

  it("releases removed regular events while remaining subscribed", async () => {
    const test = createStore([], asyncSnapshot);
    let timeline: NostrEvent[] = [];
    const sub = TimelineModel({ kinds: [1] })(test.store).subscribe((value) => (timeline = value));
    await Promise.resolve();

    for (let version = 1; version <= 1000; version++) {
      const event = makeEvent(version);
      test.insert$.next(event);
      test.insert$.next(event);
      test.remove$.next(event);
      test.remove$.next(event);
      expect(test.owners.size).toBe(0);
    }

    expect(timeline).toEqual([]);
    expect(test.claim).toHaveBeenCalledTimes(1000);
    expect(test.removeClaim).toHaveBeenCalledTimes(1000);
    sub.unsubscribe();
    expect(test.removeClaim).toHaveBeenCalledTimes(1000);
  });

  it("isolates direct subscriptions and supports resubscription", async () => {
    const event = makeEvent(1);
    const test = createStore([event], asyncSnapshot);
    const model = TimelineModel({ kinds: [1] })(test.store);
    const first = model.subscribe();
    const second = model.subscribe();
    await Promise.resolve();

    expect(test.owners.get(event)).toBe(2);
    first.unsubscribe();
    expect(test.owners.get(event)).toBe(1);

    const next = makeEvent(2);
    test.insert$.next(next);
    expect(test.owners.get(next)).toBe(1);
    second.unsubscribe();
    expect(test.owners.size).toBe(0);

    const third = model.subscribe();
    await Promise.resolve();
    expect(test.owners).toEqual(new Map([[event, 1]]));
    third.unsubscribe();
    expect(test.owners.size).toBe(0);
  });

  it("retains requested history and does not mutate emitted snapshots", async () => {
    const first = makeEvent(1, 0);
    const second = makeEvent(2, 0);
    const test = createStore([first], asyncSnapshot);
    const snapshots: NostrEvent[][] = [];
    const sub = TimelineModel(
      { kinds: [0] },
      { includeOldVersion: true, batchWindow: false },
    )(test.store).subscribe((value) => snapshots.push(value));
    await Promise.resolve();

    test.insert$.next(second);
    test.remove$.next(first);

    expect(snapshots).toEqual([[first], [second, first], [second]]);
    expect(test.owners).toEqual(new Map([[second, 1]]));
    sub.unsubscribe();
    expect(test.owners.size).toBe(0);
  });

  it("releases current members on stream error", async () => {
    const event = makeEvent(1);
    const test = createStore([event], asyncSnapshot);
    const error = vi.fn();
    TimelineModel({ kinds: [1] })(test.store).subscribe({ error });
    await Promise.resolve();

    const failure = new Error("stream failed");
    test.insert$.error(failure);

    expect(error).toHaveBeenCalledWith(failure);
    expect(test.owners.size).toBe(0);
  });
});

describe("shared timeline claims", () => {
  it.each([false, true])("releases replaced versions with keepOldVersions=%s", (keepOldVersions) => {
    const store = new EventStore({ verifyEvent: () => true, keepOldVersions });
    const first = makeEvent(1, 0);
    store.add(first);
    const claim = vi.spyOn(store, "claim");
    const release = vi.spyOn(store, "removeClaim");
    let timeline: NostrEvent[] = [];

    try {
      store.timeline({ kinds: [0] }, { batchWindow: false }).subscribe((value) => (timeline = value));
      const second = makeEvent(2, 0);
      store.add(second);

      expect(timeline).toEqual([second]);
      expect(claim).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenCalledExactlyOnceWith(first);
    } finally {
      store.dispose();
    }

    expect(release).toHaveBeenCalledTimes(2);
  });

  it("preserves live members arriving during a delayed initial snapshot", async () => {
    const event = makeEvent(1);
    const test = createStore([], true);
    const sub = TimelineModel({ kinds: [1] })(test.store).subscribe();

    test.insert$.next(event);
    expect(test.owners.get(event)).toBe(1);
    await Promise.resolve();
    expect(test.owners.get(event)).toBe(1);

    sub.unsubscribe();
    expect(test.owners.size).toBe(0);
    expect(test.removeClaim).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("releases members when all input streams complete", () => {
    const event = makeEvent(1);
    const test = createStore([event]);
    const complete = vi.fn();
    TimelineModel({ kinds: [1] })(test.store).subscribe({ complete });

    test.insert$.complete();
    test.remove$.complete();

    expect(complete).toHaveBeenCalledOnce();
    expect(test.owners.size).toBe(0);
  });

  it("keeps independent claims for overlapping models", () => {
    const event = makeEvent(1);
    const test = createStore([event]);
    const narrow = TimelineModel({ kinds: [1] })(test.store).subscribe();
    const broad = TimelineModel({})(test.store).subscribe();

    expect(test.owners.get(event)).toBe(2);
    narrow.unsubscribe();
    expect(test.owners.get(event)).toBe(1);
    test.remove$.next(event);
    expect(test.owners.size).toBe(0);
    broad.unsubscribe();
    expect(test.removeClaim).toHaveBeenCalledTimes(2);
  });

  it("releases a claim when the real store expires an event", async () => {
    vi.useFakeTimers();
    const store = new EventStore({ verifyEvent: () => true, keepExpired: false });
    const event = makeEvent(1);
    event.tags = [["expiration", String(Math.round(Date.now() / 1000) + 2)]];
    const release = vi.spyOn(store, "removeClaim");
    let timeline: NostrEvent[] = [];

    try {
      store.timeline({ kinds: [1] }).subscribe((value) => (timeline = value));
      store.add(event);
      await vi.advanceTimersByTimeAsync(16);
      expect(timeline).toEqual([event]);

      await vi.advanceTimersByTimeAsync(3000);
      expect(timeline).toEqual([]);
      expect(release).toHaveBeenCalledExactlyOnceWith(event);
    } finally {
      store.dispose();
    }

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("shares ownership through keep-warm, resets after expiry, and releases on disposal", async () => {
    vi.useFakeTimers();
    const store = new EventStore({ verifyEvent: () => true });
    store.modelKeepWarm = 100;
    const event = makeEvent(1);
    store.add(event);
    const claim = vi.spyOn(store, "claim");
    const release = vi.spyOn(store, "removeClaim");

    try {
      const timeline = store.timeline({ kinds: [1] });
      const first = timeline.subscribe();
      const second = timeline.subscribe();
      expect(claim).toHaveBeenCalledTimes(1);

      first.unsubscribe();
      second.unsubscribe();
      await vi.advanceTimersByTimeAsync(99);
      expect(release).not.toHaveBeenCalled();

      const warm = timeline.subscribe();
      expect(claim).toHaveBeenCalledTimes(1);
      warm.unsubscribe();
      await vi.advanceTimersByTimeAsync(100);
      expect(release).toHaveBeenCalledExactlyOnceWith(event);

      const active = timeline.subscribe();
      expect(claim).toHaveBeenCalledTimes(2);
      store.dispose();
      expect(active.closed).toBe(true);
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      store.dispose();
    }
  });
});
