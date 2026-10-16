import { asyncScheduler, EMPTY, firstValueFrom, NEVER, of, Subject } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCountService,
  nip85CountSource,
  countService,
  createCountRuntime,
  reactionCountMetric,
  relayCountSource,
  routingCountSource,
} from "../index.js";
import type { CountContext, CountRequest } from "../index.js";
const a = "wss://a.test/",
  b = "wss://b.test/",
  c = "wss://c.test/";
const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
const query = { target, metric: reactionCountMetric };
const answer = (relay: string, count = 7) => of({ [relay]: { ok: true as const, value: { count } } });
afterEach(() => vi.useRealTimers());

it("binds the pool once and does no work until observed", () => {
  const count = vi.fn<CountRequest>(([relay]) => answer(relay, 0));
  const builder = countService({ count }).roundRobin([a, b]);
  const service = builder.build();
  expect(count).not.toHaveBeenCalled();
  const x = service.event(target).reactions$.subscribe();
  const y = service.event({ ...target, id: "b".repeat(64) }).reactions$.subscribe();
  expect(count.mock.calls.map(([relays]) => relays[0])).toEqual([a, b]);
  x.unsubscribe();
  y.unsubscribe();
  service.stop();
});

it("dispatches more than eight independent requests without an implicit global cap", () => {
  const count = vi.fn<CountRequest>(() => NEVER);
  const service = countService({ count }).roundRobin([a, b, c]).build();
  const subs = Array.from({ length: 12 }, (_, i) => service.event({ ...target, id: String(i) }).reactions$.subscribe());
  expect(count).toHaveBeenCalledTimes(12);
  subs.forEach((sub) => sub.unsubscribe());
  service.stop();
});

it("selects an available peer immediately when the first relay is saturated", () => {
  const runtime = createCountRuntime({ perRelay: 1 });
  const held = runtime.run([`relay:${a}`], () => NEVER).subscribe();
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const service = countService({ count }).availability([a, b]).runtime(runtime).build();
  const sub = service.event(target).reactions$.subscribe();
  expect(count.mock.calls.map(([relays]) => relays[0])).toEqual([b]);
  sub.unsubscribe();
  service.stop();
  held.unsubscribe();
  runtime.stop();
});

it("waits for the round-robin candidate but supports explicit busy skipping", () => {
  const runtime = createCountRuntime({ perRelay: 1 });
  const held = runtime.run([`relay:${a}`], () => NEVER).subscribe();
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const waiting = countService({ count }).roundRobin([a, b]).runtime(runtime).build();
  const first = waiting.event(target).reactions$.subscribe();
  expect(count).not.toHaveBeenCalled();
  const skipping = countService({ count }).roundRobin([a, b], { busy: "skip" }).runtime(runtime).build();
  const second = skipping.event(target).reactions$.subscribe();
  expect(count.mock.calls[0][0]).toEqual([b]);
  held.unsubscribe();
  expect(count.mock.calls[1][0]).toEqual([a]);
  first.unsubscribe();
  second.unsubscribe();
  waiting.stop();
  skipping.stop();
  runtime.stop();
});

it("starts transport timeout after admission and preserves full timeout across fallback", () => {
  vi.useFakeTimers();
  const runtime = createCountRuntime({ perRelay: 1 });
  const held = runtime.run([`relay:${a}`], () => NEVER).subscribe();
  const count = vi.fn<CountRequest>(([relay]) => (relay === a ? NEVER : answer(relay)));
  const service = countService({ count })
    .fallback([a, b])
    .runtime(runtime)
    .configure({ attemptTimeout: 500, selectionTimeout: 1000 })
    .build();
  const values: (number | undefined)[] = [];
  const sub = service.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(400);
  held.unsubscribe();
  vi.advanceTimersByTime(499);
  expect(count).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(values.at(-1)).toBe(7);
  sub.unsubscribe();
  service.stop();
  runtime.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps shared runtime capacity occupied when another service stops", () => {
  const runtime = createCountRuntime({ perRelay: 1 });
  const count = vi.fn<CountRequest>(() => NEVER);
  const builder = countService({ count }).fallback([a]).runtime(runtime);
  const first = builder.build(),
    second = builder.build();
  const x = first.event(target).reactions$.subscribe();
  const y = second.event(target).reactions$.subscribe();
  expect(count).toHaveBeenCalledTimes(1);
  second.stop();
  expect(runtime.available([`relay:${a}`])).toBe(false);
  first.stop();
  expect(runtime.available([`relay:${a}`])).toBe(true);
  x.unsubscribe();
  y.unsubscribe();
  runtime.stop();
});

it("keeps operational state out of policy and includes nesting and acceptance settings", async () => {
  const source = relayCountSource({ relays: [a], count: ([relay]) => answer(relay) });
  const root = routingCountSource("round-robin", [source]);
  const runtime = createCountRuntime();
  const context: CountContext = {
    clock: asyncScheduler,
    deadline: Infinity,
    attemptTimeout: 1000,
    runtime,
    transport: runtime,
  };
  const before = await firstValueFrom(root.policy(query));
  await firstValueFrom(root.count(query, context));
  expect(await firstValueFrom(root.policy(query))).toBe(before);
  expect(await firstValueFrom(routingCountSource("availability", [source]).policy(query))).not.toBe(before);
  runtime.stop();
});

it("allows nested custom sources to decline and falls through to a relay", () => {
  const custom = { id: "custom", policy: () => of("v1"), count: () => EMPTY };
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const service = countService({ count })
    .fallback((route) => [custom, route.roundRobin([a, b])])
    .build();
  const sub = service.event(target).reactions$.subscribe();
  expect(count).toHaveBeenCalledTimes(1);
  sub.unsubscribe();
  service.stop();
});

it("waits for capacity changes when every availability candidate is busy", () => {
  const runtime = createCountRuntime({ perRelay: 1 });
  const held = runtime.run([`relay:${a}`], () => NEVER).subscribe();
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const service = countService({ count }).availability([a]).runtime(runtime).build();
  const sub = service.event(target).reactions$.subscribe();
  expect(count).not.toHaveBeenCalled();
  held.unsubscribe();
  expect(count).toHaveBeenCalledTimes(1);
  sub.unsubscribe();
  service.stop();
  runtime.stop();
});

it("releases the upstream before reentrant capacity admission", () => {
  const runtime = createCountRuntime({ perRelay: 1 });
  const upstream = new Subject<number>();
  const first = runtime.run([`relay:${a}`], () => upstream).subscribe();
  let ran = false;
  const second = runtime
    .run([`relay:${a}`], () => {
      ran = true;
      expect(upstream.observed).toBe(false);
      return of(1);
    })
    .subscribe();
  first.unsubscribe();
  expect(ran).toBe(true);
  second.unsubscribe();
  runtime.stop();
});

it("bounds progressive empty COUNT outcomes by the dispatched timeout", () => {
  vi.useFakeTimers();
  const count = vi.fn<CountRequest>(([relay]) => (relay === a ? new Subject() : answer(relay)));
  const service = countService({ count }).fallback([a, b]).configure({ attemptTimeout: 100 }).build();
  const values: (number | undefined)[] = [];
  const sub = service.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(100);
  expect(values.at(-1)).toBe(7);
  sub.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a busy preferred branch without declaring the relay unhealthy", () => {
  vi.useFakeTimers();
  const runtime = createCountRuntime({ perRelay: 1 });
  const held = runtime.run([`relay:${a}`], () => NEVER).subscribe();
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const service = countService({ count })
    .fallback([a, b])
    .runtime(runtime)
    .configure({ selectionTimeout: 100 })
    .build();
  const sub = service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(100);
  expect(count.mock.calls[0][0]).toEqual([b]);
  expect(runtime.healthy(`count:${a}`)).toBe(true);
  sub.unsubscribe();
  service.stop();
  held.unsubscribe();
  runtime.stop();
});

it("normalizes capacity keys and atomically acquires relay and provider resources", () => {
  const runtime = createCountRuntime({ perRelay: 1, perProvider: 1 });
  const held = runtime.run(["relay:wss://A.test", `relay:${a}`, "provider:p"], () => NEVER).subscribe();
  expect(runtime.available([`relay:${a}`])).toBe(false);
  expect(runtime.available([`relay:${b}`, "provider:p"])).toBe(false);
  expect(runtime.available([`relay:${b}`, "provider:other"])).toBe(true);
  held.unsubscribe();
  expect(runtime.available([`relay:${a}`])).toBe(true);
  runtime.stop();
});

it("mixes verified NIP-85 providers and relay leaves in a round-robin group", async () => {
  vi.useFakeTimers();
  const { FakeUser } = await import("../../__tests__/fake-user.js");
  const signer = new FakeUser();
  const assertion = signer.event({
    kind: 30383,
    tags: [
      ["d", target.id],
      ["reaction_cnt", "12"],
    ],
  });
  const request = vi.fn(() => of(assertion));
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const service = countService({ count, request })
    .roundRobin((route) => [route.nip85({ providers: () => [{ pubkey: signer.pubkey, relays$: of([c]) }] }), a])
    .build();
  const values: (number | undefined)[] = [];
  const first = service.event(target).reactions$.subscribe((value) => values.push(value));
  const second = service.event({ ...target, id: "b".repeat(64) }).reactions$.subscribe();
  await vi.advanceTimersByTimeAsync(10);
  expect(values.at(-1)).toBe(12);
  expect(count).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
  first.unsubscribe();
  second.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("skips repeated endpoints across nested fallbacks within one resolution", () => {
  const count = vi.fn<CountRequest>(([relay]) =>
    relay === a ? of({ [a]: { ok: true, value: { count: -1 } } }) : answer(relay),
  );
  const service = countService({ count })
    .fallback((route) => [route.fallback([a]), route.fallback([a, b])])
    .build();
  const sub = service.event(target).reactions$.subscribe();
  expect(count.mock.calls.map(([relays]) => relays[0])).toEqual([a, b]);
  sub.unsubscribe();
  service.stop();
});

it("falls through unsupported availability groups without consuming the selection budget", () => {
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const unsupported = {
    id: "unsupported",
    policy: () => of("v1"),
    supports: () => of(false),
    available: () => of(false),
    count: () => EMPTY,
  };
  const service = countService({ count })
    .fallback((route) => [route.availability([unsupported]), a])
    .build();
  const sub = service.event(target).reactions$.subscribe();
  expect(count).toHaveBeenCalledTimes(1);
  sub.unsubscribe();
  service.stop();
});

it("does not overcommit relay capacity when diagnostic callbacks reenter admission", () => {
  const runtime = createCountRuntime({ perRelay: 1 });
  let reentered = false;
  let secondStarted = false;
  const events = runtime.events$.subscribe((event) => {
    if (event.type === "start" && !reentered) {
      reentered = true;
      runtime
        .tryRun([`relay:${a}`], () => {
          secondStarted = true;
          return of(1);
        })
        .subscribe();
    }
  });
  const first = runtime.run([`relay:${a}`], () => NEVER).subscribe();
  expect(secondStarted).toBe(false);
  first.unsubscribe();
  events.unsubscribe();
  runtime.stop();
});

it("shares cache policy between equivalent builder and manual routing trees", async () => {
  const { default: Keyv } = await import("keyv");
  const cache = new Keyv();
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const first = countService({ count }).fallback([a, b]).configure({ cache }).build();
  const sub = first.event(target).reactions$.subscribe();
  for (let i = 0; i < 100; i++) await Promise.resolve();
  expect(count).toHaveBeenCalledTimes(1);
  sub.unsubscribe();
  first.stop();
  const source = routingCountSource(
    "fallback",
    [a, b].map((relay) => relayCountSource({ count, relays: [relay] })),
  );
  const second = createCountService({ source, cache });
  const values: (number | undefined)[] = [];
  const next = second.event(target).reactions$.subscribe((value) => values.push(value));
  for (let i = 0; i < 100; i++) await Promise.resolve();
  expect(values.at(-1)).toBe(7);
  expect(count).toHaveBeenCalledTimes(1);
  next.unsubscribe();
  second.stop();
});

it("keeps assertion batches isolated across service deadlines on a shared runtime", async () => {
  vi.useFakeTimers();
  const { FakeUser } = await import("../../__tests__/fake-user.js");
  const signer = new FakeUser();
  const assertion = signer.event({
    kind: 30383,
    tags: [
      ["d", target.id],
      ["reaction_cnt", "12"],
    ],
  });
  const streams: Subject<typeof assertion>[] = [];
  const source = nip85CountSource({
    request: () => {
      const stream = new Subject<typeof assertion>();
      streams.push(stream);
      return stream;
    },
    providers: () => [{ pubkey: signer.pubkey, relays$: of([a]) }],
    batchWindow: 0,
  });
  const runtime = createCountRuntime();
  const builder = countService({}).source(source).runtime(runtime);
  const first = builder.configure({ resolutionTimeout: 50 }).build();
  const second = builder.configure({ resolutionTimeout: 150 }).build();
  const x = first.event(target).reactions$.subscribe();
  const values: (number | undefined)[] = [];
  const y = second.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(0);
  expect(streams).toHaveLength(2);
  vi.advanceTimersByTime(60);
  expect(streams[0].observed).toBe(false);
  expect(streams[1].observed).toBe(true);
  streams[1].next(assertion);
  streams[1].complete();
  expect(values.at(-1)).toBe(12);
  x.unsubscribe();
  y.unsubscribe();
  first.stop();
  second.stop();
  runtime.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not let broken or silent custom availability observers block ready peers", () => {
  const count = vi.fn<CountRequest>(([relay]) => answer(relay));
  const silent = { id: "silent", policy: () => of("v1"), available: () => NEVER, count: () => EMPTY };
  const broken = {
    id: "broken",
    policy: () => of("v1"),
    available: () => {
      throw new Error("broken");
    },
    count: () => EMPTY,
  };
  const service = countService({ count }).availability([silent, broken, a]).build();
  const sub = service.event(target).reactions$.subscribe();
  expect(count).toHaveBeenCalledTimes(1);
  sub.unsubscribe();
  service.stop();
});

it("keeps a shared assertion request alive after its earliest subscriber expires", async () => {
  vi.useFakeTimers();
  const { FakeUser } = await import("../../__tests__/fake-user.js");
  const signer = new FakeUser();
  const other = { ...target, id: "b".repeat(64) };
  const assertion = signer.event({
    kind: 30383,
    tags: [
      ["d", other.id],
      ["reaction_cnt", "12"],
    ],
  });
  const stream = new Subject<typeof assertion>();
  const request = vi.fn(() => stream);
  const service = countService({ request })
    .fallback((route) => [route.nip85({ providers: () => [{ pubkey: signer.pubkey, relays$: of([a]) }] })])
    .configure({ resolutionTimeout: 50, attemptTimeout: 1000 })
    .build();
  const first = service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(5);
  const values: (number | undefined)[] = [];
  const second = service.event(other).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(45);
  expect(request).toHaveBeenCalledTimes(1);
  expect(stream.observed).toBe(true);
  vi.advanceTimersByTime(2);
  stream.next(assertion);
  stream.complete();
  expect(values.at(-1)).toBe(12);
  first.unsubscribe();
  second.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});
