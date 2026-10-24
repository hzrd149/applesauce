import { EventStore } from "applesauce-core";
import { finalizeEvent } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KehtoContext } from "../../types.js";
import { decryptForNapplet, decryptForNapplet$ } from "../encryption.js";

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

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
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
