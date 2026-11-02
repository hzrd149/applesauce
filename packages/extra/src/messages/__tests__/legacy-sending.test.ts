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

function draftStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

describe("legacy draft handoff", () => {
  it("restores and hands off content, reply, and expiration before publication", async () => {
    const drafts = draftStorage();
    const { conversation, pool, storage } = setup({ draftStorage: drafts });
    const draft = { content: "saved", replyTo: "a".repeat(64), expiration: 2000000000 };
    drafts.values.set(`draft:${conversation.id}`, JSON.stringify({ version: 1, draft }));
    const prepare = vi.spyOn(conversation, "prepareSend");
    drafts.removeItem.mockImplementationOnce(async (key) => {
      expect(storage.setItem).toHaveBeenCalledOnce();
      expect(await conversation.loadPublications()).toHaveLength(1);
      drafts.values.delete(key);
    });

    const prepared = await conversation.prepareDraft();
    expect(prepare).toHaveBeenCalledWith(draft, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(prepared.message.tags).toContainEqual(["e", draft.replyTo]);
    expect(prepared.message.tags).toContainEqual(["expiration", String(draft.expiration)]);
    expect(await conversation.loadDraft()).toBeUndefined();
    expect(drafts.values.size).toBe(0);
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("rejects missing drafts without a signer prompt and accepts empty saved content", async () => {
    const { conversation } = setup();
    const prompt = vi.spyOn(signer, "getPublicKey");
    await expect(conversation.prepareDraft()).rejects.toThrow("No conversation draft");
    expect(prompt).not.toHaveBeenCalled();
    await conversation.setDraft({ content: "" });
    await conversation.prepareDraft();
    expect(await conversation.loadDraft()).toBeUndefined();
  });

  it.each(["signing", "retention"])("preserves the draft on failed %s", async (failure) => {
    const drafts = draftStorage();
    const { conversation, storage } = setup({ draftStorage: drafts });
    await conversation.setDraft({ content: "keep" });
    if (failure === "signing") vi.spyOn(signer, "signEvent").mockRejectedValueOnce(new Error("sign failed"));
    else storage.setItem.mockRejectedValueOnce(new Error("retain failed"));

    await expect(conversation.prepareDraft()).rejects.toThrow("failed");
    expect(await conversation.loadDraft()).toEqual({ content: "keep" });
    expect(drafts.removeItem).not.toHaveBeenCalled();
    expect(await conversation.loadPublications()).toEqual([]);
  });

  it.each([false, true])("preserves edits during preparation, identical replacement: %s", async (identical) => {
    const { conversation } = setup();
    await conversation.setDraft({ content: "captured" });
    const prompt = deferred<string>();
    const getKey = vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(prompt.promise);
    const preparing = conversation.prepareDraft();
    await vi.waitFor(() => expect(getKey).toHaveBeenCalled());
    await conversation.setDraft({ content: "newer" });
    if (identical) await conversation.setDraft({ content: "captured" });
    prompt.resolve(owner);
    await preparing;
    expect(await conversation.loadDraft()).toEqual({ content: identical ? "captured" : "newer" });
  });

  it("returns a recoverable handle and reports contextual storage failure when clearing fails", async () => {
    const drafts = draftStorage();
    const { conversation, pool } = setup({ draftStorage: drafts });
    await conversation.setDraft({ content: "keep" });
    const failure = new Error("disk unavailable");
    drafts.removeItem.mockRejectedValueOnce(failure);
    const errors = subscribeSpyTo(conversation.errors$);
    const prepared = await conversation.prepareDraft();

    expect(errors.getLastValue()).toMatchObject({
      operation: "storage",
      eventId: prepared.message.id,
      error: { message: "Failed to remove prepared conversation draft", cause: failure },
    });
    expect(await conversation.loadDraft()).toEqual({ content: "keep" });
    expect(drafts.values.size).toBe(1);
    expect((await conversation.loadPublications())[0].message).toBe(prepared.message);
    await conversation.publish(prepared);
    expect(pool.publish).toHaveBeenCalledOnce();
    expect(await conversation.loadDraft()).toEqual({ content: "keep" });
    errors.unsubscribe();
  });

  it("never clears an unrelated draft on publish retries or ordinary preparation and sends", async () => {
    const { conversation, pool } = setup();
    await conversation.setDraft({ content: "handoff" });
    const prepared = await conversation.prepareDraft();
    await conversation.setDraft({ content: "next" });
    pool.publish.mockRejectedValueOnce(new Error("offline"));
    await expect(conversation.publish(prepared)).rejects.toThrow("offline");
    await conversation.publish(prepared);
    const direct = await conversation.prepareSend({ content: "not the draft" });
    await direct.publish();
    await conversation.send({ content: "also independent" });
    expect(await conversation.loadDraft()).toEqual({ content: "next" });
  });

  it("keeps sending active through slow draft removal and serializes a newer edit after it", async () => {
    const drafts = draftStorage();
    const { conversation } = setup({ draftStorage: drafts });
    await conversation.setDraft({ content: "captured" });
    const removal = deferred<void>();
    drafts.removeItem.mockImplementationOnce(async (key) => {
      await removal.promise;
      drafts.values.delete(key);
    });
    const activity = subscribeSpyTo(conversation.sending$);
    const preparing = conversation.prepareDraft();
    await vi.waitFor(() => expect(drafts.removeItem).toHaveBeenCalled());
    expect(activity.getValues()).toEqual([false, true]);
    const editing = conversation.setDraft({ content: "newer" });
    removal.resolve();
    await Promise.all([preparing, editing]);
    expect(activity.getValues()).toEqual([false, true, false]);
    expect(await conversation.loadDraft()).toEqual({ content: "newer" });
    activity.unsubscribe();
  });

  it.each(["abort", "stop", "dispose"] as const)(
    "preserves the saved draft when %s cancels preparation",
    async (cancel) => {
      const drafts = draftStorage();
      const { conversation } = setup({ draftStorage: drafts });
      await conversation.setDraft({ content: "keep" });
      const controller = new AbortController();
      const prompt = deferred<string>();
      const getKey = vi.spyOn(signer, "getPublicKey").mockReturnValueOnce(prompt.promise);
      const activity = subscribeSpyTo(conversation.sending$);
      const preparing = conversation.prepareDraft({ signal: controller.signal });
      const rejected = expect(preparing).rejects.toThrow();
      await vi.waitFor(() => expect(getKey).toHaveBeenCalled());
      if (cancel === "abort") controller.abort();
      else conversation[cancel]();
      await rejected;
      prompt.resolve(owner);
      expect(drafts.removeItem).not.toHaveBeenCalled();
      expect(drafts.values.size).toBe(1);
      expect(activity.getValues()).toEqual([false, true, false]);
      if (cancel !== "dispose") expect(await conversation.loadDraft()).toEqual({ content: "keep" });
      activity.unsubscribe();
    },
  );

  it.each(["abort", "stop", "dispose"] as const)(
    "returns the prepared handle without clearing when %s follows successful preparation",
    async (cancel) => {
      const drafts = draftStorage();
      const { conversation, storage } = setup({ draftStorage: drafts });
      await conversation.setDraft({ content: "keep" });
      const controller = new AbortController();
      const prepareSend = conversation.prepareSend.bind(conversation);
      vi.spyOn(conversation, "prepareSend").mockImplementationOnce(async (request, options) => {
        const prepared = await prepareSend(request, options);
        if (cancel === "abort") controller.abort();
        else conversation[cancel]();
        return prepared;
      });
      const prepared = await conversation.prepareDraft({ signal: controller.signal });
      expect(prepared.message.id).toBeTruthy();
      expect(storage.setItem).toHaveBeenCalledOnce();
      expect(drafts.removeItem).not.toHaveBeenCalled();
      expect(drafts.values.size).toBe(1);
      if (cancel === "abort") await conversation.publish(prepared);
      else await expect(conversation.publish(prepared)).rejects.toThrow();
      if (cancel === "stop") {
        const [fresh] = await conversation.loadPublications();
        await conversation.publish(fresh);
        expect(await conversation.loadDraft()).toEqual({ content: "keep" });
      }
    },
  );

  it.each(["abort", "stop", "dispose"] as const)(
    "retains access to the handle when %s occurs during draft removal",
    async (cancel) => {
      const drafts = draftStorage();
      const { conversation } = setup({ draftStorage: drafts });
      await conversation.setDraft({ content: "captured" });
      const controller = new AbortController();
      const removal = deferred<void>();
      drafts.removeItem.mockImplementationOnce(async (key) => {
        await removal.promise;
        drafts.values.delete(key);
      });
      const activity = subscribeSpyTo(conversation.sending$);
      const preparing = conversation.prepareDraft({ signal: controller.signal });
      await vi.waitFor(() => expect(drafts.removeItem).toHaveBeenCalled());
      // Storage already started cannot be cancelled; a subsequent edit stays behind it.
      const editing = cancel === "dispose" ? undefined : conversation.setDraft({ content: "newer" });
      if (cancel === "abort") controller.abort();
      else conversation[cancel]();
      expect(activity.getValues()).toEqual([false, true]);
      removal.resolve();
      const prepared = await preparing;
      await editing;
      expect(prepared.message.id).toBeTruthy();
      expect(activity.getValues()).toEqual([false, true, false]);
      if (cancel !== "dispose") expect(await conversation.loadDraft()).toEqual({ content: "newer" });
      activity.unsubscribe();
    },
  );

  it("still reports a storage failure when cancellation occurs during removal", async () => {
    const drafts = draftStorage();
    const { conversation } = setup({ draftStorage: drafts });
    await conversation.setDraft({ content: "keep" });
    const removal = deferred<void>();
    drafts.removeItem.mockReturnValueOnce(removal.promise);
    const controller = new AbortController();
    const errors = subscribeSpyTo(conversation.errors$);
    const preparing = conversation.prepareDraft({ signal: controller.signal });
    await vi.waitFor(() => expect(drafts.removeItem).toHaveBeenCalled());
    controller.abort();
    removal.reject(new Error("disk failed"));
    const prepared = await preparing;
    expect(errors.getLastValue()).toMatchObject({ operation: "storage", eventId: prepared.message.id });
    expect(await conversation.loadDraft()).toEqual({ content: "keep" });
    errors.unsubscribe();
  });

  it("does not sign or clear after cancellation during draft restoration", async () => {
    const drafts = draftStorage();
    const restored = deferred<string>();
    const getItem = vi.fn(() => restored.promise);
    const { conversation } = setup({ draftStorage: { ...drafts, getItem } });
    const controller = new AbortController();
    const sign = vi.spyOn(signer, "getPublicKey");
    const preparing = conversation.prepareDraft({ signal: controller.signal });
    const rejected = expect(preparing).rejects.toThrow();
    await vi.waitFor(() => expect(getItem).toHaveBeenCalled());
    controller.abort();
    restored.resolve(JSON.stringify({ version: 1, draft: { content: "restored" } }));
    await rejected;
    expect(sign).not.toHaveBeenCalled();
    expect(drafts.removeItem).not.toHaveBeenCalled();
    expect(await conversation.loadDraft()).toEqual({ content: "restored" });
  });

  it.each(["abort", "stop", "dispose"] as const)(
    "preserves the draft and durable publication when %s interrupts retention",
    async (cancel) => {
      const drafts = draftStorage();
      const { conversation, storage } = setup({ draftStorage: drafts });
      await conversation.setDraft({ content: "keep" });
      const retention = deferred<void>();
      storage.setItem.mockReturnValueOnce(retention.promise);
      const controller = new AbortController();
      const preparing = conversation.prepareDraft({ signal: controller.signal });
      const rejected = expect(preparing).rejects.toThrow();
      await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
      if (cancel === "abort") controller.abort();
      else conversation[cancel]();
      await rejected;
      retention.resolve();
      expect(drafts.removeItem).not.toHaveBeenCalled();
      expect(drafts.values.size).toBe(1);
      // A completed durable write is recoverable, but cancellation before success never hands off the draft.
      if (cancel !== "dispose") {
        expect(await conversation.loadPublications()).toHaveLength(1);
        expect(await conversation.loadDraft()).toEqual({ content: "keep" });
      }
    },
  );
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
