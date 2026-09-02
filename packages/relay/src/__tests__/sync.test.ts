import { subscribeSpyTo } from "@hirez_io/observer-spy";
import type { NostrEvent } from "applesauce-core/helpers";
import { defer, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { Relay, SyncDirection } from "../relay.js";

const event = (n: number): NostrEvent => ({
  id: n.toString(16).padStart(64, "0"),
  pubkey: "1".repeat(64),
  created_at: n,
  kind: 1,
  tags: [],
  content: String(n),
  sig: "2".repeat(128),
});

describe("sync scheduler", () => {
  let server: WS;
  let relay: Relay;

  beforeEach(() => {
    vi.spyOn(Relay, "fetchInformationDocument").mockReturnValue(of(null));
    server = new WS("wss://sync-test", { jsonProtocol: true });
    relay = new Relay("wss://sync-test");
    relay.keepAlive = 0;
  });

  afterEach(async () => {
    await WS.clean();
    vi.restoreAllMocks();
  });

  it("enforces global concurrency four and emits settlement order", async () => {
    const events = Array.from({ length: 6 }, (_, n) => event(n + 1));
    const pending = new Map<string, Subject<any>>();
    let active = 0;
    let maximum = 0;
    vi.spyOn(relay, "negentropy").mockReturnValue(of({ have: events.map(({ id }) => id), need: [] }));
    vi.spyOn(relay, "event").mockImplementation((value) => {
      const result = new Subject<any>();
      pending.set(value.id, result);
      return defer(() => {
        active += 1;
        maximum = Math.max(maximum, active);
        return result;
      });
    });

    const spy = subscribeSpyTo(relay.sync(events, {}, SyncDirection.SEND));
    await vi.waitFor(() => expect(pending.size).toBe(4));
    pending.get(events[2].id)!.next({ ok: true, from: relay.url });
    pending.get(events[2].id)!.complete();
    active -= 1;
    await vi.waitFor(() => expect(pending.size).toBe(5));
    for (const value of events.filter((value) => value.id !== events[2].id)) {
      await vi.waitFor(() => expect(pending.has(value.id)).toBe(true));
      pending.get(value.id)!.next({ ok: true, from: relay.url });
      pending.get(value.id)!.complete();
      active -= 1;
    }
    await spy.onComplete();

    expect(maximum).toBe(4);
    expect(spy.getValues()[0]).toMatchObject({ type: "sent", event: events[2] });
  });

  it("schedules RECEIVE fairly while SEND remains blocked and drains before completion", async () => {
    const events = Array.from({ length: 5 }, (_, n) => event(n + 10));
    const sends = events.map(() => new Subject<any>());
    const req = vi.spyOn(relay, "req").mockReturnValue(
      of({ type: "EOSE", from: relay.url, id: "receive" }),
    );
    vi.spyOn(relay, "negentropy").mockReturnValue(
      of({ have: events.map(({ id }) => id), need: [event(99).id] }),
    );
    vi.spyOn(relay, "event").mockImplementation((value) => sends[events.findIndex(({ id }) => id === value.id)]);

    const spy = subscribeSpyTo(relay.sync(events, {}, SyncDirection.BOTH));
    await vi.waitFor(() => expect(req).toHaveBeenCalledOnce());
    expect(spy.receivedComplete()).toBe(false);

    for (let index = 0; index < sends.length; index += 1) {
      sends[index].next({ ok: true, from: relay.url });
      sends[index].complete();
    }
    await spy.onComplete();
    expect(spy.getValues()).toHaveLength(events.length);
  });

  it("rejects invalid concurrency before starting protocol work", async () => {
    const negotiate = vi.spyOn(relay, "negentropy");
    const spy = subscribeSpyTo(relay.sync([], {}, SyncDirection.BOTH, { concurrency: 0 }), { expectErrors: true });
    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(RangeError);
    expect(negotiate).not.toHaveBeenCalled();
  });
});
