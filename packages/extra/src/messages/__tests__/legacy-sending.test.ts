import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { firstValueFrom } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient } from "../legacy/client.js";
import type { LegacyMessagesClientOptions, PreparedLegacyMessage } from "../legacy/types.js";

const ownerKey = new Uint8Array(32).fill(1);
const peerKey = new Uint8Array(32).fill(2);
const signer = new PrivateKeySigner(ownerKey);
const owner = await signer.getPublicKey();
const peer = await new PrivateKeySigner(peerKey).getPublicKey();
const clients: LegacyMessagesClient[] = [];
const accepted = [{ from: "wss://dm.test/", ok: true }];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(options: Partial<LegacyMessagesClientOptions> = {}) {
  const eventStore = new EventStore();
  for (const key of [ownerKey, peerKey]) {
    eventStore.add(
      finalizeEvent({ kind: kinds.RelayList, created_at: 1, tags: [["r", "wss://dm.test/"]], content: "" }, key),
    );
  }
  const pool = { publish: vi.fn(async () => accepted) };
  const storage = {
    getItem: vi.fn(async (): Promise<string | null> => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  };
  const client = new LegacyMessagesClient({
    pubkey: owner,
    signer,
    eventStore,
    pool: pool as unknown as RelayPool,
    fallbackRelays: ["wss://dm.test/"],
    publicationStorage: storage,
    timeout: 1,
    ...options,
  });
  clients.push(client);
  return { conversation: client.conversation(peer), pool, storage };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("legacy conversation sending activity", () => {
  it.each(["direct", "proxy"] as const)("shares activity, states, and retries through %s publication", async (path) => {
    const { conversation, pool } = setup();
    const prepared = await conversation.prepareSend({ content: "same event" });
    const sign = vi.spyOn(signer, "signEvent");
    const activity = subscribeSpyTo(conversation.sending$);
    const states = subscribeSpyTo(conversation.publications$);
    const errors = subscribeSpyTo(conversation.errors$);
    const publish = () => (path === "direct" ? conversation.publish(prepared) : prepared.publish());
    pool.publish.mockRejectedValueOnce(new Error("offline"));

    await expect(publish()).rejects.toThrow("offline");
    expect(states.getLastValue()).toEqual({ [prepared.message.id]: "failed" });
    expect(errors.getLastValue()).toMatchObject({ operation: "send", eventId: prepared.message.id });
    expect(await publish()).toBe(prepared.message);
    expect(states.getValues().map((value) => value[prepared.message.id])).toEqual([
      "prepared",
      "publishing",
      "failed",
      "publishing",
      "accepted",
    ]);
    expect(activity.getValues()).toEqual([false, true, false, true, false]);
    for (const call of pool.publish.mock.calls as unknown[][]) {
      expect(call[0]).toEqual(["wss://dm.test/"]);
      expect(call[1]).toBe(prepared.message);
    }
    expect(sign).not.toHaveBeenCalled();
    await conversation.publish(prepared);
    await prepared.publish();
    expect(pool.publish).toHaveBeenCalledTimes(2);
    activity.unsubscribe();
    states.unsubscribe();
    errors.unsubscribe();
  });

  it("keeps the convenience handle a proxy to the canonical method", async () => {
    const { conversation } = setup();
    const prepared = await conversation.prepareSend({ content: "proxy" });
    const publish = vi.spyOn(conversation, "publish");
    const options = { signal: new AbortController().signal };
    await prepared.publish(options);
    expect(publish).toHaveBeenCalledWith(prepared, options);
  });

  it("publishes restored pending handles directly without signing", async () => {
    const original = setup();
    const prepared = await original.conversation.prepareSend({ content: "restored" });
    const serialized = JSON.stringify({
      version: 1,
      messages: [{ event: prepared.message, relays: ["wss://dm.test/"], preparedAt: 1 }],
    });
    const restored = setup();
    restored.storage.getItem.mockResolvedValueOnce(serialized);
    const sign = vi.spyOn(signer, "signEvent");
    const [pending] = await firstValueFrom(restored.conversation.pendingPublications$);
    expect(await restored.conversation.publish(pending)).toEqual(prepared.message);
    expect(sign).not.toHaveBeenCalled();
    expect(restored.pool.publish).toHaveBeenCalledTimes(1);
  });

  it.each(["foreign", "forged", "discarded", "stale", "disposed"] as const)(
    "rejects %s handles without publication side effects",
    async (invalid) => {
      const { conversation, pool, storage } = setup();
      let prepared = await conversation.prepareSend({ content: invalid });
      if (invalid === "foreign") prepared = await setup().conversation.prepareSend({ content: "foreign" });
      if (invalid === "forged") prepared = { ...prepared } as PreparedLegacyMessage;
      if (invalid === "discarded") await conversation.discardPublication(prepared.message.id);
      if (invalid === "stale") {
        conversation.stop();
        await conversation.loadPublications();
      }
      if (invalid === "disposed") conversation.dispose();
      const activity = subscribeSpyTo(conversation.sending$);
      const states = subscribeSpyTo(conversation.publications$);
      const errors = subscribeSpyTo(conversation.errors$);
      storage.removeItem.mockClear();
      storage.setItem.mockClear();

      await expect(conversation.publish(prepared)).rejects.toThrow();
      if (invalid === "stale" || invalid === "discarded" || invalid === "disposed")
        await expect(prepared.publish()).rejects.toThrow();
      expect(activity.getValues()).toEqual([false]);
      expect(states.getValues()).toHaveLength(1);
      expect(errors.getValues()).toEqual([]);
      expect(pool.publish).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      activity.unsubscribe();
      states.unsubscribe();
      errors.unsubscribe();
    },
  );

  it("recovers fresh handles after stop without resurrecting old proxies", async () => {
    const { conversation, pool } = setup();
    const stale = await conversation.prepareSend({ content: "recover" });
    conversation.stop();
    const [fresh] = await conversation.loadPublications();
    await expect(stale.publish()).rejects.toThrow();
    expect(await conversation.publish(fresh)).toBe(stale.message);
    await expect(conversation.publish(stale)).rejects.toThrow();
    expect(pool.publish).toHaveBeenCalledTimes(1);
  });

  it.each(["direct", "proxy"] as const)(
    "rejects an overlapping %s call without changing active state",
    async (first) => {
      const { conversation, pool } = setup();
      const prepared = await conversation.prepareSend({ content: "overlap" });
      const [alias] = await conversation.loadPublications();
      const publication = deferred<typeof accepted>();
      pool.publish.mockReturnValueOnce(publication.promise);
      const activity = subscribeSpyTo(conversation.sending$);
      const states = subscribeSpyTo(conversation.publications$);
      const errors = subscribeSpyTo(conversation.errors$);
      const publishing = first === "direct" ? conversation.publish(prepared) : prepared.publish();
      await expect(first === "direct" ? alias.publish() : conversation.publish(alias)).rejects.toThrow("already");
      expect(states.getLastValue()).toEqual({ [prepared.message.id]: "publishing" });
      expect(errors.getValues()).toEqual([]);
      expect(activity.getValues()).toEqual([false, true]);
      publication.resolve(accepted);
      await publishing;
      expect(activity.getValues()).toEqual([false, true, false]);
      expect(pool.publish).toHaveBeenCalledTimes(1);
      activity.unsubscribe();
      states.unsubscribe();
      errors.unsubscribe();
    },
  );

  it("retries accepted storage cleanup through either path without republishing", async () => {
    const { conversation, pool, storage } = setup();
    const prepared = await conversation.prepareSend({ content: "cleanup" });
    storage.removeItem.mockRejectedValueOnce(new Error("cleanup failed"));
    const errors = subscribeSpyTo(conversation.errors$);
    await conversation.publish(prepared);
    expect(errors.getLastValue()).toMatchObject({ operation: "storage" });
    await prepared.publish();
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
    expect(pool.publish).toHaveBeenCalledTimes(1);
    expect(await conversation.loadPublications()).toEqual([]);
    errors.unsubscribe();
  });

  it.each(["stop", "dispose"] as const)("cancels direct publication on %s", async (cancel) => {
    const { conversation, pool } = setup();
    const prepared = await conversation.prepareSend({ content: cancel });
    const publication = deferred<typeof accepted>();
    pool.publish.mockReturnValueOnce(publication.promise);
    const activity = subscribeSpyTo(conversation.sending$);
    const publishing = conversation.publish(prepared);
    const rejected = expect(publishing).rejects.toThrow();
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalled());
    conversation[cancel]();
    await rejected;
    expect(activity.getValues()).toEqual([false, true, false]);
    await expect(conversation.publish(prepared)).rejects.toThrow();
    publication.resolve(accepted);
    if (cancel === "stop") {
      await vi.waitFor(async () => expect(await conversation.loadPublications()).toEqual([]));
    }
    expect(pool.publish).toHaveBeenCalledTimes(1);
    activity.unsubscribe();
  });

  it("exposes current read-only activity to initial and late subscribers without the old API", async () => {
    const { conversation } = setup();
    expect(await firstValueFrom(conversation.sending$)).toBe(false);
    expect(conversation.sending$).not.toHaveProperty("next");
    expect(conversation).not.toHaveProperty("busy$");

    const prompt = deferred<string>();
    vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(prompt.promise);
    const preparing = conversation.prepareSend({ content: "prompt" });
    const activity = subscribeSpyTo(conversation.sending$);
    expect(activity.getValues()).toEqual([true]);

    prompt.resolve(owner);
    await preparing;
    expect(activity.getValues()).toEqual([true, false]);
    expect(await firstValueFrom(conversation.sending$)).toBe(false);
    expect(await conversation.loadPublications()).toHaveLength(1);
    expect(activity.getValues()).toEqual([true, false]);
    activity.unsubscribe();
  });

  it.each(["encrypt", "signEvent"] as const)("includes the %s signer prompt", async (method) => {
    const { conversation } = setup();
    const prompt = deferred<void>();
    if (method === "encrypt") {
      const encrypt = signer.nip04.encrypt.bind(signer.nip04);
      vi.spyOn(signer.nip04, "encrypt").mockImplementationOnce(async (...args) => {
        await prompt.promise;
        return encrypt(...args);
      });
    } else {
      const sign = signer.signEvent.bind(signer);
      vi.spyOn(signer, "signEvent").mockImplementationOnce(async (...args) => {
        await prompt.promise;
        return sign(...args);
      });
    }
    const activity = subscribeSpyTo(conversation.sending$);
    const preparing = conversation.prepareSend({ content: method });
    await vi.waitFor(() => expect(method === "encrypt" ? signer.nip04.encrypt : signer.signEvent).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    prompt.resolve();
    await preparing;
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it("includes publication storage reads and writes during preparation", async () => {
    const { conversation, storage } = setup();
    const reading = deferred<string | null>();
    const writing = deferred<void>();
    storage.getItem.mockReturnValueOnce(reading.promise);
    storage.setItem.mockReturnValueOnce(writing.promise);
    const activity = subscribeSpyTo(conversation.sending$);
    const preparing = conversation.prepareSend({ content: "durable" });
    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    reading.resolve(null);
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    writing.resolve();
    await preparing;
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it("includes plaintext cache storage and settles cancellation during a durable publication write", async () => {
    const caching = deferred<void>();
    const decryptionCache = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(() => caching.promise),
    };
    const { conversation, storage } = setup({ decryptionCache });
    const writing = deferred<void>();
    storage.setItem.mockReturnValueOnce(writing.promise);
    const controller = new AbortController();
    const activity = subscribeSpyTo(conversation.sending$);
    const preparing = conversation.prepareSend({ content: "durable cancellation" }, { signal: controller.signal });
    const rejected = expect(preparing).rejects.toThrow();
    await vi.waitFor(() => expect(decryptionCache.setItem).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    caching.resolve();
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    controller.abort();
    await rejected;
    expect(activity.getValues()).toEqual([false, true, false]);
    writing.resolve();
    expect(await conversation.loadPublications()).toHaveLength(1);
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it("keeps another preparation active after a concurrent preparation fails", async () => {
    const { conversation } = setup();
    const prompt = deferred<string>();
    vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(prompt.promise).mockRejectedValueOnce(new Error("declined"));
    const activity = subscribeSpyTo(conversation.sending$);
    const preparing = conversation.prepareSend({ content: "waiting" });
    await expect(conversation.send({ content: "declined" })).rejects.toThrow("declined");
    expect(activity.getValues()).toEqual([false, true]);
    prompt.resolve(owner);
    await preparing;
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it("settles a timed-out signer prompt", async () => {
    vi.useFakeTimers();
    const { conversation } = setup({ actionTimeout: 100 });
    vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(new Promise(() => {}));
    const activity = subscribeSpyTo(conversation.sending$);
    const rejected = expect(conversation.send({ content: "timeout" })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it.each(["getPublicKey", "signEvent", "getItem", "setItem"] as const)(
    "settles preparation activity after a %s failure",
    async (method) => {
      const { conversation, storage } = setup();
      const failure = new Error(method);
      if (method === "getPublicKey" || method === "signEvent") vi.spyOn(signer, method).mockRejectedValueOnce(failure);
      else storage[method].mockRejectedValueOnce(failure);
      const activity = subscribeSpyTo(conversation.sending$);
      await expect(conversation.prepareSend({ content: "failure" })).rejects.toBe(failure);
      expect(activity.getValues()).toEqual([false, true, false]);
      activity.unsubscribe();
    },
  );

  it("keeps send continuously active through publication and accepted storage cleanup", async () => {
    const { conversation, pool, storage } = setup();
    const publication = deferred<typeof accepted>();
    const cleanup = deferred<void>();
    pool.publish.mockReturnValueOnce(publication.promise);
    storage.removeItem.mockReturnValueOnce(cleanup.promise);
    const activity = subscribeSpyTo(conversation.sending$);
    const sending = conversation.send({ content: "no gap" });
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    publication.resolve(accepted);
    await vi.waitFor(() => expect(storage.removeItem).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    cleanup.resolve();
    await sending;
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it.each(["preparation", "publication"])("keeps overlapping work active when %s finishes first", async (first) => {
    const { conversation, pool } = setup();
    const prepared = await conversation.prepareSend({ content: "publish" });
    const publication = deferred<typeof accepted>();
    pool.publish.mockReturnValueOnce(publication.promise);
    const prompt = deferred<string>();
    vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(prompt.promise);
    const activity = subscribeSpyTo(conversation.sending$);
    const preparing = conversation.prepareSend({ content: "prepare" });
    const publishing = prepared.publish();
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalled());
    if (first === "preparation") {
      prompt.resolve(owner);
      await preparing;
    } else {
      publication.resolve(accepted);
      await publishing;
    }
    expect(activity.getValues()).toEqual([false, true]);
    prompt.resolve(owner);
    publication.resolve(accepted);
    await Promise.all([preparing, publishing]);
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it("settles failed sends and leaves pending retries inactive", async () => {
    const { conversation, pool } = setup();
    pool.publish.mockRejectedValueOnce(new Error("offline"));
    const activity = subscribeSpyTo(conversation.sending$);
    await expect(conversation.send({ content: "retry" })).rejects.toThrow("offline");
    expect(activity.getValues()).toEqual([false, true, false]);
    const [pending] = await conversation.loadPublications();
    expect(activity.getValues()).toEqual([false, true, false]);
    await pending.publish();
    expect(activity.getValues()).toEqual([false, true, false, true, false]);
    activity.unsubscribe();
  });

  it("keeps independent publications concurrent until both settle", async () => {
    const { conversation, pool } = setup();
    const first = await conversation.prepareSend({ content: "first" });
    const second = await conversation.prepareSend({ content: "second" });
    const firstPublication = deferred<typeof accepted>();
    const secondPublication = deferred<typeof accepted>();
    pool.publish.mockReturnValueOnce(firstPublication.promise).mockReturnValueOnce(secondPublication.promise);
    const activity = subscribeSpyTo(conversation.sending$);
    const firstPublishing = first.publish();
    const secondPublishing = second.publish();
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(2));
    firstPublication.resolve(accepted);
    await firstPublishing;
    expect(activity.getValues()).toEqual([false, true]);
    secondPublication.resolve(accepted);
    await secondPublishing;
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it("settles activity when accepted publication cleanup reports a storage failure", async () => {
    const { conversation, storage } = setup();
    storage.removeItem.mockRejectedValueOnce(new Error("cleanup failed"));
    const activity = subscribeSpyTo(conversation.sending$);
    const errors = subscribeSpyTo(conversation.errors$);
    await conversation.send({ content: "accepted" });
    expect(activity.getValues()).toEqual([false, true, false]);
    expect(errors.getLastValue()).toMatchObject({ operation: "storage", error: new Error("cleanup failed") });
    activity.unsubscribe();
    errors.unsubscribe();
  });

  it("settles cancellation during signing and ignores the late signed result", async () => {
    const { conversation, pool, storage } = setup();
    const prompt = deferred<void>();
    const sign = signer.signEvent.bind(signer);
    vi.spyOn(signer, "signEvent").mockImplementationOnce(async (...args) => {
      await prompt.promise;
      return sign(...args);
    });
    const controller = new AbortController();
    const activity = subscribeSpyTo(conversation.sending$);
    const sending = conversation.send({ content: "late signature" }, { signal: controller.signal });
    const rejected = expect(sending).rejects.toThrow();
    await vi.waitFor(() => expect(signer.signEvent).toHaveBeenCalled());
    controller.abort();
    await rejected;
    expect(activity.getValues()).toEqual([false, true, false]);
    prompt.resolve();
    await vi.waitFor(() => expect(vi.mocked(signer.signEvent).mock.settledResults[0]?.type).toBe("fulfilled"));
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(pool.publish).not.toHaveBeenCalled();
    expect(activity.getValues()).toEqual([false, true, false]);
    activity.unsubscribe();
  });

  it.each(["abort", "stop", "dispose"])(
    "settles preparation on %s without waiting for late signer results",
    async (cancel) => {
      const { conversation, pool } = setup();
      const prompt = deferred<string>();
      vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(prompt.promise);
      const controller = new AbortController();
      const activity = subscribeSpyTo(conversation.sending$);
      const sending = conversation.send({ content: "cancel" }, { signal: controller.signal });
      const rejected = expect(sending).rejects.toThrow();
      if (cancel === "abort") controller.abort();
      else if (cancel === "stop") conversation.stop();
      else conversation.dispose();
      await rejected;
      expect(activity.getValues()).toEqual([false, true, false]);
      prompt.resolve(owner);
      await Promise.resolve();
      expect(pool.publish).not.toHaveBeenCalled();
      expect(activity.getValues()).toEqual([false, true, false]);
      activity.unsubscribe();
    },
  );

  it.each(["direct", "proxy"] as const)(
    "settles cancelled %s publication while retaining late acceptance",
    async (path) => {
      const { conversation, pool } = setup();
      const prepared = await conversation.prepareSend({ content: "late acceptance" });
      const publication = deferred<typeof accepted>();
      pool.publish.mockReturnValueOnce(publication.promise);
      const controller = new AbortController();
      const activity = subscribeSpyTo(conversation.sending$);
      const publishing =
        path === "direct"
          ? conversation.publish(prepared, { signal: controller.signal })
          : prepared.publish({ signal: controller.signal });
      const rejected = expect(publishing).rejects.toThrow();
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalled());
      controller.abort();
      await rejected;
      expect(activity.getValues()).toEqual([false, true, false]);
      publication.resolve(accepted);
      await vi.waitFor(async () => expect(await conversation.loadPublications()).toHaveLength(0));
      expect(activity.getValues()).toEqual([false, true, false]);
      activity.unsubscribe();
    },
  );
});
