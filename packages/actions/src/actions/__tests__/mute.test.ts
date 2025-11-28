import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core";
import { kinds } from "nostr-tools";
import { getMutedThings, getHiddenMutedThings } from "applesauce-common/helpers/mute";
import { subscribeSpyTo } from "@hirez_io/observer-spy";

import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionHub } from "../../action-hub.js";
import { MuteThread, UnmuteThread } from "../mute.js";

const user = new FakeUser();
const testEventId = "test-event-id";

let events: EventStore;
let factory: EventFactory;
let hub: ActionHub;

beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: user });
  hub = new ActionHub(events, factory);

  // Add a mute list event to work with
  const muteList = user.event({
    kind: kinds.Mutelist,
    tags: [],
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  });
  events.add(muteList);

  vi.useFakeTimers();
});

describe("MuteThread", () => {
  it("should add an event to public tags in mute list", async () => {
    const spy = subscribeSpyTo(hub.exec(MuteThread, testEventId), { expectErrors: false });
    await spy.onComplete();

    const emittedEvent = spy.getLastValue()!;
    const mutedThings = getMutedThings(emittedEvent);
    expect(mutedThings.threads).toContain(testEventId);
  });

  it("should add an event to hidden tags in mute list", async () => {
    const spy = subscribeSpyTo(hub.exec(MuteThread, testEventId, true), { expectErrors: false });
    await spy.onComplete();

    const emittedEvent = spy.getLastValue()!;
    const hiddenMutedThings = await getHiddenMutedThings(emittedEvent);
    expect(hiddenMutedThings?.threads).toContain(testEventId);
  });
});

describe("UnmuteThread", () => {
  it("should remove an event from public tags in mute list", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    // First add the thread to mute list
    const addSpy = subscribeSpyTo(hub.exec(MuteThread, testEventId), { expectErrors: false });
    await addSpy.onComplete();

    // Wait a second to ensure events have newer created_at
    await vi.advanceTimersByTime(1000);

    // Then unmute it
    const spy = subscribeSpyTo(hub.exec(UnmuteThread, testEventId), { expectErrors: false });
    await spy.onComplete();

    const emittedEvent = spy.getLastValue()!;
    const mutedThings = getMutedThings(emittedEvent);
    expect(mutedThings.threads).not.toContain(testEventId);
  });

  it("should remove an event from hidden tags in mute list", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    // First add the thread to hidden mute list
    const addSpy = subscribeSpyTo(hub.exec(MuteThread, testEventId, true), { expectErrors: false });
    await addSpy.onComplete();

    // Wait a second to ensure events have newer created_at
    await vi.advanceTimersByTime(2000);

    // Then unmute it
    const spy = subscribeSpyTo(hub.exec(UnmuteThread, testEventId, true), { expectErrors: false });
    await spy.onComplete();

    const emittedEvent = spy.getLastValue()!;
    const hiddenMutedThings = await getHiddenMutedThings(emittedEvent);
    expect(hiddenMutedThings?.threads).not.toContain(testEventId);
  });
});
