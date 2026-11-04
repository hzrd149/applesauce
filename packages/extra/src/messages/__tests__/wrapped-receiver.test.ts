import { GiftWrapFactory, WrappedMessageFactory } from "applesauce-common/factories";
import { EventStore } from "applesauce-core";
import { AsyncRumorStore, EventMemory, RumorStore } from "applesauce-core/event-store";
import { finalizeEvent, getEventHash, kinds, unixNow, type NostrEvent, type Rumor } from "applesauce-core/helpers";
import type { SyncAuthHandler } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, EMPTY, firstValueFrom, lastValueFrom, Observable, of, Subject, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GiftWrapReceiver } from "../../gift-wrap/receiver.js";
import type { GiftWrapProcessingRecord } from "../../gift-wrap/types.js";
import { WrappedMessagesClient } from "../wrapped/client.js";

const ownerKey = new Uint8Array(32).fill(31);
const peerKey = new Uint8Array(32).fill(32);
const signer = new PrivateKeySigner(ownerKey);
const peerSigner = new PrivateKeySigner(peerKey);
const pubkey = await signer.getPublicKey();
const peer = await peerSigner.getPublicKey();
const cleanup: (() => void)[] = [];

afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose());
  vi.restoreAllMocks();
});

function own<T extends { dispose(): void }>(value: T): T {
  cleanup.push(() => value.dispose());
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const eventStore = own(new EventStore());
  for (const key of [ownerKey, peerKey]) {
    eventStore.add(
      finalizeEvent(
        {
          kind: kinds.DirectMessageRelaysList,
          created_at: unixNow(),
          content: "",
          tags: [["relay", "wss://inbox.test/"]],
        },
        key,
      ),
    );
  }
  const arrivals = new Subject<NostrEvent>();
  const request = vi.fn(() => EMPTY);
  const pool = {
    subscription: vi.fn((_relays: string[], _filter: unknown, _options: unknown): Observable<NostrEvent> => arrivals),
    relay: vi.fn(() => ({ getSupported: async () => [], getLimitations: async () => ({ max_limit: 500 }), request })),
    req: vi.fn(() => of({ type: "EOSE", from: "wss://inbox.test/" })),
    publish: vi.fn(async (_relays: string[], _event: NostrEvent, _options?: unknown) => [
      { ok: true, from: "wss://inbox.test/" },
    ]),
  };
  const options = { pubkey, signer, eventStore, pool: pool as unknown as RelayPool, timeout: 1000 };
  return { options, eventStore, pool, arrivals };
}

async function envelope(content = crypto.randomUUID()) {
  const template = await WrappedMessageFactory.create(pubkey, content).as(peerSigner).stamp();
  const rumor = { ...template, id: getEventHash(template) };
  const gift = await GiftWrapFactory.create(peerSigner, pubkey, rumor);
  return { rumor, event: JSON.parse(JSON.stringify(gift)) as NostrEvent };
}

describe("wrapped receiver integration", () => {
  it("keeps injected loading and policy app-owned across client start, stop, and disposal", async () => {
    const { options, pool, arrivals } = setup();
    const receiver = own(new GiftWrapReceiver({ ...options, autoUnlock: true }));
    const start = vi.spyOn(receiver, "start");
    const stop = vi.spyOn(receiver, "stop");
    const dispose = vi.spyOn(receiver, "dispose");
    const policy = vi.spyOn(receiver, "setAutoUnlock");
    const client = own(new WrappedMessagesClient({ ...options, receiver, autoUnlock: false }));
    await client.start();
    expect(start).not.toHaveBeenCalled();
    expect(pool.subscription).not.toHaveBeenCalled();
    expect(pool.req).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
    expect(await firstValueFrom(receiver.autoUnlock$)).toBe(true);

    await receiver.start();
    client.stop();
    client.dispose();
    expect(stop).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(arrivals.observed).toBe(true);
    const { event, rumor } = await envelope();
    arrivals.next(event);
    await vi.waitFor(async () => expect(await receiver.rumorStore.getEvent(rumor.id)).toEqual(rumor));
    expect(pool.subscription).toHaveBeenCalledTimes(1);
  });

  it("owns internal receiving, forwards policies, and preserves the logical live lookback", async () => {
    const { options, pool, arrivals } = setup();
    const rumors = own(new RumorStore());
    const client = own(
      new WrappedMessagesClient({
        ...options,
        historySpan: 3600,
        autoUnlock: true,
        receiverOptions: { rumorStore: rumors, autoUnlock: false, decryptionConcurrency: 1 },
      }),
    );
    const disposeRumors = vi.spyOn(rumors, "dispose");
    const before = unixNow();
    await client.start();
    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(1);
    expect(pool.subscription.mock.calls[0][1]).toMatchObject({ since: expect.any(Number) });
    const since = (pool.subscription.mock.calls[0][1] as { since: number }).since;
    expect(since).toBeGreaterThanOrEqual(before - 3600 - 172800);
    expect(since).toBeLessThanOrEqual(unixNow() - 3600 - 172800);
    expect(await firstValueFrom(client.receiver.autoUnlock$)).toBe(false);
    client.stop();
    expect(arrivals.observed).toBe(false);
    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    const lifecycle: string[] = [];
    client.receiver.lifecycle$.subscribe((value) => lifecycle.push(value));
    client.dispose();
    expect(lifecycle.at(-1)).toBe("disposed");
    expect(disposeRumors).not.toHaveBeenCalled();
  });

  it("rejects mismatched injected dependencies", () => {
    const { options } = setup();
    const receiver = own(new GiftWrapReceiver(options));
    for (const mismatch of [{ pubkey: peer }, { eventStore: own(new EventStore()) }, { pool: {} as RelayPool }]) {
      expect(() => new WrappedMessagesClient({ ...options, receiver, ...mismatch })).toThrow("must match");
    }
  });

  it("ends the owned client lifecycle when checkpoint restoration stops receiving", async () => {
    const { options, arrivals } = setup();
    const client = own(
      new WrappedMessagesClient({
        ...options,
        receiverOptions: {
          processingStore: {
            list: () => {
              throw new Error("checkpoint offline");
            },
            set: () => {},
          },
        },
      }),
    );
    await client.start();
    await vi.waitFor(async () => expect(await firstValueFrom(client.status$)).toBe("idle"));
    expect(arrivals.observed).toBe(false);
  });

  it("shares decryption with the app and cancels only the stopped client's reader", async () => {
    const { options } = setup();
    const receiver = own(new GiftWrapReceiver(options));
    const client = own(new WrappedMessagesClient({ ...options, receiver }));
    const { event, rumor } = await envelope();
    const gate = deferred<string>();
    const decrypt = signer.nip44.decrypt.bind(signer.nip44);
    const calls = vi.spyOn(signer.nip44, "decrypt").mockImplementationOnce(() => gate.promise);
    const reading = client.unlock(event);
    const cancelled = expect(reading).rejects.toThrow();
    const appReading = receiver.unlock(event);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    client.stop();
    await cancelled;
    gate.resolve(await decrypt(event.pubkey, event.content));
    expect(await appReading).toEqual(rumor);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(await receiver.rumorStore.getEvent(rumor.id)).toEqual(rumor);
  });

  it("keeps passive views prompt-free and shares active readers without changing auto-unlock", async () => {
    const { options, eventStore, pool } = setup();
    const client = own(new WrappedMessagesClient({ ...options, autoUnlock: true }));
    const { event, rumor } = await envelope();
    eventStore.add(event);
    const decrypt = vi.spyOn(signer.nip44, "decrypt");
    const policy = vi.spyOn(client.receiver, "setAutoUnlock");
    expect(await firstValueFrom(client.messages$)).toEqual([]);
    expect(await firstValueFrom(client.conversations$)).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
    const reads = await Promise.all([
      lastValueFrom(client.readMessages$({ history: true }).pipe(toArray())),
      lastValueFrom(client.readMessages$({ history: true }).pipe(toArray())),
    ]);
    expect(reads).toEqual([[rumor], [rumor]]);
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(policy).not.toHaveBeenCalled();
    expect(pool.subscription).not.toHaveBeenCalled();
  });

  it("keeps finite readers scoped to their initial envelope snapshot", async () => {
    const { options, eventStore } = setup();
    const client = own(new WrappedMessagesClient(options));
    const first = await envelope("first");
    const later = await envelope("later");
    eventStore.add(first.event);
    const gate = deferred<string>();
    const decrypt = signer.nip44.decrypt.bind(signer.nip44);
    const calls = vi.spyOn(signer.nip44, "decrypt").mockImplementationOnce(() => gate.promise);
    const reading = lastValueFrom(client.readMessages$({ history: true }).pipe(toArray()));
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    eventStore.add(later.event);
    gate.resolve(await decrypt(first.event.pubkey, first.event.content));
    expect(await reading).toEqual([first.rumor]);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("reads persisted async rumors without envelopes and mirrors removal and expiration", async () => {
    const { options, pool } = setup();
    const memory = new EventMemory<Rumor>();
    const database = {
      add: async (event: Rumor) => memory.add(event),
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
    const rumorStore = own(new AsyncRumorStore({ database }));
    const receiver = own(new GiftWrapReceiver({ ...options, rumorStore }));
    const created = unixNow() - 10;
    const template = {
      ...(await envelope()).rumor,
      created_at: created,
      tags: [
        ["p", pubkey],
        ["expiration", String(created + 3600)],
      ],
    };
    const rumor = { ...template, id: getEventHash(template) };
    await rumorStore.add(rumor);
    const unrelated = { ...template, kind: 1 };
    await rumorStore.add({ ...unrelated, id: getEventHash(unrelated) });
    const client = own(new WrappedMessagesClient({ ...options, receiver, mirrorExpiration: true }));
    expect(await firstValueFrom(client.messages$)).toEqual([rumor]);
    expect(await lastValueFrom(client.readMessages$({ history: true }).pipe(toArray()))).toEqual([rumor]);
    const conversation = client.conversation(peer);
    await vi.waitFor(() => expect(conversation.eventStore.hasEvent(rumor.id)).toBe(true));
    const prepared = await client.prepareSend({ recipients: [peer], content: "reply" });
    expect(prepared.message.tags).toContainEqual(["expiration", String(prepared.message.created_at + 3600)]);
    await rumorStore.remove(rumor);
    await vi.waitFor(() => expect(conversation.eventStore.hasEvent(rumor.id)).toBe(false));
    const permanent = await client.prepareSend({ recipients: [peer], content: "permanent" });
    expect(permanent.message.tags.some((tag) => tag[0] === "expiration")).toBe(false);
    expect(pool.subscription).not.toHaveBeenCalled();
  });

  it("restores checkpoints and surfaces persistence failures without duplicate client errors", async () => {
    const { options, eventStore } = setup();
    const { event, rumor } = await envelope();
    const rumorStore = own(new RumorStore());
    rumorStore.add(rumor);
    eventStore.add(event);
    const completed: GiftWrapProcessingRecord = {
      version: 1,
      eventId: event.id,
      rumorId: rumor.id,
      status: "completed",
      stage: "checkpoint",
      attempts: 1,
    };
    const processingStore = { list: vi.fn(() => [completed]), set: vi.fn() };
    const client = own(new WrappedMessagesClient({ ...options, receiverOptions: { rumorStore, processingStore } }));
    const decrypt = vi.spyOn(signer.nip44, "decrypt");
    await client.unlock(event);
    expect(decrypt).not.toHaveBeenCalled();
    expect(processingStore.list).toHaveBeenCalledTimes(1);
    const next = await envelope();
    const failure = new Error("checkpoint offline");
    processingStore.set.mockImplementationOnce(() => {
      throw failure;
    });
    const errors: unknown[] = [];
    const subscription = client.errors$.subscribe((error) => errors.push(error));
    cleanup.push(() => subscription.unsubscribe());
    await expect(client.unlock(next.event)).rejects.toBe(failure);
    expect(errors).toEqual([{ operation: "storage", error: failure, eventId: next.event.id }]);
    expect((await firstValueFrom(client.receiver.decryptionState$)).errors.get(next.event.id)).toMatchObject({
      code: "persistence-failed",
    });
    await client.retryDecryption(next.event);
    expect(await rumorStore.getEvent(next.rumor.id)).toEqual(next.rumor);
  });

  it("stores accepted self-copies before start without decryption prompts", async () => {
    const { options, pool } = setup();
    const receiver = own(new GiftWrapReceiver({ ...options, signer: undefined }));
    const client = own(new WrappedMessagesClient({ ...options, receiver }));
    const decrypt = vi.spyOn(signer.nip44, "decrypt");
    const message = await client.send({ recipients: [peer], content: "sent" });
    expect(await receiver.rumorStore.getEvent(message.id)).toEqual(message);
    expect(decrypt).not.toHaveBeenCalled();
    expect(pool.subscription).not.toHaveBeenCalled();
  });

  it("keeps network acceptance intact when self-copy storage fails", async () => {
    const { options, pool } = setup();
    const rumorStore = own(new RumorStore());
    vi.spyOn(rumorStore, "add").mockImplementation(() => {
      throw new Error("rumor store offline");
    });
    const client = own(new WrappedMessagesClient({ ...options, receiverOptions: { rumorStore } }));
    const prepared = await client.prepareSend({ recipients: [peer], content: "accepted" });
    await expect(prepared.publish()).resolves.toEqual(prepared.message);
    expect(prepared.publications.every((publication) => publication.accepted)).toBe(true);
    await prepared.publish();
    expect(pool.publish).toHaveBeenCalledTimes(2);
    expect((await firstValueFrom(client.receiver.decryptionState$)).errors.size).toBe(1);
  });

  it("combines receiving and publication auth and preserves app requests after client stop", async () => {
    const { options, pool } = setup();
    const authenticatedPubkeys$ = new BehaviorSubject<string[]>([]);
    const challenge$ = new BehaviorSubject<string | null>("challenge");
    const relay = {
      ...pool.relay(),
      url: "wss://inbox.test/",
      authenticatedPubkeys$,
      challenge$,
      authenticate: vi.fn(async () => {
        authenticatedPubkeys$.next([pubkey]);
        return { ok: true };
      }),
    };
    pool.relay.mockReturnValue(relay);
    const context = {
      relay,
      url: relay.url,
      challenge: "challenge",
      requirement: pubkey,
      missingPubkeys: [pubkey],
      reason: "auth-required" as const,
    };
    pool.subscription.mockImplementation(
      (_relays, _filter, auth) =>
        new Observable(() => {
          void (auth as { onAuthRequired: SyncAuthHandler }).onAuthRequired(context);
        }),
    );
    pool.publish.mockImplementation(async (_relays, _event, auth) => {
      if (!authenticatedPubkeys$.value.includes(pubkey))
        await (auth as { onAuthRequired: SyncAuthHandler }).onAuthRequired(context);
      return [{ ok: true, from: relay.url }];
    });
    const receiver = own(new GiftWrapReceiver(options));
    const client = own(new WrappedMessagesClient({ ...options, receiver }));
    await receiver.start();
    const publishing = client.send({ recipients: [peer], content: "auth" });
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));
    expect(await firstValueFrom(client.authRequests$)).toHaveLength(1);
    const batch = client.authenticateAll();
    await client.authenticate(relay.url);
    expect(await batch).toEqual([{ url: relay.url, status: "authenticated" }]);
    await publishing;
    expect(relay.authenticate).toHaveBeenCalledTimes(1);

    authenticatedPubkeys$.next([]);
    receiver.stop();
    await receiver.start();
    client.stop();
    expect(await firstValueFrom(receiver.authRequests$)).toHaveLength(1);
    await receiver.authenticate(relay.url);
    expect(relay.authenticate).toHaveBeenCalledTimes(2);
  });
});
