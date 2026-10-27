import type { SyncAuthContext } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, firstValueFrom, NEVER, Observable } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageAuthentication, withMessageAuth$ } from "../common/authentication.js";
import { subscribeThroughStore } from "../common/loading.js";

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
    authenticate: vi.fn(async () => {
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

describe("message authentication", () => {
  it("pauses the bounded history window while authentication is pending", async () => {
    vi.useFakeTimers();
    const { tracker, relay, context, options } = setup();
    const pool = {
      subscription: (
        _relays: string[],
        _filters: unknown,
        auth: { onAuthRequired: (context: SyncAuthContext) => Promise<void> },
      ) =>
        new Observable(() => {
          void auth.onAuthRequired(context);
        }),
    } as unknown as RelayPool;
    const events = vi.fn();
    const subscription = subscribeThroughStore(
      { ...options, pool, eventStore: new EventStore(), timeout: 10 },
      [relay.url],
      [],
    ).subscribe(events);
    cleanup.push(() => subscription.unsubscribe());
    await vi.advanceTimersByTimeAsync(100);
    expect(events).not.toHaveBeenCalled();
    await tracker.authenticate(relay.url);
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toHaveBeenCalledWith("EOSE");
  });

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

  it("retains rejected requests for explicit retry", async () => {
    const { tracker, relay, open } = setup();
    relay.authenticate.mockResolvedValueOnce({ ok: false, message: "denied" });
    open();
    await expect(tracker.authenticate(relay.url)).rejects.toThrow("denied");
    expect((await firstValueFrom(tracker.requests$))[0]).toMatchObject({ state: "failed", error: new Error("denied") });
    await tracker.authenticate(relay.url);
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
  });

  it("clears externally satisfied and stale challenges", async () => {
    const { tracker, relay, open } = setup();
    open();
    relay.authenticatedPubkeys$.next(["another-account"]);
    expect(await firstValueFrom(tracker.requests$)).toHaveLength(1);
    relay.authenticatedPubkeys$.next([pubkey]);
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
    relay.authenticatedPubkeys$.next([]);
    open();
    relay.challenge$.next(null);
    expect(await firstValueFrom(tracker.requests$)).toEqual([]);
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
