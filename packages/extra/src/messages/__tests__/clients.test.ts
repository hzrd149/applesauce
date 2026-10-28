import { EventStore } from "applesauce-core";
import {
  finalizeEvent,
  getEncryptedContent,
  getEventHash,
  kinds,
  unixNow,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { GiftWrapFactory, LegacyMessageFactory, WrappedMessageFactory } from "applesauce-common/factories";
import { getConversationParticipants, getGiftWrapSeal, unlockGiftWrap } from "applesauce-common/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";
import {
  BehaviorSubject,
  EMPTY,
  finalize,
  firstValueFrom,
  lastValueFrom,
  Observable,
  of,
  Subject,
  Subscription,
  toArray,
} from "rxjs";
import type { SyncAuthHandler } from "applesauce-loaders/loaders";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient, WrappedMessagePublicationError, WrappedMessagesClient } from "../index.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const aliceSigner = new PrivateKeySigner(aliceKey);
const bobSigner = new PrivateKeySigner(bobKey);
const alice = await aliceSigner.getPublicKey();
const bob = await bobSigner.getPublicKey();
const disposables: { dispose(): void }[] = [];
afterEach(() => {
  disposables.splice(0).forEach((client) => client.dispose());
  vi.restoreAllMocks();
});

function setup() {
  const eventStore = new EventStore();
  for (const key of [aliceKey, bobKey])
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
  const request = vi.fn(() => EMPTY);
  const pool = {
    req: vi.fn(() => of({ type: "EOSE", from: "wss://dm.test/" })),
    subscription: vi.fn(() => new Subject<NostrEvent>()),
    relay: vi.fn(() => ({ getSupported: async () => [], getLimitations: async () => ({ max_limit: 500 }), request })),
    publish: vi.fn(async (_relays: string[], _event: NostrEvent) => [{ from: "wss://dm.test/", ok: true }]),
  };
  const options = { pubkey: alice, signer: aliceSigner, eventStore, pool: pool as unknown as RelayPool, timeout: 5 };
  return { eventStore, pool, request, options };
}

function own<T extends { dispose(): void }>(client: T): T {
  disposables.push(client);
  return client;
}

describe("standalone messaging clients", () => {
  it.each(["legacy", "wrapped"] as const)("reads empty %s history without network work", async (protocol) => {
    const { options, pool } = setup();
    const client = own(protocol === "legacy" ? new LegacyMessagesClient(options) : new WrappedMessagesClient(options));

    const messages = await lastValueFrom(client.readMessages$({ history: true }).pipe(toArray()));

    expect(messages).toEqual([]);
    expect(pool.subscription).not.toHaveBeenCalled();
    expect(pool.req).not.toHaveBeenCalled();
    expect(pool.relay).not.toHaveBeenCalled();
  });

  it.each(["legacy", "wrapped"] as const)("reads new %s store additions without network work", async (protocol) => {
    const { options, pool, eventStore } = setup();
    const client = own(protocol === "legacy" ? new LegacyMessagesClient(options) : new WrappedMessagesClient(options));
    let event: NostrEvent;
    if (protocol === "legacy") {
      event = await LegacyMessageFactory.create(alice, "stored arrival").sign(bobSigner);
    } else {
      const template = await WrappedMessageFactory.create(alice, "stored arrival").as(bobSigner).stamp();
      const rumor = { ...template, id: getEventHash(template) };
      const gift = await GiftWrapFactory.create(bobSigner, alice, rumor);
      event = gift;
    }

    const message = firstValueFrom(client.readMessages$());
    eventStore.add(event);
    await expect(message).resolves.toBeDefined();

    expect(pool.subscription).not.toHaveBeenCalled();
    expect(pool.req).not.toHaveBeenCalled();
    expect(pool.relay).not.toHaveBeenCalled();
  });

  it("owns timeline sessions by subscription and conversation generation", async () => {
    const { options } = setup();
    let activeRequests = 0;
    const request = vi.fn(
      () =>
        new Observable<NostrEvent>(() => {
          activeRequests++;
          return () => {
            activeRequests--;
          };
        }),
    );
    options.pool.request = request;
    const client = own(new LegacyMessagesClient(options));
    const conversation = client.conversation(bob);
    const loader = conversation.createTimelineLoader({ prefetch: 0 });
    const status = loader.status$.subscribe();
    expect(request).not.toHaveBeenCalled();

    const first = loader({ since: 10, until: 20 }).subscribe();
    const second = conversation.createTimelineLoader()({ since: 30, until: 40 }).subscribe();
    await vi.waitFor(() => expect(activeRequests).toBeGreaterThan(0));
    const bothSessions = activeRequests;
    first.unsubscribe();
    await vi.waitFor(() => expect(activeRequests).toBeGreaterThan(0));
    expect(activeRequests).toBeLessThan(bothSessions);

    conversation.stop();
    expect(second.closed).toBe(true);
    expect(activeRequests).toBe(0);
    const restarted = loader({ since: 50, until: 60 }).subscribe();
    await vi.waitFor(() => expect(activeRequests).toBeGreaterThan(0));
    conversation.dispose();
    expect(restarted.closed).toBe(true);
    expect(activeRequests).toBe(0);
    expect(() => conversation.createTimelineLoader()).toThrow("Conversation disposed");
    status.unsubscribe();
  });

  it("loads scoped timeline cache windows into the shared conversation store", async () => {
    const { options, eventStore } = setup();
    const message = await LegacyMessageFactory.create(alice, "cached window").sign(bobSigner);
    const cacheRequest = vi.fn(() => [message]);
    options.pool.request = vi.fn(() => EMPTY);
    const client = own(new LegacyMessagesClient({ ...options, cacheRequest }));
    const conversation = client.conversation(bob);
    const loader = conversation.createTimelineLoader({ prefetch: 0 });
    const session = loader({ since: message.created_at - 10, until: message.created_at + 10 }).subscribe();

    await vi.waitFor(() => expect(eventStore.hasEvent(message.id)).toBe(true));
    expect(await firstValueFrom(conversation.messages$)).toEqual([message]);
    for (const [filters] of cacheRequest.mock.calls as unknown as [Filter[]][]) {
      for (const filter of filters) {
        expect(filter.kinds).toEqual([kinds.EncryptedDirectMessage]);
        expect(filter.authors).toEqual(filter["#p"]?.includes(alice) ? [bob] : [alice]);
        expect(filter.limit).toBe(100);
        expect(filter.until).toBeLessThanOrEqual(message.created_at + 10);
      }
    }
    session.unsubscribe();
  });

  it("follows mailbox relay updates during sync without restarting unchanged relays", async () => {
    const { options, pool, eventStore } = setup();
    const client = own(new LegacyMessagesClient(options));
    const conversation = client.conversation(bob);
    const session = conversation.sync$({ since: 100, until: 200 }).subscribe();
    await vi.waitFor(() => expect(pool.relay).toHaveBeenCalledWith("wss://dm.test/"));
    const originalRequests = pool.relay.mock.calls.filter(([url]) => url === "wss://dm.test/").length;

    eventStore.add(
      finalizeEvent(
        {
          kind: kinds.DirectMessageRelaysList,
          created_at: unixNow() + 1,
          tags: [
            ["relay", "wss://dm.test/"],
            ["relay", "wss://added.test/"],
          ],
          content: "",
        },
        aliceKey,
      ),
    );
    await vi.waitFor(() => expect(pool.relay).toHaveBeenCalledWith("wss://added.test/"));
    expect(pool.relay.mock.calls.filter(([url]) => url === "wss://dm.test/")).toHaveLength(originalRequests);
    expect(session.closed).toBe(false);
    conversation.stop();
    expect(session.closed).toBe(true);
  });

  it("can start live conversation loading without initial history sync", async () => {
    const { options, pool } = setup();
    const client = own(new LegacyMessagesClient(options));
    await client.conversation(bob).start({ history: false });
    expect(pool.subscription).toHaveBeenCalled();
    expect(pool.req).not.toHaveBeenCalled();
    expect(pool.relay).not.toHaveBeenCalled();
  });

  it("keeps wrapped conversation stores local, scoped, deduplicated, and reactive", async () => {
    const { options, eventStore, pool } = setup();
    const client = own(new WrappedMessagesClient(options));
    const template = await WrappedMessageFactory.create(alice, "root").as(bobSigner).stamp();
    const root = { ...template, id: getEventHash(template) };
    const replyTemplate = { ...template, content: "reply", tags: [...template.tags, ["e", root.id]] };
    const reply = { ...replyTemplate, id: getEventHash(replyTemplate) };
    const otherTemplate = await WrappedMessageFactory.create(bob, "self").as(bobSigner).stamp();
    const other = { ...otherTemplate, id: getEventHash(otherTemplate) };
    const gifts = [];
    for (const message of [root, root, other]) {
      const gift = await GiftWrapFactory.create(bobSigner, alice, message);
      await unlockGiftWrap(gift, aliceSigner);
      eventStore.add(gift);
      gifts.push(gift);
    }

    const conversation = client.conversation([bob]);
    expect(client.conversation([bob, alice, bob])).toBe(conversation);
    expect(client.conversation(conversation.id)).toBe(conversation);
    expect(conversation.participants).toEqual([alice, bob].sort());
    await vi.waitFor(() => expect(conversation.eventStore.getByFilters({})).toEqual([root]));
    expect(await firstValueFrom(conversation.messages$)).toEqual([root]);
    expect(pool.subscription).not.toHaveBeenCalled();
    expect(pool.req).not.toHaveBeenCalled();

    const gift = await GiftWrapFactory.create(bobSigner, alice, reply);
    await unlockGiftWrap(gift, aliceSigner);
    eventStore.add(gift);
    await vi.waitFor(() => expect(conversation.eventStore.getByFilters({})).toHaveLength(2));
    expect(await firstValueFrom(conversation.threads$)).toEqual([root]);
    expect(await firstValueFrom(conversation.replies$(root))).toEqual([reply]);
    expect(await firstValueFrom(conversation.eventStore.event(root.id))).toEqual(root);

    eventStore.remove(gifts[0]);
    expect(conversation.eventStore.hasEvent(root.id)).toBe(true);
    eventStore.remove(gifts[1]);
    await vi.waitFor(() => expect(conversation.eventStore.hasEvent(root.id)).toBe(false));
    conversation[Symbol.dispose]();
    expect(conversation.eventStore.getByFilters({})).toEqual([]);
    expect(eventStore.hasEvent(gift.id)).toBe(true);
    const replacement = client.conversation([bob]);
    expect(replacement).not.toBe(conversation);
    client[Symbol.dispose]();
    expect(replacement.isDisposed).toBe(true);
    expect(() => client.conversation([bob])).toThrow("disposed");
  });

  it("binds wrapped conversation sends and replies to their participants", async () => {
    const { options, pool } = setup();
    const client = own(new WrappedMessagesClient(options));
    const conversation = client.conversation([bob]);
    const message = await conversation.send({ content: "hello" });
    expect(getConversationParticipants(message)).toEqual([...conversation.participants]);
    const reply = await conversation.reply(message, { content: "reply" });
    expect(reply.tags).toContainEqual(["e", message.id]);
    await expect(client.conversation([alice]).reply(message, { content: "wrong conversation" })).rejects.toThrow(
      "does not belong",
    );

    const prepared = await conversation.prepareSend({ content: "cancel me" });
    const publications = pool.publish.mock.calls.length;
    conversation.dispose();
    await expect(prepared.publish()).rejects.toThrow();
    await expect(conversation.send({ content: "disposed" })).rejects.toThrow();
    expect(pool.publish).toHaveBeenCalledTimes(publications);
  });

  it.each([LegacyMessagesClient, WrappedMessagesClient])(
    "exposes live authentication requests on %s",
    async (Client) => {
      const { options, pool } = setup();
      const authenticatedPubkeys$ = new BehaviorSubject<string[]>([]);
      const challenge$ = new BehaviorSubject<string | null>("challenge");
      const relay = {
        ...pool.relay(),
        url: "wss://dm.test/",
        authenticatedPubkeys$,
        challenge$,
        auth: vi.fn(),
        authenticate: vi.fn(async () => {
          authenticatedPubkeys$.next([alice]);
          return { ok: true };
        }),
      };
      pool.relay.mockReturnValue(relay);
      pool.subscription.mockImplementation(
        (...args: unknown[]) =>
          new Observable(() => {
            const auth = args[2] as { onAuthRequired: SyncAuthHandler };
            auth.onAuthRequired({
              relay,
              url: relay.url,
              challenge: "challenge",
              requirement: alice,
              missingPubkeys: [alice],
              reason: "auth-required",
            });
          }) as Subject<NostrEvent>,
      );
      const onAuthRequired = vi.fn();
      const client = own(new Client({ ...options, onAuthRequired }));
      await client.start();
      expect(await firstValueFrom(client.authRequests$)).toHaveLength(1);
      expect(onAuthRequired).toHaveBeenCalled();
      expect(relay.authenticate).not.toHaveBeenCalled();
      await client.authenticate(relay.url);
      expect(await firstValueFrom(client.authRequests$)).toEqual([]);
      client.stop();
      expect(challenge$.observed).toBe(false);
    },
  );

  it.each(["conversation", "client"] as const)(
    "mirrors loaded encrypted message lifetimes through %s sends",
    async (sender) => {
      const { options, eventStore, pool } = setup();
      const client = own(new LegacyMessagesClient({ ...options, mirrorExpiration: true }));
      const createdAt = unixNow() - 10;
      const incoming = finalizeEvent(
        {
          kind: kinds.EncryptedDirectMessage,
          created_at: createdAt,
          tags: [
            ["p", alice],
            ["expiration", String(createdAt + 3600)],
          ],
          content: "encrypted content",
        },
        bobKey,
      );
      eventStore.add(incoming);
      const conversation = client.conversation(bob);
      expect(getEncryptedContent(incoming)).toBeUndefined();

      const prepared =
        sender === "conversation"
          ? await conversation.prepareSend({ content: "reply" })
          : await client.prepareSend({ recipient: bob, content: "reply" });
      expect(prepared.message.tags).toContainEqual(["expiration", String(prepared.message.created_at + 3600)]);
      expect(pool.subscription).not.toHaveBeenCalled();

      const explicit = await conversation.prepareSend({ content: "explicit", expiration: unixNow() + 7200 });
      expect(explicit.message.tags).toContainEqual(["expiration", String(unixNow() + 7200)]);
    },
  );

  it("uses only the newest available conversation message for expiration mirroring", () => {
    const { options, eventStore } = setup();
    const client = own(new LegacyMessagesClient({ ...options, mirrorExpiration: true }));
    const conversation = client.conversation(bob);
    const createdAt = unixNow() - 10;
    const expiring = finalizeEvent(
      {
        kind: kinds.EncryptedDirectMessage,
        created_at: createdAt,
        content: "encrypted",
        tags: [
          ["p", alice],
          ["expiration", String(createdAt + 3600)],
        ],
      },
      bobKey,
    );
    eventStore.add(expiring);
    expect(conversation.getExpiration(createdAt + 100)).toBe(createdAt + 3700);
    expect(client.conversation(alice).getExpiration()).toBeUndefined();

    const permanent = finalizeEvent(
      {
        kind: kinds.EncryptedDirectMessage,
        created_at: createdAt + 1,
        content: "encrypted",
        tags: [["p", alice]],
      },
      bobKey,
    );
    eventStore.add(permanent);
    expect(conversation.getExpiration()).toBeUndefined();
    eventStore.remove(permanent);
    expect(conversation.getExpiration(createdAt + 100)).toBe(createdAt + 3700);
    eventStore.remove(expiring);
    expect(conversation.getExpiration()).toBeUndefined();
  });

  it("loads a legacy conversation without loading other correspondents or starting the inbox", async () => {
    const { options, pool, request } = setup();
    const cacheRequest = vi.fn(async (_filters: Filter[]) => []);
    const client = own(new LegacyMessagesClient({ ...options, cacheRequest }));
    const conversation = client.conversation(bob);
    expect(client.conversation(bob)).toBe(conversation);
    expect(pool.subscription).not.toHaveBeenCalled();

    await conversation.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(await firstValueFrom(client.status$)).toBe("idle");
    for (const [, filter] of pool.subscription.mock.calls as unknown as [string[], Filter][]) {
      expect(filter.kinds).toEqual([kinds.EncryptedDirectMessage]);
      expect([[alice], [bob]]).toContainEqual(filter.authors);
      expect(filter["#p"]).toEqual(filter.authors?.[0] === alice ? [bob] : [alice]);
    }
    expect(cacheRequest).toHaveBeenCalled();
    for (const [filters] of request.mock.calls as unknown as [Filter[]][]) {
      for (const filter of filters) {
        expect(filter.authors).toHaveLength(1);
        expect(filter["#p"]).toEqual(filter.authors?.[0] === alice ? [bob] : [alice]);
      }
    }
    const filters = cacheRequest.mock.calls[0][0];
    expect(filters).toEqual([
      expect.objectContaining({ authors: [bob], "#p": [alice], since: expect.any(Number) }),
      expect.objectContaining({ authors: [alice], "#p": [bob], since: expect.any(Number) }),
    ]);

    await conversation.loadHistory({ since: 100, until: 200 });
    expect(cacheRequest).toHaveBeenLastCalledWith([
      { kinds: [kinds.EncryptedDirectMessage], authors: [bob], "#p": [alice], since: 100, until: 200 },
      { kinds: [kinds.EncryptedDirectMessage], authors: [alice], "#p": [bob], since: 100, until: 200 },
    ]);
  });

  it("isolates conversation lifetimes and disposes every child with its client", async () => {
    const { options, pool } = setup();
    let active = 0;
    pool.subscription.mockImplementation(() => {
      active++;
      return new Subject<NostrEvent>().pipe(finalize(() => active--)) as Subject<NostrEvent>;
    });
    const client = own(new LegacyMessagesClient({ ...options, fallbackRelays: ["wss://dm.test/"] }));
    const bobConversation = client.conversation(bob);
    const selfConversation = client.conversation(alice);
    await bobConversation.start();
    await bobConversation.start();
    await selfConversation.start();
    expect(active).toBe(4);
    bobConversation.stop();
    expect(active).toBe(2);
    await bobConversation.start();
    expect(active).toBe(4);
    client.dispose();
    expect(active).toBe(0);
    await expect(bobConversation.start()).rejects.toThrow("disposed");
    await expect(selfConversation.start()).rejects.toThrow("disposed");
  });

  it("restores conversation plaintext without signer prompts and reports cache failures without blocking relays", async () => {
    const { options, eventStore, request } = setup();
    const incoming: NostrEvent = JSON.parse(
      JSON.stringify(await LegacyMessageFactory.create(alice, "cached").sign(bobSigner)),
    );
    eventStore.add(incoming);
    const decrypt = vi.spyOn(aliceSigner.nip04, "decrypt");
    const client = own(
      new LegacyMessagesClient({
        ...options,
        cacheRequest: async () => {
          throw new Error("Cache offline");
        },
        decryptionCache: { getItem: async () => "cached", setItem: async () => {} },
      }),
    );
    const conversation = client.conversation(bob);
    const failures: unknown[] = [];
    const subscription = conversation.errors$.subscribe((failure) => failures.push(failure.error));
    await conversation.start();
    await vi.waitFor(() => expect(getEncryptedContent(incoming)).toBe("cached"));
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(decrypt).not.toHaveBeenCalled();
    expect(failures).toContainEqual(new Error("Cache offline"));
    subscription.unsubscribe();
  });

  it("scopes conversation decryption and sending to its correspondent", async () => {
    const { options, eventStore } = setup();
    const incoming: NostrEvent = JSON.parse(
      JSON.stringify(await LegacyMessageFactory.create(alice, "hello").sign(bobSigner)),
    );
    const unrelated: NostrEvent = JSON.parse(
      JSON.stringify(await LegacyMessageFactory.create(alice, "self").sign(aliceSigner)),
    );
    eventStore.add(incoming);
    eventStore.add(unrelated);
    const decrypt = vi.spyOn(aliceSigner.nip04, "decrypt");
    const client = own(new LegacyMessagesClient({ ...options, fallbackRelays: ["wss://dm.test/"] }));
    const conversation = client.conversation(bob);
    expect(await firstValueFrom(conversation.messages$)).toEqual([incoming]);
    await conversation.start();
    client.setAutoUnlock(true);
    await vi.waitFor(() => expect(getEncryptedContent(incoming)).toBe("hello"));
    client.setAutoUnlock(false);
    await conversation.unlock();
    expect(getEncryptedContent(incoming)).toBe("hello");
    expect(decrypt).toHaveBeenCalledTimes(1);
    await expect(conversation.unlock(unrelated)).rejects.toThrow("does not belong");
    const sent = await conversation.send({ content: "reply" });
    expect(sent.tags).toContainEqual(["p", bob]);
    await vi.waitFor(async () => expect(await firstValueFrom(conversation.messages$)).toHaveLength(2));
    const prepared = await conversation.prepareSend({ content: "cancelled" });
    conversation.stop();
    await expect(prepared.publish()).rejects.toThrow();
    conversation.dispose();
    expect(client.conversation(bob)).not.toBe(conversation);
  });

  it("returns native signed legacy events with plaintext available through the cache helper", async () => {
    const { options, pool } = setup();
    const signer = {
      getPublicKey: () => aliceSigner.getPublicKey(),
      signEvent: aliceSigner.signEvent.bind(aliceSigner),
      nip04: aliceSigner.nip04,
    };
    const client = own(new LegacyMessagesClient({ ...options, signer, fallbackRelays: ["wss://dm.test/"] }));
    const event = await client.send({ recipient: bob, content: "native legacy" });

    expect(event).toBe(pool.publish.mock.calls[0][1]);
    expect(event.kind).toBe(kinds.EncryptedDirectMessage);
    expect(event.sig).toHaveLength(128);
    expect(event.content).not.toBe("native legacy");
    expect(getEncryptedContent(event)).toBe("native legacy");
    expect(await lastValueFrom(client.readMessages$({ history: true }))).toBe(event);
    expect(pool.subscription).not.toHaveBeenCalled();
    expect(pool.req).not.toHaveBeenCalled();
    const reply = await client.reply(event, "reply");
    expect(reply.tags).toContainEqual(["p", bob]);
    expect(reply.tags).toContainEqual(["e", event.id]);
  });

  it("returns native wrapped rumors from both publication and decrypted reads", async () => {
    const { options, pool, eventStore } = setup();
    const client = own(new WrappedMessagesClient(options));
    const rumor = await client.send({ recipients: [bob], content: "native wrapped" });

    expect(rumor).toMatchObject({ kind: kinds.PrivateDirectMessage, pubkey: alice, content: "native wrapped" });
    expect(rumor).not.toHaveProperty("sig");
    expect(rumor).not.toHaveProperty("senderPubkey");
    const ownEnvelope = pool.publish.mock.calls
      .map(([, event]) => event)
      .find((event) => event.tags.some((tag) => tag[0] === "p" && tag[1] === alice))!;
    eventStore.add(ownEnvelope);
    const restored = await lastValueFrom(client.readMessages$({ history: true }));
    expect(pool.subscription).not.toHaveBeenCalled();
    expect(pool.req).not.toHaveBeenCalled();
    expect(restored).toEqual(rumor);
    expect([...eventStore.getByFilters({ kinds: [kinds.PrivateDirectMessage, kinds.Seal] })]).toEqual([]);
  });

  it("starts without signer prompts and stops/restarts owned subscriptions", async () => {
    const { options, eventStore, pool } = setup();
    const message = await LegacyMessageFactory.create(alice, "hello").sign(bobSigner);
    // Simulate an event arriving from persistent encrypted storage without symbol caches.
    eventStore.add(JSON.parse(JSON.stringify(message)));
    const decrypt = vi.spyOn(aliceSigner.nip04, "decrypt");
    const client = own(new LegacyMessagesClient({ ...options, fallbackRelays: ["wss://dm.test/"] }));
    await client.start();
    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    expect(decrypt).not.toHaveBeenCalled();
    client.setAutoUnlock(true);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getEncryptedContent(eventStore.getEvent(message.id)!)).toBe("hello"));
    client.stop();
    expect(pool.subscription.mock.results.every((result) => !result.value.observed)).toBe(true);
    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(4);
  });

  it("restores both wrapped layers without decrypting and exposes native rumors", async () => {
    const { options, eventStore } = setup();
    const template = await WrappedMessageFactory.create(alice, "cached").as(bobSigner).stamp();
    const rumor = { ...template, id: getEventHash(template) };
    const gift = await GiftWrapFactory.create(bobSigner, alice, rumor);
    const seal = getGiftWrapSeal(gift)!;
    const cache = new Map([
      [gift.id, JSON.stringify(seal)],
      [seal.id, JSON.stringify(rumor)],
    ]);
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt");
    const client = own(
      new WrappedMessagesClient({
        ...options,
        decryptionCache: {
          getItem: async (id) => cache.get(id) ?? null,
          setItem: async (id, content) => {
            cache.set(id, content);
          },
        },
      }),
    );
    eventStore.add(JSON.parse(JSON.stringify(gift)));
    await client.start();
    await vi.waitFor(async () => expect((await firstValueFrom(client.messages$))[0]?.content).toBe("cached"));
    expect(decrypt).not.toHaveBeenCalled();
    expect((await firstValueFrom(client.conversation$([alice, bob])))[0].id).toBe(rumor.id);
    expect((await firstValueFrom(client.conversation$([alice, bob].sort().join(":"))))[0].id).toBe(rumor.id);
  });

  it("restarts the wrapped inbox and decrypts both layers only after opting in", async () => {
    const { options, eventStore, pool } = setup();
    const template = await WrappedMessageFactory.create(alice, "wrapped hello").as(bobSigner).stamp();
    const rumor = { ...template, id: getEventHash(template) };
    const gift = await GiftWrapFactory.create(bobSigner, alice, rumor);
    eventStore.add(JSON.parse(JSON.stringify(gift)));
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt");
    const client = own(new WrappedMessagesClient(options));

    await client.start();
    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(1);
    expect(decrypt).not.toHaveBeenCalled();
    client.setAutoUnlock(true);
    await vi.waitFor(async () => expect((await firstValueFrom(client.messages$))[0]?.content).toBe("wrapped hello"));
    expect(decrypt).toHaveBeenCalledTimes(2);

    client.stop();
    expect(pool.subscription.mock.results.every((result) => !result.value.observed)).toBe(true);
    await client.start();
    expect(pool.subscription).toHaveBeenCalledTimes(2);
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("loads both legacy conversation directions without wrapped timestamp overlap", async () => {
    const { options, request } = setup();
    const client = own(new LegacyMessagesClient({ ...options, fallbackRelays: ["wss://dm.test/"] }));
    const history = await client.loadHistory({ since: 1_000_000, until: 2_000_000, correspondent: bob });

    expect(history.done).toBe(true);
    expect(history.mailboxes).toHaveLength(2);
    for (const [author, recipient] of [
      [alice, bob],
      [bob, alice],
    ]) {
      expect(request.mock.calls).toContainEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({
              kinds: [kinds.EncryptedDirectMessage],
              authors: [author],
              "#p": [recipient],
              since: 1_000_000,
              until: 2_000_000,
            }),
          ]),
        ]),
      );
    }
  });

  it.each([LegacyMessagesClient, WrappedMessagesClient])(
    "%s does not hydrate events after stop interrupts a pending cache read",
    async (Client) => {
      const { options, eventStore, pool } = setup();
      const event = await LegacyMessageFactory.create(alice, "cached later").sign(bobSigner);
      let resolve!: (events: NostrEvent[]) => void;
      const client = own(
        new Client({
          ...options,
          cacheRequest: () =>
            new Promise((done) => {
              resolve = done;
            }),
        }),
      );
      const starting = client.start();
      client.stop();
      resolve([event]);
      await starting;
      expect(eventStore.getEvent(event.id)).toBeUndefined();
      expect(pool.subscription).not.toHaveBeenCalled();
    },
  );

  it("bounds wrapped history using envelope overlap and keeps plaintext out of the store", async () => {
    const { options, request, eventStore } = setup();
    const client = own(new WrappedMessagesClient(options));
    const status = await lastValueFrom(client.sync$({ since: 1_000_000 }));
    expect(status.done).toBe(true);
    expect(request).toHaveBeenCalled();
    expect(request.mock.calls[0]).toEqual(
      expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ since: 1_000_000 - 172800 })])]),
    );
    expect([...eventStore.getByFilters({ kinds: [kinds.PrivateDirectMessage, kinds.Seal] })]).toEqual([]);
  });

  it("reports a bad decryption and continues to later messages", async () => {
    const { options, eventStore } = setup();
    const bad = finalizeEvent(
      { kind: kinds.EncryptedDirectMessage, tags: [["p", alice]], content: "invalid", created_at: unixNow() },
      bobKey,
    );
    const good = await LegacyMessageFactory.create(alice, "good").sign(bobSigner);
    eventStore.add(bad);
    eventStore.add(JSON.parse(JSON.stringify(good)));
    const client = own(new LegacyMessagesClient(options));
    const errors: unknown[] = [];
    const sub = client.errors$.subscribe((error) => errors.push(error));
    await client.unlock();
    expect(getEncryptedContent(eventStore.getEvent(good.id)!)).toBe("good");
    expect((await firstValueFrom(client.decryptionState$)).failed).toEqual([bad.id]);
    expect(errors).toHaveLength(1);
    sub.unsubscribe();
  });

  it("deduplicates rumors and excludes envelopes for conversations outside the owner's participant set", async () => {
    const { options, eventStore } = setup();
    const template = await WrappedMessageFactory.create(alice, "duplicate envelopes").as(bobSigner).stamp();
    const rumor = { ...template, id: getEventHash(template) };
    const unrelatedTemplate = await WrappedMessageFactory.create(bob, "not Alice's conversation").as(bobSigner).stamp();
    const unrelated = { ...unrelatedTemplate, id: getEventHash(unrelatedTemplate) };
    for (const message of [rumor, rumor, unrelated]) {
      const gift = await GiftWrapFactory.create(bobSigner, alice, message);
      await unlockGiftWrap(gift, aliceSigner);
      eventStore.add(gift);
    }
    const client = own(new WrappedMessagesClient(options));
    expect((await firstValueFrom(client.messages$)).map((message) => message.id)).toEqual([rumor.id]);
  });

  it.each([LegacyMessagesClient, WrappedMessagesClient])(
    "%s continues loading when the encrypted-event cache is unavailable",
    async (Client) => {
      const { options, pool } = setup();
      const client = own(
        new Client({
          ...options,
          cacheRequest: async () => {
            throw new Error("storage offline");
          },
        }),
      );
      const errors: unknown[] = [];
      const subscription = client.errors$.subscribe((error) => errors.push(error));
      await client.start();
      expect(pool.subscription).toHaveBeenCalled();
      expect(errors).toContainEqual(expect.objectContaining({ operation: "restore" }));
      subscription.unsubscribe();
    },
  );

  it("retains identical wrapped envelopes and retries only failed recipients", async () => {
    const { options, pool } = setup();
    const client = own(new WrappedMessagesClient(options));
    const prepared = await client.prepareSend({ recipients: [bob], content: "hello" });
    expect(pool.publish).not.toHaveBeenCalled();
    pool.publish.mockResolvedValueOnce([{ from: "wss://dm.test/", ok: false }]);
    await expect(prepared.publish()).rejects.toBeInstanceOf(WrappedMessagePublicationError);
    expect(prepared.publications.filter((publication) => publication.accepted)).toHaveLength(1);
    expect(pool.publish).toHaveBeenCalledTimes(2);
    const failed = pool.publish.mock.calls[0][1];
    expect((await prepared.publish()).id).toBe(prepared.message.id);
    expect(prepared.publications.every((publication) => publication.accepted)).toBe(true);
    expect(pool.publish.mock.calls[2][1]).toBe(failed);
    await prepared.publish();
    expect(pool.publish).toHaveBeenCalledTimes(3);
  });

  it("cancels a publication between wrapped recipients", async () => {
    const { options, pool } = setup();
    const client = own(new WrappedMessagesClient(options));
    const prepared = await client.prepareSend({ recipients: [bob], content: "cancel" });
    const controller = new AbortController();
    pool.publish.mockImplementationOnce(async () => {
      controller.abort();
      return [{ from: "wss://dm.test/", ok: true }];
    });
    await expect(prepared.publish({ signal: controller.signal })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pool.publish).toHaveBeenCalledTimes(1);
    await prepared.publish();
    expect(pool.publish).toHaveBeenCalledTimes(2);
  });

  it("prepares and retries in the conversation while reporting publication state on the client", async () => {
    const { options, pool } = setup();
    const client = own(new LegacyMessagesClient(options));
    const conversation = client.conversation(bob);
    const clientPrepare = vi.spyOn(client, "prepareSend");
    const clientErrors: unknown[] = [];
    const conversationErrors: unknown[] = [];
    const subscriptions = new Subscription();
    subscriptions.add(client.errors$.subscribe((error) => clientErrors.push(error)));
    subscriptions.add(conversation.errors$.subscribe((error) => conversationErrors.push(error)));
    const signerCalls = vi.spyOn(aliceSigner, "signEvent");
    try {
      const prepared = await conversation.prepareSend({ content: "retry" });
      expect(clientPrepare).not.toHaveBeenCalled();
      expect(pool.publish).not.toHaveBeenCalled();
      expect(await firstValueFrom(conversation.publications$)).toEqual({ [prepared.message.id]: "prepared" });
      expect(await firstValueFrom(client.publications$)).toEqual({ [prepared.message.id]: "prepared" });

      pool.publish.mockResolvedValueOnce([{ from: "wss://dm.test/", ok: false }]);
      await expect(prepared.publish()).rejects.toThrow();
      expect(await firstValueFrom(conversation.publications$)).toEqual({ [prepared.message.id]: "failed" });
      expect(clientErrors).toHaveLength(1);
      expect(conversationErrors).toEqual(clientErrors);

      const [retried] = await conversation.loadPublications();
      expect(retried.message).toBe(prepared.message);
      await retried.publish();
      await prepared.publish();
      expect(signerCalls).toHaveBeenCalledTimes(1);
      expect(pool.publish).toHaveBeenCalledTimes(2);
      expect(await firstValueFrom(client.publications$)).toEqual({ [prepared.message.id]: "accepted" });
    } finally {
      subscriptions.unsubscribe();
    }
  });

  it.each([LegacyMessagesClient, WrappedMessagesClient])(
    "%s keeps completed prepared handles usable after the preparation signal ends",
    async (Client) => {
      const { options } = setup();
      const client = own(new Client(options));
      const controller = new AbortController();
      const prepared =
        client instanceof LegacyMessagesClient
          ? await client.prepareSend({ recipient: bob, content: "prepared" }, { signal: controller.signal })
          : await client.prepareSend({ recipients: [bob], content: "prepared" }, { signal: controller.signal });
      controller.abort();
      expect((await prepared.publish()).id).toBe(prepared.message.id);
    },
  );

  it("prepares a new event each time, even for identical plaintext", async () => {
    const { options } = setup();
    const client = own(new LegacyMessagesClient(options));
    const request = { recipient: bob, content: "same content" };
    const first = await client.prepareSend(request);
    const second = await client.prepareSend(request);
    expect(first.message.id).not.toBe(second.message.id);
    expect((await client.conversation(bob).loadPublications()).map((prepared) => prepared.message.id)).toEqual([
      first.message.id,
      second.message.id,
    ]);
  });

  it("aggregates overlapping publications and cancels only the stopped conversation", async () => {
    const { options, pool } = setup();
    const client = own(new LegacyMessagesClient(options));
    const conversation = client.conversation(bob);
    const self = client.conversation(alice);
    const prepared = await conversation.prepareSend({ content: "bob" });
    const selfPrepared = await self.prepareSend({ content: "self" });
    const finishPublications: (() => void)[] = [];
    pool.publish.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPublications.push(() => resolve([{ from: "wss://dm.test/", ok: true }]));
        }),
    );

    const bobPublishing = prepared.publish();
    const bobResult = expect(bobPublishing).rejects.toThrow();
    const selfPublishing = selfPrepared.publish();
    expect(await firstValueFrom(client.busy$)).toBe(true);
    expect(await firstValueFrom(conversation.busy$)).toBe(true);
    expect(await firstValueFrom(self.busy$)).toBe(true);
    conversation.stop();
    await bobResult;
    expect(await firstValueFrom(conversation.busy$)).toBe(false);
    expect(await firstValueFrom(client.busy$)).toBe(true);
    finishPublications.forEach((finish) => finish());
    await selfPublishing;
    expect(await firstValueFrom(client.busy$)).toBe(false);
    await expect(prepared.publish()).rejects.toThrow();
  });

  it("routes client replies through the conversation and preserves explicit expiration", async () => {
    const { options } = setup();
    const client = own(new LegacyMessagesClient(options));
    const parent = finalizeEvent(
      { kind: kinds.EncryptedDirectMessage, created_at: unixNow(), content: "encrypted", tags: [["p", alice]] },
      bobKey,
    );
    const conversation = client.conversation(bob);
    const reply = vi.spyOn(conversation, "reply");
    const expiration = unixNow() + 3600;
    const message = await client.reply(parent, "reply", { expiration });
    expect(reply).toHaveBeenCalledOnce();
    expect(message.tags).toContainEqual(["expiration", String(expiration)]);
    expect(message.tags).toContainEqual(["e", parent.id]);
    await expect(client.conversation(alice).reply(parent, "wrong conversation")).rejects.toThrow("does not belong");
  });

  it("retries prepared events and exposes outgoing-only conversations", async () => {
    const { options, pool } = setup();
    const client = own(new LegacyMessagesClient(options));
    const request = { recipient: bob, content: "hello" };
    pool.publish.mockResolvedValueOnce([{ from: "wss://dm.test/", ok: false }]);
    const prepared = await client.prepareSend(request);
    await expect(prepared.publish()).rejects.toThrow();
    await prepared.publish();
    await prepared.publish();
    expect(pool.publish).toHaveBeenCalledTimes(2);
    expect(pool.publish.mock.calls[0][1]).toBe(pool.publish.mock.calls[1][1]);
    expect((await firstValueFrom(client.conversations$))[0].participants.sort()).toEqual([alice, bob].sort());
  });

  it.each([LegacyMessagesClient, WrappedMessagesClient])(
    "%s rejects signer identity changes and disposed sends before publication",
    async (Client) => {
      const { options, pool } = setup();
      const client = own(new Client({ ...options, signer: bobSigner }));
      const send = (content: string) =>
        client instanceof LegacyMessagesClient
          ? client.send({ recipient: bob, content })
          : client.send({ recipients: [bob], content });
      await expect(send("wrong owner")).rejects.toThrow("does not match");
      client.dispose();
      await expect(send("closed")).rejects.toThrow("disposed");
      expect(pool.publish).not.toHaveBeenCalled();
    },
  );

  it("keeps wrapped mentions out of the recipient list", async () => {
    const { options, pool } = setup();
    const client = own(new WrappedMessagesClient(options));
    const content = `nostr:${await bobSigner.getPublicKey()}`;
    await client.send({ recipients: [bob], content });
    const rumor = await unlockGiftWrap(pool.publish.mock.calls[0][1], bobSigner);
    expect(getConversationParticipants(rumor).sort()).toEqual([alice, bob].sort());
    expect(rumor.content).toBe(content);
  });
});
