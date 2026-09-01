import { BehaviorSubject, Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { RelayGroup } from "../group.js";
import type { Relay } from "../relay.js";

const fake = (url: string, source: Observable<any>) =>
  ({ url, count: vi.fn(() => source) }) as unknown as Relay;

describe("progressive group count", () => {
  it("emits a fast partial snapshot then a cumulative slow snapshot", () => {
    const fast = new Subject<any>();
    const slow = new Subject<any>();
    const values: any[] = [];
    new RelayGroup([fake("wss://fast.test", fast), fake("wss://slow.test", slow)]).count({ kinds: [1] }, "id").subscribe((v) => values.push(v));
    fast.next({ count: 1 }); fast.complete();
    slow.next({ count: 2 }); slow.complete();
    expect(values).toEqual([
      { "wss://fast.test/": { ok: true, value: { count: 1 } } },
      { "wss://fast.test/": { ok: true, value: { count: 1 } }, "wss://slow.test/": { ok: true, value: { count: 2 } } },
    ]);
  });

  it("isolates an offline relay as an outcome while preserving success", () => {
    const ok = new Subject<any>(); const bad = new Subject<any>(); const cause = new Error("offline"); const values: any[] = [];
    new RelayGroup([fake("wss://ok.test", ok), fake("wss://bad.test", bad)]).count({}).subscribe((v) => values.push(v));
    bad.error(cause); ok.next({ count: 4 }); ok.complete();
    expect(values.at(-1)["wss://bad.test/"].error).toBe(cause);
    expect(values.at(-1)["wss://ok.test/"].value.count).toBe(4);
  });

  it("replays terminal-empty completion without a stale snapshot", () => {
    const members = new BehaviorSubject<Relay[]>([]); const values: any[] = []; let complete = 0;
    const result = new RelayGroup(members).count({});
    result.subscribe({ next: (v) => values.push(v), complete: () => complete++ });
    result.subscribe({ next: (v) => values.push(v), complete: () => complete++ });
    expect(values).toEqual([]); expect(complete).toBe(2);
  });

  it("retracts the last settled outcome while another relay remains pending", () => {
    const settled = new Subject<any>();
    const pending = new Subject<any>();
    const settledRelay = fake("wss://settled.test", settled);
    const pendingRelay = fake("wss://pending.test", pending);
    const members = new BehaviorSubject<Relay[]>([settledRelay, pendingRelay]);
    const result = new RelayGroup(members).count({});
    const early: any[] = [];
    const late: any[] = [];
    result.subscribe((value) => early.push(value));

    settled.next({ count: 1 });
    settled.complete();
    members.next([pendingRelay]);
    result.subscribe((value) => late.push(value));

    expect(late).toEqual([]);
    pending.next({ count: 2 });
    pending.complete();
    expect(early.at(-1)).toEqual({ "wss://pending.test/": { ok: true, value: { count: 2 } } });
    expect(late).toEqual([{ "wss://pending.test/": { ok: true, value: { count: 2 } } }]);
  });
});
