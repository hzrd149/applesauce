import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { Observable, Subject, take } from "rxjs";
import { describe, expect, it } from "vitest";
import { getKeyedRouter, KeyedRouter } from "../keyed-router.js";

type Value = { key: string; n: number };
const byKey = (v: Value) => v.key;

/** A source that counts its current and total subscribers */
function createSource() {
  const subject = new Subject<Value>();
  const counts = { current: 0, total: 0 };
  const source = new Observable<Value>((observer) => {
    counts.current++;
    counts.total++;
    const sub = subject.subscribe(observer);
    return () => {
      counts.current--;
      sub.unsubscribe();
    };
  });
  return { subject, source, counts };
}

describe("KeyedRouter", () => {
  it("should only deliver values to routes with a matching key", () => {
    const { subject, source } = createSource();
    const router = new KeyedRouter(source, byKey);
    const a = subscribeSpyTo(router.route("a"));
    const b = subscribeSpyTo(router.route("b"));

    subject.next({ key: "a", n: 1 });
    subject.next({ key: "c", n: 2 });

    expect(a.getValues()).toEqual([{ key: "a", n: 1 }]);
    expect(b.getValues()).toEqual([]);
  });

  it("should hold one source subscription while any route is open", () => {
    const { source, counts } = createSource();
    const router = new KeyedRouter(source, byKey);
    const a = router.route("a").subscribe();
    const b = router.route("b").subscribe();
    expect(counts.current).toBe(1);

    a.unsubscribe();
    expect(counts.current).toBe(1);
    b.unsubscribe();
    expect(counts.current).toBe(0);
  });

  it("should not deliver the current value to a route opened while dispatching", () => {
    const { subject, source } = createSource();
    const router = new KeyedRouter(source, byKey);
    const late: Value[] = [];

    router
      .route("a")
      .pipe(take(1))
      .subscribe(() => router.route("a").subscribe((v) => late.push(v)));
    subject.next({ key: "a", n: 1 });
    subject.next({ key: "a", n: 2 });

    expect(late).toEqual([{ key: "a", n: 2 }]);
  });

  it("should skip a route removed while dispatching", () => {
    const { subject, source } = createSource();
    const router = new KeyedRouter(source, byKey);
    const second: Value[] = [];
    let secondSub: { unsubscribe(): void } | undefined;

    router.route("a").subscribe(() => secondSub?.unsubscribe());
    secondSub = router.route("a").subscribe((v) => second.push(v));
    subject.next({ key: "a", n: 1 });

    expect(second).toEqual([]);
  });

  it("should complete every route and resubscribe afterwards", () => {
    const { subject, source, counts } = createSource();
    const router = new KeyedRouter(source, byKey);
    const a = subscribeSpyTo(router.route("a"));
    const b = subscribeSpyTo(router.route("b"));

    subject.complete();
    expect(a.receivedComplete()).toBe(true);
    expect(b.receivedComplete()).toBe(true);

    // The completed subject completes the new subscription synchronously, leaving the router ready again
    subscribeSpyTo(router.route("a"));
    subscribeSpyTo(router.route("a"));
    expect(counts.total).toBe(3);
  });

  it("should send source errors to every route", () => {
    const { subject, source } = createSource();
    const router = new KeyedRouter(source, byKey);
    const a = subscribeSpyTo(router.route("a"), { expectErrors: true });
    const error = new Error("failed");

    subject.error(error);
    expect(a.getError()).toBe(error);
  });
});

describe("getKeyedRouter", () => {
  it("should share one router per source and key name", () => {
    const { source } = createSource();

    expect(getKeyedRouter(source, "key", byKey)).toBe(getKeyedRouter(source, "key", byKey));
    expect(getKeyedRouter(source, "other", byKey)).not.toBe(getKeyedRouter(source, "key", byKey));
  });
});
