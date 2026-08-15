import { subscribeSpyTo } from "@hirez_io/observer-spy";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { NEVER, Observable, of, Subject, throwError, timer } from "rxjs";
import { map } from "rxjs/operators";
import { describe, expect, it, vi } from "vitest";

import { describeWireRequest } from "../helpers/auth-log.js";
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
  request: { verb: "REQ", id: "fake-req-id", filters: [{ kinds: [1] }] },
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

function baseConfig(overrides: Partial<AuthRetryConfig<number>> = {}): AuthRetryConfig<number> {
  return {
    buildContext: (reason) => ({ ...FAKE_CONTEXT, reason }),
    authSatisfied$: () => of(true),
    satisfiedPubkeys: () => [],
    gate: new AuthPhaseGate(),
    // Default: any value counts as progress, matching every existing test's "any value is progress" intent
    isProgress: () => true,
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

/** Renders an injected `log` spy's captured calls as plain strings, in call order */
function collectLines(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map((call) => String(call[0]));
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
    const spy = subscribeSpyTo(persistent.source.pipe(authRetry(baseConfig({ errors }))), { expectErrors: true });

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
    const spy = subscribeSpyTo(persistent.source.pipe(authRetry(baseConfig({ onAuthRequired, errors }))), {
      expectErrors: true,
    });

    await spy.onError();

    expect(errors.handler).toHaveBeenCalledTimes(1);
    expect(errors.handler).toHaveBeenCalledWith("auth-required: persistent", rejection);
    expect(spy.getError()).toEqual({ kind: "handler", reason: "auth-required: persistent", cause: rejection });
  });

  // Pairs with the test above: a synchronous throw and a rejected promise must be the same outcome (CR-04)
  it("maps a synchronously-throwing handler to the handler error, carrying the thrown value as cause (CR-04)", async () => {
    const thrown = new Error("sync boom");
    const onAuthRequired = vi.fn(() => {
      throw thrown;
    });
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(persistent.source.pipe(authRetry(baseConfig({ onAuthRequired, errors }))), {
      expectErrors: true,
    });

    await spy.onError();

    expect(errors.handler).toHaveBeenCalledTimes(1);
    expect(errors.handler).toHaveBeenCalledWith("auth-required: persistent", thrown);
    expect(spy.getError()).toEqual({ kind: "handler", reason: "auth-required: persistent", cause: thrown });
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  // CR-01: a call-site bookkeeping value (mirroring req()'s synthetic OPEN) must never reset the D-08
  // consecutive counter — only a value config.isProgress accepts as real progress may reset it.
  it("does not let a non-progress bookkeeping value reset the consecutive counter (CR-01)", async () => {
    const errors = makeErrors();
    const onAuthRequired = vi.fn();
    // -1 stands in for req()'s synthetic OPEN: a real (non-signal) value that is NOT progress
    const isProgress = (value: number) => value !== -1;
    let subscribeCount = 0;
    // Explicit subscription cap (per plan instruction): against an operator whose D-08 reset is
    // unconditional, this fixture's bookkeeping value would reset the counter every cycle and the
    // source would be resubscribed forever. Cap it so the test fails an assertion instead of hanging.
    const SUBSCRIPTION_CAP = 5;

    const source = new Observable<number | AuthRequiredSignal>((subscriber) => {
      subscribeCount++;
      if (subscribeCount > SUBSCRIPTION_CAP) {
        subscriber.error(new Error("test fixture subscription cap exceeded — CR-01 bound did not hold"));
        return;
      }
      // Every subscription: a bookkeeping value first (mirrors req()'s OPEN), then an auth-required signal
      subscriber.next(-1);
      subscriber.next(authRequiredSignal(`auth-required: cycle ${subscribeCount}`));
    });

    const spy = subscribeSpyTo(
      source.pipe(authRetry(baseConfig({ authRetries: 1, isProgress, onAuthRequired, errors }))),
      { expectErrors: true },
    );

    await spy.onError();

    expect(subscribeCount).toBe(2); // authRetries + 1
    expect(onAuthRequired).toHaveBeenCalledTimes(1); // authRetries
    expect(errors.exhausted).toHaveBeenCalledTimes(1);
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

    const spy = subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ authTimeout: false, authSatisfied$ }))), {
      expectErrors: true,
    });

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
    subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ onAuthRequired, authSatisfied$: () => of(true) }))));

    ctrl.emit(authRequiredSignal("auth-required: already satisfied"));

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });
});

// 14-05: the operation track's per-phase line set (D-05/D-07/D-08/D-14/D-15), including ALOG-02
// attribution between two concurrent operations sharing one log stream. Every expectation below is
// derived from the D-14 line enumeration (14-CONTEXT.md) or from the independently-tested
// describeWireRequest formatter — never copied from the operator's own rendered output.
describe("authRetry — operation track logging (14-05)", () => {
  it("opted-out short circuit logs exactly one line, prefixed by the wire key, naming the opt-out, with no phase counter", async () => {
    const log = vi.fn();
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const expectedLabel = describeWireRequest(FAKE_CONTEXT.request);
    const spy = subscribeSpyTo(persistent.source.pipe(authRetry(baseConfig({ waitForAuth: false, log, errors }))), {
      expectErrors: true,
    });

    await spy.onError();

    const lines = collectLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith(expectedLabel)).toBe(true);
    expect(lines[0]).toContain("opted out");
    expect(lines[0]).not.toMatch(/phase \d+\/\d+/);
  });

  it("retries-exhausted logs one line naming the exhausted budget, with no phase counter of its own", async () => {
    const log = vi.fn();
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(persistent.source.pipe(authRetry(baseConfig({ authRetries: 1, log, errors }))), {
      expectErrors: true,
    });

    await spy.onError();

    const lines = collectLines(log);
    const exhaustedLine = lines.find((l) => l.includes("exhausted"));
    expect(exhaustedLine).toBeDefined();
    expect(exhaustedLine).toContain("1");
    expect(exhaustedLine).not.toMatch(/phase \d+\/\d+/);
  });

  it("a successful phase (handler present) emits begin, handler-invoked, resolved-and-waiting, and wait-satisfied lines in order", async () => {
    const log = vi.fn();
    const onAuthRequired = vi.fn();
    const ctrl = makeControllableSource<number>();
    subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ onAuthRequired, log, satisfiedPubkeys: () => ["pk1"] }))));

    ctrl.emit(authRequiredSignal("auth-required: go"));

    const lines = collectLines(log);
    const beginIdx = lines.findIndex((l) => l.includes("entering phase 1/1"));
    const invokedIdx = lines.findIndex((l) => l.includes("invoking the configured onAuthRequired handler"));
    const waitingIdx = lines.findIndex((l) => l.includes("now waiting for"));
    const satisfiedIdx = lines.findIndex((l) => l.includes("wait satisfied") && l.includes("pk1"));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(invokedIdx).toBeGreaterThan(beginIdx);
    expect(waitingIdx).toBeGreaterThan(invokedIdx);
    expect(satisfiedIdx).toBeGreaterThan(waitingIdx);
  });

  it("a handler-absent phase emits begin, handler-absent, and wait-satisfied lines", async () => {
    const log = vi.fn();
    const ctrl = makeControllableSource<number>();
    subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ log }))));

    ctrl.emit(authRequiredSignal("auth-required: go"));

    const lines = collectLines(log);
    expect(lines.some((l) => l.includes("entering phase 1/1"))).toBe(true);
    expect(lines.some((l) => l.includes("no onAuthRequired handler is configured"))).toBe(true);
    expect(lines.some((l) => l.includes("wait satisfied"))).toBe(true);
    // The handler-invoked branch must never fire when no handler is configured
    expect(lines.some((l) => l.includes("invoking the configured onAuthRequired handler"))).toBe(false);
  });

  it("a synchronous handler throw logs the throw distinctly, carrying the cause's message", async () => {
    const log = vi.fn();
    const thrown = new Error("sync boom");
    const onAuthRequired = vi.fn(() => {
      throw thrown;
    });
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(persistent.source.pipe(authRetry(baseConfig({ onAuthRequired, log, errors }))), {
      expectErrors: true,
    });

    await spy.onError();

    const lines = collectLines(log);
    expect(lines.some((l) => l.includes("threw synchronously") && l.includes("sync boom"))).toBe(true);
    expect(lines.some((l) => l.includes("promise rejected"))).toBe(false);
  });

  it("an asynchronous handler rejection logs the rejection distinctly, carrying the cause's message", async () => {
    const log = vi.fn();
    const rejection = new Error("handler blew up");
    const onAuthRequired = vi.fn().mockRejectedValue(rejection);
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(persistent.source.pipe(authRetry(baseConfig({ onAuthRequired, log, errors }))), {
      expectErrors: true,
    });

    await spy.onError();

    const lines = collectLines(log);
    expect(lines.some((l) => l.includes("promise rejected") && l.includes("handler blew up"))).toBe(true);
    expect(lines.some((l) => l.includes("threw synchronously"))).toBe(false);
  });

  it("a per-phase timeout logs the timeout naming the configured budget", async () => {
    const log = vi.fn();
    const errors = makeErrors();
    const persistent = makePersistentSignalSource();
    const spy = subscribeSpyTo(
      persistent.source.pipe(authRetry(baseConfig({ authTimeout: 50, authSatisfied$: () => NEVER, log, errors }))),
      { expectErrors: true },
    );

    await spy.onError();

    const lines = collectLines(log);
    expect(lines.some((l) => l.includes("timed out") && l.includes("50ms"))).toBe(true);
  });

  it("ALOG-02: two concurrent operations against different wire requests are individually attributable in one shared log stream", async () => {
    const log = vi.fn();

    const reqRequest: RelayAuthContext["request"] = {
      verb: "REQ",
      id: "req-alpha-attribution-id",
      filters: [{ kinds: [1] }],
    };
    const eventPayload: NostrEvent = {
      kind: 7,
      id: "event-beta-attribution-id-0000000000000000000000000000000000",
      pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      created_at: 1743712795,
      tags: [],
      content: "+",
      sig: "5a57b5a12bba4b7cf0121077b1421cf4df402c5c221376c076204fc4f7519e28ce6508f26ddc132c406ccfe6e62cc6db857b96c788565cdca9674fe9a0710ac2",
    };
    const eventRequest: RelayAuthContext["request"] = { verb: "EVENT", event: eventPayload };

    // Derived from the same already-tested formatter the operator itself calls — not a hardcoded
    // rendered-line literal copied from the implementation.
    const reqLabel = describeWireRequest(reqRequest);
    const eventLabel = describeWireRequest(eventRequest);
    expect(reqLabel).not.toBe(eventLabel);

    const reqSource = makePersistentSignalSource();
    const eventSource = makePersistentSignalSource();
    const errorsA = makeErrors();
    const errorsB = makeErrors();

    const spyA = subscribeSpyTo(
      reqSource.source.pipe(
        authRetry(
          baseConfig({
            buildContext: (reason) => ({ ...FAKE_CONTEXT, request: reqRequest, reason }),
            log,
            errors: errorsA,
          }),
        ),
      ),
      { expectErrors: true },
    );
    const spyB = subscribeSpyTo(
      eventSource.source.pipe(
        authRetry(
          baseConfig({
            buildContext: (reason) => ({ ...FAKE_CONTEXT, request: eventRequest, reason }),
            log,
            errors: errorsB,
          }),
        ),
      ),
      { expectErrors: true },
    );

    await Promise.all([spyA.onError(), spyB.onError()]);

    const lines = collectLines(log);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const belongsToReq = line.startsWith(reqLabel);
      const belongsToEvent = line.startsWith(eventLabel);
      // Exactly one — never both (ambiguous), never neither (unattributable)
      expect(belongsToReq !== belongsToEvent).toBe(true);
    }
    expect(lines.some((l) => l.startsWith(reqLabel))).toBe(true);
    expect(lines.some((l) => l.startsWith(eventLabel))).toBe(true);
  });

  it("D-08: the wait-satisfied line names every pubkey an array requirement's wait was satisfied by", async () => {
    const log = vi.fn();
    const ctrl = makeControllableSource<number>();
    subscribeSpyTo(
      ctrl.source.pipe(
        authRetry(
          baseConfig({ waitForAuth: ["pk-alpha", "pk-beta"], log, satisfiedPubkeys: () => ["pk-alpha", "pk-beta"] }),
        ),
      ),
    );

    ctrl.emit(authRequiredSignal("auth-required: go"));

    const lines = collectLines(log);
    const satisfiedLine = lines.find((l) => l.includes("wait satisfied"));
    expect(satisfiedLine).toBeDefined();
    expect(satisfiedLine).toContain("pk-alpha");
    expect(satisfiedLine).toContain("pk-beta");
  });

  it("D-08: a boolean requirement satisfied with no pubkeys reported says so explicitly rather than trailing off", async () => {
    const log = vi.fn();
    const ctrl = makeControllableSource<number>();
    // baseConfig's default satisfiedPubkeys already returns []
    subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ log }))));

    ctrl.emit(authRequiredSignal("auth-required: go"));

    const lines = collectLines(log);
    const satisfiedLine = lines.find((l) => l.includes("wait satisfied"));
    expect(satisfiedLine).toBeDefined();
    expect(satisfiedLine).toContain("no pubkeys reported");
  });

  it("D-07: the consecutive-counter reset emits no line, and the phase counter demonstrably restarts at 1", async () => {
    const log = vi.fn();
    const ctrl = makeControllableSource<number>();
    subscribeSpyTo(ctrl.source.pipe(authRetry(baseConfig({ authRetries: 1, log }))));

    // Cycle 1: one auth phase, resolved by a real value which also resets the counter
    ctrl.emit(authRequiredSignal("auth-required: cycle 1"));
    ctrl.emit(1);

    // Cycle 2: a fresh phase — if the reset above had not happened, authRetries: 1 would already be
    // exhausted and this signal would produce the "exhausted" line instead of a second "entering" line.
    ctrl.emit(authRequiredSignal("auth-required: cycle 2"));
    ctrl.emit(2);

    const lines = collectLines(log);
    const enteringLines = lines.filter((l) => l.includes("entering phase"));
    expect(enteringLines).toHaveLength(2);
    expect(enteringLines[0]).toContain("entering phase 1/1");
    expect(enteringLines[1]).toContain("entering phase 1/1");
    expect(lines.some((l) => /reset/i.test(l))).toBe(false);
  });
});

describe("suspendableTimeout", () => {
  it("does not fire while the gate is open, but fires on the remaining budget once it closes", async () => {
    const gate = new AuthPhaseGate();
    gate.begin();

    const spy = subscribeSpyTo(NEVER.pipe(suspendableTimeout(80, gate, { firstWhen: () => true })), {
      expectErrors: true,
    });

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
    const spy = subscribeSpyTo(
      NEVER.pipe(suspendableTimeout(50, gate, { firstWhen: () => true, with: () => of("fallback") })),
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(spy.getValues()).toEqual(["fallback"]);
  });

  it("returns identity for a non-positive or non-finite budget", async () => {
    const gate = new AuthPhaseGate();
    const spy = subscribeSpyTo(of(1).pipe(suspendableTimeout(0, gate, { firstWhen: () => true })));
    expect(spy.getValues()).toEqual([1]);

    const spyInfinite = subscribeSpyTo(of(2).pipe(suspendableTimeout(Infinity, gate, { firstWhen: () => true })));
    expect(spyInfinite.getValues()).toEqual([2]);
  });

  it("propagates a source error normally", async () => {
    const gate = new AuthPhaseGate();
    const err = new Error("boom");
    const spy = subscribeSpyTo(throwError(() => err).pipe(suspendableTimeout(100, gate, { firstWhen: () => true })), {
      expectErrors: true,
    });
    await spy.onError();
    expect(spy.getError()).toBe(err);
  });

  // WR-01: a value firstWhen rejects (mirroring req()'s synthetic OPEN) must not cancel the clock —
  // only a value it accepts as progress may.
  it("still fires after the budget when firstWhen rejects the first emission (WR-01)", async () => {
    const gate = new AuthPhaseGate();
    const source = new Subject<number>();
    const spy = subscribeSpyTo(source.pipe(suspendableTimeout(80, gate, { firstWhen: (value) => value !== 0 })), {
      expectErrors: true,
    });

    // Emits a bookkeeping value (mirrors req()'s OPEN) the predicate rejects, then stays silent
    source.next(0);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(spy.getError()).toBeInstanceOf(Error);
  });
});
