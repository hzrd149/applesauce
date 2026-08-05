import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NEVER, Observable, of, Subject, throwError, timer } from "rxjs";
import { map } from "rxjs/operators";
import { describe, expect, it, vi } from "vitest";

import type { RelayAuthContext } from "../types.js";
import {
  AuthPhaseGate,
  AuthRequiredSignal,
  authRequiredSignal,
  authRetry,
  AuthRetryConfig,
  isAuthRequiredSignal,
  suspendableTimeout,
} from "../operators/auth-retry.js";

/** A minimal RelayAuthContext stand-in — the operator is tested in isolation, no real Relay involved */
const FAKE_CONTEXT: RelayAuthContext = {
  relay: {} as never,
  url: "wss://relay.example/",
  challenge: null,
  operation: "read",
  requirement: true,
  missingPubkeys: null,
  reason: "",
};

/** Marker error constructors distinguishable by `kind`, standing in for the real Relay error classes */
function makeErrors() {
  return {
    exhausted: vi.fn((reason: string) => ({ kind: "exhausted" as const, reason })),
    handler: vi.fn((reason: string, cause: unknown) => ({ kind: "handler" as const, reason, cause })),
    timeout: vi.fn((reason: string) => ({ kind: "timeout" as const, reason })),
  };
}

function baseConfig(overrides: Partial<AuthRetryConfig> = {}): AuthRetryConfig {
  return {
    operation: "read",
    buildContext: (reason) => ({ ...FAKE_CONTEXT, reason }),
    authSatisfied$: () => of(true),
    gate: new AuthPhaseGate(),
    errors: makeErrors(),
    ...overrides,
  };
}

/**
 * A source that re-arms a fresh Subject on every subscription (mirroring a real per-call REQ pipeline)
 * so the test can manually control what each successive subscription emits, and count subscriptions.
 */
function makeControllableSource<T>() {
  let current: Subject<T | AuthRequiredSignal> | null = null;
  let subscribeCount = 0;

  const source = new Observable<T | AuthRequiredSignal>((subscriber) => {
    subscribeCount++;
    const subject = new Subject<T | AuthRequiredSignal>();
    current = subject;
    const sub = subject.subscribe(subscriber);
    return () => sub.unsubscribe();
  });

  return {
    source,
    emit: (value: T | AuthRequiredSignal) => current?.next(value),
    getSubscribeCount: () => subscribeCount,
  };
}

/** A source that always signals auth-required on every subscription, never emitting a real value */
function makePersistentSignalSource() {
  let subscribeCount = 0;
  const source = new Observable<number | AuthRequiredSignal>((subscriber) => {
    subscribeCount++;
    subscriber.next(authRequiredSignal("auth-required: persistent"));
    subscriber.complete();
  });
  return { source, getSubscribeCount: () => subscribeCount };
}

describe("authRetry", () => {
  it("never lets the raw signal reach the subscriber", async () => {
    const ctrl = makeControllableSource<number>();
    const spy = subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig())));

    ctrl.emit(authRequiredSignal("auth-required: need"));
    ctrl.emit(42);

    expect(spy.getValues()).toEqual([42]);
    expect(spy.getValues().some((v) => isAuthRequiredSignal(v))).toBe(false);
  });

  it("invokes the handler once per auth phase with the built context", async () => {
    const ctrl = makeControllableSource<number>();
    const onAuthRequired = vi.fn();
    subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ onAuthRequired }))));

    ctrl.emit(authRequiredSignal("auth-required: please authenticate"));

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledWith({ ...FAKE_CONTEXT, reason: "auth-required: please authenticate" });
  });

  it("subscribes the source exactly twice (authRetries + 1) against a persistently-signalling source", async () => {
    const persistent = makePersistentSignalSource();
    const errors = makeErrors();
    const spy = subscribeSpyTo(
      persistent.source.pipe(authRetry(baseConfig({ errors }))),
      { expectErrors: true },
    );

    await spy.onError();

    expect(persistent.getSubscribeCount()).toBe(2);
    expect(errors.exhausted).toHaveBeenCalledTimes(1);
    expect(spy.getError()).toEqual({ kind: "exhausted", reason: "auth-required: persistent" });
  });

  it("resets the consecutive counter after a real value, allowing a fresh retry budget", async () => {
    const ctrl = makeControllableSource<number>();
    const errors = makeErrors();
    const spy = subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ errors }))), { expectErrors: true });

    // First cycle: one signal (consumes the single default retry), then a real value resets the counter
    ctrl.emit(authRequiredSignal("auth-required: cycle 1"));
    ctrl.emit(1);
    // Second cycle: two consecutive signals should exhaust the (reset) budget of 1
    ctrl.emit(authRequiredSignal("auth-required: cycle 2a"));
    ctrl.emit(authRequiredSignal("auth-required: cycle 2b"));

    await spy.onError();

    expect(spy.getValues()).toEqual([1]);
    expect(errors.exhausted).toHaveBeenCalledTimes(1);
    expect(errors.exhausted).toHaveBeenCalledWith("auth-required: cycle 2b");
  });

  it("waitForAuth: false never invokes the handler and errors with the exhausted constructor", async () => {
    const onAuthRequired = vi.fn();
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(
      persistent.source.pipe(authRetry(baseConfig({ waitForAuth: false, onAuthRequired, errors }))),
      { expectErrors: true },
    );

    await spy.onError();

    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(errors.exhausted).toHaveBeenCalledTimes(1);
    expect(persistent.getSubscribeCount()).toBe(1);
    expect(spy.getError()).toEqual({ kind: "exhausted", reason: "auth-required: persistent" });
  });

  it("maps a rejecting handler to the handler error, carrying the rejection as cause", async () => {
    const rejection = new Error("handler blew up");
    const onAuthRequired = vi.fn().mockRejectedValue(rejection);
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(
      persistent.source.pipe(authRetry(baseConfig({ onAuthRequired, errors }))),
      { expectErrors: true },
    );

    await spy.onError();

    expect(errors.handler).toHaveBeenCalledTimes(1);
    expect(errors.handler).toHaveBeenCalledWith("auth-required: persistent", rejection);
    expect(spy.getError()).toEqual({ kind: "handler", reason: "auth-required: persistent", cause: rejection });
  });

  it("a short authTimeout produces the timeout error", async () => {
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(
      persistent.source.pipe(
        authRetry(
          baseConfig({
            authTimeout: 50,
            // never satisfied — the wait hangs until the timeout fires
            authSatisfied$: () => NEVER,
            errors,
          }),
        ),
      ),
      { expectErrors: true },
    );

    await spy.onError();

    expect(errors.timeout).toHaveBeenCalledTimes(1);
    expect(spy.getError()).toEqual({ kind: "timeout", reason: "auth-required: persistent" });
  });

  it("authTimeout: false leaves the phase pending past a window that would otherwise time out", async () => {
    const ctrl = makeControllableSource<number>();
    // Resolves after 150ms — comfortably past a would-be short timeout, proving no bound applies
    const authSatisfied$ = () => timer(150).pipe(map(() => true));

    const spy = subscribeSpyTo(
      ctrl.source.pipe(authRetry(baseConfig({ authTimeout: false, authSatisfied$ }))),
      { expectErrors: true },
    );

    ctrl.emit(authRequiredSignal("auth-required: unbounded"));

    // A short bound (e.g. 50ms) would have already errored by now; authTimeout: false must not have
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(spy.getError()).toBeUndefined();

    // Let the wait genuinely resolve and confirm the phase completes cleanly afterwards
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(spy.getError()).toBeUndefined();
    expect(ctrl.getSubscribeCount()).toBe(2);
  });

  it("still invokes the handler when the requirement is already satisfied", async () => {
    const onAuthRequired = vi.fn();
    const ctrl = makeControllableSource<number>();
    subscribeSpyTo(
      ctrl.source.pipe(authRetry(baseConfig({ onAuthRequired, authSatisfied$: () => of(true) }))),
    );

    ctrl.emit(authRequiredSignal("auth-required: already satisfied"));

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });
});

describe("suspendableTimeout", () => {
  it("does not fire while the gate is open, but fires on the remaining budget once it closes", async () => {
    const gate = new AuthPhaseGate();
    gate.begin();

    const spy = subscribeSpyTo(NEVER.pipe(suspendableTimeout(80, gate)), { expectErrors: true });

    // Wait well past the budget while the gate stays open — must not have fired yet
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(spy.getError()).toBeUndefined();

    gate.end();

    // Now the (near-full) remaining budget should elapse and the timeout should fire
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(spy.getError()).toBeInstanceOf(Error);
  });

  it("fires using the `with` escape hatch when provided", async () => {
    const gate = new AuthPhaseGate();
    const spy = subscribeSpyTo(NEVER.pipe(suspendableTimeout(50, gate, { with: () => of("fallback") })));

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(spy.getValues()).toEqual(["fallback"]);
  });

  it("returns identity for a non-positive or non-finite budget", async () => {
    const gate = new AuthPhaseGate();
    const spy = subscribeSpyTo(of(1).pipe(suspendableTimeout(0, gate)));
    expect(spy.getValues()).toEqual([1]);

    const spyInfinite = subscribeSpyTo(of(2).pipe(suspendableTimeout(Infinity, gate)));
    expect(spyInfinite.getValues()).toEqual([2]);
  });

  it("propagates a source error normally", async () => {
    const gate = new AuthPhaseGate();
    const err = new Error("boom");
    const spy = subscribeSpyTo(throwError(() => err).pipe(suspendableTimeout(100, gate)), { expectErrors: true });
    await spy.onError();
    expect(spy.getError()).toBe(err);
  });
});
