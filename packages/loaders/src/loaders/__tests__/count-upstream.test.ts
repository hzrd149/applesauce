import { EMPTY, of } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { createCountService, nip85CountSource, relayCountSource } from "../index.js";
import type { CountPool, CountRequest } from "../index.js";

const relay = "wss://counts.test/";
const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
afterEach(() => vi.useRealTimers());

it("accepts a structural pool directly and preserves its method receiver", () => {
  vi.useFakeTimers();
  const pool = {
    value: 12,
    count: vi.fn<CountRequest>(function (this: { value: number }) {
      return of({ [relay]: { ok: true, value: { count: this.value } } });
    }),
  };
  const counts = createCountService(pool, { relays: [relay] });
  expect(pool.count).not.toHaveBeenCalled();
  const values: (number | undefined)[] = [];
  counts.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(1);
  expect(values).toEqual([undefined, 12]);
  counts.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("accepts direct COUNT methods and nested pool options", () => {
  vi.useFakeTimers();
  const count = vi.fn<CountRequest>(() => of({ [relay]: { ok: true, value: { count: 0 } } }));
  for (const options of [
    { count, relays: [relay] },
    { pool: { count }, relays: [relay] },
  ]) {
    const service = createCountService(options);
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((value) => values.push(value));
    vi.advanceTimersByTime(1);
    expect(values.at(-1)).toBe(0);
    service.stop();
  }
  expect(count).toHaveBeenCalledTimes(2);
});

it("accepts a request function directly for assertion-only services", () => {
  vi.useFakeTimers();
  const user = new FakeUser();
  const event = user.event({
    kind: 30383,
    tags: [
      ["d", target.id],
      ["reaction_cnt", "7"],
    ],
  });
  const request = vi.fn(() => of(event));
  const counts = createCountService(request, {
    providers: () => [{ kind: 30383, tag: "reaction_cnt", servicePubkey: user.pubkey, relay }],
  });
  const values: (number | undefined)[] = [];
  counts.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(12);
  expect(values.at(-1)).toBe(7);
  expect(request).toHaveBeenCalledOnce();
  counts.stop();
});

it("automatically tries assertions before COUNT and preserves request receivers", () => {
  vi.useFakeTimers();
  const pool = {
    requests: 0,
    request() {
      this.requests++;
      return EMPTY;
    },
    count: vi.fn<CountRequest>(() => of({ [relay]: { ok: true, value: { count: 3 } } })),
  };
  const counts = createCountService(pool, {
    relays: [relay],
    providers: () => [{ kind: 30383, tag: "reaction_cnt", servicePubkey: "b".repeat(64), relay }],
  });
  const values: (number | undefined)[] = [];
  counts.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(25);
  expect(pool.requests).toBe(2);
  expect(pool.count).toHaveBeenCalledOnce();
  expect(values.at(-1)).toBe(3);
  counts.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("accepts pools in individual adapters and allows explicit transport overrides", () => {
  vi.useFakeTimers();
  const pool: CountPool = { count: vi.fn(() => EMPTY), request: vi.fn(() => EMPTY) };
  const count = vi.fn<CountRequest>(() => of({ [relay]: { ok: true, value: { count: 2 } } }));
  const service = createCountService({ sources: [relayCountSource({ pool, count, relays: [relay] })] });
  service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(1);
  expect(count).toHaveBeenCalledOnce();
  expect(pool.count).not.toHaveBeenCalled();
  service.stop();
  expect(() => nip85CountSource({ pool, providers: () => [] })).not.toThrow();
});

it("validates missing transports and honors explicit source composition", () => {
  expect(() => createCountService({ relays: [relay] })).toThrow("COUNT method");
  expect(() => createCountService({ providers: () => [] })).toThrow("request method");
  expect(() => relayCountSource({ relays: [relay] })).toThrow("COUNT method");
  expect(() => nip85CountSource({ providers: () => [] })).toThrow("request method");
  const counts = createCountService({ sources: [], relays: [relay] });
  counts.stop();
});
