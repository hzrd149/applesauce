import { EventStore } from "applesauce-core";
import {
  finalizeEvent,
  getEncryptedContent,
  kinds,
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

function setup(decryptionTimeout = 60000, decryptionCache?: EncryptedContentCache) {
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
  });
  clients.push(client);
  return { client, eventStore, pool };
}

async function encryptedMessage(content: string, recipient = owner) {
  const message = await LegacyMessageFactory.create(recipient, content).sign(peerSigner);
  return JSON.parse(JSON.stringify(message)) as NostrEvent;
}

describe("legacy reactive ownership", () => {
  it("rejects explicit decryption with the original failure and retains it in decryption state", async () => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("failure");
    eventStore.add(event);
    const failure = new Error("signer rejected");
    vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(failure);

    await expect(client.unlock(event)).rejects.toBe(failure);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({
      pending: 0,
      failed: [event.id],
      errors: { [event.id]: failure },
    });
    expect(client).not.toHaveProperty("errors$");

    await client.retryDecryption(event);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ failed: [], errors: {} });
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
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 3 });

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
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, failed: [] });
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
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, failed: [first.id] });
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
      errors.splice(0, errors.length, ...state.failed);
    });

    await client.unlock();

    expect(getEncryptedContent(good)).toBe("good");
    expect(new Set(errors)).toEqual(new Set([first.id, second.id]));
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, locked: 0, unlocked: 1 });
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
      for (const [eventId, error] of Object.entries(state.errors)) {
        if (!errors.some((failure) => failure.eventId === eventId))
          errors.push({ operation: "decrypt", eventId, error });
      }
    });

    await client.unlock();

    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt.mock.calls[0][1]).toBe(good.content);
    expect(getEncryptedContent(good)).toBe("good");
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, failed: [malformed.id] });
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

  it("reports read failures in shared state and clears them after an explicit retry", async () => {
    const { client, eventStore } = setup();
    const event = await encryptedMessage("retry");
    eventStore.add(event);
    const conversation = client.conversation(peer);
    const decrypt = vi.spyOn(ownerSigner.nip04, "decrypt").mockRejectedValueOnce(new Error("signer unavailable"));
    const errors: { operation: string; eventId: string; error: unknown }[] = [];
    const subscription = client.decryptionState$.subscribe((state) => {
      for (const [eventId, error] of Object.entries(state.errors)) {
        if (!errors.some((failure) => failure.eventId === eventId))
          errors.push({ operation: "decrypt", eventId, error });
      }
    });

    expect(await lastValueFrom(client.readMessages$({ history: true }).pipe(toArray()))).toEqual([]);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, failed: [event.id] });
    expect(await firstValueFrom(conversation.decryptionState$)).toMatchObject({ pending: 0, failed: [event.id] });
    await conversation.unlock();
    expect(decrypt).toHaveBeenCalledTimes(1);

    await client.retryDecryption(event);
    expect(await firstValueFrom(conversation.decryptionState$)).toMatchObject({ unlocked: 1, failed: [] });
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
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, failed: [event.id] });

    const retrying = client.retryDecryption(event);
    finish("late");
    await retrying;
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, failed: [], unlocked: 1 });
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
    expect(await firstValueFrom(client.decryptionState$)).toMatchObject({ pending: 0, failed: [] });
  });

  it("does not prompt after a conversation stops during plaintext cache restoration", async () => {
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

    await conversation.start({ history: false });
    expect(getItem).toHaveBeenCalledTimes(1);
    conversation.stop();
    finishCache(null);
    // Flush the cache and decryption promise continuations before checking for a late prompt.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(decrypt).not.toHaveBeenCalled();
    expect(await firstValueFrom(conversation.decryptionState$)).toMatchObject({ pending: 0, failed: [] });
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
    expect(await firstValueFrom(client.busy$)).toBe(false);
    expect(await firstValueFrom(client.publications$)).toEqual({});

    const conversation = client.conversation(peer);
    const prepared = await conversation.prepareSend({ content: "prepared" });
    expect(await firstValueFrom(client.publications$)).toEqual({ [prepared.message.id]: "prepared" });
    conversation.dispose();
    expect(await firstValueFrom(client.publications$)).toEqual({});
    expect(await firstValueFrom(client.busy$)).toBe(false);
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
