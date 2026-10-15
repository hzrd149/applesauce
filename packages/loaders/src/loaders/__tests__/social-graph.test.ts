import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { EMPTY, from, map, NEVER, Observable, of, take, throwError, timer } from "rxjs";
import { afterEach, describe, expect, it, Mock, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { CacheRequest, NostrRequest } from "../../types.js";
import { createSocialGraphLoader, SocialGraphEventStore } from "../social-graph.js";

afterEach(() => {
  vi.clearAllMocks();
});

/** Returns the authors requested by every call to a mocked request */
function requestedAuthors(request: Mock<NostrRequest>) {
  return request.mock.calls.map(([, filters]) => filters.flatMap((f: Filter) => f.authors ?? []));
}

describe("createSocialGraphLoader", () => {
  it("should accept a nostr request and load contact events", async () => {
    const user = new FakeUser();
    const contacts = user.contacts();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(of(contacts));

    const loader = createSocialGraphLoader(request);
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }).events$);
    await spy.onComplete();

    expect(request).toHaveBeenCalledWith(["wss://relay.com/"], [{ kinds: [kinds.Contacts], authors: [user.pubkey] }]);
    expect(spy.getValues()).toEqual([contacts]);
  });

  it("should accept an upstream pool object", async () => {
    const user = new FakeUser();
    const contacts = user.contacts();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(of(contacts));

    const loader = createSocialGraphLoader({ request });
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }).events$);
    await spy.onComplete();

    expect(request).toHaveBeenCalledOnce();
    expect(spy.getValues()).toEqual([contacts]);
  });

  it("should batch contact list requests for users at the same distance", async () => {
    const root = new FakeUser();
    const user1 = new FakeUser();
    const user2 = new FakeUser();
    const request: Mock<NostrRequest> = vi
      .fn()
      .mockReturnValueOnce(of(root.contacts([user1.pubkey, user2.pubkey])))
      .mockReturnValueOnce(EMPTY);

    const loader = createSocialGraphLoader(request, { parallel: 10 });
    await subscribeSpyTo(
      loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$,
    ).onComplete();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]).toEqual([{ kinds: [kinds.Contacts], authors: [user1.pubkey, user2.pubkey] }]);
  });

  it("should not request the root again when a contact follows it back", async () => {
    const root = new FakeUser();
    const friend = new FakeUser();
    const request: Mock<NostrRequest> = vi.fn((_relays, filters) => {
      const authors = filters.flatMap((f) => f.authors ?? []);
      if (authors.includes(root.pubkey)) return of(root.contacts([friend.pubkey, root.pubkey]));
      return of(friend.contacts([root.pubkey]));
    });

    const loader = createSocialGraphLoader(request);
    await subscribeSpyTo(
      loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 2 }).events$,
    ).onComplete();

    expect(requestedAuthors(request)).toEqual([[root.pubkey], [friend.pubkey]]);
  });

  it("should request each relay separately", async () => {
    const user = new FakeUser();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = createSocialGraphLoader(request);
    await subscribeSpyTo(
      loader({ pubkey: user.pubkey, relays: ["wss://a.com", "wss://b.com"], distance: 0 }).events$,
    ).onComplete();

    expect(request.mock.calls.map(([relays]) => relays)).toEqual([["wss://a.com/"], ["wss://b.com/"]]);
  });

  it("should not wait for a slow batch before expanding a finished one", async () => {
    const root = new FakeUser();
    const slow = new FakeUser();
    const fast = new FakeUser();
    const next = new FakeUser();
    const request: Mock<NostrRequest> = vi.fn((_relays, filters) => {
      const author = filters[0].authors![0];
      if (author === root.pubkey) return of(root.contacts([slow.pubkey, fast.pubkey]));
      if (author === slow.pubkey) return NEVER;
      if (author === fast.pubkey) return of(fast.contacts([next.pubkey]));
      return EMPTY;
    });

    const loader = createSocialGraphLoader(request, { parallel: 1, concurrency: 2 });
    subscribeSpyTo(loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 2 }).events$);

    await vi.waitFor(() => expect(requestedAuthors(request)).toContainEqual([next.pubkey]));
  });

  it("should limit open requests per relay", async () => {
    const root = new FakeUser();
    const friends = Array.from({ length: 4 }, () => new FakeUser().pubkey);
    let open = 0;
    let maxOpen = 0;
    const request: Mock<NostrRequest> = vi.fn((_relays, filters) => {
      if (filters[0].authors!.includes(root.pubkey)) return of(root.contacts(friends));
      return new Observable<NostrEvent>((observer) => {
        maxOpen = Math.max(maxOpen, ++open);
        const timer = setTimeout(() => observer.complete(), 5);
        return () => {
          open--;
          clearTimeout(timer);
        };
      });
    });

    const loader = createSocialGraphLoader(request, { parallel: 1, concurrency: 4, maxRequestsPerRelay: 2 });
    await subscribeSpyTo(
      loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$,
    ).onComplete();

    expect(request).toHaveBeenCalledTimes(5);
    expect(maxOpen).toBe(2);
  });

  describe("relay result caps", () => {
    it("should re-request users a capped relay dropped with single-author filters", async () => {
      const root = new FakeUser();
      const friends = Array.from({ length: 3 }, () => new FakeUser());
      const lists = new Map(friends.map((f) => [f.pubkey, f.contacts()]));
      const request: Mock<NostrRequest> = vi.fn((_relays, filters) => {
        const authors = filters.flatMap((f) => f.authors ?? []);
        if (authors.includes(root.pubkey)) return of(root.contacts(friends.map((f) => f.pubkey)));
        // A capped relay: fills a 3-event implicit limit with copies of the first list
        if (filters.length === 1) return from([0, 1, 2].map(() => lists.get(authors[0])!));
        return from(authors.map((a) => lists.get(a)!));
      });

      const loader = createSocialGraphLoader(request);
      const spy = subscribeSpyTo(loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$);
      await spy.onComplete();

      expect(request.mock.calls[2][1]).toEqual([
        { kinds: [kinds.Contacts], authors: [friends[1].pubkey] },
        { kinds: [kinds.Contacts], authors: [friends[2].pubkey] },
      ]);
      expect(spy.getValues().map((e) => e.pubkey)).toEqual([root.pubkey, ...friends.map((f) => f.pubkey)]);
    });

    it("should send at most 20 filters per retry request", async () => {
      const root = new FakeUser();
      const first = new FakeUser();
      const friends = [first.pubkey, ...Array.from({ length: 45 }, () => new FakeUser().pubkey)];
      const versions = [100, 200].map((created_at) => first.event({ kind: kinds.Contacts, created_at }));
      const request: Mock<NostrRequest> = vi.fn((_relays, filters) => {
        const authors = filters.flatMap((f) => f.authors ?? []);
        if (authors.includes(root.pubkey)) return of(root.contacts(friends));
        // Capped: two versions of the first user's list and nothing for anyone else
        if (filters.length === 1) return from(versions);
        return EMPTY;
      });

      const loader = createSocialGraphLoader(request);
      await subscribeSpyTo(
        loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$,
      ).onComplete();

      expect(request.mock.calls.slice(2).map(([, filters]) => filters.length)).toEqual([20, 20, 5]);
    });

    it("should not retry a relay that returned one list per user it has", async () => {
      const root = new FakeUser();
      const friends = Array.from({ length: 3 }, () => new FakeUser());
      const request: Mock<NostrRequest> = vi.fn((_relays, filters) => {
        const authors = filters.flatMap((f) => f.authors ?? []);
        if (authors.includes(root.pubkey)) return of(root.contacts(friends.map((f) => f.pubkey)));
        // The last user has no list anywhere
        return from(friends.slice(0, 2).map((f) => f.contacts()));
      });

      const loader = createSocialGraphLoader(request);
      await subscribeSpyTo(
        loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$,
      ).onComplete();

      expect(request).toHaveBeenCalledTimes(2);
    });

    it("should not retry users another relay returned", async () => {
      const root = new FakeUser();
      const friend = new FakeUser();
      const request: Mock<NostrRequest> = vi.fn((relays, filters) => {
        const authors = filters.flatMap((f) => f.authors ?? []);
        if (authors.includes(root.pubkey))
          return relays[0] === "wss://a.com/" ? of(root.contacts([friend.pubkey])) : EMPTY;
        // Relay a looks capped but relay b has the list
        return relays[0] === "wss://a.com/" ? of(root.contacts()) : of(friend.contacts());
      });

      const loader = createSocialGraphLoader(request);
      await subscribeSpyTo(
        loader({ pubkey: root.pubkey, relays: ["wss://a.com", "wss://b.com"], distance: 1 }).events$,
      ).onComplete();

      expect(request).toHaveBeenCalledTimes(4);
    });
  });

  describe("hints", () => {
    it("should send each user only to its own hinted relays", async () => {
      const root = new FakeUser();
      const a = new FakeUser();
      const b = new FakeUser();
      const rootContacts = root.event({
        kind: kinds.Contacts,
        tags: [
          ["p", a.pubkey, "wss://hint-a.com"],
          ["p", b.pubkey, "wss://hint-b.com"],
        ],
      });
      const request: Mock<NostrRequest> = vi.fn((_relays, filters) =>
        filters.flatMap((f) => f.authors ?? []).includes(root.pubkey) ? of(rootContacts) : EMPTY,
      );

      const loader = createSocialGraphLoader(request, { hints: true });
      await subscribeSpyTo(
        loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$,
      ).onComplete();

      const calls = request.mock.calls.slice(1).map(([relays, filters]) => [relays[0], filters[0].authors]);
      expect(calls).toEqual([
        ["wss://relay.com/", [a.pubkey, b.pubkey]],
        ["wss://hint-a.com/", [a.pubkey]],
        ["wss://hint-b.com/", [b.pubkey]],
      ]);
    });

    it("should cap the number of hinted relays", async () => {
      const root = new FakeUser();
      const tags = Array.from({ length: 5 }, (_, i) => ["p", new FakeUser().pubkey, `wss://hint-${i}.com`]);
      const rootContacts = root.event({ kind: kinds.Contacts, tags });
      const request: Mock<NostrRequest> = vi.fn((_relays, filters) =>
        filters.flatMap((f) => f.authors ?? []).includes(root.pubkey) ? of(rootContacts) : EMPTY,
      );

      const loader = createSocialGraphLoader(request, { hints: true, maxHintRelays: 2 });
      await subscribeSpyTo(
        loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$,
      ).onComplete();

      // The base relay plus two hinted relays
      expect(request.mock.calls.slice(1)).toHaveLength(3);
    });
  });

  it("should only emit a follow list when it is newer than the one already loaded", async () => {
    const user = new FakeUser();
    const older = user.event({ kind: kinds.Contacts, created_at: 100 });
    const newer = user.event({ kind: kinds.Contacts, created_at: 200 });
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(from([newer, older, newer]));

    const loader = createSocialGraphLoader(request);
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }).events$);
    await spy.onComplete();

    expect(spy.getValues()).toEqual([newer]);
  });

  it("should add since to contact list filters", async () => {
    const user = new FakeUser();
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = createSocialGraphLoader(request);
    await subscribeSpyTo(
      loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0, since: 100 }).events$,
    ).onComplete();

    expect(request).toHaveBeenCalledWith(
      ["wss://relay.com/"],
      [{ kinds: [kinds.Contacts], authors: [user.pubkey], since: 100 }],
    );
  });

  it("should refresh cached lists from relays with since after the cached list", async () => {
    const user = new FakeUser();
    const contacts = user.event({ kind: kinds.Contacts, created_at: 100 });
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(of(contacts));
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(EMPTY);

    const loader = createSocialGraphLoader(request, { cacheRequest });
    const spy = subscribeSpyTo(loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }).events$);
    await spy.onComplete();

    expect(cacheRequest).toHaveBeenCalledWith([{ kinds: [kinds.Contacts], authors: [user.pubkey] }]);
    expect(request).toHaveBeenCalledWith(
      ["wss://relay.com/"],
      [{ kinds: [kinds.Contacts], authors: [user.pubkey], since: 101 }],
    );
    expect(spy.getValues()).toEqual([contacts]);
  });

  it("should still request relays after cache hits when since is set", async () => {
    const user = new FakeUser();
    const cachedContacts = user.event({ kind: kinds.Contacts, created_at: 100 });
    const relayContacts = user.event({ kind: kinds.Contacts, created_at: 200 });
    const cacheRequest: Mock<CacheRequest> = vi.fn().mockReturnValue(of(cachedContacts));
    const request: Mock<NostrRequest> = vi.fn().mockReturnValue(of(relayContacts));

    const loader = createSocialGraphLoader(request, { cacheRequest });
    const spy = subscribeSpyTo(
      loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0, since: 150 }).events$,
    );
    await spy.onComplete();

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
    await subscribeSpyTo(
      loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).events$,
    ).onComplete();

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
    await subscribeSpyTo(
      loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 }).events$,
    ).onComplete();

    expect(eventStore.add).toHaveBeenCalledWith(contacts);
  });

  describe("status$", () => {
    it("should report found, missing and done", async () => {
      const root = new FakeUser();
      const friend = new FakeUser();
      const request: Mock<NostrRequest> = vi.fn((_relays, filters) =>
        filters.flatMap((f) => f.authors ?? []).includes(root.pubkey) ? of(root.contacts([friend.pubkey])) : EMPTY,
      );

      const loader = createSocialGraphLoader(request);
      const spy = subscribeSpyTo(loader({ pubkey: root.pubkey, relays: ["wss://relay.com"], distance: 1 }).status$);
      await spy.onComplete();

      expect(spy.getLastValue()).toEqual(
        expect.objectContaining({ requested: 2, found: 1, missing: 1, queued: 0, inFlight: 0, done: true }),
      );
      expect(spy.getLastValue()?.relays["wss://relay.com/"]).toEqual(
        expect.objectContaining({ requests: 2, events: 1, errors: 0 }),
      );
    });

    it("should record relay errors and keep loading", async () => {
      const user = new FakeUser();
      const contacts = user.contacts();
      const request: Mock<NostrRequest> = vi.fn((relays) =>
        relays[0] === "wss://bad.com/" ? throwError(() => new Error("offline")) : of(contacts),
      );

      const loader = createSocialGraphLoader(request);
      const { events$, status$ } = loader({
        pubkey: user.pubkey,
        relays: ["wss://bad.com", "wss://good.com"],
        distance: 0,
      });
      const status = subscribeSpyTo(status$);
      const events = subscribeSpyTo(events$);
      await status.onComplete();

      expect(events.getValues()).toEqual([contacts]);
      expect(status.getLastValue()?.relays["wss://bad.com/"]).toEqual(
        expect.objectContaining({ errors: 1, error: new Error("offline") }),
      );
    });

    it("should share one load between events$ and status$", async () => {
      const user = new FakeUser();
      const request: Mock<NostrRequest> = vi.fn().mockReturnValue(
        timer(10).pipe(
          map(() => user.contacts()),
          take(1),
        ),
      );

      const loader = createSocialGraphLoader(request);
      const { events$, status$ } = loader({ pubkey: user.pubkey, relays: ["wss://relay.com"], distance: 0 });
      subscribeSpyTo(events$);
      await subscribeSpyTo(status$).onComplete();

      expect(request).toHaveBeenCalledOnce();
    });
  });
});
