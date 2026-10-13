import { EventStore } from "applesauce-core";
import { finalizeEvent, generateSecretKey, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { type Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { publishEvent } from "../publish";
import { relayTimeline } from "../relay-timeline";

type TimelineState = ReturnType<typeof relayTimeline> extends Observable<infer T> ? T : never;

const secret = generateSecretKey();
const event = (kind = 1, created_at = 1, content = "note") =>
  finalizeEvent({ kind, created_at, content, tags: kind === 30023 ? [["d", "article"]] : [] }, secret);

function setup() {
  const relays = new Map<string, Subject<NostrEvent | "EOSE">>([
    ["wss://one", new Subject()],
    ["wss://two", new Subject()],
  ]);
  const pool = { relay: (url: string) => ({ subscription: () => relays.get(url)! }) } as unknown as RelayPool;
  return { store: new EventStore(), pool, relays };
}

describe("relay timeline ownership", () => {
  it("ingests events, follows revisions and excludes events from previously selected relays", () => {
    const { store, pool, relays } = setup();
    const unrelated = event(30023, 1, "previous relay");
    const selected = event(30023, 2, "selected relay");
    const latest = event(30023, 3, "latest revision");
    // Use a different address for an unrelated cached article.
    const other = finalizeEvent({ kind: 30023, created_at: 4, content: "other", tags: [["d", "other"]] }, secret);
    store.add(unrelated);
    store.add(other);
    const states: TimelineState[] = [];
    const subscription = relayTimeline(store, pool, ["wss://one"], { kinds: [30023] }).subscribe((value) =>
      states.push(value),
    );
    expect(states[states.length - 1]?.events).toEqual([]);
    expect(states[states.length - 1]?.status).toBe("loading");
    relays.get("wss://one")!.next(selected);
    expect(store.hasEvent(selected.id)).toBe(true);
    expect(states[states.length - 1]?.events.map((value) => value.id)).toEqual([selected.id]);
    store.add(latest);
    expect(states[states.length - 1]?.events.map((value) => value.id)).toEqual([latest.id]);
    relays.get("wss://one")!.next("EOSE");
    expect(states[states.length - 1]?.status).toBe("live");
    subscription.unsubscribe();
    expect(relays.get("wss://one")!.observed).toBe(false);
  });

  it("isolates relay errors and tears down every relay on unsubscribe", () => {
    const { store, pool, relays } = setup();
    let latest: TimelineState | undefined;
    const subscription = relayTimeline(store, pool, ["wss://one", "wss://two"], { kinds: [1] }).subscribe((state) => {
      latest = state;
    });
    relays.get("wss://one")!.error(new Error("Offline"));
    relays.get("wss://two")!.next(event());
    relays.get("wss://two")!.next("EOSE");
    expect(latest?.errors).toEqual(["Offline"]);
    expect(latest?.status).toBe("live");
    expect(latest?.events).toHaveLength(1);
    subscription.unsubscribe();
    expect(relays.get("wss://two")!.observed).toBe(false);
  });

  it("resets membership on each subscription and distinguishes closed empty results", () => {
    const { store, pool, relays } = setup();
    const timeline = relayTimeline(store, pool, ["wss://one"], { kinds: [1] });
    const first = timeline.subscribe();
    relays.get("wss://one")!.next(event());
    first.unsubscribe();
    const states: TimelineState[] = [];
    const second = timeline.subscribe((state) => states.push(state));
    expect(states[states.length - 1].events).toEqual([]);
    relays.get("wss://one")!.complete();
    expect(states[states.length - 1].status).toBe("closed");
    expect(states[states.length - 1].errors).toEqual([]);
    second.unsubscribe();
  });
});

describe("publish acceptance", () => {
  it("rejects missing targets without making a request", async () => {
    const publish = vi.fn();
    await expect(publishEvent({ publish } as unknown as RelayPool, [], event())).rejects.toThrow(
      "No publishing relays",
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("awaits verdicts and rejects a fulfilled request when all relays reject", async () => {
    const publish = vi.fn().mockResolvedValue([{ from: "wss://one", ok: false, message: "blocked" }]);
    await expect(publishEvent({ publish } as unknown as RelayPool, ["wss://one"], event())).rejects.toThrow("blocked");
  });

  it("preserves partial verdicts, deduplicates targets and propagates transport failures", async () => {
    const responses = [
      { from: "wss://one", ok: true },
      { from: "wss://two", ok: false, message: "blocked" },
    ];
    const publish = vi.fn().mockResolvedValue(responses);
    const signed = event();
    await expect(
      publishEvent({ publish } as unknown as RelayPool, ["wss://one", "wss://one", "wss://two"], signed),
    ).resolves.toEqual(responses);
    expect(publish).toHaveBeenCalledWith(["wss://one", "wss://two"], signed);
    publish.mockRejectedValueOnce(new Error("Transport failed"));
    await expect(publishEvent({ publish } as unknown as RelayPool, ["wss://one"], signed)).rejects.toThrow(
      "Transport failed",
    );
  });
});
