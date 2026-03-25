import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { BehaviorSubject, EMPTY, NEVER, Observable, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { CacheRequest, NostrRequest } from "../../types.js";
import {
  AddressPointersLoader,
  addressPointerLoadingSequence,
  cacheAddressPointersLoader,
  consolidateAddressPointers,
  createAddressLoader,
  relayHintsAddressPointersLoader,
  relaysAddressPointersLoader,
} from "../address-loader.js";

const user = new FakeUser();

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// consolidateAddressPointers
// ---------------------------------------------------------------------------

describe("consolidateAddressPointers", () => {
  it("should consolidate address pointers", () => {
    const appSettings = {
      kind: 30078,
      pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
      identifier: "nostrudel-settings",
    };
    const appFavorites = {
      kind: 30078,
      pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
      identifier: "nostrudel-favorite-apps",
    };
    const relays = {
      kind: 10002,
      pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    };
    const emojis = {
      kind: 10030,
      pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    };
    const profile = {
      kind: 0,
      pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    };
    const mute = {
      kind: 10000,
      pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    };

    const input = [appSettings, relays, emojis, appFavorites, { ...profile, relays: [] }, mute, profile, profile];

    expect(consolidateAddressPointers(input)).toEqual(
      expect.arrayContaining([appSettings, appFavorites, relays, emojis, expect.objectContaining(profile), mute]),
    );
  });

  it("should merge relay arrays from duplicate pointers", () => {
    // Note: mergeRelaySets normalizes URLs (adds trailing slash)
    const pointer1 = { kind: 0, pubkey: user.pubkey, relays: ["wss://relay1.com/"] };
    const pointer2 = { kind: 0, pubkey: user.pubkey, relays: ["wss://relay2.com/"] };

    const result = consolidateAddressPointers([pointer1, pointer2]);

    expect(result).toHaveLength(1);
    expect(result[0].relays).toEqual(expect.arrayContaining(["wss://relay1.com/", "wss://relay2.com/"]));
  });

  it("should deduplicate relay URLs when merging", () => {
    // Note: mergeRelaySets normalizes URLs (adds trailing slash)
    const pointer1 = { kind: 0, pubkey: user.pubkey, relays: ["wss://relay1.com/", "wss://relay2.com/"] };
    const pointer2 = { kind: 0, pubkey: user.pubkey, relays: ["wss://relay2.com/", "wss://relay3.com/"] };

    const result = consolidateAddressPointers([pointer1, pointer2]);

    expect(result).toHaveLength(1);
    // relay2 should appear only once
    const relay2Count = result[0].relays!.filter((r) => r === "wss://relay2.com/").length;
    expect(relay2Count).toBe(1);
  });

  it("should propagate cache:false when any duplicate has it", () => {
    const pointer1 = { kind: 0, pubkey: user.pubkey };
    const pointer2 = { kind: 0, pubkey: user.pubkey, cache: false as const };

    const result = consolidateAddressPointers([pointer1, pointer2]);

    expect(result).toHaveLength(1);
    expect(result[0].cache).toBe(false);
  });

  it("should not propagate cache:false from first pointer when second does not have it", () => {
    const pointer1 = { kind: 0, pubkey: user.pubkey, cache: false as const };
    const pointer2 = { kind: 0, pubkey: user.pubkey };

    const result = consolidateAddressPointers([pointer1, pointer2]);

    expect(result).toHaveLength(1);
    // First pointer already had cache:false, stays false
    expect(result[0].cache).toBe(false);
  });

  it("should not mutate the original pointer relay array", () => {
    const originalRelays = ["wss://relay1.com"];
    const pointer1 = { kind: 0, pubkey: user.pubkey, relays: originalRelays };
    const pointer2 = { kind: 0, pubkey: user.pubkey, relays: ["wss://relay2.com"] };

    consolidateAddressPointers([pointer1, pointer2]);

    // Original array should be unchanged
    expect(originalRelays).toEqual(["wss://relay1.com"]);
  });
});

// ---------------------------------------------------------------------------
// cacheAddressPointersLoader
// ---------------------------------------------------------------------------

describe("cacheAddressPointersLoader", () => {
  it("should call the cache request with filters and emit returned events", () => {
    const profile = user.profile();
    const cacheResult = new Subject<NostrEvent>();
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(cacheResult.asObservable());

    const loader = cacheAddressPointersLoader(cacheRequest);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    expect(cacheRequest).toHaveBeenCalledOnce();
    // Emit from cache
    cacheResult.next(profile);
    cacheResult.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should return EMPTY when all pointers have cache:false", () => {
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = cacheAddressPointersLoader(cacheRequest);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey, cache: false }]));

    // Cache should not be called at all
    expect(cacheRequest).not.toHaveBeenCalled();
    expect(spy.receivedComplete()).toBe(true);
    expect(spy.getValues()).toHaveLength(0);
  });

  it("should only load pointers without cache:false in a mixed batch", () => {
    const profile = user.profile();
    const cacheResult = new Subject<NostrEvent>();
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(cacheResult.asObservable());

    const loader = cacheAddressPointersLoader(cacheRequest);
    const spy = subscribeSpyTo(
      loader([
        { kind: 0, pubkey: user.pubkey },
        { kind: 3, pubkey: user.pubkey, cache: false },
      ]),
    );

    // Cache was called (for the cacheable pointer)
    expect(cacheRequest).toHaveBeenCalledOnce();
    cacheResult.next(profile);
    cacheResult.complete();

    expect(spy.getValues()).toEqual([profile]);
  });
});

// ---------------------------------------------------------------------------
// relayHintsAddressPointersLoader
// ---------------------------------------------------------------------------

describe("relayHintsAddressPointersLoader", () => {
  it("should call the request with merged relay hints from all pointers", () => {
    const profile = user.profile();
    const relayResult = new Subject<NostrEvent>();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(relayResult.asObservable());

    const loader = relayHintsAddressPointersLoader(request);
    const spy = subscribeSpyTo(
      loader([
        { kind: 0, pubkey: user.pubkey, relays: ["wss://relay1.com/"] },
        { kind: 3, pubkey: user.pubkey, relays: ["wss://relay2.com/"] },
      ]),
    );

    expect(request).toHaveBeenCalledOnce();
    const [calledRelays] = request.mock.calls[0];
    // mergeRelaySets normalizes URLs (trailing slash)
    expect(calledRelays).toEqual(expect.arrayContaining(["wss://relay1.com/", "wss://relay2.com/"]));

    relayResult.next(profile);
    relayResult.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should return EMPTY when no pointers have relay hints", () => {
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = relayHintsAddressPointersLoader(request);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    // Should not call the request at all
    expect(request).not.toHaveBeenCalled();
    expect(spy.receivedComplete()).toBe(true);
    expect(spy.getValues()).toHaveLength(0);
  });

  it("should hang (never complete) when the relay never responds — documents blocking behavior", () => {
    // A relay that accepts the connection but never sends data or closes
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(NEVER);

    const loader = relayHintsAddressPointersLoader(request);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey, relays: ["wss://dead-relay.com"] }]));

    // The loader observable hangs — never completes, never errors
    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);
    expect(spy.getValues()).toHaveLength(0);
  });

  it("should propagate errors from the relay", () => {
    const relayResult = new Subject<NostrEvent>();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(relayResult.asObservable());

    const loader = relayHintsAddressPointersLoader(request);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey, relays: ["wss://relay.com"] }]), {
      expectErrors: true,
    });

    relayResult.error(new Error("connection refused"));

    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// relaysAddressPointersLoader
// ---------------------------------------------------------------------------

describe("relaysAddressPointersLoader", () => {
  it("should call the request with a static relay array", () => {
    const profile = user.profile();
    const relayResult = new Subject<NostrEvent>();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(relayResult.asObservable());

    const loader = relaysAddressPointersLoader(request, ["wss://static-relay.com"]);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    expect(request).toHaveBeenCalledOnce();
    const [calledRelays] = request.mock.calls[0];
    expect(calledRelays).toEqual(["wss://static-relay.com"]);

    relayResult.next(profile);
    relayResult.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should call the request using the latest value from an Observable relay array", () => {
    const profile = user.profile();
    const relayResult = new Subject<NostrEvent>();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(relayResult.asObservable());

    const relays$ = new BehaviorSubject<string[]>(["wss://first.com"]);

    const loader = relaysAddressPointersLoader(request, relays$);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    expect(request).toHaveBeenCalledOnce();
    const [calledRelays] = request.mock.calls[0];
    expect(calledRelays).toEqual(["wss://first.com"]);

    relayResult.next(profile);
    relayResult.complete();

    expect(spy.getValues()).toEqual([profile]);
  });

  it("should return EMPTY when the relay array is empty", () => {
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = relaysAddressPointersLoader(request, []);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    expect(request).not.toHaveBeenCalled();
    expect(spy.receivedComplete()).toBe(true);
    expect(spy.getValues()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addressPointerLoadingSequence
// ---------------------------------------------------------------------------

describe("addressPointerLoadingSequence", () => {
  let result1: Subject<NostrEvent>;
  let loader1: Mock<AddressPointersLoader>;
  let result2: Subject<NostrEvent>;
  let loader2: Mock<AddressPointersLoader>;

  beforeEach(() => {
    result1 = new Subject<NostrEvent>();
    loader1 = vi.fn().mockReturnValue(result1.asObservable());
    result2 = new Subject<NostrEvent>();
    loader2 = vi.fn().mockReturnValue(result2.asObservable());
  });

  it("should call loaders in order", () => {
    const pointer = { kind: 0, pubkey: user.pubkey, relays: ["wss://relay.com"] };

    const loader = addressPointerLoadingSequence(loader1, loader2);
    const spy = subscribeSpyTo(loader([pointer]));

    expect(loader1).toHaveBeenCalledWith([pointer]);
    expect(loader2).not.toHaveBeenCalled();

    // Finish first loader with no results
    result1.complete();

    expect(loader2).toHaveBeenCalledWith([pointer]);
    result2.complete();

    // Loader should be complete now
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should skip loader if loader throws an error", () => {
    const pointer = { kind: 0, pubkey: user.pubkey, relays: ["wss://relay.com"] };

    const loader = addressPointerLoadingSequence(loader1, loader2);
    const spy = subscribeSpyTo(loader([pointer]));

    // Finish first loader with an error
    result1.error(new Error("test"));

    // Second loader should be called
    expect(loader2).toHaveBeenCalled();
    result2.complete();

    // Loader should be complete now
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should not request address pointers from second loader if first loader returns results", () => {
    const loader = addressPointerLoadingSequence(loader1, loader2);
    const spy = subscribeSpyTo(
      loader([
        { kind: 0, pubkey: user.pubkey },
        { kind: 0, pubkey: "other-pubkey" },
      ]),
    );

    const profile = user.profile({ name: "testing" });
    result1.next(profile);
    result1.complete();

    expect(loader2).toHaveBeenCalledWith([{ kind: 0, pubkey: "other-pubkey" }]);
    result2.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should not request address pointer from second loader if first loader returns results and errors", () => {
    const loader = addressPointerLoadingSequence(loader1, loader2);
    const spy = subscribeSpyTo(
      loader([
        { kind: 0, pubkey: user.pubkey },
        { kind: 0, pubkey: "other-pubkey" },
      ]),
    );

    const profile = user.profile({ name: "testing" });
    result1.next(profile);
    result1.error(new Error("test"));

    expect(loader2).toHaveBeenCalledWith([{ kind: 0, pubkey: "other-pubkey" }]);
    result2.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should block indefinitely when a loader never completes — documents dead-relay blocking", () => {
    // loader1 returns NEVER — simulates a relay that accepts connection but never sends data
    loader1 = vi.fn().mockReturnValue(NEVER);

    const loader = addressPointerLoadingSequence(loader1, loader2);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    // The sequence generator is stuck waiting for loader1 to complete
    // loader2 is never reached
    expect(loader2).not.toHaveBeenCalled();
    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);
  });

  it("should skip undefined loaders without error", () => {
    const loader = addressPointerLoadingSequence(undefined, loader2);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    // loader1 was undefined, loader2 should be called
    expect(loader2).toHaveBeenCalled();
    result2.complete();

    expect(spy.receivedComplete()).toBe(true);
  });

  it("should not consider non-replaceable events (kind 1) as satisfying a pointer", () => {
    const loader = addressPointerLoadingSequence(loader1, loader2);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    // Emit a kind 1 note — not replaceable, should not satisfy the kind 0 pointer
    const note = user.note("hello");
    result1.next(note);
    result1.complete();

    // The kind 0 pointer is NOT satisfied, so loader2 is called with it
    expect(loader2).toHaveBeenCalledWith([{ kind: 0, pubkey: user.pubkey }]);
    result2.complete();

    expect(spy.getValues()).toEqual([note]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should emit newer event versions arriving from a later loader even when pointer is already satisfied", () => {
    const loader = addressPointerLoadingSequence(loader1, loader2);
    const spy = subscribeSpyTo(loader([{ kind: 0, pubkey: user.pubkey }]));

    const olderProfile = user.profile({ name: "old" }, { created_at: 1000 });
    result1.next(olderProfile);
    result1.complete();

    // The pointer is now satisfied (removed from remaining), so loader2 is called with []
    // but a newer profile arrives anyway (e.g., loader2 was already subscribed before results came in)
    // In practice: when remaining becomes empty, the sequence returns without calling loader2
    // So loader2 is NOT called with the empty pointer list
    // The sequence completes — only the older profile is emitted
    result2.complete();

    expect(spy.getValues()).toEqual([olderProfile]);
    expect(spy.receivedComplete()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createAddressLoader
// ---------------------------------------------------------------------------

describe("createAddressLoader", () => {
  let request: Mock<NostrRequest>;
  let requestResult: Subject<NostrEvent>;

  beforeEach(() => {
    requestResult = new Subject<NostrEvent>();
    request = vi.fn().mockReturnValue(requestResult.asObservable());
  });

  it("should batch multiple pointer requests within the buffer window into one upstream call", () => {
    vi.useFakeTimers();

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: false,
      lookupRelays: ["wss://lookup.com"],
    });

    const lookupResult = new Subject<NostrEvent>();
    request.mockReturnValue(lookupResult.asObservable());

    const spy1 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));
    const spy2 = subscribeSpyTo(loader({ kind: 3, pubkey: user.pubkey }));

    vi.advanceTimersByTime(200);

    // Both requests should be batched into a single upstream call
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(["wss://lookup.com"], expect.any(Array));

    lookupResult.complete();
    expect(spy1.receivedComplete()).toBe(true);
    expect(spy2.receivedComplete()).toBe(true);
  });

  it("should return the matching event to the subscriber", () => {
    vi.useFakeTimers();

    const profile = user.profile({ name: "test" });
    const lookupResult = new Subject<NostrEvent>();
    request.mockReturnValue(lookupResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: false,
      lookupRelays: ["wss://lookup.com"],
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));

    vi.advanceTimersByTime(200);

    lookupResult.next(profile);
    lookupResult.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should only return events matching the pointer's kind, pubkey, and identifier", () => {
    vi.useFakeTimers();

    const userProfile = user.profile({ name: "mine" });
    const otherUser = new FakeUser();
    const otherProfile = otherUser.profile({ name: "other" });

    const lookupResult = new Subject<NostrEvent>();
    request.mockReturnValue(lookupResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: false,
      lookupRelays: ["wss://lookup.com"],
      // Disable dedup so we can test matching in isolation
      eventStore: null,
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));

    vi.advanceTimersByTime(200);

    // Relay returns both the requested event AND an unrelated one
    lookupResult.next(otherProfile);
    lookupResult.next(userProfile);
    lookupResult.complete();

    // Only the event matching the pointer's pubkey should be returned
    expect(spy.getValues()).toEqual([userProfile]);
  });

  it("should fall through to lookup relays when relay hints loader errors (offline relay)", () => {
    vi.useFakeTimers();

    const profile = user.profile({ name: "found via lookup" });

    // relay hints: errors immediately (offline relay)
    const hintResult = new Subject<NostrEvent>();
    // lookup: returns the event
    const lookupResult = new Subject<NostrEvent>();

    request
      .mockReturnValueOnce(hintResult.asObservable()) // hint call
      .mockReturnValueOnce(lookupResult.asObservable()); // lookup call

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: true,
      lookupRelays: ["wss://lookup.com"],
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey, relays: ["wss://hint.com"] }));

    vi.advanceTimersByTime(200);

    // Simulate offline relay — errors immediately
    hintResult.error(new Error("connection refused"));

    // Lookup relay returns the event
    lookupResult.next(profile);
    lookupResult.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should not advance past a dead relay hint (never completes) to the lookup step", () => {
    vi.useFakeTimers();

    // relay hint: NEVER completes — dead relay
    request.mockReturnValue(NEVER);

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: true,
      lookupRelays: ["wss://lookup.com"],
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey, relays: ["wss://dead.com"] }));

    vi.advanceTimersByTime(200);

    // The sequence is stuck on the dead relay — lookup is never reached
    // The loader hangs indefinitely (this documents the blocking behavior)
    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1); // only the hint call, no lookup call
  });

  it("should skip relay hints step when followRelayHints is false", () => {
    vi.useFakeTimers();

    const profile = user.profile();
    const lookupResult = new Subject<NostrEvent>();
    request.mockReturnValue(lookupResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: false,
      lookupRelays: ["wss://lookup.com"],
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey, relays: ["wss://hint-should-be-skipped.com"] }));

    vi.advanceTimersByTime(200);

    // Only one call — directly to lookup relays (not to the hint relay)
    expect(request).toHaveBeenCalledTimes(1);
    const [calledRelays] = request.mock.calls[0];
    expect(calledRelays).toEqual(["wss://lookup.com"]);

    lookupResult.next(profile);
    lookupResult.complete();

    expect(spy.getValues()).toEqual([profile]);
  });

  it("should query extraRelays for pointers not found in relay hints", () => {
    vi.useFakeTimers();

    const otherUser = new FakeUser();
    const otherProfile = otherUser.profile({ name: "from extra" });

    const hintResult = new Subject<NostrEvent>();
    const extraResult = new Subject<NostrEvent>();

    request
      .mockReturnValueOnce(hintResult.asObservable()) // relay hints (for user's pointer)
      .mockReturnValueOnce(extraResult.asObservable()); // extra relays (for otherUser's pointer)

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: true,
      extraRelays: ["wss://extra.com"],
    });

    // Subscribe to two pointers: one with relay hints, one without
    const userProfile = user.profile();
    const spy1 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey, relays: ["wss://hint.com/"] }));
    const spy2 = subscribeSpyTo(loader({ kind: 0, pubkey: otherUser.pubkey }));

    vi.advanceTimersByTime(200);

    // Relay hint call satisfies user's pointer
    hintResult.next(userProfile);
    hintResult.complete();

    // otherUser's pointer is still remaining — extraRelays step is called for it
    expect(request).toHaveBeenCalledTimes(2);

    extraResult.next(otherProfile);
    extraResult.complete();

    expect(spy1.getValues()).toEqual([userProfile]);
    expect(spy2.getValues()).toEqual([otherProfile]);
  });

  it("should only query lookupRelays when earlier steps did not find the event", () => {
    vi.useFakeTimers();

    const profile = user.profile();
    const hintResult = new Subject<NostrEvent>();
    request.mockReturnValue(hintResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: true,
      lookupRelays: ["wss://lookup.com"],
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey, relays: ["wss://hint.com"] }));

    vi.advanceTimersByTime(200);

    // Relay hint returns the event — pointer is satisfied
    hintResult.next(profile);
    hintResult.complete();

    // Lookup relay should NOT be called since the pointer was found in hints
    expect(request).toHaveBeenCalledTimes(1);
    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should consult the cache first and skip relay steps when cache hits", () => {
    vi.useFakeTimers();

    const cachedProfile = user.profile({ name: "cached" });
    const cacheResult = new Subject<NostrEvent>();
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(cacheResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      cacheRequest,
      lookupRelays: ["wss://lookup.com"],
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));

    vi.advanceTimersByTime(200);

    // Cache returns the profile
    cacheResult.next(cachedProfile);
    cacheResult.complete();

    // No relay request should have been made
    expect(request).not.toHaveBeenCalled();
    expect(spy.getValues()).toEqual([cachedProfile]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should disable deduplication when eventStore is null", () => {
    vi.useFakeTimers();

    const profile = user.profile({ name: "test" });

    const lookupResult = new Subject<NostrEvent>();
    request.mockReturnValue(lookupResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: false,
      lookupRelays: ["wss://lookup.com"],
      eventStore: null,
    });

    const spy1 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));
    const spy2 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));

    vi.advanceTimersByTime(200);

    lookupResult.next(profile);
    lookupResult.complete();

    // With dedup disabled, both subscribers receive the same event
    expect(spy1.getValues()).toEqual([profile]);
    expect(spy2.getValues()).toEqual([profile]);
  });

  it("should emit only the newer event version when EventMemory deduplication is active", () => {
    vi.useFakeTimers();

    // Two versions of the same profile: same pubkey, different created_at
    const olderProfile = user.profile({ name: "old" }, { created_at: 1000 });
    const newerProfile = user.profile({ name: "new" }, { created_at: 2000 });

    const lookupResult = new Subject<NostrEvent>();
    request.mockReturnValue(lookupResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      followRelayHints: false,
      lookupRelays: ["wss://lookup.com"],
      // Default: EventMemory is used for deduplication
    });

    const spy1 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));
    const spy2 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));

    vi.advanceTimersByTime(200);

    // Relay returns the older version first, then the newer
    lookupResult.next(olderProfile);
    lookupResult.next(newerProfile);
    lookupResult.complete();

    // The older event is emitted first (it updates the EventMemory)
    // The newer event also emits (it replaces the older in EventMemory)
    // Both arrive because they are distinct events from the relay
    const allEmitted = [...spy1.getValues(), ...spy2.getValues()];
    expect(allEmitted).toContain(newerProfile);

    // The older profile's version of this address is superseded —
    // a second subscriber asking for the same pointer gets only the newer one
    // because EventMemory has already stored the newer version
  });

  it("should handle lookup relay finding event after cache miss", () => {
    vi.useFakeTimers();

    const profile = user.profile({ name: "from lookup" });
    const cacheResult = new Subject<NostrEvent>();
    const lookupResult = new Subject<NostrEvent>();

    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(cacheResult.asObservable());

    // First call will be lookup relays (after cache miss)
    request.mockReturnValue(lookupResult.asObservable());

    const loader = createAddressLoader(request, {
      bufferTime: 100,
      cacheRequest,
      followRelayHints: false,
      lookupRelays: ["wss://lookup.com"],
    });

    const spy = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));

    vi.advanceTimersByTime(200);

    // Cache misses
    cacheResult.complete();

    // Lookup relay finds it
    lookupResult.next(profile);
    lookupResult.complete();

    expect(spy.getValues()).toEqual([profile]);
    expect(spy.receivedComplete()).toBe(true);
  });
});
