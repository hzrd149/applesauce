import { Subject, tap, throttleTime } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventStore } from "../../event-store/event-store.js";
import { IEventStore } from "../../event-store/interface.js";
import { NostrEvent, StoreEvent } from "../../helpers/event.js";
import { TimelineModel } from "../base.js";

function event(id: number, created_at = id, kind = 1): NostrEvent {
  return {
    id: id.toString(16).padStart(64, "0"),
    pubkey: "a".repeat(64),
    kind,
    created_at,
    tags: [],
    content: "",
    sig: "0".repeat(128),
  };
}

function setup(initial: NostrEvent[] | Promise<NostrEvent[]> = []) {
  const owners = new Map<NostrEvent, number>();
  const insert$ = new Subject<NostrEvent>();
  const remove$ = new Subject<NostrEvent>();
  const store = {
    insert$,
    remove$,
    getTimeline: () => initial,
    claim: vi.fn((member: NostrEvent) => owners.set(member, (owners.get(member) ?? 0) + 1)),
    removeClaim: vi.fn((member: NostrEvent) => {
      const count = owners.get(member) ?? 0;
      expect(count).toBeGreaterThan(0);
      if (count === 1) owners.delete(member);
      else owners.set(member, count - 1);
    }),
  };
  return { ...store, owners, store: store as unknown as IEventStore };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("TimelineModel scheduling and incremental snapshots", () => {
  it("uses a fixed 16 ms window by default with a synchronous initial snapshot", async () => {
    const store = new EventStore({ verifyEvent: () => true });
    const snapshots: NostrEvent[][] = [];
    store.timeline({ kinds: [1] }).subscribe((value) => snapshots.push(value));
    const first = event(1);
    const second = event(2);
    store.add(first);
    await vi.advanceTimersByTimeAsync(15);
    store.add(second);
    expect(snapshots).toEqual([[]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshots).toEqual([[], [second, first]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshots).toHaveLength(2);
    store.dispose();
  });

  it.each(["ascending", "descending", "equal"])("matches immediate ordering for %s timestamps", async (order) => {
    const test = setup();
    const snapshots: NostrEvent[][] = [];
    let immediate: NostrEvent[] = [];
    const batched = TimelineModel({})(test.store).subscribe((value) => snapshots.push(value));
    const original = TimelineModel({}, { batchWindow: false })(test.store).subscribe((value) => (immediate = value));
    for (let index = 1; index <= 100; index++) {
      const timestamp = order === "ascending" ? index : order === "descending" ? 101 - index : 1;
      test.insert$.next(event(index, timestamp));
    }
    expect(snapshots).toEqual([[]]);
    await vi.advanceTimersByTimeAsync(16);
    expect(snapshots).toEqual([[], immediate]);
    const previous = snapshots[1].slice();
    test.remove$.next(immediate[0]);
    await vi.advanceTimersByTimeAsync(16);
    expect(snapshots[1]).toEqual(previous);
    expect(snapshots[2]).toEqual(immediate);
    batched.unsubscribe();
    original.unsubscribe();
    expect(test.owners.size).toBe(0);
  });

  it("applies every update synchronously in explicit immediate mode", () => {
    const test = setup();
    const snapshots: NostrEvent[][] = [];
    const sub = TimelineModel({}, { batchWindow: false })(test.store).subscribe((value) => snapshots.push(value));
    const first = event(1);
    const second = event(2);
    test.insert$.next(first);
    test.insert$.next(second);
    test.remove$.next(first);
    expect(snapshots).toEqual([[], [first], [second, first], [second]]);
    expect(vi.getTimerCount()).toBe(0);
    sub.unsubscribe();
  });

  it("keeps zero-delay scheduling asynchronous", async () => {
    const test = setup();
    const snapshots = vi.fn();
    const sub = TimelineModel({}, { batchWindow: 0 })(test.store).subscribe(snapshots);
    test.insert$.next(event(1));
    expect(snapshots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it("does not sort or materialize snapshots during burst ingestion", async () => {
    const test = setup();
    const snapshots = vi.fn();
    const readTimestamp = vi.fn();
    const sub = TimelineModel({})(test.store).subscribe(snapshots);
    for (let index = 1; index <= 5000; index++) {
      const member = event(index);
      Object.defineProperty(member, "created_at", {
        get: () => {
          readTimestamp();
          return index;
        },
      });
      test.insert$.next(member);
    }
    expect(readTimestamp).not.toHaveBeenCalled();
    expect(snapshots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(16);
    expect(snapshots).toHaveBeenCalledTimes(2);
    expect(snapshots.mock.lastCall?.[0]).toHaveLength(5000);
    sub.unsubscribe();
  });

  it("does not sort the preloaded snapshot or re-sort unchanged members on a small update", async () => {
    const initial = Array.from({ length: 5000 }, (_, index) => event(5000 - index));
    const test = setup(initial);
    const sort = vi.spyOn(Array.prototype, "sort");
    const sub = TimelineModel({})(test.store).subscribe();
    const afterInitial = sort.mock.calls.length;
    test.insert$.next(event(6000));
    await vi.advanceTimersByTimeAsync(16);
    const afterSparse = sort.mock.calls.length;
    test.insert$.next(event(6001));
    test.insert$.next(event(6002));
    await vi.advanceTimersByTimeAsync(16);
    const sortedLengths = sort.mock.instances
      .slice(afterSparse)
      .map((array) => (Array.isArray(array) ? array.length : undefined));
    sort.mockRestore();
    expect(afterInitial).toBe(0);
    expect(afterSparse).toBe(0);
    expect(sortedLengths).toEqual([2]);
    sub.unsubscribe();
  });

  it("suppresses batches with no net membership change and never claims ignored inputs", async () => {
    const member = event(2, 2, 0);
    const test = setup([member]);
    const snapshots = vi.fn();
    const sub = TimelineModel({ kinds: [0] })(test.store).subscribe(snapshots);
    test.insert$.next(member);
    test.insert$.next(event(1, 1, 0));
    test.insert$.next(event(3));
    test.remove$.next(event(4, 4, 0));
    expect(vi.getTimerCount()).toBe(0);
    expect(test.claim).toHaveBeenCalledExactlyOnceWith(member);
    sub.unsubscribe();

    const empty = setup();
    const changes = vi.fn();
    const active = TimelineModel({})(empty.store).subscribe(changes);
    const temporary = event(1);
    empty.insert$.next(temporary);
    empty.remove$.next(temporary);
    await vi.advanceTimersByTimeAsync(16);
    expect(changes).toHaveBeenCalledExactlyOnceWith([]);
    expect(empty.owners.size).toBe(0);
    active.unsubscribe();
  });

  it("handles removal and reinsertion of the same id without duplicating a snapshot entry", async () => {
    const first = event(1, 1);
    const second = event(2, 1);
    const test = setup([first, second]);
    let latest: NostrEvent[] = [];
    const sub = TimelineModel({})(test.store).subscribe((value) => (latest = value));
    test.remove$.next(second);
    test.insert$.next(second);
    test.insert$.next(event(3, 1));
    await vi.advanceTimersByTimeAsync(16);
    expect(latest.map((member) => member.id)).toEqual([event(3).id, second.id, first.id]);
    sub.unsubscribe();
  });

  it.each([false, true])(
    "matches an independent oracle after every batch with includeOldVersion=%s",
    async (includeOldVersion) => {
      const test = setup();
      let latest: NostrEvent[] = [];
      const sub = TimelineModel({}, { includeOldVersion })(test.store).subscribe((value) => (latest = value));
      const expected = new Map<string, { event: NostrEvent; sequence: number }>();
      const candidates = Array.from({ length: 100 }, (_, index) =>
        event(index + 1, index % 17, index % 3 === 0 ? 0 : 1),
      );
      let seed = 12345;
      let sequence = 0;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      };
      for (let batch = 0; batch < 30; batch++) {
        for (let index = 0; index < 50; index++) {
          const member = candidates[random() % candidates.length];
          const key = !includeOldVersion && member.kind === 0 ? "profile" : member.id;
          if (random() % 3 === 0) {
            test.remove$.next(member);
            if (expected.get(key)?.event.id === member.id) expected.delete(key);
          } else {
            test.insert$.next(member);
            const previous = expected.get(key)?.event;
            if (
              !previous ||
              (previous.id !== member.id &&
                (member.created_at > previous.created_at ||
                  (member.created_at === previous.created_at && member.id < previous.id)))
            )
              expected.set(key, { event: member, sequence: sequence++ });
          }
        }
        await vi.advanceTimersByTimeAsync(16);
        const sorted = Array.from(expected.values()).sort(
          (a, b) => b.event.created_at - a.event.created_at || b.sequence - a.sequence,
        );
        expect(latest).toEqual(sorted.map((entry) => entry.event));
        expect(test.owners).toEqual(new Map(latest.map((member) => [member, 1])));
      }
      sub.unsubscribe();
      expect(test.owners.size).toBe(0);
    },
  );

  it("rebuilds a small remainder after mass removal without changing tie ordering", async () => {
    const initial = Array.from({ length: 100 }, (_, index) => event(100 - index));
    const test = setup(initial);
    const snapshots: NostrEvent[][] = [];
    const sub = TimelineModel({})(test.store).subscribe((value) => snapshots.push(value));
    for (const member of initial.slice(0, 95)) test.remove$.next(member);
    const addition = event(101, 2);
    test.insert$.next(addition);
    await vi.advanceTimersByTimeAsync(16);
    expect(snapshots[1]).toEqual([...initial.slice(95, 98), addition, ...initial.slice(98)]);
    expect(snapshots[0]).toEqual(initial);
    for (const member of snapshots[1]) test.remove$.next(member);
    await vi.advanceTimersByTimeAsync(16);
    expect(snapshots[2]).toEqual([]);
    expect(test.owners.size).toBe(0);
    sub.unsubscribe();
  });

  it("releases replacements immediately and chooses the NIP-01 winner", async () => {
    const test = setup();
    let latest: NostrEvent[] = [];
    const sub = TimelineModel({})(test.store).subscribe((value) => (latest = value));
    for (let index = 1; index <= 1000; index++) test.insert$.next(event(index, index, 0));
    const winner = event(999, 1000, 0);
    test.insert$.next(winner);
    test.remove$.next(event(1000, 1000, 0));
    test.insert$.next(event(1001, 1000, 0));
    expect(test.owners).toEqual(new Map([[winner, 1]]));
    await vi.advanceTimersByTimeAsync(16);
    expect(latest).toEqual([winner]);
    sub.unsubscribe();
    expect(test.owners.size).toBe(0);
  });

  it("preserves the boolean history argument through store.timeline", async () => {
    const store = new EventStore({ verifyEvent: () => true, keepOldVersions: true });
    const first = event(1, 1, 0);
    const second = event(2, 2, 0);
    store.add(first);
    let latest: NostrEvent[] = [];
    store.timeline({}, true).subscribe((value) => (latest = value));
    store.add(second);
    await vi.advanceTimersByTimeAsync(16);
    expect(latest).toEqual([second, first]);
    store.dispose();
  });

  it("selects initial replacement winners without claiming discarded versions", () => {
    const older = event(3, 1, 0);
    const loser = event(2, 2, 0);
    const winner = event(1, 2, 0);
    const test = setup([loser, winner, older]);
    const next = vi.fn();
    const sub = TimelineModel({})(test.store).subscribe(next);
    expect(next).toHaveBeenCalledExactlyOnceWith([winner]);
    expect(test.claim).toHaveBeenCalledExactlyOnceWith(winner);
    sub.unsubscribe();
  });

  it("replays updates while an async snapshot loads without losing inserts or resurrecting removals", async () => {
    const first = event(1);
    const second = event(2);
    const test = setup(Promise.resolve([first]));
    const snapshots: NostrEvent[][] = [];
    const sub = TimelineModel({})(test.store).subscribe((value) => snapshots.push(value));
    test.remove$.next(first);
    test.insert$.next(second);
    expect(test.owners).toEqual(new Map([[second, 1]]));
    await Promise.resolve();
    expect(snapshots).toEqual([[second]]);
    sub.unsubscribe();
    expect(test.owners.size).toBe(0);
  });

  it("releases buffered inserts when unsubscribed before initialization", async () => {
    const test = setup(Promise.resolve([]));
    const snapshots = vi.fn();
    const sub = TimelineModel({})(test.store).subscribe(snapshots);
    test.insert$.next(event(1));
    sub.unsubscribe();
    await Promise.resolve();
    expect(snapshots).not.toHaveBeenCalled();
    expect(test.owners.size).toBe(0);
    expect(test.insert$.observed).toBe(false);
  });

  it("waits for an async snapshot when input streams complete first", async () => {
    const member = event(1);
    const test = setup(Promise.resolve([member]));
    const complete = vi.fn();
    const next = vi.fn();
    TimelineModel({})(test.store).subscribe({ next, complete });
    test.remove$.next(member);
    test.insert$.complete();
    test.remove$.complete();
    await Promise.resolve();
    expect(next).toHaveBeenCalledExactlyOnceWith([]);
    expect(complete).toHaveBeenCalledOnce();
    expect(test.owners.size).toBe(0);
  });

  it("flushes pending changes on completion and cancels the timer", () => {
    const test = setup();
    const next = vi.fn();
    const complete = vi.fn();
    TimelineModel({})(test.store).subscribe({ next, complete });
    const member = event(1);
    test.insert$.next(member);
    test.insert$.complete();
    test.remove$.complete();
    expect(next).toHaveBeenLastCalledWith([member]);
    expect(complete).toHaveBeenCalledOnce();
    expect(test.owners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases claims and cancels pending snapshots on stream error", () => {
    const test = setup();
    const error = vi.fn();
    TimelineModel({})(test.store).subscribe({ error });
    test.insert$.next(event(1));
    const failure = new Error("failed");
    test.remove$.error(failure);
    expect(error).toHaveBeenCalledWith(failure);
    expect(test.owners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports rejected snapshots and releases buffered claims", async () => {
    const failure = new Error("snapshot failed");
    const test = setup(Promise.reject(failure));
    const error = vi.fn();
    TimelineModel({})(test.store).subscribe({ error });
    test.insert$.next(event(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith(failure);
    expect(test.owners.size).toBe(0);
  });

  it("allows reentrant store updates to start a new batch without mutating the emitted snapshot", async () => {
    const test = setup();
    const snapshots: NostrEvent[][] = [];
    const first = event(1);
    const second = event(2);
    const sub = TimelineModel({})(test.store).subscribe((value) => {
      snapshots.push(value);
      if (value.length === 1) test.insert$.next(second);
    });
    test.insert$.next(first);
    await vi.advanceTimersByTimeAsync(32);
    expect(snapshots).toEqual([[], [first], [second, first]]);
    sub.unsubscribe();
  });

  it("cancels pending work at keep-warm expiry and rebuilds on resubscription", async () => {
    const store = new EventStore({ verifyEvent: () => true });
    store.modelKeepWarm = 10;
    const release = vi.spyOn(store, "removeClaim");
    const timeline = store.timeline({}, { batchWindow: 100 });
    expect(store.timeline({}, { batchWindow: 100 })).toBe(timeline);
    const next = vi.fn();
    const sub = timeline.subscribe(next);
    const member = event(1);
    store.add(member);
    sub.unsubscribe();
    await vi.advanceTimersByTimeAsync(10);
    expect(release).toHaveBeenCalledExactlyOnceWith(member);
    expect(next).toHaveBeenCalledExactlyOnceWith([]);
    expect(vi.getTimerCount()).toBe(0);
    const active = timeline.subscribe(next);
    expect(next).toHaveBeenLastCalledWith([member]);
    store.dispose();
    expect(active.closed).toBe(true);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("shares equivalent option and filter shapes without duplicating timeline computation", () => {
    const store = new EventStore({ verifyEvent: () => true });
    const filters = { kinds: [1] };
    const timeline = store.timeline(filters);
    expect(store.model(TimelineModel, [filters], { batchWindow: 16, includeOldVersion: false })).toBe(timeline);
    expect(store.timeline(filters, { batchWindow: false })).not.toBe(timeline);
    expect(store.timeline(filters, true)).toBe(store.timeline([filters], { includeOldVersion: true }));
    store.dispose();
  });

  it("supports unsigned StoreEvent members", async () => {
    const store = new EventStore<StoreEvent>({ verifyEvent: () => true });
    let latest: StoreEvent[] = [];
    store.model(TimelineModel<StoreEvent>, {}).subscribe((value) => (latest = value));
    const { sig: _sig, ...rumor } = event(1);
    store.add(rumor);
    await vi.advanceTimersByTimeAsync(16);
    expect(latest).toEqual([rumor]);
    store.dispose();
  });

  it("shows downstream throttling cannot avoid immediate snapshot construction", () => {
    const test = setup();
    const computed = vi.fn();
    const notifications = vi.fn();
    const sub = TimelineModel(
      {},
      { batchWindow: false },
    )(test.store)
      .pipe(tap(computed), throttleTime(16, undefined, { leading: true, trailing: true }))
      .subscribe(notifications);
    for (let index = 1; index <= 100; index++) test.insert$.next(event(index));
    expect(computed).toHaveBeenCalledTimes(101);
    expect(notifications).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it.each([-1, Infinity, NaN, 2147483648])("rejects invalid batchWindow %s", (batchWindow) => {
    expect(() => TimelineModel({}, { batchWindow })).toThrow("batchWindow");
  });
});
