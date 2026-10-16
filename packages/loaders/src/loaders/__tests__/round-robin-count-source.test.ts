import { asyncScheduler, BehaviorSubject, firstValueFrom, NEVER, of } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import { createCountService, reactionCountMetric, roundRobinCountSource } from "../index.js";
import type { CountContext, CountRequest } from "../index.js";

const a = "wss://a.test/";
const b = "wss://b.test/";
const c = "wss://c.test/";
const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
const query = { target, metric: reactionCountMetric };
const context: CountContext = {
  clock: asyncScheduler,
  deadline: Infinity,
  attemptTimeout: 1000,
  transport: { run: (_resources, transport) => transport() },
};
afterEach(() => vi.useRealTimers());

it("rotates subscribed resolutions, preserves policy, and normalizes duplicate routes", async () => {
  const starts: string[] = [];
  const count: CountRequest = ([relay]) => {
    starts.push(relay);
    return of({ [relay]: { ok: true, value: { count: 0, approximate: true } } });
  };
  const source = roundRobinCountSource({ count, relays: [a, a, b, c] });
  const policy = await firstValueFrom(source.policy(query));
  source.count(query, context); // Constructing an observable must not advance rotation.
  for (let i = 0; i < 4; i++) {
    expect(await firstValueFrom(source.count(query, context))).toMatchObject({
      value: 0,
      approximate: true,
      origin: { relay: [a, b, c, a][i] },
    });
  }
  expect(starts).toEqual([a, b, c, a]);
  expect(await firstValueFrom(source.policy(query))).toBe(policy);
});

it("falls back after refusal and invalid data without adding counts", async () => {
  const starts: string[] = [];
  const count: CountRequest = ([relay]) => {
    starts.push(relay);
    return of({
      [relay]:
        relay === a
          ? { ok: false, error: "refused" }
          : {
              ok: true,
              value: { count: relay === b ? -1 : 7 },
            },
    });
  };
  const source = roundRobinCountSource({ count, relays: [a, b, c] });
  expect(await firstValueFrom(source.count(query, context))).toMatchObject({ value: 7, origin: { relay: c } });
  expect(starts).toEqual([a, b, c]);
});

it("reaches another relay after timeout within the service source budget", () => {
  vi.useFakeTimers();
  const count = vi.fn<CountRequest>(([relay]) =>
    relay === a
      ? NEVER
      : of({
          [relay]: { ok: true, value: { count: 9 } },
        }),
  );
  const service = createCountService({
    sources: [roundRobinCountSource({ count, relays: [a, b] })],
    attemptTimeout: 900,
  });
  const values: (number | undefined)[] = [];
  const sub = service.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(600);
  expect(values.at(-1)).toBe(9);
  sub.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("observes relay configuration changes and cancels abandoned work", () => {
  vi.useFakeTimers();
  const routes = new BehaviorSubject([a, b]);
  const count = vi.fn<CountRequest>(() => NEVER);
  const source = roundRobinCountSource({ count, relays: routes });
  const policies: string[] = [];
  const policy = source.policy(query).subscribe((value) => policies.push(value));
  const sub = source.count(query, context).subscribe();
  sub.unsubscribe();
  vi.advanceTimersByTime(2000);
  expect(count).toHaveBeenCalledTimes(1);
  routes.next([c]);
  expect(policies).toEqual([JSON.stringify([a, b]), JSON.stringify([c])]);
  policy.unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});
