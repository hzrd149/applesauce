import { GiftWrapFactory, WrappedMessageFactory } from "applesauce-common/factories";
import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, NEVER, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDmOptions,
  createWrappedMessageProtocol,
  type NostrMessageProtocolOptions,
} from "../kehto/services/dm.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const aliceSigner = new PrivateKeySigner(aliceKey);
const bobSigner = new PrivateKeySigner(bobKey);
const alice = await aliceSigner.getPublicKey();
const bob = await bobSigner.getPublicKey();
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
});

function setup(options: Partial<NostrMessageProtocolOptions> = {}) {
  const eventStore = new EventStore();
  const pool = {
    req: vi.fn(() => new Subject()),
    publish: vi.fn(async () => [{ ok: true }]),
  };
  const protocol = createWrappedMessageProtocol({
    eventStore,
    pool: pool as unknown as RelayPool,
    signer: aliceSigner,
    timeout: 15,
    decryptionTimeout: 30,
    fallbackRelays: ["wss://fallback.test"],
    ...options,
  });
  const dm = createDmOptions({ protocols: [protocol], routingTimeout: options.timeout ?? 50 }).adapter;
  cleanup.push(() => dm.close?.());
  return { dm, eventStore, pool };
}

async function gift(content: string) {
  const rumor = await WrappedMessageFactory.create([alice], content).as(bobSigner).stamp();
  const wrapped = await GiftWrapFactory.create(bobSigner, alice, rumor);
  // Transport strips the factory’s local decrypted-content symbols.
  return JSON.parse(JSON.stringify(wrapped));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("kehto DM lifecycle", () => {
  it("follows DM relay list updates and tears down the previous request", async () => {
    const { dm, eventStore, pool } = setup();
    await dm.subscribe({}, vi.fn());
    const previous = pool.req.mock.results.at(-1)!.value;
    eventStore.add(
      finalizeEvent(
        {
          kind: kinds.DirectMessageRelaysList,
          created_at: unixNow(),
          tags: [["relay", "wss://inbox.test"]],
          content: "",
        },
        aliceKey,
      ),
    );
    expect(previous.observed).toBe(false);
    expect(pool.req.mock.calls.at(-1)?.[0]).toEqual(["wss://inbox.test/"]);
  });

  it("returns a subscription even when fallback relays never emit", async () => {
    const { dm } = setup({ fallbackRelays: NEVER });
    expect(await dm.subscribe({}, vi.fn())).toHaveProperty("subscriptionId");
  });

  it("bounds account resolution and cleans up failed subscription setup", async () => {
    const account$ = new Subject<never>();
    const { dm, pool } = setup({ account$ });
    await expect(dm.subscribe({}, vi.fn())).rejects.toThrow();
    expect(account$.observed).toBe(false);
    expect(pool.req).not.toHaveBeenCalled();
  });

  it("cancels pending setup when the service closes", async () => {
    const account$ = new Subject<never>();
    const { dm } = setup({ account$ });
    const pending = dm.subscribe({}, vi.fn());
    dm.close?.();
    await expect(pending).rejects.toThrow("closed");
    expect(account$.observed).toBe(false);
    await expect(dm.subscribe({}, vi.fn())).rejects.toThrow("closed");
  });

  it("shares concurrent decryptions and serializes each inbox", async () => {
    const first = await gift("first");
    const second = await gift("second");
    const delayed = deferred<string>();
    const original = aliceSigner.nip44.decrypt.bind(aliceSigner.nip44);
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt");
    decrypt.mockImplementationOnce(() => delayed.promise);
    cleanup.push(() => decrypt.mockRestore());
    const { dm, eventStore } = setup({ decryptionTimeout: 2000 });
    const onMessage = vi.fn();
    await dm.subscribe({}, onMessage);
    await dm.subscribe({}, vi.fn());
    eventStore.add(first);
    eventStore.add(second);
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    delayed.resolve(await original(first.pubkey, first.content));
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2));
    expect(onMessage.mock.calls.map(([message]) => message.content)).toEqual(["first", "second"]);
    expect(decrypt).toHaveBeenCalledTimes(4);
  });

  it("continues past a stalled envelope", async () => {
    const first = await gift("stalled");
    const second = await gift("readable");
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt").mockImplementationOnce(() => new Promise(() => {}));
    cleanup.push(() => decrypt.mockRestore());
    const { dm, eventStore } = setup();
    const onMessage = vi.fn();
    await dm.subscribe({}, onMessage);
    eventStore.add(first);
    eventStore.add(second);
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    expect(onMessage.mock.calls[0][0].content).toBe("readable");
  });

  it("discards pending plaintext and queued decryptions after unsubscribe", async () => {
    const first = await gift("first");
    const second = await gift("second");
    const delayed = deferred<string>();
    const original = aliceSigner.nip44.decrypt.bind(aliceSigner.nip44);
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt");
    decrypt.mockImplementationOnce(() => delayed.promise);
    cleanup.push(() => decrypt.mockRestore());
    const { dm, eventStore } = setup();
    const onMessage = vi.fn();
    const live = await dm.subscribe({}, onMessage);
    eventStore.add(first);
    eventStore.add(second);
    await dm.unsubscribe(live.subscriptionId);
    delayed.resolve(await original(first.pubkey, first.content));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onMessage).not.toHaveBeenCalled();
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("cancels a send during approval even if the same account returns", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(aliceSigner);
    const approval = deferred<boolean>();
    const approve = vi.fn(() => approval.promise);
    const { dm, pool, eventStore } = setup({ signer: signer$, approve });
    for (const key of [aliceKey, bobKey]) {
      eventStore.add(
        finalizeEvent(
          {
            kind: kinds.DirectMessageRelaysList,
            created_at: unixNow(),
            content: "",
            tags: [["relay", "wss://dm.test/"]],
          },
          key,
        ),
      );
    }
    const sending = dm.send({ recipients: [bob], content: "secret" });
    await vi.waitFor(() => expect(approve).toHaveBeenCalled());
    signer$.next(undefined);
    signer$.next(aliceSigner);
    await expect(sending).rejects.toThrow("Account changed");
    approval.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pool.publish).not.toHaveBeenCalled();
  });
  it("cancels history and its relay request immediately on logout", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(aliceSigner);
    const { dm, pool, eventStore } = setup({ signer: signer$, timeout: 2000 });
    eventStore.add(
      finalizeEvent(
        {
          kind: kinds.DirectMessageRelaysList,
          created_at: unixNow(),
          tags: [["relay", "wss://inbox.test"]],
          content: "",
        },
        aliceKey,
      ),
    );
    const history = dm.conversations({});
    await vi.waitFor(() => expect(pool.req).toHaveBeenCalled());
    const relayMessages = pool.req.mock.results.at(-1)!.value;
    signer$.next(undefined);
    await expect(history).rejects.toThrow("Account changed");
    expect(relayMessages.observed).toBe(false);
    expect(signer$.observed).toBe(false);
  });

  it("contains callback exceptions and releases subscription resources", async () => {
    const { dm, pool, eventStore } = setup();
    await dm.subscribe({}, () => {
      throw new Error("Consumer failed");
    });
    eventStore.add(await gift("hello"));
    await vi.waitFor(() => expect(pool.req.mock.results.at(-1)!.value.observed).toBe(false));
    // A failed consumer must not disable the adapter.
    const onMessage = vi.fn();
    await dm.subscribe({}, onMessage);
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
  });
  it("waits for queued history decryptions while closing the relay at EOSE", async () => {
    const wrapped = await gift("history");
    const delayed = deferred<string>();
    const original = aliceSigner.nip44.decrypt.bind(aliceSigner.nip44);
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt").mockImplementationOnce(() => delayed.promise);
    cleanup.push(() => decrypt.mockRestore());
    const { dm, pool, eventStore } = setup({ decryptionTimeout: 2000 });
    eventStore.add(wrapped);
    let completed = false;
    const history = dm.conversations({}).then((result) => {
      completed = true;
      return result;
    });
    await vi.waitFor(() => expect(pool.req).toHaveBeenCalled());
    await vi.waitFor(() => expect(pool.req.mock.results.at(-1)!.value.observed).toBe(false));
    expect(completed).toBe(false);
    delayed.resolve(await original(wrapped.pubkey, wrapped.content));
    expect((await history).conversations).toHaveLength(1);
  });
});
