import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { Observable, Subject, take } from "rxjs";
import { describe, expect, it } from "vitest";
import { SocketRouter } from "../lib/socket-router.js";

/** A source that counts how many subscribers it currently has */
function createSource() {
  const subject = new Subject<any>();
  let subscribers = 0;
  let subscriptions = 0;
  const source = new Observable<any>((observer) => {
    subscribers++;
    subscriptions++;
    const sub = subject.subscribe(observer);
    return () => {
      subscribers--;
      sub.unsubscribe();
    };
  });
  return {
    subject,
    source,
    get subscribers() {
      return subscribers;
    },
    get subscriptions() {
      return subscriptions;
    },
  };
}

describe("SocketRouter", () => {
  it("should route subscription replies by subscription id and OK by event id", () => {
    const { subject, source } = createSource();
    const router = new SocketRouter(source);
    const a = subscribeSpyTo(router.route("sub", "a"));
    const b = subscribeSpyTo(router.route("sub", "b"));
    const ok = subscribeSpyTo(router.route("ok", "a"));

    subject.next(["EVENT", "a", {}]);
    subject.next(["EOSE", "b"]);
    subject.next(["OK", "a", true, ""]);
    subject.next(["NOTICE", "a"]);

    expect(a.getValues()).toEqual([["EVENT", "a", {}]]);
    expect(b.getValues()).toEqual([["EOSE", "b"]]);
    expect(ok.getValues()).toEqual([["OK", "a", true, ""]]);
  });

  it("should hold one source subscription while any route is open", () => {
    const state = createSource();
    const router = new SocketRouter(state.source);
    const a = router.route("sub", "a").subscribe();
    const b = router.route("sub", "b").subscribe();
    expect(state.subscribers).toBe(1);

    a.unsubscribe();
    expect(state.subscribers).toBe(1);
    b.unsubscribe();
    expect(state.subscribers).toBe(0);
  });

  it("should not deliver the current message to a route opened while dispatching", () => {
    const { subject, source } = createSource();
    const router = new SocketRouter(source);
    const late: any[] = [];

    router
      .route("sub", "a")
      .pipe(take(1))
      .subscribe(() => router.route("sub", "a").subscribe((m) => late.push(m)));
    subject.next(["CLOSED", "a", ""]);
    subject.next(["EVENT", "a", {}]);

    expect(late).toEqual([["EVENT", "a", {}]]);
  });

  it("should skip a route removed while dispatching", () => {
    const { subject, source } = createSource();
    const router = new SocketRouter(source);
    const second: any[] = [];
    let secondSub: { unsubscribe(): void } | undefined;

    router.route("sub", "a").subscribe(() => secondSub?.unsubscribe());
    secondSub = router.route("sub", "a").subscribe((m) => second.push(m));
    subject.next(["EVENT", "a", {}]);

    expect(second).toEqual([]);
  });

  it("should send source errors to every route and resubscribe afterwards", () => {
    const state = createSource();
    const router = new SocketRouter(state.source);
    const a = subscribeSpyTo(router.route("sub", "a"), { expectErrors: true });
    const ok = subscribeSpyTo(router.route("ok", "b"), { expectErrors: true });
    const error = new Error("closed");

    state.subject.error(error);
    expect(a.receivedError()).toBe(true);
    expect(ok.getError()).toBe(error);

    // A new route after the error opens a fresh source subscription. The errored subject errors it
    // synchronously, which must also leave the router ready to subscribe again
    const retry = subscribeSpyTo(router.route("sub", "a"), { expectErrors: true });
    expect(state.subscriptions).toBe(2);
    expect(retry.getError()).toBe(error);

    router.route("sub", "a").subscribe({ error: () => {} });
    expect(state.subscriptions).toBe(3);
  });

  it("should complete every route when the source completes", () => {
    const { subject, source } = createSource();
    const router = new SocketRouter(source);
    const a = subscribeSpyTo(router.route("sub", "a"));

    subject.complete();
    expect(a.receivedComplete()).toBe(true);
  });
});
