import {
  enableLoggerNamespaces,
  getLoggerNamespaces,
  getLoggerSink,
  logger as rootLogger,
  setLoggerSink,
  type Debugger,
  type LogRecord,
  type LoggerSink,
} from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers";
import { asyncScheduler, BehaviorSubject, EMPTY, from, of, Subject, throwError } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCountService, nip85CountSource, reactionCountMetric, relayCountSource } from "../index.js";
import type { CountRequest } from "../index.js";

const relay = "wss://logging.test/";
const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
const pubkey = "b".repeat(64);
let savedNamespaces: string;
let savedSink: LoggerSink;
let records: LogRecord[];

beforeEach(() => {
  vi.useFakeTimers();
  savedNamespaces = getLoggerNamespaces();
  savedSink = getLoggerSink();
  records = [];
  setLoggerSink((_message, record) => records.push(record));
  enableLoggerNamespaces("applesauce:count-*");
});

afterEach(() => {
  enableLoggerNamespaces(savedNamespaces);
  setLoggerSink(savedSink);
  vi.useRealTimers();
});

const messages = () => records.map((record) => `${record.namespace} ${record.message}`).join("\n");

it("traces bad-network timeouts, retries, queue abandonment, and running cancellation", () => {
  const service = createCountService({
    relays: [relay],
    count: () => new Subject(),
    concurrency: 1,
    attemptTimeout: 100,
    resolutionTimeout: 500,
    retryDelay: 1000,
    random: () => 0.5,
  });
  const active = service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(1);
  const abandoned = service.event({ ...target, id: "queued" }).reactions$.subscribe();
  abandoned.unsubscribe();
  vi.advanceTimersByTime(101);
  expect(messages()).toContain("applesauce:count-service:transport Transport abandoned");
  expect(messages()).toContain("applesauce:count-service:sources:relay COUNT transport cancelled");
  expect(messages()).toContain("COUNT attempt failed");
  expect(messages()).toContain("TimeoutError");
  expect(messages()).toContain("Retry scheduled");
  expect(messages()).toContain(target.id);
  expect(messages()).toContain(relay);
  active.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("logs zero as success, fresh cache hits, refresh failures, and reactive policy revocation", () => {
  let calls = 0;
  const relays = new BehaviorSubject([relay]);
  const count: CountRequest = () =>
    ++calls === 1 ? of({ [relay]: { ok: true, value: { count: 0 } } }) : throwError(() => new Error("offline"));
  const service = createCountService({ relays, count, ttl: () => 1000 });
  const first = service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(1);
  first.unsubscribe();
  const second = service.event(target).reactions$.subscribe();
  expect(messages()).toContain("Cache hit");
  expect(messages()).toContain("COUNT accepted");
  expect(messages()).not.toContain("COUNT transport cancelled");
  vi.advanceTimersByTime(1001);
  expect(messages()).toContain("offline");
  expect(messages()).toContain("Resolution unavailable");
  relays.next([]);
  expect(messages()).toContain("Cached policy revoked");
  second.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("correlates assertion batches, rejected replies, missing-subject recovery, and fallback", () => {
  const now = Math.floor(Date.now() / 1000);
  const event = (subject: string, created_at: number): NostrEvent => ({
    id: "c".repeat(64),
    pubkey,
    kind: 30383,
    created_at,
    tags: [
      ["d", subject],
      ["reaction_cnt", "5"],
    ],
    sig: "",
    content: "DO NOT LOG EVENT CONTENT",
  });
  const service = createCountService({
    sources: [
      nip85CountSource({
        providers: () => [{ pubkey, relays$: of([relay]) }],
        verify: () => true,
        request: () => from([event(target.id, now - 100000), event(target.id, now)]),
      }),
      relayCountSource({ relays: [relay], count: () => of({ [relay]: { ok: true, value: { count: 2 } } }) }),
    ],
  });
  service.event(target).reactions$.subscribe();
  service.event({ ...target, id: "missing" }).reactions$.subscribe();
  vi.advanceTimersByTime(30);
  expect(messages()).toContain("Assertion batch joined");
  expect(messages()).toContain("Assertion batch dispatched");
  expect(messages()).toContain("stale assertion");
  expect(messages()).toContain("Assertion metric accepted");
  expect(messages()).toContain("Retrying missing assertion subject");
  expect(messages()).toContain("Source attempt empty");
  expect(messages()).toContain("COUNT accepted");
  expect(messages()).not.toContain("DO NOT LOG EVENT CONTENT");
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("uses standalone source namespaces and lets a source override its inherited logger", () => {
  enableLoggerNamespaces("applesauce:count-sources:*,applesauce:custom:*");
  const count: CountRequest = () => of({ [relay]: { ok: true, value: { count: 1 } } });
  const source = relayCountSource({ relays: [relay], count });
  source
    .count(
      { target, metric: reactionCountMetric },
      {
        deadline: Date.now() + 500,
        attemptTimeout: 100,
        clock: asyncScheduler,
        transport: { run: (_resources, request) => request() },
      },
    )
    .subscribe();
  expect(
    records.some(
      (record) => record.namespace === "applesauce:count-sources:relay" && record.message.includes("COUNT accepted"),
    ),
  ).toBe(true);

  const service = createCountService({
    sources: [relayCountSource({ relays: [relay], count, logger: rootLogger.extend("custom") })],
  });
  service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(1);
  expect(
    records.some(
      (record) => record.namespace === "applesauce:custom:relay" && record.message.includes("COUNT accepted"),
    ),
  ).toBe(true);
  service.stop();
});

it("inherits custom service loggers and derives each source namespace once across metric churn", () => {
  const derivations: string[] = [];
  const create = (namespace: string): Debugger => {
    const log = (() => {}) as Debugger;
    Object.defineProperties(log, { namespace: { value: namespace }, enabled: { value: false } });
    log.extend = (name) => {
      derivations.push(`${namespace}:${name}`);
      return create(`${namespace}:${name}`);
    };
    return log;
  };
  const service = createCountService({ logger: create("test"), relays: [relay], count: () => EMPTY });
  for (let i = 0; i < 20; i++) {
    const sub = service.event({ ...target, id: String(i) }).reactions$.subscribe();
    vi.advanceTimersByTime(1);
    sub.unsubscribe();
  }
  expect(derivations.filter((name) => name === "test:count-service:sources:relay")).toHaveLength(1);
  expect(derivations.filter((name) => name === "test:count-service:sources:fallback")).toHaveLength(1);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("remains silent when namespaces are disabled and does not dispatch abandoned demand", () => {
  enableLoggerNamespaces("");
  const count = vi.fn<CountRequest>(() => new Subject());
  const service = createCountService({ relays: [relay], count });
  service.event(target).reactions$.subscribe().unsubscribe();
  vi.advanceTimersByTime(10);
  service.stop();
  expect(records).toEqual([]);
  expect(count).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("records relay refusals with their reason before trying the next relay", () => {
  const other = "wss://other.test/";
  const count: CountRequest = (relays) =>
    of({
      [relays[0]]:
        relays[0] === relay
          ? { ok: false, error: new Error("auth-required: authenticate before counting") }
          : { ok: true, value: { count: 0 } },
    });
  const service = createCountService({ relays: [relay, other], count });
  const values: (number | undefined)[] = [];
  service.event(target).reactions$.subscribe((value) => values.push(value));
  vi.advanceTimersByTime(3);
  expect(messages()).toContain("COUNT refused");
  expect(messages()).toContain("auth-required");
  expect(messages()).toContain(other);
  expect(values.at(-1)).toBe(0);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("records queue overload and cancels an assertion batch only after its last interest leaves", () => {
  const overloaded = createCountService({
    relays: [relay],
    count: () => new Subject(),
    concurrency: 1,
    queueCapacity: 1,
  });
  overloaded.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(1);
  overloaded.event({ ...target, id: "queued" }).reactions$.subscribe();
  overloaded.event({ ...target, id: "overloaded" }).reactions$.subscribe();
  expect(messages()).toContain("Transport overload");
  expect(messages()).toContain("queue capacity exceeded");
  overloaded.stop();

  const service = createCountService({
    sources: [nip85CountSource({ request: () => new Subject(), providers: () => [{ pubkey, relays$: of([relay]) }] })],
  });
  const first = service.event(target).reactions$.subscribe();
  const second = service.event({ ...target, id: "other" }).reactions$.subscribe();
  vi.advanceTimersByTime(12);
  first.unsubscribe();
  expect(records.filter((record) => record.message.includes("Assertion batch cancelled"))).toHaveLength(0);
  second.unsubscribe();
  expect(records.filter((record) => record.message.includes("Assertion batch cancelled"))).toHaveLength(1);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});
