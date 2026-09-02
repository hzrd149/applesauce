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

  it("keeps protocol speed through round two while a first-round transfer is blocked", async () => {
    const first = event(101);
    const second = event(102);
    const rounds = new Subject<{ have: string[]; need: string[] }>();
    const blocked = new Subject<any>();
    const secondResult = new Subject<any>();
    const send = vi.spyOn(relay, "event").mockImplementation((value) => value.id === first.id ? blocked : secondResult);
    vi.spyOn(relay, "negentropy").mockReturnValue(rounds);

    const spy = subscribeSpyTo(relay.sync([first, second], {}, SyncDirection.SEND, { concurrency: 2 }));
    rounds.next({ have: [first.id], need: [] });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(first));
    rounds.next({ have: [second.id], need: [] });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(second));

    blocked.next({ ok: true, from: relay.url });
    blocked.complete();
    secondResult.next({ ok: true, from: relay.url });
    secondResult.complete();
    rounds.complete();
    await spy.onComplete();
  });

  it("discards queued and in-flight work before reconnecting", async () => {
    const first = event(111);
    const queued = event(112);
    const attempts = [new Subject<{ have: string[]; need: string[] }>(), new Subject<{ have: string[]; need: string[] }>()];
    const staleSend = new Subject<any>();
    const negotiate = vi.spyOn(relay, "negentropy")
      .mockReturnValueOnce(attempts[0])
      .mockReturnValueOnce(attempts[1]);
    const send = vi.spyOn(relay, "event").mockReturnValue(staleSend);
    const spy = subscribeSpyTo(
      relay.sync([first, queued], {}, SyncDirection.SEND, { concurrency: 1, reconnect: { count: 1, delay: 0 } }),
      { expectErrors: true },
    );

    attempts[0].next({ have: [first.id, queued.id], need: [] });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    attempts[0].error({ wasClean: false, code: 1006 });
    await vi.waitFor(() => expect(negotiate).toHaveBeenCalledTimes(2));

    staleSend.next({ ok: false, from: relay.url, message: "stale" });
    staleSend.complete();
    attempts[1].next({ have: [], need: [] });
    attempts[1].complete();
    await spy.onComplete();

    expect(send).toHaveBeenCalledTimes(1);
    expect(spy.getValues()).toEqual([]);
  });

  it("emits only the replacement attempt outcome for repeated work", async () => {
    const value = event(121);
    const attempts = [new Subject<{ have: string[]; need: string[] }>(), new Subject<{ have: string[]; need: string[] }>()];
    const staleSend = new Subject<any>();
    const currentSend = new Subject<any>();
    const negotiate = vi.spyOn(relay, "negentropy")
      .mockReturnValueOnce(attempts[0])
      .mockReturnValueOnce(attempts[1]);
    const send = vi.spyOn(relay, "event")
      .mockReturnValueOnce(staleSend)
      .mockReturnValueOnce(currentSend);
    const spy = subscribeSpyTo(
      relay.sync([value], {}, SyncDirection.SEND, { reconnect: { count: 1, delay: 0 } }),
      { expectErrors: true },
    );

    attempts[0].next({ have: [value.id], need: [] });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    attempts[0].error({ wasClean: false, code: 1006 });
    await vi.waitFor(() => expect(negotiate).toHaveBeenCalledTimes(2));
    attempts[1].next({ have: [value.id], need: [] });
    attempts[1].complete();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    staleSend.next({ ok: false, from: relay.url, message: "stale" });
    staleSend.complete();
    currentSend.next({ ok: true, from: relay.url });
    currentSend.complete();
    await spy.onComplete();

    expect(spy.getValues()).toEqual([
      expect.objectContaining({ type: "sent", event: value }),
    ]);
  });

  it("rejects invalid concurrency before starting protocol work", async () => {
    const negotiate = vi.spyOn(relay, "negentropy");
    const spy = subscribeSpyTo(relay.sync([], {}, SyncDirection.BOTH, { concurrency: 0 }), { expectErrors: true });
    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(RangeError);
    expect(negotiate).not.toHaveBeenCalled();
  });

  it("emits exact sent and send-failed outcomes with normalized attribution", async () => {
    const first = event(201);
    const second = event(202);
    const negative = { ok: false, from: relay.url, message: "blocked", error: new Error("blocked") };
    const thrown = new Error("socket failed");
    vi.spyOn(relay, "negentropy").mockReturnValue(of({ have: [first.id, second.id], need: [] }));
    vi.spyOn(relay, "event")
      .mockReturnValueOnce(of(negative))
      .mockReturnValueOnce(defer(() => { throw thrown; }));

    const spy = subscribeSpyTo(relay.sync([first, second], {}, SyncDirection.SEND));
    await spy.onComplete();

    expect(spy.getValues()).toEqual([
      { type: "send-failed", from: "wss://sync-test/", event: first, error: negative.error, response: negative },
      { type: "send-failed", from: "wss://sync-test/", event: second, error: thrown },
    ]);
  });

  it("treats zero-event EOSE as a successful empty RECEIVE", async () => {
    const missing = event(301);
    vi.spyOn(relay, "negentropy").mockReturnValue(of({ have: [], need: [missing.id] }));
    vi.spyOn(relay, "req").mockReturnValue(of({ type: "EOSE", from: relay.url, id: "empty" }));

    const spy = subscribeSpyTo(relay.sync([], {}, SyncDirection.RECEIVE), { expectErrors: true });
    await spy.onComplete();

    expect(spy.getValues()).toEqual([]);
    expect(spy.receivedError()).toBe(false);
  });
});
