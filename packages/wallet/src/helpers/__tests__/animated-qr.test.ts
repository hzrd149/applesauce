import { afterEach, describe, expect, it, vi } from "vitest";
import { getDecodedToken } from "@cashu/cashu-ts";
import {
  config,
  EMPTY,
  firstValueFrom,
  ignoreElements,
  lastValueFrom,
  map,
  materialize,
  Observable,
  of,
  Subject,
  take,
  throwError,
  timeout,
  timer,
} from "rxjs";
import { subscribeSpyTo } from "@hirez_io/observer-spy";

/** Loads the real bc-ur module bypassing any active vi.doMock for the same specifier */
async function loadActualBcUr() {
  return vi.importActual<typeof import("@gandlaf21/bc-ur/dist/lib/es6/index.js")>(
    "@gandlaf21/bc-ur/dist/lib/es6/index.js",
  );
}

/** A promise plus its external release function, used to gate a mocked dynamic import */
function deferredGate() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { gate, release };
}

/** Resolves after exactly one macrotask, without relying on rxjs's `timer` scheduler */
function flushMacrotask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

import { receiveAnimated, sendAnimated } from "../animated-qr.js";

const tokenStr =
  "cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAJofKTJT5B5hcIOkYWEQYXN4QDA2M2VlYjgwZDZjODM4NWU4NzYwODVhN2E4NzdkOTkyY2U4N2QwNTRmY2RjYzNiODMwMzhjOWY3MmNmMDY1ZGVhY1ghAynsxZ-OuZfZDcqYTLPYfCqHO7jkGjn97aolgtSYhYykYWSjYWVYIGbp_9B9aztSlZxz7g6Tqx5M_1PuFzJCVEMOVd8XAF8wYXNYINTOU77ODcj28v04pq7ektdf6sq2XuxvMjVE0wK6jFolYXJYIM_gZnUGT5jDOyZiQ-2vG9zYnuWaY8vPoWGe_3sXvrvbpGFhBGFzeEA0MWMwZDk1YTU5ZjkxNTdlYTc5NTJlNGFlMzYzYTI3NTMxNTllNmQ1NGJiNzExMTg5ZDk5YjU1MmYzYjIzZTJiYWNYIQM-49gen_1nPchxbaAiKprVr78VmMRVpHH_Tu9P8TO5mGFko2FlWCB9j7rlpdBH_m7tNYnLpzPhn-nGmS1CcbUfnPzjxy6G92FzWCDdsby7fGM5324T5UEoV858YWzZ9MCY59KgKP362fJDfmFyWCDL73v4FRo7iMe83bfMuEy3RJPtC1Vr1jdOpw2-x-7EAaRhYQFhc3hANjRhZDI3NmExOGNmNDhiMDZmYjdiMGYwOWFiMTU4ZTA0ZmM0NmIxYzA4YzMyNjJlODUxNzZkYTMzMTgyYzQ3YWFjWCECMDpCbNbrgA9FcQEIYxobU7ik_pTl8sByPqHDmkY4azxhZKNhZVggqHGaff9M270EU8LGxRpG_G4rn2bMgjyk3hFFg78ZXRVhc1ggP6DsNsWykwKE94yZF23gpCyapcoqh6DDZdVu0lKn2Z5hclggmPKig-lObsuxi_1XCm7_Y_tqaCcqEDz8eCwVhJ8gq9M";
const token = getDecodedToken(tokenStr, []);

afterEach(() => {
  vi.doUnmock("@gandlaf21/bc-ur/dist/lib/es6/index.js");
});

it("defers loading the UR implementation until send subscription", async () => {
  vi.resetModules();
  vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", () => {
    throw new Error("bc-ur evaluated");
  });

  const animatedQr = await import("../animated-qr.js");

  expect(animatedQr.sendAnimated).toBeTypeOf("function");
  expect(animatedQr.receiveAnimated).toBeTypeOf("function");
  await expect(lastValueFrom(animatedQr.sendAnimated(tokenStr).pipe(take(1)))).rejects.toThrow(
    "error when mocking a module",
  );
});

it("defers loading the UR implementation until receive subscription", async () => {
  vi.resetModules();
  vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", () => {
    throw new Error("bc-ur evaluated");
  });

  const animatedQr = await import("../animated-qr.js");

  expect(animatedQr.receiveAnimated).toBeTypeOf("function");
  await expect(lastValueFrom(animatedQr.receiveAnimated(of("ur:bytes/test")))).rejects.toThrow(
    "error when mocking a module",
  );
});

describe("sendAnimated", () => {
  it("should loop", async () => {
    const qr$ = sendAnimated(token, { interval: 0 });

    const spy = subscribeSpyTo(qr$);

    // wait 100ms
    await lastValueFrom(timer(100));

    // should not have competed
    expect(spy.receivedComplete()).toBeFalsy();

    spy.unsubscribe();
  });

  it("should emit parts", async () => {
    const qr$ = sendAnimated(token, { interval: 0 }).pipe(take(6));

    const spy = subscribeSpyTo(qr$);

    // wait 100ms
    await lastValueFrom(qr$);

    // should not have competed
    expect(spy.getValues()).toEqual(
      Array(6)
        .fill(0)
        .map((_, i) => expect.stringContaining(`ur:bytes/${i + 1}-10/`)),
    );
  });
});

describe("receiveAnimated", () => {
  it("forwards the exact source error", async () => {
    const error = new Error("camera failed");
    const terminal = await firstValueFrom(
      receiveAnimated(throwError(() => error)).pipe(ignoreElements(), materialize(), timeout(1000)),
    );

    expect(terminal.kind).toBe("E");
    expect(terminal.error).toBe(error);
  });

  it.each([EMPTY, of("not a ur fragment")])("errors when input completes before decoding", async (input) => {
    const terminal = await firstValueFrom(
      receiveAnimated(input).pipe(ignoreElements(), materialize(), timeout(1000)),
    );

    expect(terminal.kind).toBe("E");
    expect(terminal.error).toEqual(
      new Error("Animated QR input completed before a complete UR was decoded"),
    );
  });

  it("tears down the input subscription when unsubscribed", async () => {
    let subscribed!: () => void;
    const sourceSubscribed = new Promise<void>((resolve) => (subscribed = resolve));
    let tornDown = false;
    const input = new Observable<string>(() => {
      subscribed();
      return () => (tornDown = true);
    });

    const subscription = receiveAnimated(input).subscribe();
    await sourceSubscribed;
    subscription.unsubscribe();

    expect(tornDown).toBe(true);
  });

  it("should decode animated qr", async () => {
    const qr$ = sendAnimated(token, { interval: 0 }).pipe(
      receiveAnimated,
      map((part) => (typeof part === "string" ? getDecodedToken(part, []) : part)),
    );
    const spy = subscribeSpyTo(qr$);

    await lastValueFrom(qr$);
    expect(spy.getValues()).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      token,
    ]);
  });
});

describe("receiveAnimated hot-source pre-load buffering", () => {
  it("decodes a complete hot Subject stream emitted entirely before bc-ur finishes loading", async () => {
    vi.resetModules();
    const { gate, release } = deferredGate();
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      return loadActualBcUr();
    });

    const { UR, UREncoder } = await loadActualBcUr();
    const ur = UR.from(new TextEncoder().encode(tokenStr));
    const parts = new UREncoder(ur, 100, 0).encodeWhole();

    const animatedQr = await import("../animated-qr.js");
    const source = new Subject<string>();
    const spy = subscribeSpyTo(animatedQr.receiveAnimated(source));

    // emit the entire fragment stream synchronously, before bc-ur resolves
    for (const part of parts) source.next(part);
    source.complete();

    // release the loader only after the pre-load stream has already completed
    release();

    await vi.waitFor(() => expect(spy.receivedComplete() || spy.receivedError()).toBe(true));

    expect(spy.receivedError()).toBe(false);
    const values = spy.getValues();
    const finalValue = values[values.length - 1];
    expect(typeof finalValue).toBe("string");
    expect(getDecodedToken(finalValue as string, [])).toEqual(token);
  });

  it("subscribes to its hot source synchronously, before the loader gate resolves", async () => {
    vi.resetModules();
    const { gate } = deferredGate();
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      return loadActualBcUr();
    });

    const animatedQr = await import("../animated-qr.js");

    let subscribed = false;
    const source = new Observable<string>(() => {
      subscribed = true;
      return () => {};
    });

    const subscription = animatedQr.receiveAnimated(source).subscribe();

    expect(subscribed).toBe(true);

    subscription.unsubscribe();
  });

  it("filters pre-load junk and normalizes mixed-case fragments exactly once before draining", async () => {
    vi.resetModules();
    const { gate, release } = deferredGate();
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      return loadActualBcUr();
    });

    const { UR, UREncoder } = await loadActualBcUr();
    const ur = UR.from(new TextEncoder().encode(tokenStr));
    const parts = new UREncoder(ur, 100, 0).encodeWhole().map((part) => part.toUpperCase());

    const animatedQr = await import("../animated-qr.js");
    const source = new Subject<string>();
    const spy = subscribeSpyTo(animatedQr.receiveAnimated(source));

    source.next("not a ur fragment");
    for (const part of parts) source.next(part);
    source.complete();

    release();

    await vi.waitFor(() => expect(spy.receivedComplete() || spy.receivedError()).toBe(true));

    expect(spy.receivedError()).toBe(false);
    const values = spy.getValues();
    // one progress emission per real fragment (junk filtered), plus the final decoded token
    expect(values.length).toBe(parts.length + 1);
    const finalValue = values[values.length - 1];
    expect(getDecodedToken(finalValue as string, [])).toEqual(token);
  });
});

describe("receiveAnimated cancellation, terminal order, and decoder isolation", () => {
  it("constructs no decoder for a subscription cancelled before the shared loader resolves, proven by a live positive control", async () => {
    vi.resetModules();
    const { gate, release } = deferredGate();
    let decoderInstances = 0;
    let resolveLoaderSettled!: () => void;
    const loaderSettled = new Promise<void>((resolve) => (resolveLoaderSettled = resolve));
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      const actual = await loadActualBcUr();
      class TrackingURDecoder extends actual.URDecoder {
        constructor(...args: ConstructorParameters<typeof actual.URDecoder>) {
          super(...args);
          decoderInstances++;
        }
      }
      const mocked = { ...actual, URDecoder: TrackingURDecoder };
      // signal settlement only once this factory's own module value is fully computed, so a
      // waiter never races the loader's internal `await loadActualBcUr()` step
      resolveLoaderSettled();
      return mocked;
    });

    const { UR, UREncoder } = await loadActualBcUr();
    const ur = UR.from(new TextEncoder().encode(tokenStr));
    const [firstPart] = new UREncoder(ur, 100, 0).encodeWhole();

    const animatedQr = await import("../animated-qr.js");

    // Subscription A: torn down before the shared loader promise settles, so it must never
    // reach decoder construction even though it is what triggered the dynamic import.
    let tornDown = false;
    let notified = false;
    const sourceA = new Observable<string>(() => () => (tornDown = true));
    const subscriptionA = animatedQr.receiveAnimated(sourceA).subscribe({
      next: () => (notified = true),
      error: () => (notified = true),
      complete: () => (notified = true),
    });
    subscriptionA.unsubscribe();
    expect(tornDown).toBe(true);

    // Release the shared mocked loader and wait for its own module value to be fully computed
    // before starting the positive control: a second dynamic import of the same specifier
    // issued while the first is still in flight would bypass the mock entirely.
    release();
    await loaderSettled;
    await flushMacrotask();

    // Positive control B: a live subscription started only after the same mocked loader has
    // fully settled, proving the mock resolves correctly and a decoder is constructed + emits.
    const sourceB = new Subject<string>();
    const spyB = subscribeSpyTo(animatedQr.receiveAnimated(sourceB));
    sourceB.next(firstPart);

    await vi.waitFor(() => expect(spyB.getValuesLength()).toBeGreaterThan(0));

    expect(notified).toBe(false);
    expect(decoderInstances).toBe(1);
  });

  it("sends no stopped-subscriber notification for a subscription cancelled before the shared loader rejects, proven by a live positive control", async () => {
    vi.resetModules();
    const { gate, release } = deferredGate();
    let resolveLoaderSettled!: () => void;
    const loaderSettled = new Promise<void>((resolve) => (resolveLoaderSettled = resolve));
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      // signal settlement right at the rejection point, so a waiter never races the loader's
      // own internal timing before its module promise actually rejects
      resolveLoaderSettled();
      throw new Error("bc-ur evaluated");
    });

    const animatedQr = await import("../animated-qr.js");

    const onStoppedNotification = vi.fn();
    const originalOnStoppedNotification = config.onStoppedNotification;
    config.onStoppedNotification = onStoppedNotification;

    try {
      // Subscription A: torn down before the shared loader promise settles, so its rejection
      // callback's own cancellation guard must return before ever notifying a stopped observer.
      let tornDown = false;
      const sourceA = new Observable<string>(() => () => (tornDown = true));
      const subscriptionA = animatedQr.receiveAnimated(sourceA).subscribe();
      subscriptionA.unsubscribe();
      expect(tornDown).toBe(true);

      // Release the shared mocked loader and wait for its own module value to settle (reject)
      // before starting the positive control: a second dynamic import of the same specifier
      // issued while the first is still in flight would bypass the mock entirely.
      release();
      await loaderSettled;
      await flushMacrotask();

      // Positive control B: a live subscription started only after the same mocked loader has
      // fully rejected, proving the mock rejects correctly and is delivered to a live subscriber.
      const sourceB = new Subject<string>();
      const spyB = subscribeSpyTo(animatedQr.receiveAnimated(sourceB), { expectErrors: true });

      await vi.waitFor(() => expect(spyB.receivedError()).toBe(true));
      expect(spyB.getError()?.message).toContain("error when mocking a module");

      // config.onStoppedNotification is invoked (if at all) via a scheduled setTimeout, so give
      // it two macrotasks to fire before asserting it never did.
      await flushMacrotask();
      await flushMacrotask();

      expect(onStoppedNotification).not.toHaveBeenCalled();
    } finally {
      config.onStoppedNotification = originalOnStoppedNotification;
    }
  });

  it("forwards a pre-load source error unchanged after any earlier buffered fragments", async () => {
    vi.resetModules();
    const { gate, release } = deferredGate();
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      return loadActualBcUr();
    });

    const { UR, UREncoder } = await loadActualBcUr();
    const ur = UR.from(new TextEncoder().encode(tokenStr));
    const parts = new UREncoder(ur, 100, 0).encodeWhole().slice(0, 3);

    const animatedQr = await import("../animated-qr.js");
    const source = new Subject<string>();
    const terminalPromise = firstValueFrom(
      animatedQr.receiveAnimated(source).pipe(ignoreElements(), materialize(), timeout(1000)),
    );

    const error = new Error("camera failed mid-stream");
    for (const part of parts) source.next(part);
    source.error(error);

    release();

    const terminal = await terminalPromise;
    expect(terminal.kind).toBe("E");
    expect(terminal.error).toBe(error);
  });

  it("keeps the exact incomplete-input error for a pre-load source that completes with no fragments", async () => {
    vi.resetModules();
    const { gate, release } = deferredGate();
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      return loadActualBcUr();
    });

    const animatedQr = await import("../animated-qr.js");
    const source = new Subject<string>();
    const terminalPromise = firstValueFrom(
      animatedQr.receiveAnimated(source).pipe(ignoreElements(), materialize(), timeout(1000)),
    );

    source.complete();
    release();

    const terminal = await terminalPromise;
    expect(terminal.kind).toBe("E");
    expect(terminal.error).toEqual(new Error("Animated QR input completed before a complete UR was decoded"));
  });

  it("gives each independent receive subscription its own queue and decoder, while shareReplay keeps one shared execution", async () => {
    vi.resetModules();
    const { gate, release } = deferredGate();
    let decoderInstances = 0;
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      await gate;
      const actual = await loadActualBcUr();
      class TrackingURDecoder extends actual.URDecoder {
        constructor(...args: ConstructorParameters<typeof actual.URDecoder>) {
          super(...args);
          decoderInstances++;
        }
      }
      return { ...actual, URDecoder: TrackingURDecoder };
    });

    const { UR, UREncoder } = await loadActualBcUr();
    const ur = UR.from(new TextEncoder().encode(tokenStr));
    const partsA = new UREncoder(ur, 100, 0).encodeWhole();
    const partsB = new UREncoder(ur, 100, 0).encodeWhole();

    const animatedQr = await import("../animated-qr.js");

    const sourceA = new Subject<string>();
    const sourceB = new Subject<string>();
    const resultA$ = animatedQr.receiveAnimated(sourceA);
    const resultB$ = animatedQr.receiveAnimated(sourceB);

    // two subscribers to the SAME receive result share one underlying execution
    const spyA1 = subscribeSpyTo(resultA$);
    const spyA2 = subscribeSpyTo(resultA$);

    for (const part of partsA) sourceA.next(part);
    sourceA.complete();

    release();

    await vi.waitFor(() => expect(spyA1.receivedComplete()).toBe(true));
    await vi.waitFor(() => expect(spyA2.receivedComplete()).toBe(true));

    expect(spyA1.getValues()).toEqual(spyA2.getValues());
    expect(decoderInstances).toBe(1);

    // an independent receiveAnimated() call gets its own queue and decoder
    const spyB = subscribeSpyTo(resultB$);
    for (const part of partsB) sourceB.next(part);
    sourceB.complete();

    await vi.waitFor(() => expect(spyB.receivedComplete()).toBe(true));

    expect(decoderInstances).toBe(2);
    expect(spyB.getValues()).toEqual(spyA1.getValues());
  });
});

describe("receiveAnimated decoder-construction errors", () => {
  it("routes a decoder-constructor error to the subscriber instead of losing it as an unhandled rejection", async () => {
    vi.resetModules();
    const sentinel = new Error("decoder constructor exploded");
    vi.doMock("@gandlaf21/bc-ur/dist/lib/es6/index.js", async () => {
      const actual = await loadActualBcUr();
      class ThrowingURDecoder extends actual.URDecoder {
        constructor(...args: ConstructorParameters<typeof actual.URDecoder>) {
          super(...args);
          throw sentinel;
        }
      }
      return { ...actual, URDecoder: ThrowingURDecoder };
    });

    const { UR, UREncoder } = await loadActualBcUr();
    const ur = UR.from(new TextEncoder().encode(tokenStr));
    const [firstPart] = new UREncoder(ur, 100, 0).encodeWhole();

    const animatedQr = await import("../animated-qr.js");

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const source = new Subject<string>();
      const terminalPromise = firstValueFrom(
        animatedQr.receiveAnimated(source).pipe(ignoreElements(), materialize(), timeout(1000)),
      );

      source.next(firstPart);

      const terminal = await terminalPromise;
      expect(terminal.kind).toBe("E");
      expect(terminal.error).toBe(sentinel);

      // give any stray unhandled rejection a chance to surface before asserting none did
      await flushMacrotask();
      await flushMacrotask();

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
