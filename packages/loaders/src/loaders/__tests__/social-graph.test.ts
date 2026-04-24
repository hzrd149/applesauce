import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { EMPTY, of } from "rxjs";
import { afterEach, describe, expect, it, Mock, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { CacheRequest, NostrRequest } from "../../types.js";
import { createSocialGraphLoader, SocialGraphEventStore } from "../social-graph.js";

afterEach(() => {
  vi.clearAllMocks();
});

async function flushPromises(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("createSocialGraphLoader", () => {
  it("should accept a nostr request and load contact events", async () => {
    const user = new FakeUser();
    const contacts = user.contacts();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(of(contacts));

    const loader = createSocialGraphLoader(request);
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }));
    await flushPromises();

    expect(request).toHaveBeenCalledWith(["wss://relay.com/"], [{ kinds: [kinds.Contacts], authors: [user.pubkey] }]);
    expect(spy.getValues()).toEqual([contacts]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should accept an upstream pool object", async () => {
    const user = new FakeUser();
    const contacts = user.contacts();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(of(contacts));

    const loader = createSocialGraphLoader({ request });
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }));
    await flushPromises();

    expect(request).toHaveBeenCalledOnce();
    expect(spy.getValues()).toEqual([contacts]);
  });

  it("should batch contact list requests for users at the same distance", async () => {
    const root = new FakeUser();
    const user1 = new FakeUser();
    const user2 = new FakeUser();
    const rootContacts = root.contacts([user1.pubkey, user2.pubkey]);
    const request: Mock<NostrRequest> = vi.fn().mockReturnValueOnce(of(rootContacts)).mockReturnValueOnce(EMPTY);

    const loader = createSocialGraphLoader(request, { parallel: 10 });
    subscribeSpyTo(loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }));
    await flushPromises();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]).toEqual([{ kinds: [kinds.Contacts], authors: [user1.pubkey, user2.pubkey] }]);
  });

  it("should add since to contact list filters", async () => {
    const user = new FakeUser();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = createSocialGraphLoader(request);
    subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0, since: 100 }));
    await flushPromises();

    expect(request).toHaveBeenCalledWith(
      ["wss://relay.com/"],
      [{ kinds: [kinds.Contacts], authors: [user.pubkey], since: 100 }],
    );
  });

  it("should use cache results and skip relay requests without since", async () => {
    const user = new FakeUser();
    const contacts = user.contacts();
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(of(contacts));
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = createSocialGraphLoader(request, { cacheRequest });
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }));
    await flushPromises();

    expect(cacheRequest).toHaveBeenCalledWith([{ kinds: [kinds.Contacts], authors: [user.pubkey] }]);
    expect(request).not.toHaveBeenCalled();
    expect(spy.getValues()).toEqual([contacts]);
  });

  it("should still request relays after cache hits when since is set", async () => {
    const user = new FakeUser();
    const cachedContacts = user.event({ kind: kinds.Contacts, created_at: 100 });
    const relayContacts = user.event({ kind: kinds.Contacts, created_at: 200 });
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(of(cachedContacts));
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(of(relayContacts));

    const loader = createSocialGraphLoader(request, { cacheRequest });
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0, since: 150 }));
    await flushPromises();

    expect(cacheRequest).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      ["wss://relay.com/"],
      [{ kinds: [kinds.Contacts], authors: [user.pubkey], since: 150 }],
    );
    expect(spy.getValues()).toEqual([cachedContacts, relayContacts]);
  });

  it("should expand from the event store when relays return nothing", async () => {
    const root = new FakeUser();
    const user = new FakeUser();
    const rootContacts = root.contacts([user.pubkey]);
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);
    const eventStore: SocialGraphEventStore = {
      add: vi.fn((event: NostrEvent) => event),
      getReplaceable: vi.fn((kind: number, pubkey: string) => {
        if (kind === kinds.Contacts && pubkey === root.pubkey) return rootContacts;
        return undefined;
      }),
    };

    const loader = createSocialGraphLoader(request, { eventStore });
    subscribeSpyTo(loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }));
    await flushPromises();

    expect(eventStore.getReplaceable).toHaveBeenCalledWith(kinds.Contacts, root.pubkey);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]).toEqual([{ kinds: [kinds.Contacts], authors: [user.pubkey] }]);
  });

  it("should write contact events to the event store", async () => {
    const user = new FakeUser();
    const contacts = user.contacts();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(of(contacts));
    const eventStore: SocialGraphEventStore = {
      add: vi.fn((event: NostrEvent) => event),
      getReplaceable: vi.fn(),
    };

    const loader = createSocialGraphLoader(request, { eventStore });
    subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }));
    await flushPromises();

    expect(eventStore.add).toHaveBeenCalledWith(contacts);
  });
});
