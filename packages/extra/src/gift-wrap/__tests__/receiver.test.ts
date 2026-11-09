import { GiftWrapFactory } from "applesauce-common/factories";
import { getGiftWrapRumor, isGiftWrapUnlocked, unlockGiftWrap } from "applesauce-common/helpers";
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
import type { GiftWrapProcessingRecord, GiftWrapProcessingStore, GiftWrapReceiverOptions } from "../types.js";

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

async function envelope(kind = 1, tags?: string[][]) {
  const template = {
    kind,
    pubkey: await sender.getPublicKey(),
    created_at: unixNow(),
    tags: [],
    content: crypto.randomUUID(),
  };
  const rumor = { ...template, id: getEventHash(template) };
  let gift: NostrEvent = await GiftWrapFactory.create(sender, pubkey, rumor);
  if (tags) {
    const seal = await recipient.nip44.decrypt(gift.pubkey, gift.content);
    gift = await sender.signEvent({
      kind: 1059,
      created_at: gift.created_at,
      tags: [["p", pubkey], ...tags],
      content: await sender.nip44.encrypt(pubkey, seal),
    });
  }
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

function processingStorage() {
  const records = new Map<string, GiftWrapProcessingRecord>();
  const storage: GiftWrapProcessingStore = {
    list: vi.fn(() => structuredClone([...records.values()])),
    set: vi.fn((record) => {
      records.set(record.eventId, structuredClone(record));
    }),
  };
  return { storage, records };
}

describe("GiftWrapReceiver inbox selection", () => {
  it("narrows live and cache requests and snapshots constraints while discarding reserved fields", async () => {
    const filter = {
      "#k": ["3313"],
      kinds: [1],
      "#p": ["foreign"],
      since: 1,
      until: 2,
      limit: 1,
      search: "invite",
    };
    const cacheRequest = vi.fn(async () => []);
    const { receiver, pool } = setup({ filter: filter as unknown as GiftWrapReceiverOptions["filter"], cacheRequest });
    filter["#k"].push("14");
    await receiver.start();
    expect(cacheRequest).toHaveBeenCalledWith([{ kinds: [1059], "#p": [pubkey], "#k": ["3313"] }]);
    expect(pool.subscription).toHaveBeenCalledWith(
      ["wss://inbox.test/"],
      { kinds: [1059], "#p": [pubkey], "#k": ["3313"], since: expect.any(Number) },
      expect.anything(),
    );
  });

  it("excludes existing and arriving nonmatches from background processing and inbox state", async () => {
    const invite = await envelope(3313, [["k", "3313"]]);
    const existing = await envelope(14);
    const arriving = await envelope(14);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const { receiver, eventStore } = setup({ filter: { "#k": ["3313"] }, autoUnlock: true });
    eventStore.add(existing.event);
    eventStore.add(invite.event);
    const subscription = receiver.receive$.subscribe();
    eventStore.add(arriving.event);
    notifyEventUpdate(arriving.event);
    await vi.waitFor(async () => expect(await firstValueFrom(receiver.rumors$)).toEqual([invite.rumor]));
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(await firstValueFrom(receiver.giftWraps$)).toEqual([invite.event]);
    expect(await firstValueFrom(receiver.decryptionState$)).toMatchObject({ total: 1, unlocked: 1 });
    expect(await receiver.readNext()).toBeUndefined();
    await receiver.unlock();
    expect(decrypt).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("keeps pull candidates narrowed after the initial scan but permits an explicit unlock", async () => {
    const excluded = await envelope(14);
    const invite = await envelope(3313, [["k", "3313"]]);
    const { receiver } = setup({ filter: { "#k": ["3313"] } });
    expect(await receiver.readNext()).toBeUndefined();
    await receiver.ingest(excluded.event);
    await receiver.ingest(invite.event);
    expect(await receiver.readNext()).toMatchObject({ status: "success", rumor: invite.rumor });
    expect(await receiver.readNext()).toBeUndefined();
    expect(await receiver.unlock(excluded.event)).toEqual(excluded.rumor);
    expect(await firstValueFrom(receiver.giftWraps$)).toEqual([invite.event]);
  });

  it("rejects a matching envelope with multiple recipients before decrypting", async () => {
    const { event } = await envelope(3313, [
      ["k", "3313"],
      ["p", pubkey],
    ]);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const { receiver } = setup({ filter: { "#k": ["3313"] } });
    await expect(receiver.unlock(event)).rejects.toThrow("not addressed");
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe("GiftWrapReceiver additive relays", () => {
  it.each(["explicit", "advertised", "fallback"])(
    "adds extras to %s relays without changing the selected inbox",
    async (mode) => {
      const { receiver, eventStore } = setup({
        relays: mode === "explicit" ? ["wss://inbox.test"] : undefined,
        fallbackRelays: ["wss://fallback.test"],
        extraRelays: ["wss://extra.test", "wss://extra.test/"],
      });
      if (mode === "advertised") {
        eventStore.add(
          await recipient.signEvent({
            kind: 10050,
            tags: [["relay", "wss://advertised.test"]],
            content: "",
            created_at: unixNow(),
          }),
        );
      }
      const selected: string[][] = [];
      const reads: string[][] = [];
      const selectedSubscription = receiver.relays$.subscribe((value) => selected.push(value));
      const readSubscription = receiver.readRelays$.subscribe((value) => reads.push(value));
      const inbox = `wss://${mode === "explicit" ? "inbox" : mode}.test/`;
      await vi.waitFor(() => expect(selected.at(-1)).toEqual([inbox]));
      expect(reads.at(-1)).toEqual([inbox, "wss://extra.test/"].sort());
      await receiver.start();
      readSubscription.unsubscribe();
      selectedSubscription.unsubscribe();
    },
  );

  it("reads immediately with delayed extras and only opens or closes changed relay subscriptions", async () => {
    const extras = new Subject<string[]>();
    const { receiver, pool, closed } = setup({ extraRelays: extras });
    await receiver.start();
    expect(pool.subscription).toHaveBeenCalledTimes(1);
    extras.next(["wss://extra.test"]);
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    expect(closed).not.toHaveBeenCalled();
    extras.next(["wss://extra.test/", "wss://inbox.test", "wss://extra.test"]);
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    expect(closed).not.toHaveBeenCalled();
    extras.next([]);
    expect(closed).toHaveBeenCalledTimes(1);
    extras.next(["wss://extra.test"]);
    expect(pool.subscription).toHaveBeenCalledTimes(3);
    receiver.stop();
    expect(closed).toHaveBeenCalledTimes(3);
    await receiver.start();
    expect(pool.subscription).toHaveBeenCalledTimes(4);
    receiver.stop();
    expect(closed).toHaveBeenCalledTimes(4);
  });

  it.each([[], ["wss://inbox.test", "wss://inbox.test/"], EMPTY])(
    "preserves the inbox for empty or duplicate extras (%s)",
    async (extraRelays) => {
      const { receiver } = setup({ extraRelays });
      expect(await firstValueFrom(receiver.readRelays$)).toEqual(await firstValueFrom(receiver.relays$));
    },
  );

  it.each([true, false])("syncs the narrowed inbox on extra relays with followRelays=%s", async (followRelays) => {
    const request = vi.fn(() => EMPTY);
    const pool = {
      req: vi.fn(() => of({ type: "EOSE", from: "wss://inbox.test/" })),
      relay: vi.fn(() => ({ getSupported: async () => [], getLimitations: async () => ({ max_limit: 500 }), request })),
    };
    const cacheRequest = vi.fn(async () => []);
    const { receiver } = setup({
      pool: pool as unknown as RelayPool,
      extraRelays: new BehaviorSubject(["wss://extra.test"]),
      filter: { "#k": ["3313"] },
      cacheRequest,
    });
    const subscription = receiver.sync$({ since: 100, until: 200, followRelays }).subscribe();
    await vi.waitFor(() => expect(pool.relay).toHaveBeenCalledWith("wss://extra.test/"));
    expect(pool.relay).toHaveBeenCalledWith("wss://inbox.test/");
    const filter = { kinds: [1059], "#p": [pubkey], "#k": ["3313"], since: 100, until: 200 };
    expect(cacheRequest).toHaveBeenCalledWith([filter]);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith([expect.objectContaining(filter)], expect.anything());
    subscription.unsubscribe();
  });
});

describe("GiftWrapReceiver scaling", () => {
  it("defaults to four occupied signer calls", async () => {
    const { receiver } = setup();
    const envelopes = await Promise.all(Array.from({ length: 5 }, () => envelope()));
    const gate = deferred<void>();
    const decrypt = recipient.nip44.decrypt.bind(recipient.nip44);
    let active = 0;
    let maximum = 0;
    const calls = vi.spyOn(recipient.nip44, "decrypt").mockImplementation(async (...args) => {
      maximum = Math.max(maximum, ++active);
      await gate.promise;
      try {
        return await decrypt(...args);
      } finally {
        active--;
      }
    });
    const pending = envelopes.map(({ event }) => receiver.unlock(event));
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(4));
    gate.resolve();
    await Promise.all(pending);
    expect(maximum).toBe(4);
  });

  it("checks caches concurrently with a serialized signer configuration", async () => {
    const gate = deferred<string | null>();
    const cache = { getItem: vi.fn(() => gate.promise), setItem: vi.fn() };
    const { receiver } = setup({ decryptionCache: cache, decryptionConcurrency: 1, processingConcurrency: 4 });
    for (const { event } of await Promise.all(Array.from({ length: 5 }, () => envelope())))
      await receiver.ingest(event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const subscription = receiver.receive$.subscribe();
    await vi.waitFor(() => expect(cache.getItem).toHaveBeenCalledTimes(4));
    subscription.unsubscribe();
    gate.resolve(null);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("pulls past thousands of completed envelopes without rescanning history", async () => {
    const { storage, records } = processingStorage();
    const { receiver, eventStore } = setup({ processingStore: storage });
    const template = (await envelope()).event;
    eventStore.verifyEvent = () => true;
    for (let index = 1; index <= 3000; index++) {
      const eventId = index.toString(16).padStart(64, "0");
      records.set(eventId, {
        version: 1,
        eventId,
        status: "completed",
        attempts: 1,
        stage: "checkpoint",
        rumorId: eventId,
      });
      eventStore.add({ ...template, id: eventId });
    }
    for (const { event } of await Promise.all(Array.from({ length: 12 }, () => envelope())))
      await receiver.ingest(event);
    const scans = vi.spyOn(eventStore, "getByFilters");
    let count = 0;
    for await (const result of receiver.readInbox()) {
      expect(result.status).toBe("success");
      count++;
    }
    expect(count).toBe(12);
    expect(scans).toHaveBeenCalledTimes(1);

    const arrival = await envelope();
    await receiver.ingest(arrival.event);
    expect(await receiver.readNext()).toMatchObject({ status: "success", rumor: arrival.rumor });
    expect(scans).toHaveBeenCalledTimes(1);

    const removed = await envelope();
    await receiver.ingest(removed.event);
    eventStore.remove(removed.event);
    expect(await receiver.readNext()).toBeUndefined();
    await receiver.ingest(removed.event);
    expect(await receiver.readNext()).toMatchObject({ status: "success", rumor: removed.rumor });
    expect(scans).toHaveBeenCalledTimes(1);
  });

  it("gives live arrivals a turn before finishing the stored backlog", async () => {
    const { receiver } = setup({ autoUnlock: true, decryptionConcurrency: 1 });
    for (const { event } of await Promise.all(Array.from({ length: 6 }, () => envelope())))
      await receiver.ingest(event);
    const gate = deferred<void>();
    const decrypt = recipient.nip44.decrypt.bind(recipient.nip44);
    const calls = vi.spyOn(recipient.nip44, "decrypt").mockImplementationOnce(async (...args) => {
      await gate.promise;
      return decrypt(...args);
    });
    const received: string[] = [];
    const subscription = receiver.receive$.subscribe((result) => received.push(result.event.id));
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    const live = await envelope();
    await receiver.ingest(live.event);
    gate.resolve();
    await vi.waitFor(() => expect(received).toHaveLength(7));
    expect(received.indexOf(live.event.id)).toBeLessThanOrEqual(2);
    expect(new Set(received).size).toBe(7);
    subscription.unsubscribe();
  });
});

describe("GiftWrapReceiver persistence", () => {
  it("waits for the final checkpoint page before skipping restored completions", async () => {
    const { event, rumor } = await envelope();
    const gate = deferred<void>();
    const storage: GiftWrapProcessingStore = {
      async *list() {
        yield {
          version: 1,
          eventId: event.id,
          status: "completed",
          attempts: 1,
          stage: "checkpoint",
          rumorId: rumor.id,
        };
        await gate.promise;
      },
      set: vi.fn(),
    };
    const { receiver } = setup({ processingStore: storage });
    await receiver.ingest(event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    let settled = false;
    const pull = receiver.readNext().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    expect(await pull).toBeUndefined();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("restores streamed checkpoints without exposing a partially failed snapshot", async () => {
    const { event, rumor } = await envelope();
    let broken = true;
    const storage: GiftWrapProcessingStore = {
      async *list() {
        if (broken) {
          yield {
            version: 1,
            eventId: event.id,
            status: "completed",
            attempts: 1,
            stage: "checkpoint",
            rumorId: rumor.id,
          };
          throw new Error("page unavailable");
        }
      },
      set: vi.fn(),
    };
    const { receiver } = setup({ processingStore: storage });
    await receiver.ingest(event);
    await expect(receiver.ready()).rejects.toThrow("page unavailable");
    broken = false;
    expect(await receiver.readNext()).toMatchObject({ status: "success", rumor });
  });

  it("skips and reports invalid checkpoint rows instead of failing every restore", async () => {
    const restored = await envelope();
    const damaged = await envelope();
    const storage: GiftWrapProcessingStore = {
      async *list() {
        // A row this version cannot read, such as one written by a newer schema
        yield {
          version: 2,
          eventId: damaged.event.id,
          status: "completed",
          attempts: 1,
          stage: "checkpoint",
          rumorId: damaged.rumor.id,
        } as unknown as GiftWrapProcessingRecord;
        yield {
          version: 1,
          eventId: restored.event.id,
          status: "completed",
          attempts: 1,
          stage: "checkpoint",
          rumorId: restored.rumor.id,
        };
      },
      set: vi.fn(),
    };
    const { receiver } = setup({ processingStore: storage });
    const errors = vi.fn();
    receiver.errors$.subscribe(errors);
    await receiver.ingest(restored.event);
    await receiver.ingest(damaged.event);

    await expect(receiver.ready()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "persistence", eventId: damaged.event.id }),
    );

    // The unreadable row's envelope is processed again; the valid completion is still honored
    expect(await receiver.readNext()).toMatchObject({ status: "success", rumor: damaged.rumor });
    expect(await receiver.readNext()).toBeUndefined();
  });
  it("fails readiness without processing and allows retrying a failed restore", async () => {
    const { storage } = processingStorage();
    const list = vi.spyOn(storage, "list").mockRejectedValueOnce(new Error("database offline"));
    const { receiver } = setup({ processingStore: storage });
    await receiver.ingest((await envelope()).event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const errors = vi.fn();
    receiver.errors$.subscribe(errors);
    await expect(receiver.readNext()).rejects.toThrow("database offline");
    expect(decrypt).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ operation: "persistence" }));
    expect(await receiver.readNext()).toMatchObject({ status: "success" });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("recovers a restored signer failure through external plaintext updates", async () => {
    const { storage, records } = processingStorage();
    const { event } = await envelope();
    records.set(event.id, {
      version: 1,
      eventId: event.id,
      status: "failed",
      stage: "wrap",
      attempts: 1,
      failure: {
        eventId: event.id,
        stage: "wrap",
        code: "signer-rejected",
        attempts: 1,
        retry: "manual",
        message: "denied",
      },
    });
    const { receiver } = setup({ processingStore: storage, signer: undefined });
    const stored = await receiver.ingest(event);
    const results = vi.fn();
    const subscription = receiver.receive$.subscribe(results);
    await receiver.ready();
    await unlockGiftWrap(stored, recipient);
    notifyEventUpdate(stored);
    await vi.waitFor(() => expect(results).toHaveBeenCalledWith(expect.objectContaining({ status: "success" })));
    expect(records.get(event.id)).toMatchObject({ status: "completed" });
    subscription.unsubscribe();
  });

  it.each(["missing", "error"])("preserves completion when the plaintext cache returns %s", async (cacheResult) => {
    const { storage, records } = processingStorage();
    const rumorStore = new RumorStore();
    disposables.push(rumorStore);
    const { event, rumor } = await envelope();
    const first = setup({ processingStore: storage, rumorStore }).receiver;
    await first.unlock(event);
    expect(records.get(event.id)).toMatchObject({ status: "completed", rumorId: rumor.id, attempts: 1 });
    first.dispose();

    const decryptionCache = {
      getItem: vi.fn(async () => {
        if (cacheResult === "error") throw new Error("Cache unavailable");
        return null;
      }),
      setItem: vi.fn(),
    };
    const second = setup({ processingStore: storage, rumorStore, decryptionCache, autoUnlock: true }).receiver;
    const fresh = JSON.parse(JSON.stringify(event));
    await second.ingest(fresh);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const outcomes = vi.fn();
    const errors = vi.fn();
    const errorSubscription = second.errors$.subscribe(errors);
    const subscription = second.receive$.subscribe(outcomes);
    expect(await second.readNext()).toBeUndefined();
    expect(await second.unlock(fresh)).toEqual(rumor);
    expect(isGiftWrapUnlocked(fresh)).toBe(false);
    expect(decrypt).not.toHaveBeenCalled();
    expect(outcomes).not.toHaveBeenCalled();
    expect(records.get(event.id)).toMatchObject({ status: "completed", attempts: 1 });
    if (cacheResult === "error") expect(errors).toHaveBeenCalledWith(expect.objectContaining({ operation: "cache" }));
    subscription.unsubscribe();
    errorSubscription.unsubscribe();
  });

  it.each(["stored", "arrival", "explicit"])(
    "restores completed %s envelopes from cache without repeating processing",
    async (mode) => {
      const { storage, records } = processingStorage();
      const rumorStore = new RumorStore();
      disposables.push(rumorStore);
      const cached = new Map<string, string>();
      const decryptionCache = {
        getItem: vi.fn(async (key: string) => cached.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => {
          cached.set(key, value);
        }),
      };
      const { event, rumor } = await envelope();
      const first = setup({ processingStore: storage, rumorStore, decryptionCache }).receiver;
      const invalid = finalizeEvent(
        { kind: 1059, created_at: unixNow(), tags: [["p", pubkey]], content: "broken" },
        new Uint8Array(32).fill(23),
      );
      await first.ingest(invalid);
      await first.readNext();
      await first.unlock(event);
      first.dispose();

      const second = setup({ processingStore: storage, rumorStore, decryptionCache }).receiver;
      const fresh = JSON.parse(JSON.stringify(event));
      const decrypt = vi.spyOn(recipient.nip44, "decrypt");
      const add = vi.spyOn(rumorStore, "add");
      const checkpoint = vi.spyOn(storage, "set");
      checkpoint.mockClear();
      const outcomes = vi.fn();
      const states: number[] = [];
      const stateSubscription = second.decryptionState$.subscribe((state) => states.push(state.unlocked));
      await second.ingest(JSON.parse(JSON.stringify(invalid)));
      if (mode !== "arrival") await second.ingest(fresh);
      const subscription = mode === "explicit" ? undefined : second.receive$.subscribe(outcomes);
      await second.ready();
      if (mode === "arrival") await second.ingest(fresh);
      if (mode === "explicit") expect(await second.unlock(fresh)).toEqual(rumor);

      await vi.waitFor(() => expect(isGiftWrapUnlocked(fresh)).toBe(true));
      expect(getGiftWrapRumor(fresh)).toEqual(rumor);
      await vi.waitFor(() => expect(states).toContain(1));
      expect(await second.readNext()).toBeUndefined();
      expect(outcomes).not.toHaveBeenCalled();
      expect(decrypt).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(checkpoint).not.toHaveBeenCalled();
      expect(records.get(event.id)).toMatchObject({ status: "completed", attempts: 1 });
      expect((await firstValueFrom(second.decryptionState$)).errors.size).toBe(1);

      subscription?.unsubscribe();
      const next = await envelope();
      await second.ingest(next.event);
      expect(await second.readNext()).toMatchObject({ status: "success", rumor: next.rumor });
      stateSubscription.unsubscribe();
    },
  );

  it.each(["no-store", "none", "processing", "failed-wrap", "failed-seal", "failed-storage", "completed"] as const)(
    "restores both cached layers with a %s checkpoint",
    async (progress) => {
      const { event, rumor } = await envelope();
      const sealPlaintext = await recipient.nip44.decrypt(event.pubkey, event.content);
      const seal = JSON.parse(sealPlaintext);
      const rumorPlaintext = await recipient.nip44.decrypt(seal.pubkey, seal.content);
      const cached = new Map([
        [event.id, sealPlaintext],
        [seal.id, rumorPlaintext],
      ]);
      const decryptionCache = {
        getItem: vi.fn(async (key: string) => cached.get(key) ?? null),
        setItem: vi.fn(),
      };
      const { storage, records } = processingStorage();
      if (progress === "processing" || progress === "completed") {
        records.set(event.id, {
          version: 1,
          eventId: event.id,
          status: progress,
          stage: "checkpoint",
          attempts: 1,
          ...(progress === "completed" ? { rumorId: rumor.id } : {}),
        });
      } else if (progress !== "none" && progress !== "no-store") {
        const stage = progress === "failed-storage" ? "storage" : progress === "failed-seal" ? "seal" : "wrap";
        records.set(event.id, {
          version: 1,
          eventId: event.id,
          status: "failed",
          stage,
          attempts: 1,
          failure: {
            eventId: event.id,
            stage,
            attempts: 1,
            retry: "manual",
            message: "Previous failure",
            code: stage === "storage" ? "storage-failed" : "signer-rejected",
          },
        });
      }

      const { receiver } = setup({
        processingStore: progress === "no-store" ? undefined : storage,
        decryptionCache,
      });
      const decrypt = vi.spyOn(recipient.nip44, "decrypt");
      const outcomes = vi.fn();
      await receiver.ingest(event);
      const subscription = receiver.receive$.subscribe(outcomes);

      await vi.waitFor(() => expect(isGiftWrapUnlocked(event)).toBe(true));
      expect(getGiftWrapRumor(event)).toEqual(rumor);
      expect(decryptionCache.getItem).toHaveBeenCalledWith(event.id);
      expect(decryptionCache.getItem).toHaveBeenCalledWith(seal.id);
      expect(decrypt).not.toHaveBeenCalled();
      expect(decryptionCache.setItem).not.toHaveBeenCalled();

      if (progress === "failed-storage" || progress === "completed") {
        expect(outcomes).not.toHaveBeenCalled();
        expect(storage.set).not.toHaveBeenCalled();
        expect(records.get(event.id)?.status).toBe(progress === "completed" ? "completed" : "failed");
      } else {
        await vi.waitFor(() => expect(outcomes).toHaveBeenCalledWith({ status: "success", event, rumor }));
        if (progress !== "no-store") expect(records.get(event.id)?.status).toBe("completed");
      }
      subscription.unsubscribe();
    },
  );

  it("gates reactive and explicit processing behind the same restoration", async () => {
    const gate = deferred<GiftWrapProcessingRecord[]>();
    const storage = { list: vi.fn(() => gate.promise), set: vi.fn() };
    const { receiver } = setup({ processingStore: storage, autoUnlock: true });
    await receiver.ingest((await envelope()).event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const subscription = receiver.receive$.subscribe();
    const pull = receiver.readNext();
    await Promise.resolve();
    expect(decrypt).not.toHaveBeenCalled();
    expect(storage.list).toHaveBeenCalledTimes(1);
    gate.resolve([]);
    await pull;
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(2));
    subscription.unsubscribe();
  });

  it("waits for durable completion before publishing or returning success", async () => {
    const { storage } = processingStorage();
    const gate = deferred<void>();
    const write = storage.set;
    storage.set = vi.fn(async (record) => {
      if (record.status === "completed") await gate.promise;
      await write(record);
    });
    const { receiver } = setup({ processingStore: storage });
    await receiver.ready();
    const results = vi.fn();
    const subscription = receiver.receive$.subscribe(results);
    const done = vi.fn();
    const unlock = receiver.unlock((await envelope()).event).then(done);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" })));
    expect(done).not.toHaveBeenCalled();
    expect(results).not.toHaveBeenCalled();
    gate.resolve();
    await unlock;
    expect(results).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it("recovers a failed completion checkpoint after reload without decrypting or storing again", async () => {
    const { storage, records } = processingStorage();
    const write = storage.set;
    storage.set = vi.fn((record) => {
      if (record.status === "completed") throw new Error("checkpoint offline");
      return write(record);
    });
    const rumorStore = new RumorStore();
    disposables.push(rumorStore);
    const { event, rumor } = await envelope();
    const first = setup({ processingStore: storage, rumorStore }).receiver;
    await first.ingest(event);
    expect(await first.readNext()).toMatchObject({ status: "failed", failure: { code: "persistence-failed" } });
    expect(records.get(event.id)).toMatchObject({ status: "failed", rumorId: rumor.id });
    first.dispose();
    storage.set = write;

    const second = setup({ processingStore: storage, rumorStore }).receiver;
    await second.ingest(JSON.parse(JSON.stringify(event)));
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    const add = vi.spyOn(rumorStore, "add");
    expect(await second.retry(event.id)).toMatchObject({ status: "success", rumor });
    expect(decrypt).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("keeps failures and attempt budgets across reloads", async () => {
    const { storage, records } = processingStorage();
    const { event } = await envelope();
    const first = setup({ processingStore: storage }).receiver;
    await first.ingest(event);
    vi.spyOn(recipient.nip44, "decrypt").mockRejectedValue(new Error("signer offline"));
    await first.readNext();
    first.dispose();
    const second = setup({ processingStore: storage }).receiver;
    await second.ingest(JSON.parse(JSON.stringify(event)));
    expect(await second.readNext()).toBeUndefined();
    expect((await firstValueFrom(second.decryptionState$)).errors.get(event.id)).toMatchObject({ attempts: 1 });
    await second.retry(event.id);
    expect(records.get(event.id)).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("does not consume attempts on passive cache misses", async () => {
    const { storage, records } = processingStorage();
    const cache = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const { event } = await envelope();
    const { receiver } = setup({ processingStore: storage, decryptionCache: cache });
    await receiver.ingest(event);
    const subscription = receiver.receive$.subscribe();
    await vi.waitFor(() => expect(cache.getItem).toHaveBeenCalled());
    expect(records.size).toBe(0);
    subscription.unsubscribe();
    await receiver.unlock(event);
    expect(records.get(event.id)?.attempts).toBe(1);
  });

  it("resumes an interrupted attempt and preserves completion through memory eviction", async () => {
    const { storage, records } = processingStorage();
    const { event } = await envelope();
    records.set(event.id, { version: 1, eventId: event.id, status: "processing", stage: "seal", attempts: 1 });
    const { receiver, eventStore } = setup({ processingStore: storage });
    await receiver.unlock(event);
    expect(records.get(event.id)).toMatchObject({ status: "completed", attempts: 2 });
    const subscription = receiver.receive$.subscribe();
    await receiver.ready();
    eventStore.remove(event);
    await receiver.ingest(JSON.parse(JSON.stringify(event)));
    expect(await receiver.readNext()).toBeUndefined();
    expect(records.get(event.id)?.status).toBe("completed");
    subscription.unsubscribe();
  });

  it("restores the remaining backoff rather than resetting it on reload", async () => {
    const { storage, records } = processingStorage();
    const { event } = await envelope();
    records.set(event.id, {
      version: 1,
      eventId: event.id,
      status: "failed",
      stage: "wrap",
      attempts: 1,
      retryAt: Date.now() + 1000,
      failure: {
        eventId: event.id,
        stage: "wrap",
        code: "timeout",
        attempts: 1,
        retry: "automatic",
        message: "timeout",
      },
    });
    const { receiver } = setup({ processingStore: storage, retryPolicy: { maxAttempts: 2 } });
    await receiver.ingest(event);
    const decrypt = vi.spyOn(recipient.nip44, "decrypt");
    vi.useFakeTimers();
    await receiver.ready();
    await vi.advanceTimersByTimeAsync(500);
    expect(decrypt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(records.get(event.id)).toMatchObject({ status: "completed", attempts: 2 });
  });
});

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

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "authenticates independently of an active decrypt with autoAuth=%s and extraRelay=%s",
    async (autoAuth, extraRelay) => {
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
      const { receiver } = setup({
        pool: pool as unknown as RelayPool,
        relays: extraRelay ? [] : [relay.url],
        extraRelays: extraRelay ? [relay.url] : [],
        autoAuth,
      });
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
    },
  );

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
    const { receiver } = setup({ decryptionTimeout: 50, decryptionConcurrency: 1 });
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
    const { receiver } = setup({ autoUnlock: true, decryptionConcurrency: 1 });
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
