import { unlockGiftWrap } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createKehtoShellAdapter } from "../../index.js";
import type { KehtoContext } from "../../types.js";
import { createDmOptions, createWrappedMessageProtocol, type NostrMessageProtocolOptions } from "../dm.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const alice = getPublicKey(aliceKey);
const bob = getPublicKey(bobKey);
const signer = new PrivateKeySigner(aliceKey);

function createTestDmOptions(options: NostrMessageProtocolOptions & { getWindowId?: () => string | undefined }) {
  for (const key of [aliceKey, bobKey]) {
    const pubkey = getPublicKey(key);
    if ([...options.eventStore.getByFilters({ kinds: [kinds.DirectMessageRelaysList], authors: [pubkey] })].length)
      continue;
    options.eventStore.add(
      finalizeEvent(
        {
          kind: kinds.DirectMessageRelaysList,
          created_at: unixNow(),
          content: "",
          tags: [["relay", "wss://dm.relay.com/"]],
        },
        key,
      ),
    );
  }
  return createDmOptions({
    protocols: [createWrappedMessageProtocol({ fallbackRelays: ["wss://fallback.relay.com/"], ...options })],
    routingTimeout: 200,
    getWindowId: options.getWindowId,
  });
}

function fakePool() {
  return {
    subscription: vi.fn(() => new Subject()),
    request: vi.fn(),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
    count: vi.fn(),
  };
}

let store: EventStore;
let pool: ReturnType<typeof fakePool>;
let adapters: ReturnType<typeof createKehtoShellAdapter>[];
async function create(ctx: Partial<KehtoContext> = {}): Promise<KehtoContext> {
  return { pool: pool as unknown as RelayPool, eventStore: store, signer, timeout: 50, ...ctx };
}
const event = (key: Uint8Array, kind: number, tags: string[][] = [], content = "") =>
  store.add(finalizeEvent({ kind, created_at: unixNow(), content, tags }, key))!;

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
  adapters = [];
  event(aliceKey, kinds.RelayList, [["r", "wss://alice.relay.com/"]]);
  event(bobKey, kinds.RelayList, [
    ["r", "wss://bob-in.relay.com/", "read"],
    ["r", "wss://bob-out.relay.com/", "write"],
  ]);
});
afterEach(() => {
  for (const adapter of adapters) adapter.stop();
});

describe("remaining write services", () => {
  it("round-trips encrypted DMs and tears down live subscriptions", async () => {
    const state = await create({ fallbackRelays: ["wss://fallback.relay.com/"] });
    const dm = createTestDmOptions(state).adapter;
    const result = await dm.send({ recipients: [bob], content: "hello" });
    expect(result.ok).toBe(true);
    const gifts = [...store.getByFilters({ kinds: [kinds.GiftWrap] })];
    expect(gifts).toHaveLength(2);
    const received = gifts.find((gift) => gift.tags.some((tag) => tag[0] === "p" && tag[1] === bob))!;
    expect((await unlockGiftWrap(received, new PrivateKeySigner(bobKey))).content).toBe("hello");
    expect((await dm.messages({ conversationId: result.message.conversationId })).messages).toContainEqual(
      result.message,
    );

    const onMessage = vi.fn();
    const live = await dm.subscribe({}, onMessage);
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    await dm.unsubscribe(live.subscriptionId);
    expect(pool.subscription.mock.results.at(-1)?.value.observed).toBe(false);
    dm.close?.();
  });
});

describe("remaining write services", () => {
  it("assigns unique DM subscription IDs without Web Crypto", async () => {
    const dm = createTestDmOptions(await create()).adapter;
    vi.stubGlobal("crypto", undefined);
    onTestFinished(() => {
      dm.close?.();
      vi.unstubAllGlobals();
    });

    const first = await dm.subscribe({}, vi.fn());
    const second = await dm.subscribe({}, vi.fn());
    expect(first.subscriptionId).not.toBe(second.subscriptionId);

    await dm.unsubscribe(first.subscriptionId);
    expect(pool.subscription.mock.results.at(-1)!.value.observed).toBe(true);
    await dm.unsubscribe(second.subscriptionId);
    expect(pool.subscription.mock.results.at(-1)!.value.observed).toBe(false);
  });
});

describe("remaining write services", () => {
  it("cancels the old DM subscription immediately on logout", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    event(aliceKey, kinds.DirectMessageRelaysList, [["relay", "wss://dm.relay.com/"]]);
    const dm = createTestDmOptions(await create({ signer: signer$ })).adapter;
    const live = await dm.subscribe({}, vi.fn());
    const relayMessages = pool.subscription.mock.results.at(-1)!.value;
    expect(relayMessages.observed).toBe(true);

    signer$.next(undefined);
    expect(relayMessages.observed).toBe(false);
    expect(signer$.observed).toBe(false);
    expect(await dm.status()).toMatchObject({ available: false, ownerPubkey: undefined });
    await dm.unsubscribe(live.subscriptionId);
    dm.close?.();
  });
});

describe("remaining write services", () => {
  it("does not publish a DM when approval is denied", async () => {
    const approve = vi.fn(() => false);
    const dm = createTestDmOptions({ ...(await create({ approve })), getWindowId: () => "window" }).adapter;
    await expect(dm.send({ recipients: [bob], content: "secret" })).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ windowId: "window" }));
    expect(pool.publish).not.toHaveBeenCalled();
  });
});

describe("DM request isolation", () => {
  it("captures the requesting window before asynchronous signing work", async () => {
    const approve = vi.fn((_request: { windowId?: string }) => false);
    let windowId = "first";
    const dm = createTestDmOptions({ ...(await create({ approve })), getWindowId: () => windowId }).adapter;
    const first = dm.send({ recipients: [bob], content: "one" });
    windowId = "second";
    const second = dm.send({ recipients: [bob], content: "two" });
    await Promise.allSettled([first, second]);
    expect(approve.mock.calls.map(([request]) => request.windowId)).toEqual(["first", "second"]);
    expect(pool.publish).not.toHaveBeenCalled();
  });
});
