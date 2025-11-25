import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { AddressPointersLoader, addressPointerLoadingSequence, consolidateAddressPointers } from "../address-loader.js";

const user = new FakeUser();

afterEach(() => {
  vi.clearAllTimers();
});

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
});

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
});
