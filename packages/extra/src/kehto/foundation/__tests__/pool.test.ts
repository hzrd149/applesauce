import { EventStore } from "applesauce-core";
import { finalizeEvent, unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishThroughStore, subscribeThroughStore } from "../pool.js";

const alice = new PrivateKeySigner(new Uint8Array(32).fill(1));

/** A fake pool whose req() messages are pushed by the test */
function fakePool() {
  const req$ = new Subject<any>();
  return {
    req$,
    req: vi.fn(() => req$),
    request: vi.fn(),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
    count: vi.fn(),
  };
}

let store: EventStore;
let pool: ReturnType<typeof fakePool>;

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
});
describe("subscribeThroughStore", () => {
  const note = (content: string): NostrEvent =>
    finalizeEvent({ kind: 1, created_at: unixNow(), content, tags: [] }, alice.key);

  it("emits stored events, adds relay events to the store and sends EOSE once every relay finishes", () => {
    const stored = store.add(note("stored"))!;
    const items: (NostrEvent | "EOSE")[] = [];
    const sub = subscribeThroughStore(
      { eventStore: store, pool: pool as unknown as RelayPool },
      ["wss://a/", "wss://b/"],
      [{ kinds: [1] }],
    ).subscribe((i) => items.push(i));

    const live = note("live");
    pool.req$.next({ type: "EVENT", from: "wss://a/", id: "x", event: live });
    pool.req$.next({ type: "EOSE", from: "wss://a/", id: "x" });
    expect(items).toEqual([stored, live]);
    pool.req$.next({ type: "EOSE", from: "wss://b/", id: "x" });
    expect(items.at(-1)).toBe("EOSE");
    expect(store.hasEvent(live.id)).toBe(true);
    sub.unsubscribe();
  });

  it("sends EOSE after the timeout when relays never finish", () => {
    vi.useFakeTimers();
    const items: unknown[] = [];
    const sub = subscribeThroughStore(
      { eventStore: store, pool: pool as unknown as RelayPool, timeout: 100 },
      ["wss://a/"],
      [{ kinds: [1] }],
    ).subscribe((i) => items.push(i));
    vi.advanceTimersByTime(100);
    expect(items).toEqual(["EOSE"]);
    sub.unsubscribe();
    vi.useRealTimers();
  });
});

describe("publishThroughStore", () => {
  it("throws when no relay accepts the event", async () => {
    pool.publish.mockResolvedValueOnce([{ from: "wss://a/", ok: false, message: "blocked" }] as any);
    const event = finalizeEvent({ kind: 1, created_at: unixNow(), content: "", tags: [] }, alice.key);
    await expect(
      publishThroughStore({ eventStore: store, pool: pool as unknown as RelayPool }, ["wss://a/"], event),
    ).rejects.toThrow("blocked");
    expect(store.hasEvent(event.id)).toBe(true);
  });
});
