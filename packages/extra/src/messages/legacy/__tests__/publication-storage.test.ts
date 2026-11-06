import { EventStore } from "applesauce-core";
import { kinds, finalizeEvent, unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { firstValueFrom } from "rxjs";
import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient, type MessageStorage, type PreparedLegacyMessage } from "../../index.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const signer = new PrivateKeySigner(aliceKey);
const alice = await signer.getPublicKey();
const bob = await new PrivateKeySigner(bobKey).getPublicKey();
const clients: LegacyMessagesClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.dispose());
  vi.restoreAllMocks();
});

function storageAdapter(asynchronous = false) {
  const values = new Map<string, string>();
  const storage: MessageStorage = {
    getItem: vi.fn((key: string) =>
      asynchronous ? Promise.resolve(values.get(key) ?? null) : (values.get(key) ?? null),
    ),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return asynchronous ? Promise.resolve(value) : undefined;
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
      return asynchronous ? Promise.resolve() : undefined;
    }),
  };
  return { storage, values };
}

function setup(storage?: MessageStorage, withSigner = true) {
  const eventStore = new EventStore();
  for (const key of [aliceKey, bobKey]) {
    eventStore.add(
      finalizeEvent(
        {
          kind: kinds.DirectMessageRelaysList,
          created_at: unixNow(),
          tags: [["relay", "wss://dm.test/"]],
          content: "",
        },
        key,
      ),
    );
  }
  const pool = {
    publish: vi.fn(async (_relays: string[], _event: NostrEvent) => [{ from: "wss://dm.test/", ok: true }]),
    subscription: vi.fn(),
  };
  const client = new LegacyMessagesClient({
    pubkey: alice,
    signer: withSigner ? signer : undefined,
    eventStore,
    pool: pool as unknown as RelayPool,
    publicationStorage: storage,
    timeout: 5,
  });
  clients.push(client);
  const conversation = client.conversation(bob);
  return { client, conversation, pool, key: `publication:${conversation.id}` };
}

describe("legacy publication storage", () => {
  it.each(["observe", "publish", "discard"])("restores a durable publication lazily by ID to %s", async (operation) => {
    const { storage, values } = storageAdapter(true);
    const original = setup(storage);
    const prepared = await original.conversation.prepareSend({ content: "restore by ID" });
    original.client.dispose();
    const { conversation, pool } = setup(storage, false);
    vi.mocked(storage.getItem).mockClear();
    const state$ = conversation.publicationState$(prepared.message.id);
    expect(storage.getItem).not.toHaveBeenCalled();

    if (operation === "observe") {
      expect(await firstValueFrom(state$)).toEqual({ status: "prepared" });
      expect(values.size).toBe(1);
      expect(pool.publish).not.toHaveBeenCalled();
    } else if (operation === "publish") {
      expect((await conversation.publish(prepared.message.id)).id).toBe(prepared.message.id);
      expect(await firstValueFrom(state$)).toEqual({ status: "accepted" });
      expect(values.size).toBe(0);
    } else {
      await conversation.discardPublication(prepared.message.id);
      expect(await firstValueFrom(state$)).toEqual({ status: "discarded" });
      expect(values.size).toBe(0);
      expect(pool.publish).not.toHaveBeenCalled();
    }
    expect(storage.getItem).toHaveBeenCalledOnce();
    expect(pool.subscription).not.toHaveBeenCalled();
  });

  it("rejects unknown IDs even when the signed message exists in the shared EventStore", async () => {
    const { conversation, client, pool } = setup();
    const event = finalizeEvent(
      { kind: kinds.EncryptedDirectMessage, created_at: 1, content: "encrypted", tags: [["p", bob]] },
      aliceKey,
    );
    client.eventStore.add(event);
    const state$ = conversation.publicationState$(event.id);
    await expect(firstValueFrom(state$)).rejects.toThrow("Unknown");
    await expect(conversation.publish(event.id)).rejects.toThrow("Unknown");
    await expect(conversation.discardPublication(event.id)).rejects.toThrow("Unknown");
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it.each(["foreign", "forged", "stale"])("validates %s references for observation and discard", async (invalid) => {
    const { conversation, pool } = setup();
    let prepared = await conversation.prepareSend({ content: "owned" });
    if (invalid === "foreign") prepared = await setup().conversation.prepareSend({ content: "foreign" });
    if (invalid === "forged") prepared = { ...prepared } as PreparedLegacyMessage;
    if (invalid === "stale") conversation.stop();
    const state$ = conversation.publicationState$(prepared);
    await expect(firstValueFrom(state$)).rejects.toThrow();
    await expect(conversation.discardPublication(prepared)).rejects.toThrow();
    expect(await conversation.loadPublications()).toHaveLength(1);
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("keeps handles stable within a generation and completes active state observers on stop", async () => {
    const { conversation } = setup();
    const prepared = await conversation.prepareSend({ content: "stable" });
    expect((await conversation.loadPublications())[0]).toBe(prepared);
    expect((await firstValueFrom(conversation.pendingPublications$))[0]).toBe(prepared);
    expect(prepared.state$).toBe(prepared.state$);
    const states = subscribeSpyTo(prepared.state$);
    const ids = subscribeSpyTo(conversation.publicationState$(prepared.message.id));
    const pending = subscribeSpyTo(conversation.pendingPublications$);
    await vi.waitFor(() => expect(pending.getLastValue()?.[0]).toBe(prepared));

    conversation.stop();
    expect(states.receivedComplete()).toBe(true);
    expect(ids.receivedComplete()).toBe(true);
    const fresh = pending.getLastValue()![0];
    expect(fresh).not.toBe(prepared);
    expect((await conversation.loadPublications())[0]).toBe(fresh);
    await expect(firstValueFrom(prepared.state$)).rejects.toThrow();
    await expect(prepared.publish()).rejects.toThrow();
    expect(await firstValueFrom(fresh.state$)).toEqual({ status: "prepared" });
    await conversation.publish(prepared.message.id);
    expect(await firstValueFrom(fresh.state$)).toEqual({ status: "accepted" });
    expect(states.getValues()).toEqual([{ status: "prepared" }]);
    pending.unsubscribe();
  });

  it("retains discarded state across handle and ID observation without persisting or resurrecting it", async () => {
    const { storage, values } = storageAdapter();
    const { conversation, client } = setup(storage);
    const prepared = await conversation.prepareSend({ content: "discard" });
    const states = subscribeSpyTo(prepared.state$);
    await conversation.discardPublication(prepared);
    await conversation.discardPublication(prepared.message.id);
    expect(states.getValues()).toEqual([{ status: "prepared" }, { status: "discarded" }]);
    expect(await firstValueFrom(conversation.publicationState$(prepared.message.id))).toEqual({ status: "discarded" });
    await expect(conversation.publish(prepared.message.id)).rejects.toThrow("discarded");
    expect(values.size).toBe(0);
    client.dispose();
    expect(states.receivedComplete()).toBe(true);
    const reloaded = setup(storage);
    await expect(firstValueFrom(reloaded.conversation.publicationState$(prepared.message.id))).rejects.toThrow(
      "Unknown",
    );
  });

  it("retains accepted state through cleanup and stop but never reconstructs it after reload", async () => {
    const { storage } = storageAdapter();
    const { conversation, client, pool } = setup(storage);
    const prepared = await conversation.prepareSend({ content: "accepted" });
    await prepared.publish();
    conversation.stop();
    await expect(prepared.publish()).rejects.toThrow();
    expect(await conversation.publish(prepared.message.id)).toBe(prepared.message);
    await conversation.discardPublication(prepared.message.id);
    expect(await firstValueFrom(conversation.publicationState$(prepared.message.id))).toEqual({ status: "accepted" });
    expect(pool.publish).toHaveBeenCalledOnce();
    client.dispose();
    await expect(setup(storage).conversation.publish(prepared.message.id)).rejects.toThrow("Unknown");
  });

  it.each([new Error("original"), undefined])(
    "retains the exact publication failure %s without duplicate errors",
    async (error) => {
      const { conversation, pool } = setup();
      const prepared = await conversation.prepareSend({ content: "fail" });
      const states = subscribeSpyTo(prepared.state$);
      const ids = subscribeSpyTo(conversation.publicationState$(prepared.message.id));
      const errors = subscribeSpyTo(conversation.errors$);
      pool.publish.mockRejectedValueOnce(error);
      await expect(conversation.publish(prepared.message.id)).rejects.toBe(error);
      const failed = states.getLastValue();
      expect(failed).toEqual({ status: "failed", error });
      if (failed?.status === "failed") expect(failed.error).toBe(error);
      expect(ids.getValues()).toEqual(states.getValues());
      expect(errors.getValues()).toEqual([]);
      await prepared.publish();
      expect(states.getValues().map((state) => state.status)).toEqual([
        "prepared",
        "publishing",
        "failed",
        "publishing",
        "accepted",
      ]);
      states.unsubscribe();
      ids.unsubscribe();
      errors.unsubscribe();
    },
  );

  it.each(["stop", "abort"])(
    "keeps late partial acceptance canonical after %s and blocks concurrent retries",
    async (ending) => {
      const { storage, values } = storageAdapter();
      const { conversation, pool } = setup(storage);
      const prepared = await conversation.prepareSend({ content: "late acceptance" });
      let finish!: () => void;
      pool.publish.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve([
                { from: "wss://dm.test/", ok: false },
                { from: "wss://accepted.test/", ok: true },
              ]);
          }),
      );
      const states = subscribeSpyTo(prepared.state$);
      const errors = subscribeSpyTo(conversation.errors$);
      const controller = new AbortController();
      const publishing = prepared.publish({ signal: controller.signal });
      const cancelled = expect(publishing).rejects.toThrow();
      await expect(conversation.publish(prepared.message.id)).rejects.toThrow("already");
      if (ending === "stop") conversation.stop();
      else controller.abort();
      await cancelled;
      expect(await firstValueFrom(conversation.publicationState$(prepared.message.id))).toEqual({
        status: "publishing",
      });
      await expect(conversation.publish(prepared.message.id)).rejects.toThrow("already");
      await expect(conversation.discardPublication(prepared.message.id)).rejects.toThrow("already");
      finish();
      await vi.waitFor(() => expect(values.size).toBe(0));
      expect(await firstValueFrom(conversation.publicationState$(prepared.message.id))).toEqual({ status: "accepted" });
      await conversation.publish(prepared.message.id);
      expect(pool.publish).toHaveBeenCalledOnce();
      expect(states.getValues().some((state) => state.status === "failed")).toBe(false);
      expect(errors.getValues()).toEqual([]);
      states.unsubscribe();
      errors.unsubscribe();
    },
  );

  it("does not turn cancelled network rejection into a delivery failure", async () => {
    const { conversation, pool } = setup();
    const prepared = await conversation.prepareSend({ content: "cancelled" });
    let reject!: (error: unknown) => void;
    pool.publish.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const states = subscribeSpyTo(prepared.state$);
    const controller = new AbortController();
    const publishing = prepared.publish({ signal: controller.signal });
    const cancelled = expect(publishing).rejects.toThrow();
    controller.abort();
    await cancelled;
    reject(new Error("network after cancellation"));
    await vi.waitFor(() => expect(states.getLastValue()).toEqual({ status: "prepared" }));
    expect(states.getValues().some((state) => state.status === "failed")).toBe(false);
    await conversation.publish(prepared.message.id);
    states.unsubscribe();
  });

  it("exposes acceptance before blocked storage cleanup finishes and releases observers on disposal", async () => {
    const { storage } = storageAdapter();
    const { conversation, pool } = setup(storage);
    const prepared = await conversation.prepareSend({ content: "cleanup" });
    let finish!: () => void;
    vi.mocked(storage.removeItem).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const publishing = prepared.publish();
    await vi.waitFor(() => expect(storage.removeItem).toHaveBeenCalledOnce());
    expect(await firstValueFrom(prepared.state$)).toEqual({ status: "accepted" });
    const states = subscribeSpyTo(prepared.state$);
    const cancelled = expect(publishing).rejects.toThrow();
    conversation.dispose();
    expect(states.receivedComplete()).toBe(true);
    await cancelled;
    await expect(firstValueFrom(prepared.state$)).rejects.toThrow("disposed");
    await expect(conversation.discardPublication(prepared.message.id)).rejects.toThrow("disposed");
    finish();
    expect(pool.publish).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "persists encrypted events and restores publish handles without a signer, async: %s",
    async (asynchronous) => {
      const { storage, values } = storageAdapter(asynchronous);
      const original = setup(storage);
      const prepared = await original.conversation.prepareSend({ content: "private plaintext" });
      expect([...values.keys()]).toEqual([original.key]);
      const record = JSON.parse(values.get(original.key)!);
      expect(record.version).toBe(1);
      expect(Object.keys(record.messages[0]).sort()).toEqual(["event", "preparedAt", "relays"]);
      expect(record.messages[0].event).toEqual(JSON.parse(JSON.stringify(prepared.message)));
      expect(values.get(original.key)).not.toContain("private plaintext");
      expect(original.pool.publish).not.toHaveBeenCalled();
      original.client.dispose();

      const restored = setup(storage, false);
      const pending = await firstValueFrom(restored.conversation.pendingPublications$);
      expect(pending).toHaveLength(1);
      expect(pending[0].message.id).toBe(prepared.message.id);
      expect(restored.pool.publish).not.toHaveBeenCalled();
      expect(restored.pool.subscription).not.toHaveBeenCalled();
      const published = await pending[0].publish();
      expect(published.id).toBe(prepared.message.id);
      expect(restored.pool.publish.mock.calls[0][0]).toEqual(record.messages[0].relays);
      expect(values.size).toBe(0);
      expect(await restored.conversation.loadPublications()).toEqual([]);
      await pending[0].publish();
      expect(restored.pool.publish).toHaveBeenCalledOnce();
    },
  );

  it("retains failed publications and restores the same event across reloads", async () => {
    const { storage, values } = storageAdapter();
    const original = setup(storage);
    const request = { content: "retry" };
    const prepared = await original.conversation.prepareSend(request);
    original.pool.publish.mockResolvedValueOnce([{ from: "wss://dm.test/", ok: false }]);
    await expect(prepared.publish()).rejects.toThrow();
    expect(values.size).toBe(1);
    original.client.dispose();
    const restored = setup(storage);
    const sign = vi.spyOn(signer, "signEvent");
    const [retried] = await restored.conversation.loadPublications();
    expect(retried.message.id).toBe(prepared.message.id);
    expect(sign).not.toHaveBeenCalled();
    await retried.publish();
    expect(values.size).toBe(0);
  });

  it("rejects preparation when persistence fails and leaves previous messages intact", async () => {
    const { storage, values } = storageAdapter();
    const { conversation, pool, key } = setup(storage);
    const first = await conversation.prepareSend({ content: "first" });
    const saved = values.get(key);
    vi.mocked(storage.setItem).mockRejectedValueOnce(new Error("storage offline"));
    await expect(conversation.prepareSend({ content: "second" })).rejects.toThrow("storage offline");
    expect(values.get(key)).toBe(saved);
    expect((await conversation.loadPublications()).map((pending) => pending.message.id)).toEqual([first.message.id]);
    expect(pool.publish).not.toHaveBeenCalled();
    await conversation.prepareSend({ content: "second" });
    expect(await conversation.loadPublications()).toHaveLength(2);
  });

  it("reports cleanup failures separately from successful publication and retries cleanup without republishing", async () => {
    const { storage, values } = storageAdapter();
    const { conversation, client, pool } = setup(storage);
    const prepared = await conversation.prepareSend({ content: "accepted" });
    const errors: unknown[] = [];
    const subscription = conversation.errors$.subscribe((error) => errors.push(error));
    vi.mocked(storage.removeItem).mockRejectedValueOnce(new Error("cleanup failed"));
    expect(await prepared.publish()).toBe(prepared.message);
    expect(values.size).toBe(1);
    expect(errors).toEqual([expect.objectContaining({ operation: "storage", eventId: prepared.message.id })]);
    expect(await firstValueFrom(prepared.state$)).toEqual({ status: "accepted" });
    expect(await conversation.loadPublications()).toEqual([]);
    await conversation.publish(prepared.message.id);
    expect(values.size).toBe(0);
    expect(pool.publish).toHaveBeenCalledOnce();
    subscription.unsubscribe();
  });

  it("preserves failed cleanup during other outbox writes without persisting clean terminal records", async () => {
    const { storage, values } = storageAdapter();
    const { conversation, pool, key } = setup(storage);
    const accepted = await conversation.prepareSend({ content: "accepted" });
    vi.mocked(storage.removeItem).mockRejectedValueOnce(new Error("cleanup failed"));
    await accepted.publish();
    const discarded = await conversation.prepareSend({ content: "discard" });
    await conversation.discardPublication(discarded);
    const pending = await conversation.prepareSend({ content: "pending" });
    const savedIds = () => JSON.parse(values.get(key)!).messages.map((entry: { event: NostrEvent }) => entry.event.id);
    expect(savedIds()).toEqual([accepted.message.id, pending.message.id]);
    await conversation.publish(accepted.message.id);
    expect(savedIds()).toEqual([pending.message.id]);
    const next = await conversation.prepareSend({ content: "next" });
    expect(savedIds()).toEqual([pending.message.id, next.message.id]);
    expect(pool.publish).toHaveBeenCalledOnce();
    expect(await firstValueFrom(accepted.state$)).toEqual({ status: "accepted" });
    expect(await firstValueFrom(discarded.state$)).toEqual({ status: "discarded" });
  });

  it("shares lazy ID restoration across simultaneous publication calls without double publication", async () => {
    const { storage } = storageAdapter(true);
    const original = setup(storage);
    const prepared = await original.conversation.prepareSend({ content: "restore concurrently" });
    original.client.dispose();
    const { conversation, pool } = setup(storage, false);
    vi.mocked(storage.getItem).mockClear();
    let finish!: () => void;
    pool.publish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([{ from: "wss://dm.test/", ok: true }]);
        }),
    );
    const first = conversation.publish(prepared.message.id);
    await expect(conversation.publish(prepared.message.id)).rejects.toThrow("already");
    expect(pool.publish).toHaveBeenCalledOnce();
    expect(storage.getItem).toHaveBeenCalledOnce();
    finish();
    await first;
  });

  it("discards durably and invalidates retained handles without publishing", async () => {
    const { storage, values } = storageAdapter();
    const { conversation, client, pool } = setup(storage);
    const prepared = await conversation.prepareSend({ content: "discard" });
    vi.mocked(storage.removeItem).mockRejectedValueOnce(new Error("remove failed"));
    await expect(conversation.discardPublication(prepared.message.id)).rejects.toThrow("remove failed");
    expect(await conversation.loadPublications()).toHaveLength(1);
    await conversation.discardPublication(prepared.message.id);
    expect(values.size).toBe(0);
    expect(await conversation.loadPublications()).toEqual([]);
    await expect(prepared.publish()).rejects.toThrow("discarded");
    expect(await firstValueFrom(prepared.state$)).toEqual({ status: "discarded" });
    expect(pool.publish).not.toHaveBeenCalled();
    await conversation.prepareSend({ content: "new" });
  });

  it("serializes concurrent preparations so neither outbox entry is lost", async () => {
    const { storage, values } = storageAdapter(true);
    const { conversation, key } = setup(storage);
    const prepared = await Promise.all([
      conversation.prepareSend({ content: "first" }),
      conversation.prepareSend({ content: "second" }),
    ]);
    expect(
      JSON.parse(values.get(key)!)
        .messages.map((entry: { event: NostrEvent }) => entry.event.id)
        .sort(),
    ).toEqual(prepared.map((entry) => entry.message.id).sort());
    await prepared[0].publish();
    expect(JSON.parse(values.get(key)!).messages).toHaveLength(1);
    await prepared[1].publish();
    expect(values.size).toBe(0);
  });

  it("keeps a completed storage write recoverable when preparation is cancelled", async () => {
    const { storage, values } = storageAdapter();
    const { conversation, key } = setup(storage);
    let finishWrite!: () => void;
    vi.mocked(storage.setItem).mockImplementationOnce(
      (storageKey, serialized) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            values.set(storageKey, serialized);
            resolve();
          };
        }),
    );
    const controller = new AbortController();
    const preparing = conversation.prepareSend(
      { content: "recover after cancellation" },
      { signal: controller.signal },
    );
    const cancelled = expect(preparing).rejects.toThrow();
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce());
    controller.abort();
    await cancelled;
    finishWrite();
    expect(await conversation.loadPublications()).toHaveLength(1);
    expect(JSON.parse(values.get(key)!).messages).toHaveLength(1);
  });

  it("rejects discard while publication is active", async () => {
    const { storage } = storageAdapter();
    const { conversation, pool } = setup(storage);
    const prepared = await conversation.prepareSend({ content: "in flight" });
    let finishPublish!: () => void;
    pool.publish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPublish = () => resolve([{ from: "wss://dm.test/", ok: true }]);
        }),
    );
    const publishing = prepared.publish();
    await expect(conversation.discardPublication(prepared.message.id)).rejects.toThrow("already being published");
    finishPublish();
    await publishing;
    expect(await conversation.loadPublications()).toEqual([]);
  });

  it("retries failed reads and shares restoration across subscriptions", async () => {
    const { storage } = storageAdapter(true);
    const { conversation } = setup(storage);
    vi.mocked(storage.getItem).mockRejectedValueOnce(new Error("read failed"));
    await expect(firstValueFrom(conversation.pendingPublications$)).rejects.toThrow("read failed");
    await Promise.all([
      firstValueFrom(conversation.pendingPublications$),
      firstValueFrom(conversation.pendingPublications$),
    ]);
    expect(storage.getItem).toHaveBeenCalledTimes(2);
  });

  it.each(["invalid", '{"version":2,"messages":[]}', '{"version":1,"messages":[{}]}'])(
    "preserves invalid storage for recovery: %s",
    async (serialized) => {
      const { storage, values } = storageAdapter();
      const { conversation, key } = setup(storage);
      values.set(key, serialized);
      await expect(conversation.loadPublications()).rejects.toThrow();
      expect(values.get(key)).toBe(serialized);
    },
  );

  it("validates signed events and their owner and correspondent before exposing restored handles", async () => {
    const { storage, values } = storageAdapter();
    const original = setup(storage);
    await original.conversation.prepareSend({ content: "valid" });
    const valid = JSON.parse(values.get(original.key)!);
    original.client.dispose();
    const tampered = structuredClone(valid);
    tampered.messages[0].event.content = "tampered";
    values.set(original.key, JSON.stringify(tampered));
    const restored = setup(storage);
    await expect(restored.conversation.loadPublications()).rejects.toThrow();
    const wrongOwner = structuredClone(valid);
    wrongOwner.messages[0].event = finalizeEvent(
      { kind: kinds.EncryptedDirectMessage, created_at: unixNow(), tags: [["p", alice]], content: "encrypted" },
      bobKey,
    );
    values.set(original.key, JSON.stringify(wrongOwner));
    await expect(restored.conversation.loadPublications()).rejects.toThrow();
    values.set(original.key, JSON.stringify(valid));
    expect(await restored.conversation.loadPublications()).toHaveLength(1);
  });

  it("uses draft and publication keys in the same adapter without clearing drafts on send", async () => {
    const { storage, values } = storageAdapter();
    const { client } = setup(storage);
    const conversation = new LegacyMessagesClient({
      pubkey: alice,
      signer,
      eventStore: client.eventStore,
      pool: client.pool,
      draftStorage: storage,
      publicationStorage: storage,
      timeout: 5,
    });
    clients.push(conversation);
    const peer = conversation.conversation(bob);
    await peer.setDraft({ content: "next message" });
    const prepared = await peer.prepareSend({ content: "sending" });
    expect([...values.keys()].sort()).toEqual([`draft:${peer.id}`, `publication:${peer.id}`].sort());
    await prepared.publish();
    expect(await peer.loadDraft()).toEqual({ content: "next message" });
    expect([...values.keys()]).toEqual([`draft:${peer.id}`]);
  });
});
