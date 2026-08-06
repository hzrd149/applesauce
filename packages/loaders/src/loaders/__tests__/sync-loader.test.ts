import { EventStore } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { asyncScheduler, lastValueFrom, NEVER, Observable, of, scheduled, Subject, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { createSyncLoader, SyncAuthContext, SyncLoaderStatus, SyncMethodOptions, SyncRequestMethod } from "../sync-loader.js";

const user = new FakeUser();

function collect<T>(observable: Observable<T>): Promise<T[]> {
  return lastValueFrom(observable.pipe(toArray()));
}

/** A minimal SyncAuthContext for tests that need to invoke a wrapped onAuthRequired handler directly */
function authContext(overrides: Partial<SyncAuthContext> = {}): SyncAuthContext {
  return {
    relay: {} as SyncAuthContext["relay"],
    url: "wss://relay/",
    challenge: null,
    requirement: true,
    missingPubkeys: null,
    reason: "auth-required: please authenticate",
    ...overrides,
  };
}

// Emits the events asynchronously, mirroring a real relay REQ (a synchronous source would be re-run by the
// store operator's internal share() and inflate the request count)
function asyncOf(...events: NostrEvent[]): Observable<NostrEvent> {
  return scheduled(events, asyncScheduler);
}

// Drives the internal paginated REQ path by using a relay that does not support NIP-77
function requestLoader(
  request: SyncRequestMethod,
  limit?: number,
  filter: Filter = { kinds: [1], authors: [user.pubkey] },
) {
  const eventStore = new EventStore();
  const getSupported = vi.fn().mockResolvedValue([1]);
  const loader = createSyncLoader({ eventStore, request, getSupported, sync: vi.fn() });
  return loader({ relays: ["wss://relay/"], filter, limit });
}

describe("paginated request", () => {
  it("pages backward until a block comes back empty", async () => {
    const a = user.note("a", { created_at: 100 });
    const b = user.note("b", { created_at: 90 });
    const c = user.note("c", { created_at: 80 });

    // First block returns 2 events, second returns a short page and completes
    const request: SyncRequestMethod = vi.fn().mockReturnValueOnce(asyncOf(a, b)).mockReturnValueOnce(asyncOf(c));

    const events = await collect(requestLoader(request, 2).events$);

    expect(events.map((e) => e.content)).toEqual(["a", "b", "c"]);
    expect(request).toHaveBeenCalledTimes(2);
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

  it("preserves since while paging backward from until", async () => {
    const a = user.note("a", { created_at: 100 });
    const b = user.note("b", { created_at: 90 });
    const c = user.note("c", { created_at: 80 });
    const filter: Filter = { kinds: [1], authors: [user.pubkey], since: 75, until: 105 };

    const request: SyncRequestMethod = vi.fn().mockReturnValueOnce(asyncOf(a, b)).mockReturnValueOnce(asyncOf(c));

    const events = await collect(requestLoader(request, 2, filter).events$);

    expect(events.map((e) => e.content)).toEqual(["a", "b", "c"]);
    expect((request as any).mock.calls[0][1]).toEqual([{ ...filter, limit: 2 }]);
    expect((request as any).mock.calls[1][1]).toEqual([{ ...filter, until: 89, limit: 2 }]);
  });

  it("stops when the next page would move before since", async () => {
    const a = user.note("a", { created_at: 100 });
    const b = user.note("b", { created_at: 90 });
    const filter: Filter = { kinds: [1], authors: [user.pubkey], since: 90, until: 105 };

    const request: SyncRequestMethod = vi.fn().mockReturnValueOnce(asyncOf(a, b));

    const events = await collect(requestLoader(request, 2, filter).events$);

    expect(events.map((e) => e.content)).toEqual(["a", "b"]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("drops events outside the requested window", async () => {
    const newer = user.note("newer", { created_at: 110 });
    const inRange = user.note("in range", { created_at: 95 });
    const older = user.note("older", { created_at: 80 });
    const filter: Filter = { kinds: [1], authors: [user.pubkey], since: 90, until: 100 };

    // The relay ignores since/until, but the filtered in-window page is short and completes
    const request: SyncRequestMethod = vi.fn().mockReturnValue(asyncOf(newer, inRange, older));

    const events = await collect(requestLoader(request, 3, filter).events$);

    expect(events.map((e) => e.content)).toEqual(["in range"]);
    expect(request).toHaveBeenCalledTimes(1);
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
    expect(sync).toHaveBeenCalledTimes(1);
    const opts = (sync as any).mock.calls[0][2] as SyncMethodOptions;
    expect(opts.waitForAuth).toBeUndefined();
    // WR-03: the auth-phase wrapper is installed even when the caller supplied no onAuthRequired
    expect(typeof opts.onAuthRequired).toBe("function");
    expect(request).not.toHaveBeenCalled();
  });

  it("threads waitForAuth into the negentropy sync", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(of(a));
    const request = vi.fn();
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter, waitForAuth: user.pubkey });

    await collect(events$);

    expect(sync).toHaveBeenCalledTimes(1);
    const opts = (sync as any).mock.calls[0][2] as SyncMethodOptions;
    expect(opts.waitForAuth).toBe(user.pubkey);
    // WR-03: the auth-phase wrapper is installed even when the caller supplied no onAuthRequired
    expect(typeof opts.onAuthRequired).toBe("function");
  });

  it("threads waitForAuth into the paginated request", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn();
    const request = vi.fn().mockReturnValue(of(a));
    const getSupported = vi.fn().mockResolvedValue([1]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter, waitForAuth: user.pubkey });

    await collect(events$);

    expect(request).toHaveBeenCalledTimes(1);
    const opts = (request as any).mock.calls[0][2] as SyncMethodOptions;
    expect(opts.waitForAuth).toBe(user.pubkey);
    // WR-03: the auth-phase wrapper is installed even when the caller supplied no onAuthRequired
    expect(typeof opts.onAuthRequired).toBe("function");
    expect(sync).not.toHaveBeenCalled();
  });

  it("threads onAuthRequired, authTimeout and authRetries into the negentropy sync (RAUTH-08)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(of(a));
    const request = vi.fn();
    const getSupported = vi.fn().mockResolvedValue([1, 77]);
    const onAuthRequired = vi.fn().mockResolvedValue(undefined);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({
      relays: ["wss://relay/"],
      filter,
      waitForAuth: user.pubkey,
      onAuthRequired,
      authTimeout: 5_000,
      authRetries: 2,
    });

    await collect(events$);

    expect(sync).toHaveBeenCalledTimes(1);
    const opts = (sync as any).mock.calls[0][2] as SyncMethodOptions;
    expect(opts.waitForAuth).toBe(user.pubkey);
    expect(opts.authTimeout).toBe(5_000);
    expect(opts.authRetries).toBe(2);

    // onAuthRequired is wrapped (the loader owns its own suspension signal), so assert delegation
    // behavior rather than reference equality
    expect(typeof opts.onAuthRequired).toBe("function");
    expect(opts.onAuthRequired).not.toBe(onAuthRequired);
    const context = authContext();
    await opts.onAuthRequired!(context);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledWith(context);
  });

  it("threads onAuthRequired, authTimeout and authRetries into the paginated request (RAUTH-08)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn();
    const request = vi.fn().mockReturnValue(of(a));
    const getSupported = vi.fn().mockResolvedValue([1]);
    const onAuthRequired = vi.fn().mockResolvedValue(undefined);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({
      relays: ["wss://relay/"],
      filter,
      waitForAuth: user.pubkey,
      onAuthRequired,
      authTimeout: 5_000,
      authRetries: 2,
    });

    await collect(events$);

    expect(request).toHaveBeenCalledTimes(1);
    const opts = (request as any).mock.calls[0][2] as SyncMethodOptions;
    expect(opts.waitForAuth).toBe(user.pubkey);
    expect(opts.authTimeout).toBe(5_000);
    expect(opts.authRetries).toBe(2);

    expect(typeof opts.onAuthRequired).toBe("function");
    const context = authContext();
    await opts.onAuthRequired!(context);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledWith(context);
  });

  it("passes the exact same auth options object to both the negentropy sync and its paginated fallback (RAUTH-08)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    // The negentropy sync fails for a non-auth reason, so the relay falls back to the paginated
    // request using the SAME per-relay options object (Task 1's single methodOptions construction)
    const sync = vi.fn().mockReturnValue(throwError());
    const request = vi.fn().mockReturnValueOnce(of(a)).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);
    const onAuthRequired = vi.fn().mockResolvedValue(undefined);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({
      relays: ["wss://relay/"],
      filter,
      waitForAuth: user.pubkey,
      onAuthRequired,
      authTimeout: 5_000,
      authRetries: 2,
    });

    await collect(events$);

    const syncOpts = (sync as any).mock.calls[0][2];
    const requestOpts = (request as any).mock.calls[0][2];
    // Both paths read the literal same object — "identically" is structural, not a coincidence
    expect(requestOpts).toBe(syncOpts);
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

  it("streams request events before the request completes", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");
    const requestSubject = new Subject<NostrEvent>();

    const sync = vi.fn();
    const request = vi.fn().mockReturnValueOnce(requestSubject).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter });

    const events: NostrEvent[] = [];
    const sub = events$.subscribe((event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 0));

    requestSubject.next(a);
    expect(events).toEqual([a]);

    requestSubject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sub.unsubscribe();
  });

  it("streams negentropy sync events before the sync completes", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");
    const syncSubject = new Subject<NostrEvent>();

    const sync = vi.fn().mockReturnValue(syncSubject);
    const request = vi.fn().mockReturnValue(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter, timeout: false });

    const events: NostrEvent[] = [];
    const sub = events$.subscribe((event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 0));

    syncSubject.next(a);
    expect(events).toEqual([a]);

    syncSubject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sub.unsubscribe();
  });

  it("does not drop events when status subscribes before events", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");
    const requestSubject = new Subject<NostrEvent>();

    const sync = vi.fn();
    const request = vi.fn().mockReturnValueOnce(requestSubject).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

    const statusSub = status$.subscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    requestSubject.next(a);

    const events: NostrEvent[] = [];
    const eventsSub = events$.subscribe((event) => events.push(event));
    expect(events).toEqual([a]);

    requestSubject.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    eventsSub.unsubscribe();
    statusSub.unsubscribe();
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
    expect(relay.sync).toHaveBeenCalledTimes(1);
    const opts = (relay.sync as any).mock.calls[0][3] as SyncMethodOptions;
    expect(opts.waitForAuth).toBeUndefined();
    // WR-03: the auth-phase wrapper is installed even when the caller supplied no onAuthRequired
    expect(typeof opts.onAuthRequired).toBe("function");
  });

  it("maps a relay pool to the internal methods, threading the three auth options (RAUTH-08)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const relay = {
      request: vi.fn().mockReturnValue(of()),
      getSupported: vi.fn().mockResolvedValue([1, 77]),
      sync: vi.fn().mockReturnValue(of(a)),
    };
    const pool = { relay: vi.fn().mockReturnValue(relay) };
    const onAuthRequired = vi.fn().mockResolvedValue(undefined);

    const loader = createSyncLoader({ eventStore, pool });
    const { events$ } = loader({ relays: ["wss://relay/"], filter, onAuthRequired, authTimeout: 5_000, authRetries: 2 });

    const events = await collect(events$);

    expect(events).toEqual([a]);
    expect(relay.sync).toHaveBeenCalledTimes(1);
    const opts = (relay.sync as any).mock.calls[0][3] as SyncMethodOptions;
    expect(opts.authTimeout).toBe(5_000);
    expect(opts.authRetries).toBe(2);
    expect(typeof opts.onAuthRequired).toBe("function");
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
    const getSupported = vi
      .fn()
      .mockReturnValueOnce(gate)
      .mockReturnValueOnce(of([1]));
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

  it("suspends the stall guard while a slow onAuthRequired handler is running (D-16)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");
    const request = vi.fn();
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    // The handler takes 40ms to resolve, longer than the loader's 20ms stall-guard budget
    const onAuthRequired = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 40)));

    // Mirrors what a real relay's authRetryOperator does: invoke the (wrapped) handler, then emit once
    // it settles
    const sync = vi.fn().mockImplementation((_url: unknown, _filter: unknown, opts: SyncMethodOptions) => {
      return new Observable<NostrEvent>((observer) => {
        Promise.resolve(opts.onAuthRequired?.(authContext())).then(() => {
          observer.next(a);
          observer.complete();
        });
      });
    });

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({
      relays: ["wss://relay/"],
      filter,
      timeout: 20,
      onAuthRequired,
      authTimeout: false,
    });

    const statusPromise = collect(status$);
    const events = await collect(events$);
    const last = (await statusPromise).at(-1) as SyncLoaderStatus;

    expect(events).toEqual([a]);
    expect(last.relays["wss://relay/"].state).toBe("complete");
    expect(request).not.toHaveBeenCalled();
  });

  // HELD-OUT: reserved for RESEARCH Assumption A2. Suspending only for the duration of the handler call
  // (not the post-handler wait) makes this fail — verified empirically before landing this test (see the
  // plan summary's RED observation).
  it("suspends the stall guard through the post-handler auth wait, not just the handler call (D-16)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");
    const request = vi.fn();
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    // The handler resolves almost immediately...
    const onAuthRequired = vi.fn().mockResolvedValue(undefined);

    const sync = vi.fn().mockImplementation((_url: unknown, _filter: unknown, opts: SyncMethodOptions) => {
      return new Observable<NostrEvent>((observer) => {
        Promise.resolve(opts.onAuthRequired?.(authContext())).then(() => {
          // ...but the underlying stream (mirroring a slow post-handler authSatisfied$ wait) emits
          // nothing for longer than the loader's own 20ms stall-guard budget before finally emitting
          setTimeout(() => {
            observer.next(a);
            observer.complete();
          }, 40);
        });
      });
    });

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({
      relays: ["wss://relay/"],
      filter,
      timeout: 20,
      onAuthRequired,
      authTimeout: 100,
    });

    const statusPromise = collect(status$);
    const events = await collect(events$);
    const last = (await statusPromise).at(-1) as SyncLoaderStatus;

    expect(events).toEqual([a]);
    expect(last.relays["wss://relay/"].state).toBe("complete");
    expect(request).not.toHaveBeenCalled();
  });

  it("errors the relay without falling back when negentropy sync fails with an auth error name (D-16)", async () => {
    const eventStore = new EventStore();
    const authError = Object.assign(new Error("auth-required: please authenticate"), { name: "AuthTimeoutError" });

    const sync = vi.fn().mockReturnValue(throwError(authError));
    const request = vi.fn().mockReturnValue(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

    const statusPromise = collect(status$);
    events$.subscribe();
    const last = (await statusPromise).at(-1) as SyncLoaderStatus;

    expect(last.relays["wss://relay/"].state).toBe("error");
    expect(last.relays["wss://relay/"].error?.name).toBe("AuthTimeoutError");
    expect(request).not.toHaveBeenCalled();
  });

  it("still falls back to a request when negentropy sync fails with a non-auth error (D-16)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");

    const sync = vi.fn().mockReturnValue(throwError());
    const request = vi.fn().mockReturnValueOnce(of(a)).mockReturnValueOnce(of());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { events$ } = loader({ relays: ["wss://relay/"], filter });

    const events = await collect(events$);

    expect(events).toEqual([a]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

/** Returns an observable that errors immediately with `error`, defaulting to a generic sync failure */
function throwError(error: Error = new Error("sync failed")): Observable<never> {
  return new Observable((observer) => observer.error(error));
}

// 13-13: WR-03/WR-04 gap closure. Kept as its own describe block (not folded into "createSyncLoader"
// above) so later additions can append alongside it without disturbing this file's existing structure.
describe("13-13: handler-less auth-phase suspension and auth-phase timer lifetime (WR-03/WR-04)", () => {
  const filter: Filter = { kinds: [1], authors: [user.pubkey] };

  it("suspends the stall guard for a handler-less caller when the relay requires auth (WR-03)", async () => {
    const eventStore = new EventStore();
    const a = user.note("a");
    // The fallback path must never actually be reached once the fix holds; configured to fail loudly
    // (rather than complete emptily) so a pre-fix fallback trip surfaces as the relay's final ERROR
    // state, not a misleadingly "complete" empty result
    const request = vi.fn().mockReturnValue(throwError());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    // No onAuthRequired anywhere in the loader options. Mirrors what a real relay's authRetryOperator
    // does: invoke the (always-installed, WR-03) wrapper, then wait noticeably longer than the loader's
    // small stall-guard budget before emitting — the shape of a relay-side wait for out-of-band auth
    // under D-14
    const sync = vi.fn().mockImplementation((_url: unknown, _filter: unknown, opts: SyncMethodOptions) => {
      return new Observable<NostrEvent>((observer) => {
        Promise.resolve(opts.onAuthRequired?.(authContext())).then(() => {
          setTimeout(() => {
            observer.next(a);
            observer.complete();
          }, 40);
        });
      });
    });

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({
      relays: ["wss://relay/"],
      filter,
      timeout: 20,
      authTimeout: 100,
    });

    const statusPromise = collect(status$);
    const events = await collect(events$);
    const last = (await statusPromise).at(-1) as SyncLoaderStatus;

    // RED (pre-fix): last.relays["wss://relay/"].state read "error" (the handler-less call was a no-op,
    // the 20ms stall clock ran through the 40ms wait, timed out, fell back to a throwing request, and
    // the relay errored) and events read [] instead of [a]. See the SUMMARY for the recorded values.
    expect(events).toEqual([a]);
    expect(last.relays["wss://relay/"].state).toBe("complete");
    expect(request).not.toHaveBeenCalled();
  });

  // Control, not a RED observation of its own: proves the WR-03 fix does not become a permanent disarm.
  // Must pass both before and after the fix — a handler-less caller's suspension is bounded by
  // authTimeout, not turned off.
  it("still errors a handler-less caller once authTimeout elapses with no relay response (WR-03 control)", async () => {
    const eventStore = new EventStore();
    const request = vi.fn().mockReturnValue(throwError());
    const getSupported = vi.fn().mockResolvedValue([1, 77]);

    // Opens the auth phase (invokes the wrapper) and then never emits or completes at all
    const sync = vi.fn().mockImplementation((_url: unknown, _filter: unknown, opts: SyncMethodOptions) => {
      return new Observable<NostrEvent>((observer) => {
        void opts.onAuthRequired?.(authContext());
      });
    });

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({
      relays: ["wss://relay/"],
      filter,
      timeout: 20,
      authTimeout: 30,
    });

    const statusPromise = collect(status$);
    events$.subscribe();
    const last = (await statusPromise).at(-1) as SyncLoaderStatus;

    expect(last.relays["wss://relay/"].state).toBe("error");
  });

  it("clears the auth-phase timer when the run is torn down before the phase closes (WR-04)", async () => {
    vi.useFakeTimers();
    try {
      const eventStore = new EventStore();
      const request = vi.fn();
      const getSupported = vi.fn().mockResolvedValue([1, 77]);

      // Opens the auth phase and then never emits or completes — the phase's own timer is still
      // pending when the run below is torn down
      const sync = vi.fn().mockImplementation((_url: unknown, _filter: unknown, opts: SyncMethodOptions) => {
        return new Observable<NostrEvent>((observer) => {
          void opts.onAuthRequired?.(authContext());
        });
      });

      const loader = createSyncLoader({ eventStore, request, getSupported, sync });
      const { events$ } = loader({
        relays: ["wss://relay/"],
        filter,
        timeout: false,
        authTimeout: 10_000,
      });

      // Baseline before subscribing — no timer of this test's own is armed anywhere else, so the
      // assertions below can be an exact zero rather than a relative delta
      const baseline = vi.getTimerCount();
      const sub = events$.subscribe();

      // Drive the run far enough (past the asapScheduler microtask hop, getSupported's promise, and
      // sync()'s synchronous handler invocation) for the auth phase's own close-timer to be armed.
      // advanceTimersByTimeAsync is required over the synchronous form: the run starts on asapScheduler,
      // which is microtask-based, so a synchronous advance would never get it moving.
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBeGreaterThan(baseline);

      // Tear the run down by unsubscribing — nothing else will ever close this phase now
      sub.unsubscribe();

      // RED (pre-fix): this read baseline + 1 — no finalize hook existed to force-close the still-open
      // phase on unsubscribe, so its 10s close-timer survived teardown. See the SUMMARY for the actual
      // recorded pre-fix count.
      expect(vi.getTimerCount()).toBe(baseline);

      // Advancing well past authTimeout afterwards must produce no further emission and run no leaked
      // callback
      await vi.advanceTimersByTimeAsync(20_000);
      expect(vi.getTimerCount()).toBe(baseline);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not arm a fresh timer when a handler settles after its phase was already force-closed (WR-04)", async () => {
    vi.useFakeTimers();
    try {
      const eventStore = new EventStore();
      const a = user.note("a");
      const request = vi.fn();
      const getSupported = vi.fn().mockResolvedValue([1, 77]);

      let resolveHandler!: () => void;
      const onAuthRequired = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveHandler = resolve;
          }),
      );

      // Invokes the wrapper, then emits on the next microtask — forceCloseAuthPhases runs on every
      // stream emission (D-16), force-closing the phase while the handler above is still pending. The
      // emission must not be synchronous: mapEventsToStore's internal share()/mergeWith combination
      // re-subscribes (and re-runs) a fully synchronous source, which would double-invoke the wrapper —
      // the exact gotcha this file's own asyncOf() helper exists to avoid
      const sync = vi.fn().mockImplementation((_url: unknown, _filter: unknown, opts: SyncMethodOptions) => {
        return new Observable<NostrEvent>((observer) => {
          void opts.onAuthRequired?.(authContext());
          Promise.resolve().then(() => {
            observer.next(a);
            observer.complete();
          });
        });
      });

      const loader = createSyncLoader({ eventStore, request, getSupported, sync });
      const { events$ } = loader({
        relays: ["wss://relay/"],
        filter,
        timeout: false,
        onAuthRequired,
        authTimeout: 10_000,
      });

      const baseline = vi.getTimerCount();
      const sub = events$.subscribe();

      // Drive the run to completion: the handler is still pending when its phase force-closes
      await vi.advanceTimersByTimeAsync(0);
      expect(onAuthRequired).toHaveBeenCalledTimes(1);

      // Resolve the handler's promise well after the force-close, and flush — this is the leak path:
      // scheduleClose() runs against an already-closed phase
      resolveHandler();
      await vi.advanceTimersByTimeAsync(0);

      // RED (pre-fix): this read baseline + 1 — scheduleClose() armed a fresh authTimeout-long timer
      // against an already-closed phase, and nothing would ever clear it. See the SUMMARY for the
      // actual recorded pre-fix count.
      expect(vi.getTimerCount()).toBe(baseline);

      sub.unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});

// 13-12: RAUTH-08 gap closure. These are CONTRACT tests against the loader's injected request/sync
// functions (D-06: applesauce-loaders depends only on applesauce-core, nanoid and rxjs — it does not
// import applesauce-relay, even as a devDependency). The two error `.name` strings used below
// ("AuthRequiredError" / "AuthHandlerError", alongside the pre-existing "AuthTimeoutError" coverage
// above) are load-bearing wire between packages: they must stay in lockstep with the pinned values
// RELAY_AUTH_ERROR_NAMES duck-types against (sync-loader.ts) and that AuthRequiredError/AuthHandlerError/
// AuthTimeoutError construct (packages/relay/src/relay.ts) — a rename in either place silently breaks
// the D-16 no-fallback guard with no compiler error to catch it.
describe("13-12: D-16 all-name coverage and the paginated path's own bound", () => {
  const filter: Filter = { kinds: [1], authors: [user.pubkey] };

  it.each(["AuthRequiredError", "AuthHandlerError"])(
    "errors the relay without falling back when negentropy sync fails with a %s name (D-16)",
    async (name) => {
      const eventStore = new EventStore();
      const authError = Object.assign(new Error("auth-required: please authenticate"), { name });

      const sync = vi.fn().mockReturnValue(throwError(authError));
      const request = vi.fn().mockReturnValue(of());
      const getSupported = vi.fn().mockResolvedValue([1, 77]);

      const loader = createSyncLoader({ eventStore, request, getSupported, sync });
      const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

      const statusPromise = collect(status$);
      events$.subscribe();
      const last = (await statusPromise).at(-1) as SyncLoaderStatus;

      // Paired negative control for this whole set lives above at "still falls back to a request when
      // negentropy sync fails with a non-auth error (D-16)" — an unrecognised error name DOES fall back
      // and DOES call request(), proving this guard actually discriminates rather than always refusing
      // to fall back.
      expect(last.relays["wss://relay/"].state).toBe("error");
      expect(last.relays["wss://relay/"].error?.name).toBe(name);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("does not add its own retry layer on top of the paginated path's own terminal auth failure", async () => {
    const eventStore = new EventStore();
    // The terminal outcome a real relay.request() now produces once its own authRetries budget is
    // spent (packages/relay/src/relay.ts's AuthRequiredError, constructed at authRetryOperator's
    // exhausted outcome) — the bound itself is proven at the wire level by plan 13-09. This test pins
    // that the loader does not layer its own unbounded retry on top of that already-terminal failure:
    // exactly one request() call, not a ceiling.
    const exhaustedAuth = Object.assign(new Error("auth-required: please authenticate"), {
      name: "AuthRequiredError",
    });
    const request = vi.fn().mockReturnValue(throwError(exhaustedAuth));
    // No NIP-77 support, so the loader pages through a REQ directly — the branch just above the D-16
    // guard
    const getSupported = vi.fn().mockResolvedValue([1]);
    const sync = vi.fn();

    const loader = createSyncLoader({ eventStore, request, getSupported, sync });
    const { status$, events$ } = loader({ relays: ["wss://relay/"], filter });

    const statusPromise = collect(status$);
    events$.subscribe();
    const last = (await statusPromise).at(-1) as SyncLoaderStatus;

    expect(request).toHaveBeenCalledTimes(1);
    expect(last.relays["wss://relay/"].state).toBe("error");
    expect(last.relays["wss://relay/"].error?.name).toBe("AuthRequiredError");
    expect(sync).not.toHaveBeenCalled();
  });
});
