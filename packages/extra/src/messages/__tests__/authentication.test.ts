import type { SyncAuthContext } from "applesauce-loaders/loaders";
import { Relay, type RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, firstValueFrom, NEVER, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageAuthentication, withMessageAuth$ } from "../common/authentication.js";

const signer = new PrivateKeySigner(new Uint8Array(32).fill(1));
const pubkey = await signer.getPublicKey();
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  vi.useRealTimers();
});

function setup(accountSigner = signer) {
  const authenticatedPubkeys$ = new BehaviorSubject<string[]>([]);
  const challenge$ = new BehaviorSubject<string | null>("challenge");
  const relay = {
    url: "wss://auth.test/",
    authenticatedPubkeys$,
    challenge$,
    auth: vi.fn(),
    authenticate: vi.fn(async (..._args: Parameters<ReturnType<RelayPool["relay"]>["authenticate"]>) => {
      authenticatedPubkeys$.next([pubkey]);
      return { ok: true, message: "accepted" };
    }),
  };
  const pool = { relay: () => relay } as unknown as RelayPool;
  const tracker = new MessageAuthentication(pool, pubkey, accountSigner);
  cleanup.push(() => tracker.clear());
  const context: SyncAuthContext = {
    relay,
    url: relay.url,
    challenge: "challenge",
    requirement: pubkey,
    missingPubkeys: [pubkey],
    reason: "auth-required",
  };
  const callback = vi.fn();
  const options = tracker.configure({ onAuthRequired: callback });
  const open = () => {
    const subscription = withMessageAuth$(options, (auth) => {
      auth.onAuthRequired!(context);
      return NEVER;
    }).subscribe();
    cleanup.push(() => subscription.unsubscribe());
    return subscription;
  };
  return { tracker, relay, context, callback, open, options };
}

function batchSetup(accountSigner = signer, concurrent = false) {
  const entries = Array.from({ length: 3 }, (_, index) => {
    const entry = setup();
    entry.relay.url = `wss://auth-${index}.test/`;
    entry.context.url = entry.relay.url;
    return entry;
  });
  const pool = {
    relay: (url: string) => entries.find((entry) => entry.relay.url === url)!.relay,
  } as unknown as RelayPool;
  const tracker = new MessageAuthentication(pool, pubkey, accountSigner, concurrent);
  cleanup.push(() => tracker.clear());
  const track = (index: number) => tracker.track(entries[index].context, false);
  return { tracker, entries, track };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("message authentication batches", () => {
  it("starts every relay concurrently when configured and shares individual attempts", async () => {
    const { tracker, entries, track } = batchSetup(signer, true);
    const gate = deferred<void>();
    entries.forEach(({ relay }, index) => {
      track(index);
      relay.authenticate.mockImplementation(async () => {
        await gate.promise;
        return { ok: true, message: "accepted" };
      });
    });
    const batch = tracker.authenticateAll();
    const individual = tracker.authenticate(entries[0].relay.url);
    await vi.waitFor(() => entries.forEach(({ relay }) => expect(relay.authenticate).toHaveBeenCalledTimes(1)));
    gate.resolve();
    expect((await batch).every((result) => result.status === "authenticated")).toBe(true);
    await individual;
  });
  it("returns an empty snapshot without signing", async () => {
    const { tracker } = batchSetup();
    expect(await tracker.authenticateAll()).toEqual([]);
  });

  it("delegates missing challenge acquisition to the relay", async () => {
    const { tracker, entries, track } = batchSetup();
    entries[0].relay.challenge$.next(null);
    entries[0].context = { ...entries[0].context, challenge: null };
    track(0);
    expect(await tracker.authenticateAll()).toEqual([{ url: entries[0].relay.url, status: "authenticated" }]);
    expect(entries[0].relay.authenticate).toHaveBeenCalledWith(expect.anything(), { signal: expect.any(AbortSignal) });
  });

  it("preserves individual rejection when a queued requirement is released", async () => {
    const { tracker, entries, track } = batchSetup();
    const release = track(0);
    const attempt = tracker.authenticate(entries[0].relay.url);
    release();
    await expect(attempt).rejects.toThrow("no longer pending");
    expect(entries[0].relay.authenticate).not.toHaveBeenCalled();
  });

  it("serializes mixed outcomes, shares individual clicks, and excludes new arrivals", async () => {
    const { tracker, entries, track } = batchSetup();
    const first = deferred<{ ok: boolean; message: string }>();
    entries[0].relay.authenticate.mockReturnValueOnce(first.promise);
    entries[1].relay.authenticate.mockRejectedValueOnce(new Error("denied"));
    track(0);
    track(1);
    const batch = tracker.authenticateAll();
    const click = tracker.authenticate(entries[0].relay.url);
    track(2);
    await vi.waitFor(() => expect(entries[0].relay.authenticate).toHaveBeenCalledTimes(1));
    expect(entries[1].relay.authenticate).not.toHaveBeenCalled();
    first.resolve({ ok: true, message: "accepted" });
    await click;
    expect(await batch).toEqual([
      { url: entries[0].relay.url, status: "authenticated" },
      { url: entries[1].relay.url, status: "failed", error: new Error("denied") },
    ]);
    expect(entries[2].relay.authenticate).not.toHaveBeenCalled();
    expect(
      (await firstValueFrom(tracker.requests$)).find((request) => request.url === entries[1].relay.url),
    ).toMatchObject({ state: "failed", error: new Error("denied") });
    await tracker.authenticate(entries[1].relay.url);
  });

  it.each(["satisfied", "released"])("skips queued %s requests", async (reason) => {
    const { tracker, entries, track } = batchSetup();
    const first = deferred<{ ok: boolean; message: string }>();
    entries[0].relay.authenticate.mockReturnValueOnce(first.promise);
    track(0);
    const release = track(1);
    const batch = tracker.authenticateAll();
    await vi.waitFor(() => expect(entries[0].relay.authenticate).toHaveBeenCalled());
    if (reason === "satisfied") entries[1].relay.authenticatedPubkeys$.next([pubkey]);
    if (reason === "released") release();
    first.resolve({ ok: true, message: "accepted" });
    expect((await batch)[1]).toEqual({ url: entries[1].relay.url, status: "skipped" });
    expect(entries[1].relay.authenticate).not.toHaveBeenCalled();
  });

  it("preserves queued approval and deduplicates clicks across changed challenges", async () => {
    const { tracker, entries, track } = batchSetup();
    const first = deferred<{ ok: boolean; message: string }>();
    entries[0].relay.authenticate.mockReturnValueOnce(first.promise);
    track(0);
    track(1);
    const batch = tracker.authenticateAll();
    const click = tracker.authenticate(entries[1].relay.url);
    await vi.waitFor(() => expect(entries[0].relay.authenticate).toHaveBeenCalled());
    entries[1].relay.challenge$.next("replacement");
    entries[1].context = { ...entries[1].context, challenge: "replacement" };
    track(1);
    expect(tracker.authenticate(entries[1].relay.url)).toBe(click);
    expect((await firstValueFrom(tracker.requests$))[1]).toMatchObject({
      context: { challenge: "replacement" },
      state: "authenticating",
    });
    first.resolve({ ok: true, message: "accepted" });
    expect((await batch)[1].status).toBe("authenticated");
    await click;
    expect(entries[1].relay.authenticate).toHaveBeenCalledTimes(1);
  });

  it("continues the queue after wrong-signer failures", async () => {
    const wrong = new PrivateKeySigner(new Uint8Array(32).fill(2));
    const { tracker, entries, track } = batchSetup(wrong);
    track(0);
    track(1);
    expect((await tracker.authenticateAll()).map((result) => result.status)).toEqual(["failed", "failed"]);
    expect(entries[0].relay.authenticate).not.toHaveBeenCalled();
    expect(entries[1].relay.authenticate).not.toHaveBeenCalled();
  });

  it("shares an existing individual attempt with overlapping batches", async () => {
    const { tracker, entries, track } = batchSetup();
    track(0);
    track(1);
    const click = tracker.authenticate(entries[0].relay.url);
    const first = tracker.authenticateAll();
    const second = tracker.authenticateAll();
    await click;
    expect(await first).toEqual(await second);
    expect(entries[0].relay.authenticate).toHaveBeenCalledTimes(1);
    expect(entries[1].relay.authenticate).toHaveBeenCalledTimes(1);
  });

  it("skips expired queued requests without blocking later relays", async () => {
    vi.useFakeTimers();
    const { tracker, entries, track } = batchSetup();
    const first = deferred<{ ok: boolean; message: string }>();
    entries[0].relay.authenticate.mockReturnValueOnce(first.promise);
    track(0);
    tracker.track(entries[1].context, 10);
    track(2);
    const batch = tracker.authenticateAll();
    await vi.advanceTimersByTimeAsync(10);
    first.resolve({ ok: true, message: "accepted" });
    expect((await batch).map((result) => result.status)).toEqual(["authenticated", "skipped", "authenticated"]);
  });

  it("continues after relay timeout while keeping an unsettled signer serialized", async () => {
    const { tracker, entries, track } = batchSetup();
    const signed = deferred<Awaited<ReturnType<typeof signer.signEvent>>>();
    const signEvent = vi.spyOn(signer, "signEvent").mockReturnValueOnce(signed.promise);
    entries[0].relay.authenticate.mockImplementationOnce(async (authSigner) => {
      void authSigner.signEvent({ tags: [["challenge", "challenge"]] } as any).catch(() => {});
      throw new Error("Relay authentication timed out");
    });
    track(0);
    track(1);
    const batch = tracker.authenticateAll();
    await vi.waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    expect(entries[1].relay.authenticate).not.toHaveBeenCalled();
    signed.reject(new Error("dismissed"));
    expect((await batch).map((result) => result.status)).toEqual(["failed", "authenticated"]);
    signEvent.mockRestore();
  });

  it("rejects clear promptly but retains the signer lock across subsequent work", async () => {
    const { tracker, entries, track } = batchSetup();
    const signed = deferred<Awaited<ReturnType<typeof signer.signEvent>>>();
    const signEvent = vi.spyOn(signer, "signEvent").mockReturnValueOnce(signed.promise);
    entries[0].relay.authenticate.mockImplementationOnce(async (authSigner, options) => {
      const signing = authSigner.signEvent({ tags: [["challenge", "challenge"]] } as any);
      signing.catch(() => {});
      return new Promise((_, reject) =>
        options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason)),
      );
    });
    track(0);
    track(1);
    const batch = tracker.authenticateAll();
    const rejected = expect(batch).rejects.toThrow();
    await vi.waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    tracker.clear();
    await rejected;
    expect(entries[1].relay.authenticate).not.toHaveBeenCalled();
    track(2);
    const next = tracker.authenticate(entries[2].relay.url);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(entries[2].relay.authenticate).not.toHaveBeenCalled();
    signed.reject(new Error("cancelled prompt"));
    await next;
    signEvent.mockRestore();
  });

  it("does not let a stopped generation authenticate new requests for the same relay", async () => {
    const { tracker, entries, track } = batchSetup();
    const owner = deferred<string>();
    const getPublicKey = vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(owner.promise);
    track(0);
    const old = tracker.authenticate(entries[0].relay.url);
    const rejected = expect(old).rejects.toThrow();
    await vi.waitFor(() => expect(getPublicKey).toHaveBeenCalled());
    tracker.clear();
    await rejected;
    track(0);
    const next = tracker.authenticate(entries[0].relay.url);
    owner.resolve(pubkey);
    await next;
    expect(entries[0].relay.authenticate).toHaveBeenCalledTimes(1);
    getPublicKey.mockRestore();
  });
});

describe("message authentication with Relay.authenticate", () => {
  function realRelaySetup(signEvent = vi.fn(signer.signEvent.bind(signer))) {
    const relay = new Relay("wss://auth.test/");
    // Keep the real challenge acquisition and signing policy without opening a socket.
    const exchange = vi.spyOn(relay as any, "authExchange").mockImplementation(() => {
      relay.authenticatedPubkeys$.next([pubkey]);
      return of({ ok: true, message: "accepted" });
    });
    const authenticate = vi.spyOn(relay, "authenticate");
    const pool = { relay: () => relay } as unknown as RelayPool;
    const tracker = new MessageAuthentication(pool, pubkey, { getPublicKey: async () => pubkey, signEvent });
    const context: SyncAuthContext = {
      relay,
      url: relay.url,
      challenge: null,
      requirement: pubkey,
      missingPubkeys: [pubkey],
      reason: "auth-required",
    };
    tracker.track(context, false);
    cleanup.push(() => {
      tracker.clear();
      relay.close();
    });
    return { relay, tracker, context, exchange, authenticate, signEvent };
  }

  it("uses the current challenge when a queued relay reaches the signer", async () => {
    const { relay, context, signEvent } = realRelaySetup();
    const blocking = setup();
    blocking.relay.url = "wss://blocking.test/";
    blocking.context.url = blocking.relay.url;
    const response = deferred<{ ok: boolean; message: string }>();
    blocking.relay.authenticate.mockReturnValueOnce(response.promise);
    const pool = {
      relay: (url: string) => (url === relay.url ? relay : blocking.relay),
    } as unknown as RelayPool;
    const tracker = new MessageAuthentication(pool, pubkey, { getPublicKey: async () => pubkey, signEvent });
    cleanup.push(() => tracker.clear());
    tracker.track(blocking.context, false);
    tracker.track(context, false);
    relay.challenge$.next("original");
    const batch = tracker.authenticateAll();
    await vi.waitFor(() => expect(blocking.relay.authenticate).toHaveBeenCalledTimes(1));
    relay.challenge$.next("replacement");
    expect(signEvent).not.toHaveBeenCalled();
    response.resolve({ ok: true, message: "accepted" });
    expect((await batch).map((result) => result.status)).toEqual(["authenticated", "authenticated"]);
    expect(signEvent).toHaveBeenCalledTimes(1);
    expect(signEvent.mock.calls[0][0].tags).toContainEqual(["challenge", "replacement"]);
  });

  it("waits for a challenge instead of skipping relay approval", async () => {
    const { relay, tracker, authenticate, signEvent } = realRelaySetup();
    const attempt = tracker.authenticate(relay.url);
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    expect(signEvent).not.toHaveBeenCalled();
    relay.challenge$.next("arrived");
    await attempt;
    expect(signEvent.mock.calls[0][0].tags).toContainEqual(["challenge", "arrived"]);
  });

  it("delegates in-flight challenge freshness and the default retry to the relay", async () => {
    const signed = deferred<Awaited<ReturnType<typeof signer.signEvent>>>();
    const signEvent = vi.fn(signer.signEvent.bind(signer)).mockReturnValueOnce(signed.promise);
    const { relay, tracker, authenticate, exchange } = realRelaySetup(signEvent);
    relay.challenge$.next("original");
    const attempt = tracker.authenticate(relay.url);
    await vi.waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    relay.challenge$.next("replacement");
    expect(tracker.authenticate(relay.url)).toBe(attempt);
    expect((await firstValueFrom(tracker.requests$))[0]).toMatchObject({ state: "authenticating" });
    signed.resolve(await signer.signEvent(signEvent.mock.calls[0][0]));
    await attempt;
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) });
    expect(signEvent).toHaveBeenCalledTimes(2);
    expect(signEvent.mock.calls[1][0].tags).toContainEqual(["challenge", "replacement"]);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][0].tags).toContainEqual(["challenge", "replacement"]);
  });

  it("retains relay failures when challenge changes exhaust the default retry budget", async () => {
    const { relay, tracker, exchange, signEvent } = realRelaySetup();
    let changes = 0;
    signEvent.mockImplementation(async (event) => {
      relay.challenge$.next(`replacement-${++changes}`);
      return signer.signEvent(event);
    });
    relay.challenge$.next("original");
    await expect(tracker.authenticate(relay.url)).rejects.toThrow("challenge changed too many times");
    expect(signEvent).toHaveBeenCalledTimes(2);
    expect(exchange).not.toHaveBeenCalled();
    expect((await firstValueFrom(tracker.requests$))[0]).toMatchObject({ state: "failed" });
    relay.challenge$.next("next");
    expect((await firstValueFrom(tracker.requests$))[0]).toMatchObject({
      state: "failed",
      context: { challenge: "next" },
    });
  });
});

describe("message authentication", () => {
  it("deduplicates relay prompts and preserves other operations on teardown", async () => {
    const { tracker, relay, callback, open } = setup();
    const first = open();
    const second = open();
    expect(await firstValueFrom(tracker.requests$)).toHaveLength(1);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(relay.authenticate).not.toHaveBeenCalled();
    first.unsubscribe();
    expect(await firstValueFrom(tracker.requests$)).toHaveLength(1);
    second.unsubscribe();
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
    expect(relay.challenge$.observed).toBe(false);
  });

  it("shares concurrent attempts and clears accepted authentication", async () => {
    const { tracker, relay, open } = setup();
    open();
    const first = tracker.authenticate(relay.url);
    expect(tracker.authenticate(relay.url)).toBe(first);
    expect((await firstValueFrom(tracker.requests$))[0].state).toBe("authenticating");
    await first;
    expect(relay.authenticate).toHaveBeenCalledTimes(1);
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
  });

  it("keeps approval and the remaining operation alive when another operation tears down", async () => {
    const { tracker, relay, context, options } = setup();
    const settled = vi.fn();
    const response = deferred<{ ok: boolean; message: string }>();
    relay.authenticate.mockReturnValueOnce(response.promise);
    const first = withMessageAuth$(options, (auth) => {
      void Promise.resolve(auth.onAuthRequired!(context)).then(settled);
      return NEVER;
    }).subscribe();
    const second = withMessageAuth$(options, (auth) => {
      void Promise.resolve(auth.onAuthRequired!(context)).then(settled);
      return NEVER;
    }).subscribe();
    cleanup.push(
      () => first.unsubscribe(),
      () => second.unsubscribe(),
    );
    const attempt = tracker.authenticate(relay.url);
    await vi.waitFor(() => expect(relay.authenticate).toHaveBeenCalledTimes(1));
    relay.challenge$.next("replacement");
    expect(settled).not.toHaveBeenCalled();
    first.unsubscribe();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(relay.authenticate.mock.calls[0][1]!.signal!.aborted).toBe(false);
    expect(tracker.authenticate(relay.url)).toBe(attempt);
    relay.authenticatedPubkeys$.next([pubkey]);
    response.resolve({ ok: true, message: "accepted" });
    await attempt;
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it("retains rejected requests for explicit retry", async () => {
    const { tracker, relay, open } = setup();
    relay.authenticate.mockResolvedValueOnce({ ok: false, message: "denied" });
    open();
    await expect(tracker.authenticate(relay.url)).rejects.toThrow("denied");
    expect((await firstValueFrom(tracker.requests$))[0]).toMatchObject({ state: "failed", error: new Error("denied") });
    await tracker.authenticate(relay.url);
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
  });

  it("clears externally satisfied requests but preserves requirements across challenges", async () => {
    const { tracker, relay, open } = setup();
    open();
    relay.authenticatedPubkeys$.next(["another-account"]);
    expect(await firstValueFrom(tracker.requests$)).toHaveLength(1);
    relay.authenticatedPubkeys$.next([pubkey]);
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
    relay.authenticatedPubkeys$.next([]);
    open();
    relay.challenge$.next(null);
    expect(await firstValueFrom(tracker.requests$)).toMatchObject([{ context: { challenge: null }, state: "pending" }]);
    relay.challenge$.next("replacement");
    expect(await firstValueFrom(tracker.requests$)).toMatchObject([
      { context: { challenge: "replacement" }, state: "pending" },
    ]);
  });

  it("expires requests and cleans up relay observers", async () => {
    vi.useFakeTimers();
    const { tracker, relay, open } = setup();
    open();
    await vi.advanceTimersByTimeAsync(30000);
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
    expect(relay.authenticatedPubkeys$.observed).toBe(false);
  });

  it("rejects a mismatched signer before authenticating", async () => {
    const { tracker, relay, open } = setup(new PrivateKeySigner(new Uint8Array(32).fill(2)));
    open();
    await expect(tracker.authenticate(relay.url)).rejects.toThrow("does not match");
    expect(relay.authenticate).not.toHaveBeenCalled();
  });

  it("cancels queued authentication when the owner stops", async () => {
    const { tracker, relay, open } = setup();
    open();
    const attempt = tracker.authenticate(relay.url);
    tracker.clear();
    await expect(attempt).rejects.toThrow();
    expect(relay.authenticate).not.toHaveBeenCalled();
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
  });
});
