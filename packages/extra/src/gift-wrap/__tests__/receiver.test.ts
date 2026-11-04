import { GiftWrapFactory } from "applesauce-common/factories";
import { unlockGiftWrap } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { AsyncRumorStore, EventMemory, RumorStore } from "applesauce-core/event-store";
import {
  finalizeEvent,
  getEventHash,
  notifyEventUpdate,
  unixNow,
  type NostrEvent,
  type Rumor,
} from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, EMPTY, firstValueFrom, Observable, of, Subject } from "rxjs";
import type { SyncAuthHandler } from "applesauce-loaders/loaders";
import type { ISigner } from "applesauce-signers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GiftWrapReceiver } from "../receiver.js";
import type { GiftWrapReceiverOptions } from "../types.js";

const sender = new PrivateKeySigner(new Uint8Array(32).fill(21));
const recipient = new PrivateKeySigner(new Uint8Array(32).fill(22));
const pubkey = await recipient.getPublicKey();
const disposables: { dispose(): void }[] = [];
afterEach(() => {
  disposables.splice(0).forEach((value) => value.dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function envelope(kind = 1) {
  const template = {
    kind,
    pubkey: await sender.getPublicKey(),
    created_at: unixNow(),
    tags: [],
    content: crypto.randomUUID(),
  };
  const rumor = { ...template, id: getEventHash(template) };
  const gift = await GiftWrapFactory.create(sender, pubkey, rumor);
  return { rumor, event: JSON.parse(JSON.stringify(gift)) as NostrEvent };
}

function setup(overrides: Partial<GiftWrapReceiverOptions> = {}) {
  const arrivals = new Subject<NostrEvent>();
  const closed = vi.fn();
  const pool = {
    subscription: vi.fn(
      () =>
        new Observable<NostrEvent>((subscriber) => {
          const subscription = arrivals.subscribe(subscriber);
          return () => {
            closed();
            subscription.unsubscribe();
          };
        }),
    ),
  };
  const eventStore = new EventStore();
  const receiver = new GiftWrapReceiver({
    pubkey,
    eventStore,
    pool: pool as unknown as RelayPool,
    signer: recipient,
    relays: ["wss://inbox.test"],
    ...overrides,
  });
  disposables.push(receiver, eventStore);
  return { receiver, eventStore, pool, arrivals, closed };
}

describe("GiftWrapReceiver", () => {
  it("receives existing and externally inserted wraps without opening relays", async () => {
    const { receiver, eventStore, pool } = setup({ autoUnlock: true });
    const first = await envelope();
    const second = await envelope();
    eventStore.add(first.event);
    const results = vi.fn();
    const subscription = receiver.receive$.subscribe(results);
    eventStore.add(second.event);
    await vi.waitFor(() => expect(results).toHaveBeenCalledTimes(2));
    expect(results.mock.calls.map(([result]) => result.rumor.id).sort()).toEqual(
      [first.rumor.id, second.rumor.id].sort(),
    );
    expect(pool.subscription).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("collects third-party decryption after a cache miss without duplicate results", async () => {
    const cache = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const { receiver, eventStore } = setup({ decryptionCache: cache });
    const { event, rumor } = await envelope();
    const results = vi.fn();
    const subscription = receiver.receive$.subscribe(results);
    const stored = eventStore.add(event)!;
    await vi.waitFor(() => expect(cache.getItem).toHaveBeenCalled());
    await unlockGiftWrap(stored, recipient);
    await vi.waitFor(() => expect(results).toHaveBeenCalledTimes(1));
    expect(results.mock.calls[0][0]).toMatchObject({ status: "success", rumor });
    const lateResults = vi.fn();
    const late = receiver.receive$.subscribe(lateResults);
    notifyEventUpdate(stored);
    await receiver.unlock(stored);
    expect(results).toHaveBeenCalledTimes(1);
    expect(lateResults).not.toHaveBeenCalled();
    late.unsubscribe();
    subscription.unsubscribe();
  });

  it("restores both layers from cache without signer calls", async () => {
    const { event, rumor } = await envelope();
    const sealJson = await recipient.nip44.decrypt(event.pubkey, event.content);
    const seal = JSON.parse(sealJson) as NostrEvent;
    const values = new Map([
      [event.id, sealJson],
      [seal.id, JSON.stringify(rumor)],
    ]);
    const cache = { getItem: vi.fn(async (id: string) => values.get(id) ?? null), setItem: vi.fn() };
    const { receiver, eventStore } = setup({ decryptionCache: cache, autoUnlock: true });
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const result = firstValueFrom(receiver.receive$);
    eventStore.add(event);
    await expect(result).resolves.toMatchObject({ status: "success", rumor });
    expect(cache.getItem.mock.calls).toEqual([[event.id], [seal.id]]);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("releases store observation on unsubscribe and scans again when restarted", async () => {
    const { receiver, eventStore } = setup({ autoUnlock: true });
    const results = vi.fn();
    const first = receiver.receive$.subscribe(results);
    first.unsubscribe();
    const { event } = await envelope();
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    eventStore.add(event);
    await Promise.resolve();
    expect(decrypt).not.toHaveBeenCalled();
    expect(results).not.toHaveBeenCalled();
    const second = receiver.receive$.subscribe(results);
    await vi.waitFor(() => expect(results).toHaveBeenCalledTimes(1));
    receiver.stop();
    expect(second.closed).toBe(true);
  });

  it("shares outcomes with watch subscribers and emits manual retries", async () => {
    const { receiver } = setup();
    const { event } = await envelope();
    const received = vi.fn();
    const watched = vi.fn();
    const receiving = receiver.receive$.subscribe(received);
    const watching = receiver.watch$.subscribe(watched);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockRejectedValueOnce(new Error("denied"));
    await expect(receiver.unlock(event)).rejects.toThrow("denied");
    await receiver.retry(event.id);
    expect(received.mock.calls.map(([result]) => result.status)).toEqual(["failed", "success"]);
    expect(watched.mock.calls).toEqual(received.mock.calls);
    expect(decrypt).toHaveBeenCalledTimes(3);
    receiving.unsubscribe();
    expect(watching.closed).toBe(false);
    receiver.stop();
    expect(watching.closed).toBe(true);
  });

  it("collects external decryption after a signer rejection without retrying it", async () => {
    const { receiver, eventStore } = setup({ autoUnlock: true });
    const { event } = await envelope();
    const results = vi.fn();
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockRejectedValue(new Error("denied"));
    const subscription = receiver.receive$.subscribe(results);
    const stored = eventStore.add(event)!;
    await vi.waitFor(() => expect(results).toHaveBeenCalledTimes(1));
    expect(decrypt).toHaveBeenCalledTimes(1);
    decrypt.mockRestore();
    await unlockGiftWrap(stored, recipient);
    await vi.waitFor(() => expect(results).toHaveBeenCalledTimes(2));
    expect(results.mock.calls[1][0].status).toBe("success");
    subscription.unsubscribe();
  });

  it("shares cached seal processing across different wraps", async () => {
    const { event } = await envelope();
    const sealJson = await recipient.nip44.decrypt(event.pubkey, event.content);
    const seal = JSON.parse(sealJson) as NostrEvent;
    const ephemeral = new PrivateKeySigner(new Uint8Array(32).fill(25));
    const second = await ephemeral.signEvent({
      kind: 1059,
      created_at: unixNow(),
      tags: [["p", pubkey]],
      content: await ephemeral.nip44.encrypt(pubkey, sealJson),
    });
    const cache = {
      getItem: vi.fn(async (id: string) => (id === event.id || id === second.id ? sealJson : null)),
      setItem: vi.fn(),
    };
    const gate = deferred<void>();
    const original = recipient.nip44.decrypt.bind(recipient.nip44);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockImplementation(async (...args) => {
      await gate.promise;
      return original(...args);
    });
    const { receiver, eventStore } = setup({ decryptionCache: cache, autoUnlock: true, decryptionConcurrency: 2 });
    eventStore.add(event);
    eventStore.add(second);
    const results = vi.fn();
    const subscription = receiver.receive$.subscribe(results);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    gate.resolve();
    await vi.waitFor(() => expect(results).toHaveBeenCalledTimes(2));
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(cache.getItem.mock.calls.filter(([id]) => id === seal.id)).toHaveLength(1);
    subscription.unsubscribe();
  });

  it("keeps watching after decryption failures and emits each failure once", async () => {
    const { receiver, arrivals } = setup({ autoUnlock: true });
    const errors = vi.fn();
    const terminal = vi.fn();
    const errorSubscription = receiver.errors$.subscribe(errors);
    const watch = receiver.watch$.subscribe({ error: terminal });
    const invalid = finalizeEvent(
      { kind: 1059, created_at: unixNow(), tags: [["p", pubkey]], content: "broken" },
      new Uint8Array(32).fill(23),
    );
    arrivals.next(invalid);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(errors.mock.calls[0][0]).toMatchObject({ eventId: invalid.id, failure: { stage: "wrap" } });
    arrivals.next((await envelope(14)).event);
    await vi.waitFor(async () => expect(await firstValueFrom(receiver.rumors$)).toHaveLength(1));
    expect(terminal).not.toHaveBeenCalled();
    expect(watch.closed).toBe(false);
    watch.unsubscribe();
    errorSubscription.unsubscribe();
  });

  it("paces manual retries and never automatically retries a recognized rejection", async () => {
    const { receiver } = setup({
      retryPolicy: { maxAttempts: 3, delay: 10, classify: () => ({ code: "signer-rejected", retry: "automatic" }) },
    });
    for (let index = 0; index < 2; index++) await receiver.ingest((await envelope()).event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockRejectedValue(new Error("permission denied"));
    vi.useFakeTimers();
    for await (const result of receiver.readInbox())
      expect(result).toMatchObject({ status: "failed", failure: { code: "signer-rejected", retry: "manual" } });
    await vi.advanceTimersByTimeAsync(100);
    expect(decrypt).toHaveBeenCalledTimes(2);
    decrypt.mockRestore();
    const recoveredDecrypt = vi.spyOn(recipient.nip44, "decrypt");
    const retries = receiver.retryFailed();
    expect(recoveredDecrypt).not.toHaveBeenCalled();
    expect((await retries.next()).value).toMatchObject({ status: "success" });
    expect(recoveredDecrypt).toHaveBeenCalledTimes(2);
    await retries.return();
    expect((await firstValueFrom(receiver.decryptionState$)).errors.size).toBe(1);
  });

  it("bounds automatic retry attempts with backoff", async () => {
    const { receiver } = setup({
      retryPolicy: {
        maxAttempts: 3,
        delay: 10,
        maxDelay: 15,
        classify: () => ({ code: "decryption-failed", retry: "automatic" }),
      },
    });
    const { event } = await envelope();
    await receiver.ingest(event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockRejectedValue(new Error("offline"));
    vi.useFakeTimers();
    await receiver.readNext();
    await vi.advanceTimersByTimeAsync(9);
    expect(decrypt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(decrypt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15);
    expect(decrypt).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(decrypt).toHaveBeenCalledTimes(3);
    expect((await firstValueFrom(receiver.decryptionState$)).errors.get(event.id)).toMatchObject({
      attempts: 3,
      retry: "manual",
    });
  });

  it("cancels scheduled retries when stopped", async () => {
    const { receiver } = setup({
      retryPolicy: { maxAttempts: 3, delay: 10, classify: () => ({ code: "decryption-failed", retry: "automatic" }) },
    });
    await receiver.ingest((await envelope()).event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockRejectedValue(new Error("offline"));
    vi.useFakeTimers();
    await receiver.readNext();
    receiver.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("returns missing signer failures and preserves explicit cancellation", async () => {
    const { receiver } = setup({ signer: undefined });
    await receiver.ingest((await envelope()).event);
    await expect(receiver.readNext()).resolves.toMatchObject({
      status: "failed",
      failure: { code: "signer-unavailable", retry: "manual" },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(receiver.readInbox({ signal: controller.signal }).next()).rejects.toThrow();
  });

  it("automatically retries storage without invoking the signer again", async () => {
    const rumorStore = new RumorStore();
    disposables.push(rumorStore);
    const { receiver } = setup({ rumorStore, retryPolicy: { maxAttempts: 2, delay: 10 } });
    const { event } = await envelope();
    await receiver.ingest(event);
    const add = vi.spyOn(rumorStore, "add").mockImplementationOnce(() => {
      throw new Error("disk busy");
    });
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    vi.useFakeTimers();
    await expect(receiver.readNext()).resolves.toMatchObject({
      status: "failed",
      failure: { stage: "storage", retry: "automatic" },
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(add).toHaveBeenCalledTimes(2);
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect((await firstValueFrom(receiver.decryptionState$)).errors.size).toBe(0);
  });

  it("pulls one complete envelope at a time without prefetching", async () => {
    const { receiver } = setup();
    for (let index = 0; index < 3; index++) await receiver.ingest((await envelope()).event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const inbox = receiver.readInbox();
    expect(decrypt).not.toHaveBeenCalled();
    expect((await inbox.next()).done).toBe(false);
    expect(decrypt).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(decrypt).toHaveBeenCalledTimes(2);
    await inbox.return();
    expect(decrypt).toHaveBeenCalledTimes(2);
    const remaining = await Promise.all([receiver.readNext(), receiver.readNext()]);
    expect(new Set(remaining.map((result) => result?.event.id)).size).toBe(2);
    expect(await receiver.readNext()).toBeUndefined();
    expect((await receiver.readInbox().next()).done).toBe(true);
  });

  it.each(["explicit", "bulk", "automatic"])("bounds concurrent %s decryption", async (mode) => {
    const { receiver } = setup({ decryptionConcurrency: 2, autoUnlock: true });
    const events = await Promise.all(Array.from({ length: 4 }, () => envelope()));
    for (const { event } of events) await receiver.ingest(event);
    const gate = deferred<void>();
    const original = recipient.nip44.decrypt.bind(recipient.nip44);
    let active = 0;
    let maximum = 0;
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockImplementation(async (...args) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await gate.promise;
        return await original(...args);
      } finally {
        active--;
      }
    });
    const watch = mode === "automatic" ? receiver.watch$.subscribe() : undefined;
    const pending =
      mode === "explicit"
        ? Promise.all(events.map(({ event }) => receiver.unlock(event)))
        : mode === "bulk"
          ? receiver.unlock()
          : Promise.resolve();
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(2));
    gate.resolve();
    await pending;
    await vi.waitFor(async () => expect(await firstValueFrom(receiver.rumors$)).toHaveLength(4));
    expect(maximum).toBe(2);
    watch?.unsubscribe();
  });

  it("yields a failure without closing the iterator or decrypting another envelope", async () => {
    const { receiver } = setup();
    const invalid = finalizeEvent(
      { kind: 1059, created_at: unixNow(), tags: [["p", pubkey]], content: "broken" },
      new Uint8Array(32).fill(23),
    );
    await receiver.ingest(invalid);
    const inbox = receiver.readInbox();
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    await expect(inbox.next()).resolves.toMatchObject({
      done: false,
      value: { status: "failed", failure: { stage: "wrap", code: "decryption-failed" } },
    });
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect((await firstValueFrom(receiver.decryptionState$)).errors.has(invalid.id)).toBe(true);
    const valid = await envelope();
    await receiver.ingest(valid.event);
    await expect(inbox.next()).resolves.toMatchObject({
      done: false,
      value: { status: "success", rumor: valid.rumor },
    });
    expect((await inbox.next()).done).toBe(true);
  });
  it("accepts arbitrary rumor kinds and deduplicates concurrent readers", async () => {
    const { receiver } = setup();
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    for (const kind of [1, 14, 15, 444]) {
      const { event, rumor } = await envelope(kind);
      const [first, second] = await Promise.all([receiver.unlock(event), receiver.unlock(event)]);
      expect(first).toEqual(rumor);
      expect(second).toBe(first);
    }
    expect(decrypt).toHaveBeenCalledTimes(8);
    expect(await firstValueFrom(receiver.rumors$)).toHaveLength(4);
  });

  it("shares a cold live stream with explicit start ownership", async () => {
    const { receiver, pool, closed } = setup();
    expect(pool.subscription).not.toHaveBeenCalled();
    const first = receiver.watch$.subscribe();
    const second = receiver.watch$.subscribe();
    await receiver.start();
    expect(pool.subscription).toHaveBeenCalledTimes(1);
    first.unsubscribe();
    second.unsubscribe();
    expect(closed).not.toHaveBeenCalled();
    receiver.stop();
    expect(closed).toHaveBeenCalledTimes(1);
    const restarted = receiver.watch$.subscribe();
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    restarted.unsubscribe();
  });

  it("stores arrivals without prompting until auto-unlock is enabled", async () => {
    const { receiver, arrivals } = setup();
    const { event } = await envelope();
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const watch = receiver.watch$.subscribe();
    arrivals.next(event);
    await vi.waitFor(async () => expect((await firstValueFrom(receiver.decryptionState$)).pending).toBe(0));
    expect(decrypt).not.toHaveBeenCalled();
    receiver.setAutoUnlock(true);
    await vi.waitFor(async () => expect(await firstValueFrom(receiver.rumors$)).toHaveLength(1));
    expect(decrypt).toHaveBeenCalledTimes(2);
    watch.unsubscribe();
  });

  it("rejects foreign and invalid outer envelopes before invoking the signer", async () => {
    const { receiver } = setup();
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const { event } = await envelope();
    await expect(receiver.unlock({ ...event, sig: "0".repeat(128) })).rejects.toThrow("signature");
    await expect(receiver.unlock({ ...event, tags: [["p", "a".repeat(64)]] })).rejects.toThrow("account");
    expect(decrypt).not.toHaveBeenCalled();
  });

  it.each(["seal-json", "seal-kind", "seal-signature", "seal-ciphertext", "rumor-json", "rumor-id", "rumor-author"])(
    "isolates malformed %s without storing an unvalidated rumor",
    async (scenario) => {
      const { receiver } = setup();
      const { rumor } = await envelope();
      const inner = scenario === "rumor-author" ? { ...rumor, pubkey } : rumor;
      const rumorJSON =
        scenario === "rumor-json"
          ? "not json"
          : JSON.stringify({ ...inner, id: scenario === "rumor-id" ? "0".repeat(64) : getEventHash(inner) });
      const seal = await sender.signEvent({
        kind: scenario === "seal-kind" ? 1 : 13,
        created_at: unixNow(),
        tags: [],
        content: scenario === "seal-ciphertext" ? "broken" : await sender.nip44.encrypt(pubkey, rumorJSON),
      });
      const sealJSON =
        scenario === "seal-json"
          ? "not json"
          : JSON.stringify(scenario === "seal-signature" ? { ...seal, sig: "0".repeat(128) } : seal);
      const event = await sender.signEvent({
        kind: 1059,
        created_at: unixNow(),
        tags: [["p", pubkey]],
        content: await sender.nip44.encrypt(pubkey, sealJSON),
      });
      await receiver.ingest(event);
      const inbox = receiver.readInbox();
      const result = (await inbox.next()).value;
      expect(result).toMatchObject({
        status: "failed",
        failure: {
          stage: scenario.startsWith("rumor") ? "rumor" : "seal",
          code:
            scenario === "seal-ciphertext"
              ? "decryption-failed"
              : scenario.startsWith("rumor")
                ? "invalid-rumor"
                : "invalid-seal",
          retry: scenario === "seal-ciphertext" ? "manual" : "never",
        },
      });
      expect(await firstValueFrom(receiver.rumors$)).toHaveLength(0);
      const valid = await envelope();
      await receiver.ingest(valid.event);
      await expect(inbox.next()).resolves.toMatchObject({ value: { status: "success", rumor: valid.rumor } });
    },
  );

  it("shares layer caches across receiver restarts without prompting a read-only receiver", async () => {
    const values = new Map<string, string>();
    const cache = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const first = setup({ decryptionCache: cache });
    const { event } = await envelope();
    await first.receiver.unlock(event);
    first.receiver.dispose();
    expect(values.size).toBe(2);
    const second = setup({ signer: undefined, decryptionCache: cache });
    await second.receiver.ingest(JSON.parse(JSON.stringify(event)));
    const watch = second.receiver.watch$.subscribe();
    await vi.waitFor(async () => expect(await firstValueFrom(second.receiver.rumors$)).toHaveLength(1));
    watch.unsubscribe();
  });

  it.each([false, true])("authenticates independently of an active decrypt with autoAuth=%s", async (autoAuth) => {
    const authenticatedPubkeys$ = new BehaviorSubject<string[]>([]);
    const challenge$ = new BehaviorSubject<string | null>("challenge");
    const acknowledgement = deferred<void>();
    const relay = {
      url: "wss://auth.test/",
      authenticatedPubkeys$,
      challenge$,
      authenticate: vi.fn(async (signer: Pick<ISigner, "signEvent">) => {
        await signer.signEvent({
          kind: 22242,
          created_at: unixNow(),
          content: "",
          tags: [
            ["challenge", "challenge"],
            ["relay", "wss://auth.test/"],
          ],
        });
        await acknowledgement.promise;
        authenticatedPubkeys$.next([pubkey]);
        return { ok: true, message: "accepted" };
      }),
    };
    const pool = {
      relay: () => relay,
      subscription: (_relays: string[], _filter: unknown, options: { onAuthRequired: SyncAuthHandler }) =>
        new Observable<NostrEvent>(() => {
          void options.onAuthRequired({
            relay: relay as never,
            url: relay.url,
            challenge: "challenge",
            requirement: pubkey,
            missingPubkeys: [pubkey],
            reason: "auth-required",
          });
        }),
    };
    const { receiver } = setup({ pool: pool as unknown as RelayPool, relays: [relay.url], autoAuth });
    const first = await envelope();
    const gate = deferred<string>();
    const originalDecrypt = recipient.nip44.decrypt.bind(recipient.nip44);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt").mockImplementationOnce(() => gate.promise);
    const sign = vi.spyOn(recipient, "signEvent");
    const unlocking = receiver.unlock(first.event);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    const watch = receiver.watch$.subscribe();
    expect(await firstValueFrom(receiver.authRequests$)).toHaveLength(1);
    if (autoAuth) await vi.waitFor(() => expect(sign).toHaveBeenCalledTimes(1));
    else expect(sign).not.toHaveBeenCalled();
    const auth = receiver.authenticate(relay.url);
    const duplicate = receiver.authenticate(relay.url);
    expect(duplicate).toBe(auth);
    await vi.waitFor(() => expect(sign).toHaveBeenCalledTimes(1));
    expect(decrypt).toHaveBeenCalledTimes(1);
    gate.resolve(await originalDecrypt(first.event.pubkey, first.event.content));
    await vi.waitFor(() => expect(sign).toHaveBeenCalledTimes(1));
    // Acknowledgement is still blocked, but NIP-44 work can finish.
    await unlocking;
    expect(decrypt).toHaveBeenCalledTimes(2);
    acknowledgement.resolve();
    await auth;
    expect(await firstValueFrom(receiver.authRequests$)).toHaveLength(0);
    watch.unsubscribe();
  });

  it("continues bulk processing after malformed ciphertext and retains the failure", async () => {
    const { receiver } = setup();
    const invalid = finalizeEvent(
      { kind: 1059, created_at: unixNow(), tags: [["p", pubkey]], content: "broken" },
      new Uint8Array(32).fill(23),
    );
    await receiver.ingest(invalid);
    const { event } = await envelope();
    await receiver.ingest(event);
    await receiver.unlock();
    expect(await firstValueFrom(receiver.rumors$)).toHaveLength(1);
    const state = await firstValueFrom(receiver.decryptionState$);
    expect(state.errors.has(invalid.id)).toBe(true);
    expect(state.locked).toBe(1);
  });

  it("holds the signer slot after cancellation and skips the abandoned seal", async () => {
    const { receiver } = setup();
    const first = await envelope();
    const second = await envelope();
    const gate = deferred<string>();
    const decrypt = recipient.nip44.decrypt.bind(recipient.nip44);
    const calls = vi.spyOn(recipient.nip44, "decrypt").mockImplementationOnce(() => gate.promise);
    const cancellation = new AbortController();
    const abandoned = receiver.unlock(first.event, { signal: cancellation.signal }).catch((error) => error);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    cancellation.abort();
    await abandoned;
    const next = receiver.unlock(second.event);
    await Promise.resolve();
    expect(calls).toHaveBeenCalledTimes(1);
    gate.resolve(await decrypt(first.event.pubkey, first.event.content));
    await expect(next).resolves.toEqual(second.rumor);
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it("resumes background envelopes when a manual reader releases processing capacity", async () => {
    const { receiver } = setup({ autoUnlock: true, maxQueued: 1 });
    const first = await envelope();
    const second = await envelope();
    const gate = deferred<string>();
    const decrypt = recipient.nip44.decrypt.bind(recipient.nip44);
    const calls = vi.spyOn(recipient.nip44, "decrypt").mockImplementationOnce(() => gate.promise);

    const manual = receiver.unlock(first.event);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));

    await receiver.ingest(second.event);
    const outcomes: unknown[] = [];
    const subscription = receiver.receive$.subscribe((outcome) => outcomes.push(outcome));

    gate.resolve(await decrypt(first.event.pubkey, first.event.content));
    await manual;

    await vi.waitFor(() => {
      expect(outcomes).toContainEqual({ status: "success", event: second.event, rumor: second.rumor });
    });
    subscription.unsubscribe();
  });

  it("does not interpret a signer's human-readable error as a receiver error", async () => {
    const { receiver } = setup();
    const { event } = await envelope();
    const cause = new Error("A NIP-44 signer is required");
    vi.spyOn(recipient.nip44, "decrypt").mockRejectedValueOnce(cause);

    await receiver.ingest(event);

    await expect(receiver.readNext()).resolves.toMatchObject({
      status: "failed",
      failure: { code: "decryption-failed", cause },
    });
  });

  it("keeps an unresolved signer serialized after reader timeout", async () => {
    const { receiver } = setup({ decryptionTimeout: 50 });
    const first = await envelope();
    const second = await envelope();
    const gate = deferred<string>();
    const original = recipient.nip44.decrypt.bind(recipient.nip44);
    const calls = vi.spyOn(recipient.nip44, "decrypt").mockImplementationOnce(() => gate.promise);
    vi.useFakeTimers();
    const timedOut = expect(receiver.unlock(first.event)).rejects.toThrow("Timeout");
    await vi.advanceTimersByTimeAsync(50);
    await timedOut;
    expect(calls).toHaveBeenCalledTimes(1);
    const next = receiver.unlock(second.event);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveBeenCalledTimes(1);
    gate.resolve(await original(first.event.pubkey, first.event.content));
    await next;
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it("disabling automatic processing abandons the next layer and stored backlog", async () => {
    const { receiver } = setup({ autoUnlock: true });
    const first = await envelope();
    const second = await envelope();
    const gate = deferred<string>();
    const original = recipient.nip44.decrypt.bind(recipient.nip44);
    const calls = vi.spyOn(recipient.nip44, "decrypt").mockImplementationOnce(() => gate.promise);
    await receiver.ingest(first.event);
    await receiver.ingest(second.event);
    const watch = receiver.watch$.subscribe();
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    receiver.setAutoUnlock(false);
    const [encryptedBy, ciphertext] = calls.mock.calls[0];
    gate.resolve(await original(encryptedBy, ciphertext));
    await vi.waitFor(async () => expect((await firstValueFrom(receiver.decryptionState$)).pending).toBe(0));
    expect(calls).toHaveBeenCalledTimes(1);
    receiver.setAutoUnlock(true);
    await vi.waitFor(async () => {
      expect([...(await firstValueFrom(receiver.decryptionState$)).errors.values()]).toEqual([]);
      expect(await firstValueFrom(receiver.rumors$)).toHaveLength(2);
    });
    expect(calls).toHaveBeenCalledTimes(4);
    watch.unsubscribe();
  });

  it("keeps sync cold and finite with exact envelope timestamp bounds", async () => {
    const request = vi.fn(() => EMPTY);
    const pool = {
      req: vi.fn(() => of({ type: "EOSE", from: "wss://inbox.test/" })),
      relay: vi.fn(() => ({ getSupported: async () => [], getLimitations: async () => ({ max_limit: 500 }), request })),
    };
    const cacheRequest = vi.fn(async () => []);
    const { receiver } = setup({ pool: pool as unknown as RelayPool, cacheRequest });
    receiver.sync$({ since: 100, until: 200 });
    expect(cacheRequest).not.toHaveBeenCalled();
    const result = await receiver.loadHistory({ since: 100, until: 200 });
    expect(result.done).toBe(true);
    expect(cacheRequest).toHaveBeenCalledWith([{ kinds: [1059], "#p": [pubkey], since: 100, until: 200 }]);
    expect(await firstValueFrom(receiver.lifecycle$)).toBe("idle");
  });

  it("retries rumor storage without repeating either signer call", async () => {
    const rumorStore = new RumorStore();
    disposables.push(rumorStore);
    const { receiver } = setup({ rumorStore });
    const { event, rumor } = await envelope();
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const add = vi.spyOn(rumorStore, "add").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(receiver.unlock(event)).rejects.toThrow("disk full");
    expect((await firstValueFrom(receiver.decryptionState$)).errors.get(event.id)?.stage).toBe("storage");
    await expect(receiver.retry(event.id)).resolves.toMatchObject({ status: "success", rumor });
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(2);
    expect((await firstValueFrom(receiver.decryptionState$)).errors.size).toBe(0);
  });

  it("awaits a database-backed rumor store and leaves supplied stores alive", async () => {
    const memory = new EventMemory<Rumor>();
    const gate = deferred<void>();
    const database = {
      add: async (event: Rumor) => {
        await gate.promise;
        return memory.add(event);
      },
      remove: async (event: Rumor) => memory.remove(event),
      removeByFilters: async (...args: Parameters<typeof memory.removeByFilters>) => memory.removeByFilters(...args),
      hasEvent: async (id: string) => memory.hasEvent(id),
      getEvent: async (id: string) => memory.getEvent(id),
      hasReplaceable: async (...args: Parameters<typeof memory.hasReplaceable>) => memory.hasReplaceable(...args),
      getReplaceable: async (...args: Parameters<typeof memory.getReplaceable>) => memory.getReplaceable(...args),
      getReplaceableHistory: async (...args: Parameters<typeof memory.getReplaceableHistory>) =>
        memory.getReplaceableHistory(...args),
      getByFilters: async (...args: Parameters<typeof memory.getByFilters>) => memory.getByFilters(...args),
      getTimeline: async (...args: Parameters<typeof memory.getTimeline>) => memory.getTimeline(...args),
    };
    const rumorStore = new AsyncRumorStore({ database });
    disposables.push(rumorStore);
    const { receiver, eventStore } = setup({ rumorStore });
    const disposeRumors = vi.spyOn(rumorStore, "dispose");
    const disposeEvents = vi.spyOn(eventStore, "dispose");
    const { event, rumor } = await envelope();
    const finished = vi.fn();
    const pending = receiver.unlock(event).then(finished);
    await vi.waitFor(async () => expect((await firstValueFrom(receiver.decryptionState$)).unlocked).toBe(1));
    expect(finished).not.toHaveBeenCalled();
    gate.resolve();
    await pending;
    expect(await rumorStore.getEvent(rumor.id)).toEqual(rumor);
    receiver.dispose();
    expect(disposeRumors).not.toHaveBeenCalled();
    expect(disposeEvents).not.toHaveBeenCalled();
  });
});
