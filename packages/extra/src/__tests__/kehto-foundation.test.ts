import { decryptForNapplet, decryptForNapplet$ } from "../kehto/foundation/encryption.js";
import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, firstValueFrom, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishThroughStore, subscribeThroughStore } from "../kehto/foundation/pool.js";
import { getStoredOutboxes, selectReadRelays, selectRelayTier } from "../kehto/foundation/relays.js";
import { createApprovingSigner, createKehtoSigner, signForNapplet } from "../kehto/foundation/signer.js";
import { createKehtoAccount$, kehtoAccount$, type KehtoAccount } from "../kehto/foundation/account.js";
import type { KehtoContext } from "../kehto/types.js";

const alice = new PrivateKeySigner(new Uint8Array(32).fill(1));
const bob = new PrivateKeySigner(new Uint8Array(32).fill(2));
const pk = (signer: PrivateKeySigner) => getPublicKey(signer.key);

/** A fake pool whose req() messages are pushed by the test */
function fakePool() {
  const req$ = new Subject<any>();
  return {
    req$,
    req: vi.fn(() => req$),
    request: vi.fn(),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
    count: vi.fn(),
  };
}

let store: EventStore;
let pool: ReturnType<typeof fakePool>;
const create = (ctx: Partial<KehtoContext> = {}): KehtoContext => ({
  pool: pool as unknown as RelayPool,
  eventStore: store,
  ...ctx,
});
const relayList = (key: Uint8Array, tags: string[][]) =>
  finalizeEvent({ kind: kinds.RelayList, created_at: unixNow(), content: "", tags }, key);

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
});
describe("createKehtoAccount$", () => {
  it("clears the previous account synchronously and follows signer changes", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(alice);
    const accounts: (KehtoAccount | undefined)[] = [];
    const sub = createKehtoAccount$(signer$).subscribe((account) => accounts.push(account));
    await vi.waitFor(() => expect(accounts.at(-1)?.pubkey).toBe(pk(alice)));

    signer$.next(bob);
    expect(accounts.at(-1)).toBeUndefined();
    await vi.waitFor(() => expect(accounts.at(-1)).toEqual({ signer: bob, pubkey: pk(bob) }));

    signer$.next(undefined);
    expect(accounts.at(-1)).toBeUndefined();
    sub.unsubscribe();
    expect(signer$.observed).toBe(false);
  });

  it("ignores delayed pubkeys from a previous signer and handles resolution failures", async () => {
    let resolve!: (pubkey: string) => void;
    const delayed = {
      ...alice,
      getPublicKey: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    };
    const signer$ = new BehaviorSubject<import("applesauce-signers").ISigner | undefined>(delayed);
    const accounts: (KehtoAccount | undefined)[] = [];
    const sub = createKehtoAccount$(signer$).subscribe((account) => accounts.push(account));
    signer$.next(bob);
    await vi.waitFor(() => expect(accounts.at(-1)?.pubkey).toBe(pk(bob)));
    resolve(pk(alice));
    await Promise.resolve();
    expect(accounts.at(-1)?.pubkey).toBe(pk(bob));

    signer$.next({
      ...delayed,
      getPublicKey: () => {
        throw new Error("unavailable");
      },
    });
    await vi.waitFor(() => expect(accounts.at(-1)).toBeUndefined());
    sub.unsubscribe();
  });
});

describe("signForNapplet", () => {
  it("restamps created_at after approval", async () => {
    const state = create({ signer: alice, approve: () => true });
    const event = await signForNapplet(
      alice,
      { kind: 1, content: "hi", tags: [], created_at: 1 },
      { approve: state.approve },
    );
    expect(event.created_at).toBeGreaterThan(1);
    expect(event.pubkey).toBe(pk(alice));
  });

  it("throws when the host denies the request", async () => {
    const approve = vi.fn(() => false);
    await expect(
      signForNapplet(alice, { kind: 1, content: "", tags: [], created_at: 1 }, { approve, windowId: "win" }),
    ).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledWith({
      windowId: "win",
      template: { kind: 1, content: "", tags: [], created_at: 1 },
    });
  });

  it("returns null without a signer", () => {
    expect(createKehtoSigner(undefined, { eventStore: store })).toBeNull();
  });
});

describe("signer account consistency", () => {
  it("keeps the captured account when the host switches accounts during approval", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(alice);
    const approve = vi.fn(() => {
      signer$.next(bob);
      return true;
    });
    const state = create({ signer: signer$, approve });
    const account = await firstValueFrom(kehtoAccount$(state));
    const signer = createApprovingSigner(account?.signer, { approve })!;
    const event = await signer.signEvent({ kind: 1, content: "hello", tags: [], created_at: 1 });

    expect(signer$.value).toBe(bob);
    expect(await signer.getPublicKey()).toBe(pk(alice));
    expect(event.pubkey).toBe(pk(alice));
  });

  it("reads relay permissions for the captured signer before shared pubkey resolution", async () => {
    store.add(relayList(alice.key, [["r", "wss://alice.relay.com/", "write"]]));
    const signer = createKehtoSigner(alice, { eventStore: store })!;

    expect(await signer.getRelays!()).toEqual({
      "wss://alice.relay.com/": { read: false, write: true },
    });
  });
});

describe("relay selection", () => {
  it("reads from the authors' stored outboxes and publishes to the user's outboxes", async () => {
    store.add(relayList(bob.key, [["r", "wss://bob.relay.com/", "write"]]));
    store.add(relayList(alice.key, [["r", "wss://alice.relay.com/"]]));

    expect(getStoredOutboxes(store, pk(bob))).toEqual(["wss://bob.relay.com/"]);
    expect(selectReadRelays(store, [{ authors: [pk(bob)] }], pk(alice))).toEqual(["wss://bob.relay.com/"]);
    expect(selectRelayTier(store, [], pk(alice), ["wss://fallback.relay.com/"])).toEqual(["wss://alice.relay.com/"]);
  });

  it("uses the fallback relays when nothing is known", () => {
    expect(selectRelayTier(store, [], pk(alice), ["wss://fallback.relay.com/"])).toEqual(["wss://fallback.relay.com/"]);
    expect(selectReadRelays(store, [{ kinds: [1] }], undefined, ["wss://fallback.relay.com/"])).toEqual([
      "wss://fallback.relay.com/",
    ]);
  });
});

describe("subscribeThroughStore", () => {
  const note = (content: string): NostrEvent =>
    finalizeEvent({ kind: 1, created_at: unixNow(), content, tags: [] }, alice.key);

  it("emits stored events, adds relay events to the store and sends EOSE once every relay finishes", () => {
    const stored = store.add(note("stored"))!;
    const items: (NostrEvent | "EOSE")[] = [];
    const sub = subscribeThroughStore(
      { eventStore: store, pool: pool as unknown as RelayPool },
      ["wss://a/", "wss://b/"],
      [{ kinds: [1] }],
    ).subscribe((i) => items.push(i));

    const live = note("live");
    pool.req$.next({ type: "EVENT", from: "wss://a/", id: "x", event: live });
    pool.req$.next({ type: "EOSE", from: "wss://a/", id: "x" });
    expect(items).toEqual([stored, live]);
    pool.req$.next({ type: "EOSE", from: "wss://b/", id: "x" });
    expect(items.at(-1)).toBe("EOSE");
    expect(store.hasEvent(live.id)).toBe(true);
    sub.unsubscribe();
  });

  it("sends EOSE after the timeout when relays never finish", () => {
    vi.useFakeTimers();
    const items: unknown[] = [];
    const sub = subscribeThroughStore(
      { eventStore: store, pool: pool as unknown as RelayPool, timeout: 100 },
      ["wss://a/"],
      [{ kinds: [1] }],
    ).subscribe((i) => items.push(i));
    vi.advanceTimersByTime(100);
    expect(items).toEqual(["EOSE"]);
    sub.unsubscribe();
    vi.useRealTimers();
  });
});

describe("publishThroughStore", () => {
  it("throws when no relay accepts the event", async () => {
    pool.publish.mockResolvedValueOnce([{ from: "wss://a/", ok: false, message: "blocked" }] as any);
    const event = finalizeEvent({ kind: 1, created_at: unixNow(), content: "", tags: [] }, alice.key);
    await expect(
      publishThroughStore({ eventStore: store, pool: pool as unknown as RelayPool }, ["wss://a/"], event),
    ).rejects.toThrow("blocked");
    expect(store.hasEvent(event.id)).toBe(true);
  });
});

describe("napplet decryption", () => {
  it("starts on subscription, shares concurrent work and suppresses delivery after unsubscribe", async () => {
    let resolve!: (content: string) => void;
    const decrypt = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const signer = { ...bob, getPublicKey: () => bob.getPublicKey(), nip04: { ...bob.nip04, decrypt } };
    const state = create({ signer });
    const event = finalizeEvent({ kind: 4, content: "ciphertext", tags: [["p", pk(bob)]], created_at: 1 }, alice.key);
    const read$ = decryptForNapplet$(state, event);
    expect(decrypt).not.toHaveBeenCalled();

    const first = vi.fn();
    const second = vi.fn();
    const a = read$.subscribe(first);
    const b = read$.subscribe(second);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));

    a.unsubscribe();
    resolve("secret");
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith({ ...event, content: "secret" }));
    expect(first).not.toHaveBeenCalled();
    b.unsubscribe();
  });

  it("cancels pending plaintext delivery when the account changes", async () => {
    let resolve!: (content: string) => void;
    const decrypt = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const owner = {
      getPublicKey: () => bob.getPublicKey(),
      signEvent: bob.signEvent.bind(bob),
      nip04: { ...bob.nip04, decrypt },
    };
    const signer$ = new BehaviorSubject<import("applesauce-signers").ISigner | undefined>(owner);
    const context = create({ signer: signer$ });
    const event = finalizeEvent({ kind: 4, content: "ciphertext", tags: [["p", pk(bob)]], created_at: 1 }, alice.key);
    const received = vi.fn();
    const subscription = decryptForNapplet$(context, event).subscribe(received);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledOnce());

    signer$.next(alice);
    expect(received).toHaveBeenCalledExactlyOnceWith(event);
    resolve("private to bob");
    await Promise.resolve();
    expect(received).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
    expect(signer$.observed).toBe(false);
  });

  it.each(["nip04", "nip44"] as const)(
    "decrypts %s using an account-scoped cache without changing stored content",
    async (method) => {
      const content = await alice[method].encrypt(pk(bob), "secret");
      const event = store.add(
        finalizeEvent(
          { kind: method === "nip04" ? 4 : 1059, content, tags: [["p", pk(bob)]], created_at: 1 },
          alice.key,
        ),
      )!;
      const values = new Map<string, string>();
      const cache = {
        getItem: vi.fn(async (key: string) => values.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => {
          values.set(key, value);
        }),
      };
      const state = create({ signer: bob, decryptionCache: cache });
      expect((await decryptForNapplet(state, event)).content).toBe("secret");
      expect((await decryptForNapplet(state, event)).content).toBe("secret");
      expect(cache.setItem).toHaveBeenCalledExactlyOnceWith(`${pk(bob)}:${event.id}`, "secret");
      expect(event.content).toBe(content);
      expect(await decryptForNapplet(create({ signer: bob, decrypt: false }), event)).toBe(event);
      expect(await decryptForNapplet(create(), event)).toBe(event);
    },
  );

  it("keeps pending decryptions scoped to the cache captured by each read", async () => {
    let resolve!: (content: string) => void;
    const decrypt = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const signer = { getPublicKey: () => bob.getPublicKey(), signEvent: bob.signEvent.bind(bob), nip04: { decrypt } };
    const firstCache = { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) };
    const secondCache = { getItem: vi.fn(async () => "second cached"), setItem: vi.fn(async () => {}) };
    const cache$ = new BehaviorSubject<import("applesauce-common/helpers").EncryptedContentCache>(firstCache);
    const context = create({ signer, decryptionCache: cache$ });
    const event = finalizeEvent({ kind: 4, content: "ciphertext", tags: [["p", pk(bob)]], created_at: 1 }, alice.key);
    const pending = decryptForNapplet(context, event);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledOnce());

    cache$.next(secondCache);
    expect((await decryptForNapplet(context, event)).content).toBe("second cached");
    resolve("first plaintext");
    expect((await pending).content).toBe("first plaintext");
    expect(firstCache.setItem).toHaveBeenCalledExactlyOnceWith(`${pk(bob)}:${event.id}`, "first plaintext");
    expect(secondCache.setItem).not.toHaveBeenCalled();
  });

  it("uses the reactive cache for each account and supports disabling the cache", async () => {
    const content = await alice.nip04.encrypt(pk(bob), "secret");
    const event = finalizeEvent({ kind: 4, content, tags: [["p", pk(bob)]], created_at: 1 }, alice.key);
    const aliceCache = { getItem: vi.fn(async () => "alice cached"), setItem: vi.fn(async () => {}) };
    const bobCache = { getItem: vi.fn(async () => "bob cached"), setItem: vi.fn(async () => {}) };
    const cache$ = new BehaviorSubject<typeof aliceCache | undefined>(bobCache);
    const signer$ = new BehaviorSubject(bob);
    const context = create({ signer: signer$, decryptionCache: cache$ });

    expect((await decryptForNapplet(context, event)).content).toBe("bob cached");
    expect(bobCache.getItem).toHaveBeenCalledExactlyOnceWith(`${pk(bob)}:${event.id}`);

    cache$.next(aliceCache);
    signer$.next(alice);
    expect((await decryptForNapplet(context, event)).content).toBe("alice cached");
    expect(aliceCache.getItem).toHaveBeenCalledExactlyOnceWith(`${pk(alice)}:${event.id}`);

    cache$.next(undefined);
    expect((await decryptForNapplet(context, event)).content).toBe("secret");
    expect(aliceCache.setItem).not.toHaveBeenCalled();
    expect(bobCache.setItem).not.toHaveBeenCalled();
    expect(cache$.observed).toBe(false);
  });

  it("decrypts outgoing messages with the recipient key and leaves failures unchanged", async () => {
    const content = await alice.nip04.encrypt(pk(bob), "outgoing");
    const event = finalizeEvent({ kind: 4, content, tags: [["p", pk(bob)]], created_at: 1 }, alice.key);
    expect((await decryptForNapplet(create({ signer: alice }), event)).content).toBe("outgoing");
    const broken = { ...event, content: "invalid" };
    expect(await decryptForNapplet(create({ signer: bob }), broken)).toBe(broken);
  });
});
