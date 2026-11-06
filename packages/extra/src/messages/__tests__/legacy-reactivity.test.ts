import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EventStore } from "applesauce-core";
import {
  finalizeEvent,
  getEncryptedContent,
  kinds,
  restoreEncryptedContent,
  setEncryptedContentCache,
  type EncryptedContentCache,
  type NostrEvent,
} from "applesauce-core/helpers";
import { LegacyMessageFactory } from "applesauce-common/factories";
import { PrivateKeySigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";
import { EMPTY, firstValueFrom, lastValueFrom, Subject, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient } from "../legacy/client.js";

const ownerKey = new Uint8Array(32).fill(1);
const peerKey = new Uint8Array(32).fill(2);
const ownerSigner = new PrivateKeySigner(ownerKey);
const peerSigner = new PrivateKeySigner(peerKey);
const owner = await ownerSigner.getPublicKey();
const peer = await peerSigner.getPublicKey();
const clients: LegacyMessagesClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(decryptionTimeout = 60000, decryptionCache?: EncryptedContentCache, autoUnlock?: boolean) {
  const eventStore = new EventStore();
  const pool = {
    subscription: vi.fn(() => new Subject<NostrEvent>()),
    relay: vi.fn(() => ({ getSupported: async () => [], getLimitations: async () => ({}), request: () => EMPTY })),
    publish: vi.fn(async () => [{ from: "wss://dm.test/", ok: true }]),
  };
  const client = new LegacyMessagesClient({
    pubkey: owner,
    signer: ownerSigner,
    eventStore,
    pool: pool as unknown as RelayPool,
    fallbackRelays: ["wss://dm.test/"],
    timeout: 1,
    decryptionTimeout,
    decryptionCache,
    autoUnlock,
  });
  clients.push(client);
  return { client, eventStore, pool };
}

async function encryptedMessage(content: string, recipient = owner) {
  const message = await LegacyMessageFactory.create(recipient, content).sign(peerSigner);
  return JSON.parse(JSON.stringify(message)) as NostrEvent;
}

describe("legacy reactive ownership", () => {
  it("shares live processing and releases it only when the last watcher leaves", () => {
    const { client, pool } = setup();
    const conversation = client.conversation(peer);
    const watching$ = conversation.watch$;
    expect(pool.subscription).not.toHaveBeenCalled();

    const first = watching$.subscribe();
    const second = conversation.watch$.subscribe();
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    first.unsubscribe();
    expect(pool.subscription.mock.results.every(({ value }) => value.observed)).toBe(true);
    second.unsubscribe();
    expect(pool.subscription.mock.results.every(({ value }) => !value.observed)).toBe(true);

    const repeated = watching$.subscribe();
    expect(pool.subscription).toHaveBeenCalledTimes(4);
    repeated.unsubscribe();
    expect(pool.subscription.mock.results.every(({ value }) => !value.observed)).toBe(true);
  });

  it("does not release explicit start ownership when a viewport unsubscribes", async () => {
    const { client, pool } = setup();
    const conversation = client.conversation(peer);
    const viewport = conversation.watch$.subscribe();
    await conversation.start();
    viewport.unsubscribe();
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    expect(pool.subscription.mock.results.every(({ value }) => value.observed)).toBe(true);
    expect(await firstValueFrom(conversation.lifecycle$)).toBe("running");

    conversation.stop();
    expect(pool.subscription.mock.results.every(({ value }) => !value.observed)).toBe(true);
    const resumed = conversation.watch$.subscribe();
    expect(pool.subscription).toHaveBeenCalledTimes(4);
    conversation.stop();
    expect(resumed.closed).toBe(true);
  });

  it("completes watchers on disposal and rejects later subscriptions", () => {
    const { client, pool } = setup();
    const conversation = client.conversation(peer);
    const watching$ = conversation.watch$;
    const watcher = subscribeSpyTo(watching$);
    conversation.dispose();
    expect(watcher.receivedComplete()).toBe(true);
    expect(pool.subscription.mock.results.every(({ value }) => !value.observed)).toBe(true);
    const late = subscribeSpyTo(watching$, { expectErrors: true });
    expect(late.getError()).toEqual(expect.objectContaining({ message: "Conversation disposed" }));
  });

  it("does not cancel a pending send or independent discovery when a viewport unsubscribes", async () => {
    const { client, pool, eventStore } = setup();
    for (const key of [ownerKey, peerKey])
      eventStore.add(
        finalizeEvent(
          {
            kind: kinds.DirectMessageRelaysList,
            created_at: 1,
            tags: [["relay", "wss://dm.test/"]],
            content: "",
          },
          key,
        ),
      );
    const conversation = client.conversation(peer);
    const prepared = await conversation.prepareSend({ content: "still sending" });
    let finish!: () => void;
    pool.publish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([{ from: "wss://dm.test/", ok: true }]);
        }),
    );
    const viewport = conversation.watch$.subscribe();
    const discovery = conversation.discover$().subscribe();
    const sending = prepared.publish();
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));

    viewport.unsubscribe();
    expect(discovery.closed).toBe(false);
    expect(await firstValueFrom(conversation.sending$)).toBe(true);
    finish();
    await expect(sending).resolves.toBe(prepared.message);
    discovery.unsubscribe();
  });

  it("restores plaintext and auto-unlocks while watched without requiring start", async () => {
    const cached = await encryptedMessage("cached viewport");
    const locked = await encryptedMessage("auto viewport");
    const { client, eventStore } = setup(60000, {
      getItem: async (id) => (id === cached.id ? "cached viewport" : null),
      setItem: async () => {},
    });
    eventStore.add(cached);
    const conversation = client.conversation(peer);
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt");
    const viewport = conversation.watch$.subscribe();
    await vi.waitFor(() => expect(getEncryptedContent(cached)).toBe("cached viewport"));
    expect(decrypt).not.toHaveBeenCalled();

    conversation.setAutoUnlock(true);
    eventStore.add(locked);
    await vi.waitFor(() => expect(getEncryptedContent(locked)).toBe("auto viewport"));
    expect(decrypt).toHaveBeenCalledTimes(1);
    viewport.unsubscribe();
    eventStore.add(await encryptedMessage("not watched"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false, true])(
    "exposes the initial auto-unlock option %s without subject methods",
    (autoUnlock) => {
      const { client } = setup(60000, undefined, autoUnlock);
      const conversation = client.conversation(peer);
      const clientState = subscribeSpyTo(client.autoUnlock$);
      const conversationState = subscribeSpyTo(conversation.autoUnlock$);

      expect(clientState.getValues()).toEqual([autoUnlock ?? false]);
      expect(conversationState.getValues()).toEqual([autoUnlock ?? false]);
      expect(client.autoUnlock$).not.toHaveProperty("next");
      expect(conversation.autoUnlock$).not.toHaveProperty("next");

      clientState.unsubscribe();
      conversationState.unsubscribe();
    },
  );

  it("propagates client auto-unlock changes to existing and new conversations", () => {
    const { client } = setup();
    const existing = client.conversation(peer);
    const clientState = subscribeSpyTo(client.autoUnlock$);
    const existingState = subscribeSpyTo(existing.autoUnlock$);

    client.setAutoUnlock(true);
    const created = client.conversation(owner);
    const createdState = subscribeSpyTo(created.autoUnlock$);
    expect(createdState.getValues()).toEqual([true]);

    client.setAutoUnlock(false);
    expect(clientState.getValues()).toEqual([false, true, false]);
    expect(existingState.getValues()).toEqual([false, true, false]);
    expect(createdState.getValues()).toEqual([true, false]);

    clientState.unsubscribe();
    existingState.unsubscribe();
    createdState.unsubscribe();
  });

  it("keeps conversation overrides independent until the next client setter", () => {
    const { client } = setup();
    const conversation = client.conversation(peer);
    const sibling = client.conversation(owner);
    const clientState = subscribeSpyTo(client.autoUnlock$);
    const conversationState = subscribeSpyTo(conversation.autoUnlock$);
    const siblingState = subscribeSpyTo(sibling.autoUnlock$);

    conversation.setAutoUnlock(true);
    expect(clientState.getValues()).toEqual([false]);
    expect(siblingState.getValues()).toEqual([false]);
    expect(conversationState.getValues()).toEqual([false, true]);

    // Reapplying the client's unchanged value still replaces the local override.
    client.setAutoUnlock(false);
    expect(conversationState.getValues()).toEqual([false, true, false]);

    clientState.unsubscribe();
    conversationState.unsubscribe();
    siblingState.unsubscribe();
  });

  it("rejects explicit decryption with the original failure and retains it in decryption state", async () => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("failure");
    eventStore.add(event);
    const failure = new Error("signer rejected");
    vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(failure);

    await expect(client.unlock(event)).rejects.toBe(failure);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({
      pending: 0,
      locked: 1,
      errors: new Map([[event.id, failure]]),
    });
    expect(client).not.toHaveProperty("errors$");

    await client.retryDecryption(event);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ locked: 0, errors: new Map() });
  });

  it("excludes nonstore failures and removes failures when loaded events leave the scope", async () => {
    const { client, eventStore } = setup();
    const loaded = await encryptedMessage("loaded failure");
    const nonstore = await encryptedMessage("nonstore failure");
    eventStore.add(loaded);
    const conversation = client.conversation(peer);
    const accountState = subscribeSpyTo(client.decryptionState$);
    const conversationState = subscribeSpyTo(conversation.decryptionState$);
    const failure = new Error("rejected");
    vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValue(failure);

    await expect(client.unlock(nonstore)).rejects.toBe(failure);
    expect(accountState.getLastValue()).toEqual({
      total: 1,
      unlocked: 0,
      locked: 1,
      pending: 0,
      errors: new Map(),
    });
    await expect(conversation.unlock(loaded)).rejects.toBe(failure);
    expect(accountState.getLastValue()?.errors.get(loaded.id)).toBe(failure);
    expect(conversationState.getLastValue()?.errors.get(loaded.id)).toBe(failure);

    eventStore.remove(loaded);
    await vi.waitFor(() => expect(accountState.getLastValue()?.total).toBe(0));
    await vi.waitFor(() => expect(conversationState.getLastValue()?.total).toBe(0));
    for (const state of [accountState, conversationState]) {
      expect(state.getLastValue()).toEqual({ total: 0, unlocked: 0, locked: 0, pending: 0, errors: new Map() });
      state.unsubscribe();
    }
  });

  it.each(["cache", "helper"])("clears public failures after independent %s plaintext restoration", async (route) => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("restored");
    eventStore.add(event);
    const state = subscribeSpyTo(client.conversation(peer).decryptionState$);
    vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(new Error("rejected"));
    await expect(client.unlock(event)).rejects.toThrow("rejected");
    expect(state.getLastValue()?.errors.has(event.id)).toBe(true);

    if (route === "cache") {
      await restoreEncryptedContent(event, { getItem: async () => "restored", setItem: async () => {} });
    } else setEncryptedContentCache(event, "");

    expect(state.getLastValue()).toEqual({ total: 1, unlocked: 1, locked: 0, pending: 0, errors: new Map() });
    state.unsubscribe();
  });

  it("clears a timeout failure when the signer succeeds without another reader", async () => {
    vi.useFakeTimers();
    const { client, eventStore } = setup(100);
    const event = await encryptedMessage("late success");
    eventStore.add(event);
    const state = subscribeSpyTo(client.decryptionState$);
    let finish!: (plaintext: string) => void;
    vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const unlocking = expect(client.unlock(event)).rejects.toThrow("Timeout");
    await vi.advanceTimersByTimeAsync(100);
    await unlocking;
    expect(state.getLastValue()?.errors.has(event.id)).toBe(true);

    finish("late success");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.getLastValue()).toEqual({ total: 1, unlocked: 1, locked: 0, pending: 0, errors: new Map() });
    state.unsubscribe();
  });

  it("keeps undefined rejection values present in the errors map", async () => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("undefined failure");
    eventStore.add(event);
    vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(undefined);
    await expect(client.conversation(peer).unlock(event)).rejects.toBeUndefined();

    const state = await firstValueFrom(client.decryptionState$);
    expect(state).toMatchObject({ total: 1, unlocked: 0, locked: 1, pending: 0 });
    expect(state.errors.has(event.id)).toBe(true);
    expect(state.errors.get(event.id)).toBeUndefined();
    expect(state).not.toHaveProperty("failed");
  });

  it.each(["explicit", "bulk", "auto"])("does not duplicate %s decryption failures", async (source) => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("one error channel");
    eventStore.add(event);
    const conversation = client.conversation(peer);
    const errors = subscribeSpyTo(conversation.errors$);
    const failure = new Error("rejected");
    vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(failure);

    if (source === "explicit") await expect(conversation.unlock(event)).rejects.toBe(failure);
    else if (source === "bulk") await conversation.unlock();
    else {
      conversation.setAutoUnlock(true);
      const watcher = conversation.watch$.subscribe();
      await vi.waitFor(async () =>
        expect((await firstValueFrom(conversation.decryptionState$)).errors.has(event.id)).toBe(true),
      );
      watcher.unsubscribe();
    }

    expect((await firstValueFrom(conversation.decryptionState$)).errors.get(event.id)).toBe(failure);
    expect(errors.getValues()).toEqual([]);
    errors.unsubscribe();
  });

  it.each(["bulk", "auto"])("retains %s failures for remounts until a shared retry succeeds", async (source) => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("shared retry");
    eventStore.add(event);
    const conversation = client.conversation(peer);
    const failure = { reason: "signer unavailable" };
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(failure);
    const initialState = subscribeSpyTo(conversation.decryptionState$);

    if (source === "bulk") await client.unlock();
    else {
      conversation.setAutoUnlock(true);
      const watcher = conversation.watch$.subscribe();
      await vi.waitFor(() => expect(initialState.getLastValue()?.errors.get(event.id)).toBe(failure));
      watcher.unsubscribe();
    }

    expect(initialState.getLastValue()?.errors.get(event.id)).toBe(failure);
    initialState.unsubscribe();
    const remountedState = subscribeSpyTo(conversation.decryptionState$);
    expect(remountedState.getLastValue()?.errors.get(event.id)).toBe(failure);

    let finish!: (plaintext: string) => void;
    decrypt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const retrying = client.unlock(event);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(2));
    expect(remountedState.getLastValue()).toMatchObject({ pending: 1, errors: new Map([[event.id, failure]]) });

    finish("shared retry");
    await retrying;
    expect(remountedState.getLastValue()).toMatchObject({ pending: 0, unlocked: 1, errors: new Map() });
    remountedState.unsubscribe();
  });

  it.each(["abort", "dispose"])("does not record conversation unlock %s as a decryption failure", async (ending) => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("cancelled bubble");
    eventStore.add(event);
    const conversation = client.conversation(peer);
    const controller = new AbortController();
    let finish!: (plaintext: string) => void;
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const unlocking = expect(conversation.unlock(event, { signal: controller.signal })).rejects.toThrow();
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));

    if (ending === "abort") controller.abort();
    else conversation.dispose();
    await unlocking;
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, errors: new Map() });
    finish("cancelled bubble");
  });

  it("serializes signer calls across client unlocks, conversations, and readers", async () => {
    const { client, eventStore } = setup();
    const first = await encryptedMessage("first");
    const second = await encryptedMessage("second");
    const third = await encryptedMessage("third");
    eventStore.add(third);
    const finish: ((plaintext: string) => void)[] = [];
    const decrypt = vi
      .spyOn(ownerSigner.nip04, "decrypt")
      .mockImplementation(() => new Promise((resolve) => finish.push(resolve)));

    const firstUnlock = client.unlock(first);
    const secondUnlock = client.conversation(peer).unlock(second);
    const reading = lastValueFrom(client.readMessages$({ history: true }));
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ total: 1, locked: 1, pending: 1 });

    finish[0]("first");
    await firstUnlock;
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(2));
    expect(decrypt.mock.calls[1][1]).toBe(second.content);

    finish[1]("second");
    await secondUnlock;
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(3));
    expect(decrypt.mock.calls[2][1]).toBe(third.content);
    finish[2]("third");
    await expect(reading).resolves.toBe(third);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0 });
  });

  it("skips cancelled queued events and continues to the next reader", async () => {
    const { client } = setup();
    const first = await encryptedMessage("first");
    const cancelled = await encryptedMessage("cancelled");
    const next = await encryptedMessage("next");
    const finish: ((plaintext: string) => void)[] = [];
    const decrypt = vi
      .spyOn(ownerSigner.nip04, "decrypt")
      .mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const controller = new AbortController();
    const firstUnlock = client.unlock(first);
    const cancelledUnlock = expect(client.unlock(cancelled, { signal: controller.signal })).rejects.toThrow();
    const nextUnlock = client.unlock(next);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));

    controller.abort();
    await cancelledUnlock;
    finish[0]("first");
    await firstUnlock;
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(2));
    expect(decrypt.mock.calls[1][1]).toBe(next.content);
    finish[1]("next");
    await nextUnlock;
    expect(getEncryptedContent(cancelled)).toBeUndefined();
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, errors: new Map() });
  });

  it("holds the signer slot across timeouts and stop until the actual call settles", async () => {
    vi.useFakeTimers();
    const { client } = setup(100);
    const first = await encryptedMessage("first");
    const expired = await encryptedMessage("expired");
    const next = await encryptedMessage("next");
    const finish: ((plaintext: string) => void)[] = [];
    const decrypt = vi
      .spyOn(ownerSigner.nip04, "decrypt")
      .mockImplementation(() => new Promise((resolve) => finish.push(resolve)));

    const firstUnlock = expect(client.unlock(first)).rejects.toThrow("Timeout");
    const expiredUnlock = expect(client.unlock(expired)).rejects.toThrow("Timeout");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([firstUnlock, expiredUnlock]);
    expect(decrypt).toHaveBeenCalledTimes(1);

    client.stop();
    const nextUnlock = client.unlock(next);
    await vi.advanceTimersByTimeAsync(0);
    expect(decrypt).toHaveBeenCalledTimes(1);
    finish[0]("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(decrypt.mock.calls[1][1]).toBe(next.content);
    finish[1]("next");
    await nextUnlock;
    expect(getEncryptedContent(expired)).toBeUndefined();
  });

  it("continues queued decryption after a signer rejection", async () => {
    const { client } = setup();
    const first = await encryptedMessage("rejected");
    const next = await encryptedMessage("next");
    let reject!: (error: Error) => void;
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );

    const failedUnlock = expect(client.unlock(first)).rejects.toThrow("rejected");
    const nextUnlock = client.unlock(next);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    reject(new Error("rejected"));
    await failedUnlock;
    await nextUnlock;
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(getEncryptedContent(next)).toBe("next");
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ total: 0, pending: 0, errors: new Map() });
  });

  it("finishes bulk unlock after synchronous and asynchronous failures and decrypts remaining events", async () => {
    const { client, eventStore } = setup();
    const first = await encryptedMessage("first failure");
    const second = await encryptedMessage("second failure");
    const good = await encryptedMessage("good");
    eventStore.add(first);
    eventStore.add(second);
    eventStore.add(good);
    const originalDecrypt = ownerSigner.nip04.decrypt.bind(ownerSigner.nip04);
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt");
    decrypt.mockImplementation((pubkey, ciphertext) => {
      if (ciphertext === first.content) throw new Error("Synchronous rejection");
      if (ciphertext === second.content) return Promise.reject(new Error("Asynchronous rejection"));
      return originalDecrypt(pubkey, ciphertext);
    });
    const errors: string[] = [];
    client.decryptionState$.subscribe((state) => {
      errors.splice(0, errors.length, ...state.errors.keys());
    });

    await client.unlock();

    expect(getEncryptedContent(good)).toBe("good");
    expect(new Set(errors)).toEqual(new Set([first.id, second.id]));
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({
      total: 3,
      pending: 0,
      locked: 2,
      unlocked: 1,
    });
    expect(decrypt).toHaveBeenCalledTimes(3);

    await client.unlock();
    expect(decrypt).toHaveBeenCalledTimes(3);
  });

  it("skips malformed ciphertext before invoking an extension and continues bulk decryption", async () => {
    const { client, eventStore } = setup();
    const malformed = finalizeEvent(
      { kind: kinds.EncryptedDirectMessage, created_at: 1, tags: [["p", owner]], content: "missing IV" },
      peerKey,
    );
    const good = await encryptedMessage("good");
    eventStore.add(malformed);
    eventStore.add(good);
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt");
    const errors: { operation: string; eventId: string; error: unknown }[] = [];
    client.decryptionState$.subscribe((state) => {
      for (const [eventId, error] of state.errors) {
        if (!errors.some((failure) => failure.eventId === eventId))
          errors.push({ operation: "decrypt", eventId, error });
      }
    });

    await client.unlock();

    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt.mock.calls[0][1]).toBe(good.content);
    expect(getEncryptedContent(good)).toBe("good");
    const state = await firstValueFrom(client.decryptionState$);
    expect(state).toMatchObject({ pending: 0, locked: 1 });
    expect([...state.errors.keys()]).toEqual([malformed.id]);
    expect(errors).toContainEqual({
      operation: "decrypt",
      eventId: malformed.id,
      error: expect.objectContaining({ message: "Invalid NIP-04 encrypted message content" }),
    });
  });

  it("restores cached plaintext without waiting behind a signer prompt", async () => {
    const first = await encryptedMessage("first");
    const cached = await encryptedMessage("cached");
    const { client } = setup(60000, {
      getItem: async (id) => (id === cached.id ? "cached" : null),
      setItem: async () => {},
    });
    let finish!: (plaintext: string) => void;
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const firstUnlock = client.unlock(first);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));

    await client.unlock(cached);
    expect(getEncryptedContent(cached)).toBe("cached");
    expect(decrypt).toHaveBeenCalledTimes(1);
    finish("first");
    await firstUnlock;
  });

  it("shares one pending event across reads and conversation unlocks", async () => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("shared");
    eventStore.add(event);
    const conversation = client.conversation(peer);
    let finish!: (plaintext: string) => void;
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const reading = firstValueFrom(client.readMessages$());
    const unlocking = conversation.unlock(event);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 1 });
    expect(await firstValueFrom(conversation.decryptionState$)).toMatchObject({ pending: 1 });

    finish("shared");
    await Promise.all([reading, unlocking]);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, unlocked: 1 });
    expect(await firstValueFrom(conversation.decryptionState$)).toMatchObject({ pending: 0, unlocked: 1 });
  });

  it("counts pending loaded locked events rather than readers or queued nonstore work", async () => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("shared pending");
    const nonstore = await encryptedMessage("queued nonstore");
    eventStore.add(event);
    const state = subscribeSpyTo(client.decryptionState$);
    let finish!: (plaintext: string) => void;
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = client.unlock(event);
    const second = client.conversation(peer).unlock(event);
    const queued = client.unlock(nonstore);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    expect(state.getLastValue()).toMatchObject({ total: 1, locked: 1, pending: 1 });

    eventStore.remove(event);
    await vi.waitFor(() => expect(state.getLastValue()).toMatchObject({ total: 0, locked: 0, pending: 0 }));
    eventStore.add(event);
    await vi.waitFor(() => expect(state.getLastValue()).toMatchObject({ total: 1, locked: 1, pending: 1 }));
    setEncryptedContentCache(event, "external success");
    expect(state.getLastValue()).toEqual({ total: 1, unlocked: 1, locked: 0, pending: 0, errors: new Map() });

    finish("shared pending");
    await Promise.all([first, second, queued]);
    for (const snapshot of state.getValues()) {
      expect(snapshot.total).toBe(snapshot.unlocked + snapshot.locked);
      expect(snapshot.pending).toBeLessThanOrEqual(snapshot.locked);
      expect(snapshot.errors.size).toBeLessThanOrEqual(snapshot.locked);
    }
    state.unsubscribe();
  });

  it("reports read failures in shared state and clears them after an explicit retry", async () => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("retry");
    eventStore.add(event);
    const conversation = client.conversation(peer);
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(new Error("signer unavailable"));
    const errors: { operation: string; eventId: string; error: unknown }[] = [];
    const subscription = client.decryptionState$.subscribe((state) => {
      for (const [eventId, error] of state.errors) {
        if (!errors.some((failure) => failure.eventId === eventId))
          errors.push({ operation: "decrypt", eventId, error });
      }
    });

    expect(await lastValueFrom(client.readMessages$({ history: true }).pipe(toArray()))).toEqual([]);
    expect([...(await firstValueFrom(client.decryptionState$)).errors.keys()]).toEqual([event.id]);
    expect([...(await firstValueFrom(conversation.decryptionState$)).errors.keys()]).toEqual([event.id]);
    await conversation.unlock();
    expect(decrypt).toHaveBeenCalledTimes(1);

    await client.retryDecryption(event);
    expect(await firstValueFrom(conversation.decryptionState$)).toMatchObject({ unlocked: 1, errors: new Map() });
    expect(errors).toHaveLength(1);
    subscription.unsubscribe();
  });

  it("keeps signer work shared after a reader times out", async () => {
    vi.useFakeTimers();
    const { client, eventStore } = setup(100);
    const event = await encryptedMessage("late");
    eventStore.add(event);
    let finish!: (plaintext: string) => void;
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const unlocking = expect(client.unlock(event)).rejects.toThrow("Timeout");
    await vi.advanceTimersByTimeAsync(100);
    await unlocking;
    expect([...(await firstValueFrom(client.decryptionState$)).errors.keys()]).toEqual([event.id]);

    const retrying = client.retryDecryption(event);
    finish("late");
    await retrying;
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, errors: new Map(), unlocked: 1 });
  });

  it("drops queued decryption on unsubscribe and starts fresh on another subscription", async () => {
    const { client, eventStore } = setup();
    const first = await encryptedMessage("first");
    const second = await encryptedMessage("second");
    let finish!: (plaintext: string) => void;
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const messages$ = client.readMessages$();
    expect(decrypt).not.toHaveBeenCalled();
    const subscription = messages$.subscribe();
    eventStore.add(first);
    eventStore.add(second);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));

    subscription.unsubscribe();
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0 });
    finish("first");
    await vi.waitFor(() => expect(getEncryptedContent(first)).toBe("first"));
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(getEncryptedContent(second)).toBeUndefined();

    const messages = await lastValueFrom(client.readMessages$({ history: true }).pipe(toArray()));
    expect(messages).toHaveLength(2);
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("does not decrypt events belonging to another account", async () => {
    const { client } = setup();
    const unrelated = await encryptedMessage("private", peer);
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt");
    await client.unlock(unrelated);
    expect(decrypt).not.toHaveBeenCalled();
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, errors: new Map() });
  });

  it.each(["stop", "unsubscribe"])("does not prompt after %s during plaintext cache restoration", async (ending) => {
    let finishCache!: (content: string | null) => void;
    const getItem = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finishCache = resolve;
        }),
    );
    const { client, eventStore } = setup(60000, { getItem, setItem: async () => {} });
    eventStore.add(await encryptedMessage("cancelled"));
    const conversation = client.conversation(peer);
    conversation.setAutoUnlock(true);
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt");

    const watcher = conversation.watch$.subscribe();
    expect(getItem).toHaveBeenCalledTimes(1);
    if (ending === "stop") conversation.stop();
    else watcher.unsubscribe();
    finishCache(null);
    // Flush the cache and decryption promise continuations before checking for a late prompt.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(decrypt).not.toHaveBeenCalled();
    expect(await firstValueFrom(conversation.decryptionState$)).toMatchObject({ pending: 0, errors: new Map() });
  });

  it("derives publications for late subscribers and releases disposed conversations", async () => {
    const { client, eventStore } = setup();
    for (const key of [ownerKey, peerKey])
      eventStore.add(
        finalizeEvent(
          {
            kind: kinds.DirectMessageRelaysList,
            created_at: 1,
            tags: [["relay", "wss://dm.test/"]],
            content: "",
          },
          key,
        ),
      );
    const conversation = client.conversation(peer);
    expect(await firstValueFrom(conversation.sending$)).toBe(false);
    expect(conversation).not.toHaveProperty("publications$");
    const prepared = await conversation.prepareSend({ content: "prepared" });
    expect(await firstValueFrom(prepared.state$)).toEqual({ status: "prepared" });
    conversation.dispose();
    expect(client).not.toHaveProperty("publications$");
    expect(client).not.toHaveProperty("busy$");
    expect(client.conversation(peer)).not.toBe(conversation);
  });

  it("keeps history requests cold and releases live subscriptions on stop", async () => {
    const { client, pool } = setup();
    const history$ = client.sync$({ followRelays: false });
    expect(pool.relay).not.toHaveBeenCalled();
    expect(pool.subscription).not.toHaveBeenCalled();
    expect((await lastValueFrom(history$)).done).toBe(true);

    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    client.stop();
    expect(pool.subscription.mock.results.every(({ value }) => !value.observed)).toBe(true);
    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(4);
  });
});

it("keeps discovery reactive after relay discovery times out", async () => {
  vi.useFakeTimers();
  const fallbackRelays = new Subject<string[]>();
  const client = new LegacyMessagesClient({
    pubkey: owner,
    eventStore: new EventStore(),
    pool: {} as RelayPool,
    fallbackRelays,
    timeout: 10,
  });
  clients.push(client);
  const availability: boolean[] = [];
  const subscription = client
    .conversation(peer)
    .discover$()
    .subscribe((value) => availability.push(value.canSend));

  await vi.advanceTimersByTimeAsync(10);
  expect(availability.at(-1)).toBe(false);

  fallbackRelays.next(["wss://fallback.test/"]);
  expect(availability.at(-1)).toBe(true);

  fallbackRelays.next([]);
  expect(availability.at(-1)).toBe(false);
  subscription.unsubscribe();
});
