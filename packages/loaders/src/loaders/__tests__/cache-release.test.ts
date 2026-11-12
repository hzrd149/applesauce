import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { concat, defer, EMPTY, NEVER, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { CacheEmission, CacheRelease, NostrRequest } from "../../types.js";
import { LoadableAddressPointer } from "../address-loader.js";
import { LoadableEventPointer } from "../event-loader.js";
import { createUnifiedEventLoader, UnifiedEventLoader } from "../unified-event-loader.js";

const user = new FakeUser();
const loaders: UnifiedEventLoader[] = [];
const release: CacheRelease = { type: "release" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const loader of loaders.splice(0)) loader.stop();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const cases: {
  name: string;
  event: (name: string) => NostrEvent;
  pointer: (event: NostrEvent) => LoadableEventPointer | LoadableAddressPointer;
}[] = [
  { name: "event", event: (name) => user.note(name), pointer: (event) => ({ id: event.id }) },
  {
    name: "address",
    event: (name) => user.event({ kind: 30078, tags: [["d", name]] }),
    pointer: (event) => ({ kind: event.kind, pubkey: event.pubkey, identifier: event.tags[0][1] }),
  },
];

describe.each(cases)("cache release ($name)", ({ event, pointer }) => {
  const create = (...args: Parameters<typeof createUnifiedEventLoader>) => {
    const loader = createUnifiedEventLoader(...args);
    loaders.push(loader);
    return loader;
  };

  it.each([false, true])("starts relays only for blocking misses (explicit release: %s)", (explicit) => {
    const cached = event("blocking-hit");
    const missing = event("blocking-miss");
    const cache = new Subject<CacheEmission>();
    const request = vi.fn<NostrRequest>(() => of(missing));
    const loader = create(request, {
      bufferTime: 10,
      cacheRequest: () => cache,
      extraRelays: ["wss://extra.test/"],
    });
    const a = subscribeSpyTo(loader(pointer(cached)));
    const b = subscribeSpyTo(loader(pointer(missing)));
    vi.advanceTimersByTime(10);
    cache.next(cached);
    expect(request).not.toHaveBeenCalled();
    expect(a.getValues()).toEqual([cached]);

    if (explicit) cache.next(release);
    else cache.complete();

    expect(request).toHaveBeenCalledOnce();
    const filter = request.mock.calls[0][1][0];
    if ("id" in pointer(missing)) expect(filter.ids).toEqual([missing.id]);
    else expect(filter["#d"]).toEqual([missing.tags[0][1]]);
    expect(b.getValues()).toEqual([missing]);
    expect(a.receivedComplete()).toBe(true);
    expect(b.receivedComplete()).toBe(true);
    expect(cache.observed).toBe(false);
  });

  it("ignores repeated releases and keeps one cache subscription", () => {
    const target = event("repeat-release");
    const cache = new Subject<CacheEmission>();
    const cacheRequest = vi.fn(() => cache);
    const primary = new Subject<NostrEvent>();
    const request = vi.fn(() => primary);
    const loader = create(request, {
      bufferTime: 10,
      cacheRequest,
      extraRelays: ["wss://extra.test/"],
    });
    const spy = subscribeSpyTo(loader(pointer(target)));
    vi.advanceTimersByTime(10);
    cache.next(release);
    cache.next(release);
    cache.next(target);
    cache.complete();

    expect(request).toHaveBeenCalledOnce();
    expect(cacheRequest).toHaveBeenCalledOnce();
    expect(spy.getValues()).toEqual([target]);
    expect(spy.receivedComplete()).toBe(false);
    primary.complete();
    expect(spy.receivedComplete()).toBe(true);
  });

  it("starts relays when a blocking cache times out without releasing", () => {
    const target = event("blocking-timeout");
    const cache = new Subject<CacheEmission>();
    const request = vi.fn(() => of(target));
    const loader = create(request, {
      bufferTime: 10,
      stageTimeout: 100,
      cacheRequest: () => cache,
      extraRelays: ["wss://extra.test/"],
    });
    const spy = subscribeSpyTo(loader(pointer(target)));
    vi.advanceTimersByTime(10);
    expect(request).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(cache.observed).toBe(false);
    expect(spy.getValues()).toEqual([target]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("delivers blocking cache hits and skips work after release when fully resolved", () => {
    const cached = event("disk");
    const supplemental = vi.fn(() => NEVER);
    const request = vi.fn(() => NEVER);
    const loader = create(request, {
      bufferTime: 10,
      cacheRequest: () => concat(of(cached, release), defer(supplemental)),
      extraRelays: ["wss://extra.test/"],
    });

    const spy = subscribeSpyTo(loader(pointer(cached)));
    vi.advanceTimersByTime(10);

    expect(spy.getValues()).toEqual([cached]);
    expect(spy.receivedComplete()).toBe(true);
    expect(supplemental).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("runs fallback while the optional cache is held open", () => {
    const target = event("fallback");
    const primary = new Subject<NostrEvent>();
    const supplemental = new Subject<NostrEvent>();
    const loader = create(() => primary, {
      bufferTime: 10,
      cacheRequest: () => concat(of(release), supplemental),
      extraRelays: ["wss://extra.test/"],
    });

    const spy = subscribeSpyTo(loader(pointer(target)));
    vi.advanceTimersByTime(10);
    expect(primary.observed).toBe(true);
    expect(supplemental.observed).toBe(true);

    primary.next(target);
    primary.complete();

    expect(spy.getValues()).toEqual([target]);
    expect(spy.receivedComplete()).toBe(true);
    expect(supplemental.observed).toBe(false);
  });

  it.each(["before", "after"])(
    "releases mixed-source batches when the cache hit arrives %s primary completion",
    (order) => {
      const first = event("primary");
      const second = event("supplemental");
      const primary = new Subject<NostrEvent>();
      const supplemental = new Subject<NostrEvent>();
      const loader = create(() => primary, {
        bufferTime: 10,
        stageTimeout: 0,
        cacheRequest: () => concat(of(release), supplemental),
        extraRelays: ["wss://extra.test/"],
      });

      const a = subscribeSpyTo(loader(pointer(first)));
      const b = subscribeSpyTo(loader(pointer(second)));
      vi.advanceTimersByTime(10);
      primary.next(first);
      if (order === "before") supplemental.next(second);
      primary.complete();
      if (order === "after") supplemental.next(second);

      expect(a.getValues()).toEqual([first]);
      expect(b.getValues()).toEqual([second]);
      expect(a.receivedComplete()).toBe(true);
      expect(b.receivedComplete()).toBe(true);
      expect(supplemental.observed).toBe(false);
    },
  );

  it("keeps the primary sequence running after the cache resolves every pointer", () => {
    const target = event("cache-first");
    const primary = new Subject<NostrEvent>();
    const loader = create(() => primary, {
      bufferTime: 10,
      cacheRequest: () => of(release, target),
      extraRelays: ["wss://extra.test/"],
    });

    const spy = subscribeSpyTo(loader(pointer(target)));
    vi.advanceTimersByTime(10);

    expect(spy.getValues()).toEqual([target]);
    expect(primary.observed).toBe(true);
    expect(spy.receivedComplete()).toBe(false);

    primary.next(target);
    primary.complete();
    expect(spy.getValues()).toEqual([target]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("bounds an unresolved optional cache with the stage timeout", () => {
    const supplemental = new Subject<NostrEvent>();
    const loader = create(() => EMPTY, {
      bufferTime: 10,
      stageTimeout: 100,
      cacheRequest: () => concat(of(release), supplemental),
    });

    const spy = subscribeSpyTo(loader(pointer(event("missing"))));
    vi.advanceTimersByTime(10);
    expect(spy.receivedComplete()).toBe(false);
    vi.advanceTimersByTime(100);

    expect(spy.receivedComplete()).toBe(true);
    expect(supplemental.observed).toBe(false);
  });

  it("starts a queued batch after mixed-source results resolve the active batch", () => {
    const first = event("first-batch-primary");
    const second = event("first-batch-cache");
    const third = event("queued-batch");
    const primary = new Subject<NostrEvent>();
    const supplemental = new Subject<NostrEvent>();
    const request = vi.fn(() => primary);
    const cache = vi.fn(() => supplemental);
    const loader = create(request, {
      bufferTime: 10,
      stageTimeout: 0,
      maxConcurrentBatches: 1,
      cacheRequest: () => concat(of(release), defer(cache)),
      extraRelays: ["wss://extra.test/"],
    });

    subscribeSpyTo(loader(pointer(first)));
    subscribeSpyTo(loader(pointer(second)));
    vi.advanceTimersByTime(10);
    const queued = subscribeSpyTo(loader(pointer(third)));
    vi.advanceTimersByTime(10);
    expect(cache).toHaveBeenCalledTimes(1);

    primary.next(first);
    primary.complete();
    supplemental.next(second);
    expect(cache).toHaveBeenCalledTimes(2);

    supplemental.next(third);
    expect(queued.getValues()).toEqual([third]);
    expect(queued.receivedComplete()).toBe(true);
    expect(supplemental.observed).toBe(false);
  });

  it.each(["sync", "async"])("isolates %s optional cache failures", (mode) => {
    const target = event("healthy");
    const primary = new Subject<NostrEvent>();
    const supplemental = new Subject<NostrEvent>();
    const loader = create(() => primary, {
      bufferTime: 10,
      cacheRequest: () => {
        if (mode === "sync") throw new Error("cache unavailable");
        return concat(of(release), supplemental);
      },
      extraRelays: ["wss://extra.test/"],
    });

    const spy = subscribeSpyTo(loader(pointer(target)));
    vi.advanceTimersByTime(10);
    if (mode === "async") supplemental.error(new Error("cache unavailable"));
    primary.next(target);
    primary.complete();

    expect(spy.getValues()).toEqual([target]);
    expect(spy.receivedError()).toBe(false);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("honors cache bypass when duplicate pointers disagree", () => {
    const target = event("bypass");
    const cache = vi.fn(() => [target]);
    const loader = create(() => of(target), {
      bufferTime: 10,
      cacheRequest: cache,
      extraRelays: ["wss://extra.test/"],
    });

    const a = subscribeSpyTo(loader(pointer(target)));
    const b = subscribeSpyTo(loader({ ...pointer(target), cache: false }));
    vi.advanceTimersByTime(10);

    expect(a.getValues()).toEqual([target]);
    expect(b.getValues()).toEqual([target]);
    expect(cache).not.toHaveBeenCalled();
  });

  it("tears down both branches when aborted", () => {
    const primary = new Subject<NostrEvent>();
    const supplemental = new Subject<NostrEvent>();
    const controller = new AbortController();
    const loader = create(() => primary, {
      bufferTime: 10,
      cacheRequest: () => concat(of(release), supplemental),
      extraRelays: ["wss://extra.test/"],
      signal: controller.signal,
    });

    const spy = subscribeSpyTo(loader(pointer(event("abort"))));
    vi.advanceTimersByTime(10);
    expect(primary.observed).toBe(true);
    expect(supplemental.observed).toBe(true);
    controller.abort();

    expect(primary.observed).toBe(false);
    expect(supplemental.observed).toBe(false);
    expect(spy.receivedComplete()).toBe(true);
  });
});

it("delivers a newer address version from the primary after an optional cache hit", () => {
  const older = user.profile({ name: "older" }, { created_at: 100 });
  const newer = user.profile({ name: "newer" }, { created_at: 200 });
  const primary = new Subject<NostrEvent>();
  const loader = createUnifiedEventLoader(() => primary, {
    bufferTime: 10,
    cacheRequest: () => of(release, older),
    extraRelays: ["wss://extra.test/"],
  });
  loaders.push(loader);

  const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));
  vi.advanceTimersByTime(10);
  primary.next(newer);
  primary.complete();

  expect(spy.getValues()).toEqual([older, newer]);
  expect(spy.receivedComplete()).toBe(true);
});
