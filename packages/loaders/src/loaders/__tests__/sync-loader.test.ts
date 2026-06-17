import { EventStore } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { asyncScheduler, lastValueFrom, NEVER, Observable, of, scheduled, Subject, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { createSyncLoader, SyncLoaderStatus, SyncRequestMethod } from "../sync-loader.js";

const user = new FakeUser();

function collect<T>(observable: Observable<T>): Promise<T[]> {
  return lastValueFrom(observable.pipe(toArray()));
}

// Emits the events asynchronously, mirroring a real relay REQ (a synchronous source would be re-run by the
// store operator's internal share() and inflate the request count)
function asyncOf(...events: NostrEvent[]): Observable<NostrEvent> {
  return scheduled(events, asyncScheduler);
}

// Drives the internal paginated REQ path by using a relay that does not support NIP-77
function requestLoader(request: SyncRequestMethod, limit?: number) {
  const eventStore = new EventStore();
  const getSupported = vi.fn().mockResolvedValue([1]);
  const loader = createSyncLoader({ eventStore, request, getSupported, sync: vi.fn() });
  return loader({ relays: ["wss://relay/"], filter: { kinds: [1], authors: [user.pubkey] }, limit });
}

describe("paginated request", () => {
  it("pages backward until a block comes back empty", async () => {
    const a = user.note("a", { created_at: 100 });
    const b = user.note("b", { created_at: 90 });
    const c = user.note("c", { created_at: 80 });

    // First block returns 2 events, second returns 1, third is empty
    const request: SyncRequestMethod = vi
      .fn()
      .mockReturnValueOnce(asyncOf(a, b))
      .mockReturnValueOnce(asyncOf(c))
      .mockReturnValueOnce(asyncOf());

    const events = await collect(requestLoader(request, 2).events$);

    expect(events.map((e) => e.content)).toEqual(["a", "b", "c"]);
    expect(request).toHaveBeenCalledTimes(3);
    // The second call moves past the oldest event of the first block (90 - 1)
    expect((request as any).mock.calls[1][1]).toEqual([{ kinds: [1], authors: [user.pubkey], until: 89, limit: 2 }]);
  });

  it("stops without emitting duplicates if the relay makes no backward progress", async () => {
    const a = user.note("a", { created_at: 100 });
    // The relay ignores `until` and keeps returning the same event
    const request: SyncRequestMethod = vi.fn().mockReturnValue(asyncOf(a));

    const events = await collect(requestLoader(request, 1).events$);

    // The out-of-window duplicate in the second block is dropped and pagination stops
    expect(events.map((e) => e.content)).toEqual(["a"]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("createSyncLoader", () => {
  const filter: Filter = { kinds: [1], authors: [user.pubkey] };

  it("uses negentropy sync when the relay supports NIP-77", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(of(a));
    const request = vi.fn();
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter });

    const events = await collect(events$);

    expect(events).toEqual([a]);
    expect(sync).toHaveBeenCalledWith("wss://relay/", filter);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses a paginated request when the relay does not support NIP-77", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn();
    const request = vi.fn().mockReturnValueOnce(of(a)).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter, limit: 10 });

    const events = await collect(events$);

    expect(events).toEqual([a]);
    expect(sync).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalled();
  });

  it("deduplicates events streamed from multiple relays", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(of(a));
    const request = vi.fn().mockReturnValue(of());
    // Both relays support NIP-77 and return the same event
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://one", "wss://two"], filter });

    const events = await collect(events$);

    expect(events).toEqual([a]);
  });

  it("emits a final status snapshot with done=true and the unique count", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(of(a));
    const request = vi.fn().mockReturnValue(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

    // Subscribe to both so the shared run drives the status stream
    const statusPromise = collect(status$);
    events$.subscribe();

    const statuses = await statusPromise;
    const last = statuses.at(-1) as SyncLoaderStatus;

    expect(last.done).toBe(true);
    expect(last.loaded).toBe(1);
    expect(last.relays["wss://relay/"].state).toBe("complete");
    expect(last.relays["wss://relay/"].method).toBe("negentropy");
    expect(last.relays["wss://relay/"].count).toBe(1);
  });

  it("falls back to a request when negentropy sync fails", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(throwError());
    const request = vi.fn().mockReturnValueOnce(of(a)).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter });

    const events = await collect(events$);

    expect(events).toEqual([a]);
    expect(request).toHaveBeenCalled();
  });

  it("marks synced events as seen on the relay they came from", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    // The negentropy sync emits the event without marking it as seen on the relay
    const sync = vi.fn().mockReturnValue(of(a));
    const request = vi.fn().mockReturnValue(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter });

    const [event] = await collect(events$);

    expect(getSeenRelays(event)?.has("wss://relay/")).toBe(true);
  });

  it("maps a relay pool to the internal methods", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const relay = {
      request: vi.fn().mockReturnValue(of()),
      getSupported: vi.fn().mockResolvedValue([1, 77]),
      sync: vi.fn().mockReturnValue(of(a)),
    };
    const pool = { relay: vi.fn().mockReturnValue(relay) };

    const loader = createSyncLoader({ eventStore, pool });
    const { events$ } = loader({ relays: ["wss://relay/"], filter });

    const events = await collect(events$);

    expect(events).toEqual([a]);
    expect(pool.relay).toHaveBeenCalledWith("wss://relay/");
    expect(relay.sync).toHaveBeenCalledWith(eventStore, filter);
  });

  it("surfaces a relay error as an error status without failing the loader", async () => {
    const eventStore = new EventStore();

    const sync = vi.fn();
    const request = vi.fn().mockReturnValue(throwError());
    const getSupported = vi.fn().mockResolvedValue([1]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

    const statusPromise = collect(status$);
    events$.subscribe();

    const statuses = await statusPromise;
    const last = statuses.at(-1) as SyncLoaderStatus;

    expect(last.done).toBe(true);
    expect(last.relays["wss://relay/"].state).toBe("error");
    expect(last.relays["wss://relay/"].error).toBeInstanceOf(Error);
  });

  it("times out an unresponsive negentropy sync and falls back to a request", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    // The sync never emits or completes
    const sync = vi.fn().mockReturnValue(NEVER);
    const request = vi.fn().mockReturnValueOnce(of(a)).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter, timeout: 20 });

    const events = await collect(events$);

    expect(events).toEqual([a]);
    expect(request).toHaveBeenCalled();
  });

  it("errors a relay that never responds and still completes the loader", async () => {
    const eventStore = new EventStore();

    // Neither the support check resolves nor the request responds
    const sync = vi.fn();
    const request = vi.fn().mockReturnValue(NEVER);
    const getSupported = vi.fn().mockResolvedValue([1]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter, timeout: 20 });

    const statusPromise = collect(status$);
    events$.subscribe();

    // The loader completes (does not hang) and marks the relay as errored
    const statuses = await statusPromise;
    const last = statuses.at(-1) as SyncLoaderStatus;

    expect(last.done).toBe(true);
    expect(last.relays["wss://relay/"].state).toBe("error");
  });

  it("limits how many relays load concurrently", async () => {
    const eventStore = new EventStore();

    // Hold the first relay's support check open so the second cannot start under concurrency 1
    const gate = new Subject<number[]>();
    const getSupported = vi.fn().mockReturnValueOnce(gate).mockReturnValueOnce(of([1]));
    const request = vi.fn().mockReturnValue(of());
    const sync = vi.fn();

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://one/", "wss://two/"], filter, concurrency: 1 });

    const sub = events$.subscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only the first relay has started
    expect(getSupported).toHaveBeenCalledTimes(1);

    // Let the first relay finish, then the second should start
    gate.next([1]);
    gate.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSupported).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it("replays the latest status to a status$ subscriber that joins after the run started", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    // Keep the sync open so the run stays mid-flight while status$ subscribes late
    const syncSubject = new Subject<NostrEvent>();
    const sync = vi.fn().mockReturnValue(syncSubject);
    const request = vi.fn().mockReturnValue(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter, timeout: false });

    // Subscribe to events$ first; the run starts before status$ joins
    const events: NostrEvent[] = [];
    const eventsSub = events$.subscribe((event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // status$ joins late and should immediately receive the current (loading) status
    const statuses: SyncLoaderStatus[] = [];
    const statusSub = status$.subscribe((status) => statuses.push(status));
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.at(-1)!.relays["wss://relay/"].state).toBe("loading");

    // Completing the sync finishes both observables
    syncSubject.next(a);
    syncSubject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(statuses.at(-1)!.done).toBe(true);
    expect(events).toEqual([a]);

    eventsSub.unsubscribe();
    statusSub.unsubscribe();
  });

  it("does not count events the store rejects in loaded", async () => {
    const eventStore = new EventStore();
    const valid = user.note("valid");
    // An already-expired event is rejected by the store
    const expired = user.event({ content: "expired", tags: [["expiration", "1"]] });

    const sync = vi.fn().mockReturnValue(of(valid, expired));
    const request = vi.fn().mockReturnValue(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

    const statusPromise = collect(status$);
    const events = await collect(events$);
    const last = (await statusPromise).at(-1) as SyncLoaderStatus;

    // Only the accepted event is emitted and counted
    expect(events).toEqual([valid]);
    expect(last.loaded).toBe(1);
  });

  it("emits a status update when falling back from negentropy to a request", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(throwError());
    const request = vi.fn().mockReturnValueOnce(of(a)).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

    const statusPromise = collect(status$);
    events$.subscribe();
    const statuses = await statusPromise;

    // The fallback is surfaced mid-load, not only at completion
    const fallback = statuses.find(
      (status) =>
        status.relays["wss://relay/"].state === "loading" && status.relays["wss://relay/"].method === "request",
    );
    expect(fallback).toBeDefined();
  });
});

/** Returns an observable that errors immediately */
function throwError(): Observable<never> {
  return new Observable((observer) => observer.error(new Error("sync failed")));
}
