import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createKehtoServices, createKehtoShellAdapter } from "../kehto/index.js";
import { createDmOptions } from "../kehto/services/dm.js";
import { unlockGiftWrap } from "applesauce-common/helpers";
import { createListsOptions } from "../kehto/services/lists.js";
import { createResourceOptions } from "../kehto/services/resource.js";
import { createCommonOptions } from "../kehto/services/common.js";
import { createCountOptions } from "../kehto/services/count.js";
import { createIdentityOptions } from "../kehto/services/identity.js";
import { createOutboxRouter } from "../kehto/services/outbox.js";
import type { KehtoContext } from "../kehto/types.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const alice = getPublicKey(aliceKey);
const bob = getPublicKey(bobKey);
const signer = new PrivateKeySigner(aliceKey);

function fakePool() {
  return {
    req: vi.fn(() => new Subject()),
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

describe("identity", () => {
  it("answers profile, follows and lists from the store", async () => {
    event(aliceKey, kinds.Metadata, [], JSON.stringify({ name: "alice", about: "hi" }));
    event(aliceKey, kinds.Contacts, [["p", bob]]);
    event(aliceKey, kinds.BookmarkList, [["e", "abc"]]);
    const identity = createIdentityOptions(await create());

    expect(await identity.getProfile!(alice, {} as any)).toMatchObject({ name: "alice", about: "hi" });
    expect(await identity.getFollows!(alice, {} as any)).toEqual([bob]);
    expect(await identity.getList!("bookmarks", alice, {} as any)).toEqual(["abc"]);
    expect(await identity.getList!("unknown", alice, {} as any)).toEqual([]);
  });

  it("returns null for a missing profile after the timeout", async () => {
    const identity = createIdentityOptions(await create());
    expect(await identity.getProfile!(bob, {} as any)).toBeNull();
  });
});

describe("outbox", () => {
  it("resolves no relays when relay lists and fallbacks are absent", async () => {
    const router = createOutboxRouter(await create({ eventStore: new EventStore() }));

    expect((await router.resolveRelays({ authors: [bob] })).relays).toEqual([]);
    expect((await router.resolveRelays({ pubkey: bob, direction: "write" })).relays).toEqual([]);
  });

  it("plans reads from author outboxes and writes to recipient inboxes", async () => {
    const router = createOutboxRouter(await create());
    expect(await router.resolveRelays({ authors: [bob] })).toEqual({
      relays: ["wss://bob-out.relay.com/"],
      source: "nip65",
    });
    expect((await router.resolveRelays({ pubkey: bob, direction: "write" })).relays).toEqual([
      "wss://bob-in.relay.com/",
    ]);
  });

  it("reroutes live reads when an author's relay list changes without replaying events", async () => {
    const router = createOutboxRouter(await create());
    const note = event(bobKey, kinds.ShortTextNote, [], "hello");
    const sink = { event: vi.fn(), closed: vi.fn() };
    const subscription = router.subscribe([{ authors: [bob], kinds: [1] }], {}, sink);

    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenCalledWith(["wss://bob-out.relay.com/"], [{ authors: [bob], kinds: [1] }]),
    );
    store.add(
      finalizeEvent(
        {
          kind: kinds.RelayList,
          created_at: unixNow() + 1,
          content: "",
          tags: [["r", "wss://new-out.relay.com/", "write"]],
        },
        bobKey,
      ),
    );

    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenLastCalledWith(["wss://new-out.relay.com/"], [{ authors: [bob], kinds: [1] }]),
    );
    expect(sink.event).toHaveBeenCalledTimes(1);
    expect(sink.event.mock.calls[0][0].event.id).toBe(note.id);

    subscription.close();
    event(bobKey, kinds.ShortTextNote, [], "after close");
    expect(sink.event).toHaveBeenCalledTimes(1);
  });

  it("switches inbox relays with the account and releases settings subscriptions on close", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    const fallbackRelays = new BehaviorSubject(["wss://fallback.relay.com/"]);
    const context = await create({ signer: signer$, fallbackRelays });
    const router = createOutboxRouter(context);
    const subscription = router.subscribe([{ kinds: [1] }], {}, { event: vi.fn(), closed: vi.fn() });

    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenLastCalledWith(
        ["wss://alice.relay.com/", "wss://fallback.relay.com/"],
        [{ kinds: [1] }],
      ),
    );
    signer$.next(new PrivateKeySigner(bobKey));
    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenLastCalledWith(
        ["wss://bob-in.relay.com/", "wss://fallback.relay.com/"],
        [{ kinds: [1] }],
      ),
    );
    fallbackRelays.next(["wss://new-fallback.relay.com/"]);
    expect(pool.req).toHaveBeenLastCalledWith(
      ["wss://bob-in.relay.com/", "wss://new-fallback.relay.com/"],
      [{ kinds: [1] }],
    );
    signer$.next(undefined);
    expect(pool.req).toHaveBeenLastCalledWith(["wss://new-fallback.relay.com/"], [{ kinds: [1] }]);

    subscription.close();
    expect(signer$.observed).toBe(false);
    expect(fallbackRelays.observed).toBe(false);
  });

  it("keeps the requesting window and account when approval switches the signer", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    let windowId = "first-window";
    const approve = vi.fn(() => {
      signer$.next(new PrivateKeySigner(bobKey));
      return true;
    });
    const router = createOutboxRouter({ ...(await create({ signer: signer$, approve })), getWindowId: () => windowId });
    const pending = router.publish({ kind: 1, content: "hello", tags: [], created_at: 0 });
    windowId = "second-window";
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.event?.pubkey).toBe(alice);
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ windowId: "first-window" }));
    expect(pool.publish).toHaveBeenCalledWith(["wss://alice.relay.com/"], expect.objectContaining({ pubkey: alice }));
  });

  it("signs and publishes to the user's outboxes and recipient inboxes", async () => {
    const approve = vi.fn(() => true);
    const router = createOutboxRouter({ ...(await create({ approve })), getWindowId: () => "win-1" });
    const result = await router.publish({ kind: 1, content: "hi", tags: [], created_at: 0 }, { toInboxes: [bob] });

    expect(result).toMatchObject({
      ok: true,
      relays: { "wss://alice.relay.com/": true, "wss://bob-in.relay.com/": true },
    });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ windowId: "win-1" }));
    expect(store.hasEvent(result.eventId!)).toBe(true);
  });

  it("reports a denied publish without publishing", async () => {
    const router = createOutboxRouter(await create({ approve: () => false }));
    expect(await router.publish({ kind: 1, content: "", tags: [], created_at: 0 })).toEqual({
      ok: false,
      error: "User denied",
    });
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("finds events already in the store", async () => {
    const note = event(bobKey, kinds.ShortTextNote, [], "hello");
    const router = createOutboxRouter(await create());
    expect((await router.getEvent!(note.id)).result?.event).toBe(note);
  });
});

describe("count", () => {
  it("selects relays from a reactive public key without a signer", async () => {
    const pubkey = new BehaviorSubject<string | undefined>(alice);
    pool.count.mockReturnValue(of({ "wss://count.relay.com/": { ok: true, value: { count: 1 } } }));
    const count = createCountOptions({ eventStore: store, pool: pool as unknown as RelayPool, pubkey });

    await count.count({ filters: [{ kinds: [1] }], windowId: "w" });
    expect(pool.count.mock.lastCall?.[0]).toContain("wss://alice.relay.com/");

    pubkey.next(bob);
    await count.count({ filters: [{ kinds: [1] }], windowId: "w" });
    expect(pool.count.mock.lastCall?.[0]).toContain("wss://bob-in.relay.com/");
  });

  it("returns partial counts at the deadline and releases the relay subscription", async () => {
    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const responses = new Subject<any>();
    pool.count.mockReturnValue(responses);
    const count = createCountOptions(await create());
    const result = count.count({ filters: [{ kinds: [1] }], windowId: "w" });

    responses.next({ "wss://a.relay.com/": { ok: true, value: { count: 3 } } });
    await vi.advanceTimersByTimeAsync(50);

    expect(await result).toMatchObject({ ok: true, count: 3 });
    expect(responses.observed).toBe(false);
  });

  it("bounds settings that never emit", async () => {
    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const settings = new Subject<string>();
    const count = createCountOptions({ ...(await create()), pubkey: settings });
    const result = count.count({ filters: [{ kinds: [1] }], windowId: "w" });

    await vi.advanceTimersByTimeAsync(50);

    expect(await result).toMatchObject({ ok: false });
    expect(settings.observed).toBe(false);
    expect(pool.count).not.toHaveBeenCalled();
  });

  it("rejects broad requests before contacting relays", async () => {
    const count = createCountOptions(await create());
    expect(await count.count({ filters: [{}], windowId: "w" })).toMatchObject({ ok: false });
    expect(await count.count({ filters: [], windowId: "w" })).toMatchObject({ ok: false });
    expect(pool.count).not.toHaveBeenCalled();
  });

  it("ignores malformed counts without losing a valid zero", async () => {
    pool.count.mockReturnValue(
      of({
        "wss://a.relay.com/": { ok: true, value: { count: Infinity } },
        "wss://b.relay.com/": { ok: true, value: { count: 0 } },
      }),
    );
    const count = createCountOptions(await create());
    expect(await count.count({ filters: [{ kinds: [1] }], windowId: "w" })).toMatchObject({ ok: true, count: 0 });
  });

  it("reports the largest relay count", async () => {
    pool.count.mockReturnValue(
      of({
        "wss://a.relay.com/": { ok: true, value: { count: 3 } },
        "wss://b.relay.com/": { ok: true, value: { count: 7 } },
        "wss://c.relay.com/": { ok: false, error: new Error("nope") },
      }),
    );
    const count = createCountOptions(await create());
    expect(await count.count({ filters: [{ kinds: [1] }], windowId: "w" })).toEqual({
      ok: true,
      count: 7,
      approximate: false,
      relays: ["wss://b.relay.com/"],
    });
    expect(count.isFilterSupported!({}, 0)).not.toBe(true);
  });
});

describe("common", () => {
  it("follows a user through the contacts action", async () => {
    event(aliceKey, kinds.Contacts, []);
    const common = createCommonOptions(await create());
    const result = await common.follow!([bob], { windowId: "w" });

    expect(result.ok).toBe(true);
    expect(result.event?.kind).toBe(kinds.Contacts);
    expect(result.event?.tags).toContainEqual(["p", bob]);
    expect(pool.publish).toHaveBeenCalledWith(["wss://alice.relay.com/"], result.event);
  });

  it("uses a shared account stream without a signer dependency", async () => {
    const account$ = new BehaviorSubject({ signer, pubkey: alice });
    const common = createCommonOptions({ eventStore: store, pool: pool as unknown as RelayPool, account$ });

    const first = await common.follow!([bob], { windowId: "w" });
    expect(first.event?.pubkey).toBe(alice);

    account$.next({ signer: new PrivateKeySigner(bobKey), pubkey: bob });
    const second = await common.follow!([alice], { windowId: "w" });
    expect(second.event?.pubkey).toBe(bob);
  });

  it("rejects invalid pubkeys", async () => {
    const common = createCommonOptions(await create());
    expect(await common.follow!(["nope"], { windowId: "w" })).toEqual({ ok: false, error: "invalid pubkey" });
  });
});

describe("registry", () => {
  it("creates every service unless disabled", async () => {
    const state = await create();
    expect(Object.keys(createKehtoServices(state)).sort()).toEqual([
      "common",
      "count",
      "dm",
      "identity",
      "lists",
      "outbox",
      "resource",
      "upload",
    ]);
    expect(
      Object.keys(createKehtoServices(state, { disable: ["upload", "count", "lists", "resource", "dm"] })).sort(),
    ).toEqual(["common", "identity", "outbox"]);
  });

  it("keeps service creation lazy and stops shell snapshots without owning the host loader", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    const fallbackRelays = new BehaviorSubject(["wss://fallback.relay.com/"]);
    const context = await create({ signer: signer$, fallbackRelays });
    const loader = vi.fn();
    store.eventLoader = loader;
    createKehtoServices(context);
    expect(signer$.observed).toBe(false);
    expect(fallbackRelays.observed).toBe(false);

    const adapter = createKehtoShellAdapter(context);
    adapters.push(adapter);
    await vi.waitFor(() => expect(adapter.auth.getUserPubkey()).toBe(alice));
    const cleanup = vi.fn();
    adapter.relayPool.trackSubscription("test", cleanup);
    signer$.next(new PrivateKeySigner(bobKey));
    expect(adapter.auth.getUserPubkey()).toBeNull();
    expect(adapter.auth.getSigner()).toBeNull();
    await vi.waitFor(() => expect(adapter.auth.getUserPubkey()).toBe(bob));

    adapter.stop();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(signer$.observed).toBe(false);
    expect(fallbackRelays.observed).toBe(false);
    expect(store.eventLoader).toBe(loader);
  });

  it("creates a shell adapter that exposes the current user and signer", async () => {
    const adapter = createKehtoShellAdapter(await create());
    adapters.push(adapter);
    await vi.waitFor(() => expect(adapter.auth.getUserPubkey()).toBe(alice));
    expect(await adapter.auth.getSigner("w")?.getPublicKey()).toBe(alice);
    expect(adapter.relayPool.selectRelayTier([])).toEqual(["wss://alice.relay.com/"]);
    expect(adapter.services?.identity).toBeDefined();
  });
});

describe("remaining write services", () => {
  it("round-trips encrypted DMs and tears down live subscriptions", async () => {
    const state = await create({ fallbackRelays: ["wss://fallback.relay.com/"] });
    const dm = createDmOptions(state).adapter;
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
    expect(pool.req.mock.results.at(-1)?.value.observed).toBe(false);
    dm.close?.();
  });

  it("assigns unique DM subscription IDs without Web Crypto", async () => {
    const dm = createDmOptions(await create()).adapter;
    vi.stubGlobal("crypto", undefined);
    onTestFinished(() => {
      dm.close?.();
      vi.unstubAllGlobals();
    });

    const first = await dm.subscribe({}, vi.fn());
    const second = await dm.subscribe({}, vi.fn());
    expect(first.subscriptionId).not.toBe(second.subscriptionId);

    await dm.unsubscribe(first.subscriptionId);
    expect(pool.req.mock.results.at(-1)!.value.observed).toBe(true);
    await dm.unsubscribe(second.subscriptionId);
    expect(pool.req.mock.results.at(-1)!.value.observed).toBe(false);
  });

  it("cancels the old DM subscription immediately on logout", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    event(aliceKey, kinds.DirectMessageRelaysList, [["relay", "wss://dm.relay.com/"]]);
    const dm = createDmOptions(await create({ signer: signer$ })).adapter;
    const live = await dm.subscribe({}, vi.fn());
    const relayMessages = pool.req.mock.results.at(-1)!.value;
    expect(relayMessages.observed).toBe(true);

    signer$.next(undefined);
    expect(relayMessages.observed).toBe(false);
    expect(signer$.observed).toBe(false);
    expect(await dm.status()).toMatchObject({ available: false, ownerPubkey: undefined });
    await dm.unsubscribe(live.subscriptionId);
    dm.close?.();
  });

  it("does not publish a DM when approval is denied", async () => {
    const approve = vi.fn(() => false);
    const dm = createDmOptions({ ...(await create({ approve })), getWindowId: () => "window" }).adapter;
    await expect(dm.send({ recipients: [bob], content: "secret" })).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ windowId: "window" }));
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("adds and removes list items while preserving unrelated tags", async () => {
    event(aliceKey, kinds.BookmarkList, [["title", "Saved"]]);
    const lists = createListsOptions(await create());
    const item = { itemType: "event" as const, value: "a".repeat(64) };
    const added = await lists.add!({ kind: kinds.BookmarkList }, [item], {}, { windowId: "w" });
    expect(added).toMatchObject({ ok: true, added: 1 });
    expect(added.event?.tags).toContainEqual(["title", "Saved"]);
    expect(await lists.remove!({ kind: kinds.BookmarkList }, [item], {}, { windowId: "w" })).toMatchObject({
      ok: true,
      removed: 1,
    });
  });

  it("verifies Blossom hashes and rejects oversized resources", async () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    const fetcher = vi.fn(async () => new Response(bytes));
    const resource = createResourceOptions({
      eventStore: store,
      fetch: fetcher,
      fallbackServers: ["https://blossom.example/"],
      maxBytes: 4,
    });
    await expect(resource.fetch!("blossom:" + hash, { signal: new AbortController().signal })).rejects.toThrow(
      "5 bytes",
    );
    expect(fetcher).toHaveBeenCalled();
  });
});

describe("list privacy and resource integrity", () => {
  it("keeps private bookmarks encrypted and counts duplicate items once", async () => {
    const lists = createListsOptions(await create());
    const item = { itemType: "event" as const, value: "b".repeat(64), visibility: "private" as const };
    const added = await lists.add!({ kind: kinds.BookmarkList }, [item, item], {}, { windowId: "w" });
    expect(added).toMatchObject({ ok: true, added: 1, skipped: 1 });
    expect(added.event?.content).not.toContain(item.value);
    expect(added.event?.tags).not.toContainEqual(["e", item.value]);
    expect(await lists.remove!({ kind: kinds.BookmarkList }, [item], {}, { windowId: "w" })).toMatchObject({
      ok: true,
      removed: 1,
    });
  });

  it("fetches Blossom hints without waiting for public key discovery", async () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("corrupt")).mockResolvedValueOnce(new Response(bytes));
    const resource = createResourceOptions({ eventStore: store, pubkey: new Subject<string>(), fetch: fetcher });

    const response = await resource.fetch!(`blossom:${hash}?xs=url.example`, {
      signal: new AbortController().signal,
      servers: ["https://request.example/"],
    });

    expect(await response.text()).toBe("hello");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `https://url.example/${hash}`,
      `https://request.example/${hash}`,
    ]);
  });

  it("tries hints, user servers and reactive fallbacks without duplicate requests", async () => {
    const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    event(aliceKey, 10063, [["server", "https://user.example/"]]);
    const fetcher = vi.fn(async (url: URL) =>
      url.hostname === "fallback.example" ? new Response("hello") : new Response(null, { status: 404 }),
    );
    const resource = createResourceOptions({
      eventStore: store,
      pubkey: of(alice),
      fallbackServers: new BehaviorSubject(["https://user.example/", "https://fallback.example/"]),
      fetch: fetcher,
    });

    const response = await resource.fetch!(`blossom:${hash}?xs=hint.example`, {
      signal: new AbortController().signal,
      servers: ["hint.example"],
    });

    expect(await response.text()).toBe("hello");
    expect(fetcher.mock.calls.map(([url]) => url.hostname)).toEqual([
      "hint.example",
      "user.example",
      "fallback.example",
    ]);
  });

  it("tries another Blossom server after a hash mismatch without Web Crypto", async () => {
    vi.stubGlobal("crypto", undefined);
    onTestFinished(() => vi.unstubAllGlobals());
    const bytes = new TextEncoder().encode("hello");
    const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("corrupt")).mockResolvedValueOnce(new Response(bytes));
    const resource = createResourceOptions({
      eventStore: store,
      fetch: fetcher,
      fallbackServers: ["https://one.example/", "https://two.example/"],
    });
    const response = await resource.fetch!("blossom:" + hash, { signal: new AbortController().signal });
    expect(await response.text()).toBe("hello");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("advertises custom protocols and passes request options to their handlers", async () => {
    const handler = vi.fn(async () => new Response("custom", { headers: { "content-type": "text/plain" } }));
    const resource = createResourceOptions({ eventStore: store, protocols: { ipfs: handler } });
    const request = { signal: new AbortController().signal, servers: ["https://hint.example/"] };
    const response = await resource.fetch!("ipfs:example", request);

    expect(resource.resourceInfo?.schemes).toContainEqual({ scheme: "ipfs", enabled: true });
    expect(handler).toHaveBeenCalledWith("ipfs:example", request);
    expect(await response.text()).toBe("custom");
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  it("allows overriding built-in protocols without advertising duplicates", async () => {
    const handler = vi.fn(async () => new Response("override"));
    const resource = createResourceOptions({ eventStore: store, protocols: { https: handler } });
    const response = await resource.fetch!("https://example.com/", { signal: new AbortController().signal });

    expect(await response.text()).toBe("override");
    expect(resource.resourceInfo?.schemes?.filter(({ scheme }) => scheme === "https")).toHaveLength(1);
  });

  it("enforces byte limits on custom protocols and rejects unregistered schemes", async () => {
    const resource = createResourceOptions({
      eventStore: store,
      maxBytes: 4,
      protocols: { ipfs: async () => new Response("large") },
    });
    const request = { signal: new AbortController().signal };

    await expect(resource.fetch!("ipfs:example", request)).rejects.toThrow("5 bytes");
    await expect(resource.fetch!("unknown:example", request)).rejects.toThrow("unknown:");
  });

  it("blocks private HTTPS hosts before fetching", async () => {
    const fetcher = vi.fn();
    const resource = createResourceOptions({ eventStore: store, fetch: fetcher });
    await expect(resource.fetch!("https://127.0.0.1/secret", { signal: new AbortController().signal })).rejects.toThrow(
      "private host",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("DM request isolation", () => {
  it("captures the requesting window before asynchronous signing work", async () => {
    const approve = vi.fn((_request: { windowId?: string }) => false);
    let windowId = "first";
    const dm = createDmOptions({ ...(await create({ approve })), getWindowId: () => windowId }).adapter;
    const first = dm.send({ recipients: [bob], content: "one" });
    windowId = "second";
    const second = dm.send({ recipients: [bob], content: "two" });
    await Promise.allSettled([first, second]);
    expect(approve.mock.calls.map(([request]) => request.windowId)).toEqual(["first", "second"]);
    expect(pool.publish).not.toHaveBeenCalled();
  });
});
