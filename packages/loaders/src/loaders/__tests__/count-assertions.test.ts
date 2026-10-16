import type { NostrEvent } from "applesauce-core/helpers";
import { BehaviorSubject, from, Observable, of, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCountService, nip85CountSource, relayCountSource } from "../index.js";
import type { AssertionRequest, CountProvider } from "../index.js";

const relay = "wss://assertions.test/";
const pubkey = "b".repeat(64);
const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
const provider: CountProvider = { pubkey, relays$: of([relay]) };
function assertion(subject: string, value = "7", created_at = Math.floor(Date.now() / 1000)): NostrEvent {
  return {
    id: "c".repeat(64),
    pubkey,
    kind: 30383,
    created_at,
    tags: [
      ["d", subject],
      ["reaction_cnt", value],
    ],
    content: "",
    sig: "",
  };
}
afterEach(() => vi.useRealTimers());

describe("assertion counts", () => {
  it("batches only demanded subjects, shares metrics, and retains zero", () => {
    vi.useFakeTimers();
    const request = vi.fn<AssertionRequest>((_relays, filters) =>
      from(filters[0]["#d"]!.map((id) => assertion(id, "0"))),
    );
    const service = createCountService({
      sources: [nip85CountSource({ request, providers: () => [provider], verify: () => true })],
    });
    const a = service.event(target).reactions$.subscribe();
    const b = service.event({ ...target, id: "d" }).reactions$.subscribe();
    b.unsubscribe();
    const values: (number | undefined)[] = [];
    const c = service.event(target).reactions$.subscribe((v) => values.push(v));
    vi.advanceTimersByTime(11);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1][0]["#d"]).toEqual([target.id]);
    expect(values).toEqual([undefined, 0]);
    a.unsubscribe();
    c.unsubscribe();
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps shared batches alive until their last interested metric leaves", () => {
    vi.useFakeTimers();
    let cancellations = 0;
    const events = new Subject<NostrEvent>();
    const request: AssertionRequest = () =>
      new Observable((subscriber) => {
        const sub = events.subscribe(subscriber);
        return () => {
          cancellations++;
          sub.unsubscribe();
        };
      });
    const service = createCountService({
      sources: [nip85CountSource({ request, providers: () => [provider], verify: () => true })],
    });
    const a = service.event(target).reactions$.subscribe();
    const b = service.event({ ...target, id: "d" }).reactions$.subscribe();
    vi.advanceTimersByTime(11);
    a.unsubscribe();
    expect(cancellations).toBe(0);
    b.unsubscribe();
    expect(cancellations).toBe(1);
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back independently for missing or malformed metrics and rejects invalid signatures", () => {
    vi.useFakeTimers();
    const request = vi.fn<AssertionRequest>(() => of(assertion(target.id, "-1")));
    const service = createCountService({
      sources: [
        nip85CountSource({ request, providers: () => [provider], verify: () => true }),
        relayCountSource({ relays: [relay], count: () => of({ [relay]: { ok: true, value: { count: 13 } } }) }),
      ],
    });
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    vi.advanceTimersByTime(30);
    expect(values.at(-1)).toBe(13);
    expect(request).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it("reacts to nested relay changes and provider revocation after success", () => {
    vi.useFakeTimers();
    const nested = new BehaviorSubject([relay]);
    const providers = new BehaviorSubject<readonly CountProvider[]>([{ pubkey, relays$: nested }]);
    const request = vi.fn<AssertionRequest>(() => of(assertion(target.id)));
    const service = createCountService({
      sources: [nip85CountSource({ request, providers: () => providers, verify: () => true })],
    });
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    vi.advanceTimersByTime(11);
    expect(values.at(-1)).toBe(7);
    nested.next(["wss://new.test"]);
    expect(values.at(-1)).toBeUndefined();
    vi.advanceTimersByTime(11);
    expect(request.mock.calls.at(-1)![0]).toEqual(["wss://new.test/"]);
    providers.next([]);
    expect(values.at(-1)).toBeUndefined();
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("selects the latest assertion before parsing its metric", () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    const request: AssertionRequest = () => from([assertion(target.id, "9", now - 10), assertion(target.id, "4", now)]);
    const service = createCountService({
      sources: [nip85CountSource({ request, providers: () => [provider], verify: () => true })],
    });
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    vi.advanceTimersByTime(11);
    expect(values.at(-1)).toBe(4);
    service.stop();
  });
});

it("rejects invalid signatures, stale assertions, wrong providers, and unsafe integer tags", () => {
  vi.useFakeTimers();
  for (const event of [
    assertion(target.id, "1", 1),
    { ...assertion(target.id), pubkey: "d".repeat(64) },
    assertion(target.id, "9007199254740992"),
    assertion(target.id, "2"),
  ]) {
    const service = createCountService({
      sources: [
        nip85CountSource({
          request: () => of(event),
          providers: () => [provider],
          verify: () => event.tags.find((tag) => tag[0] === "reaction_cnt")?.[1] !== "2",
        }),
      ],
    });
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((value) => values.push(value));
    vi.advanceTimersByTime(30);
    expect(values).toEqual([undefined]);
    service.stop();
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("scopes provider selection separately for event IDs, addresses, and metric tags", () => {
  vi.useFakeTimers();
  const selectors: string[] = [];
  const service = createCountService({
    sources: [
      nip85CountSource({
        providers: (kind, tag) => {
          selectors.push(`${kind}:${tag}`);
          return [];
        },
        request: () => of(),
        verify: () => true,
      }),
    ],
  });
  service.event(target).reactions$.subscribe();
  service.event({ ...target, address: `30023:${pubkey}:article` }).reactions$.subscribe();
  service.event(target).comments$.subscribe();
  expect(selectors).toEqual(["30383:reaction_cnt", "30384:reaction_cnt", "30383:comment_cnt"]);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});
