import { Server } from "@contextvm/mcp-sdk/server";
import { CallToolRequestSchema } from "@contextvm/mcp-sdk/types.js";
import { EncryptionMode, GiftWrapMode, type RelayHandler } from "@contextvm/sdk/core";
import { NostrServerTransport } from "@contextvm/sdk/transport";
import { EventStore } from "applesauce-core";
import { matchFilters, verifyEvent, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { filter, Subject, Subscription } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCordnCoordinator } from "../dm/cordn.js";

const relays = ["wss://cordn.example/"];
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const bus = new Subject<NostrEvent>();
  const serverSubscriptions = new Subscription();
  const published: NostrEvent[] = [];
  const signer = new PrivateKeySigner(new Uint8Array(32).fill(11));
  const serverSigner = new PrivateKeySigner(new Uint8Array(32).fill(12));
  const ownerPubkey = await signer.getPublicKey();
  const coordinatorPubkey = await serverSigner.getPublicKey();
  const pool = {
    subscription: vi.fn((_relays, filters) => bus.pipe(filter((event) => matchFilters(filters, event)))),
    publish: vi.fn(async (_relays, event: NostrEvent) => {
      published.push(event);
      bus.next(event);
      return [{ ok: true, from: relays[0], message: "accepted" }];
    }),
  };
  const relayHandler: RelayHandler = {
    connect: async () => {},
    disconnect: async () => serverSubscriptions.unsubscribe(),
    unsubscribe: () => serverSubscriptions.unsubscribe(),
    getRelayUrls: () => relays,
    publish: async (event) => {
      bus.next(event);
    },
    subscribe: async (filters, onEvent) => {
      const subscription = bus.pipe(filter((event) => matchFilters(filters, event))).subscribe(onEvent);
      serverSubscriptions.add(subscription);
      return () => subscription.unsubscribe();
    },
  };
  const transport = new NostrServerTransport({
    signer: serverSigner,
    relayHandler,
    encryptionMode: EncryptionMode.REQUIRED,
    giftWrapMode: GiftWrapMode.EPHEMERAL,
    injectClientPubkey: true,
    injectRequestEventId: true,
    publishRelayList: false,
    isPubkeyAllowed: () => true,
    logLevel: "silent",
  });
  const server = new Server({ name: "cordn-test", version: "1.0.0" }, { capabilities: { tools: {} } });
  const calls: { name: string; args: unknown; caller: unknown }[] = [];
  let result: Record<string, unknown> = { keyPackages: [{ pk: ownerPubkey, kp_ref: "package" }] };
  let isError = false;
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    calls.push({ name: request.params.name, args: request.params.arguments, caller: extra._meta?.clientPubkey });
    return {
      content: isError ? [{ type: "text", text: "Coordinator denied request" }] : [],
      structuredContent: result,
      isError,
    };
  });
  await server.connect(transport);
  cleanups.push(async () => {
    await server.close();
    await transport.close();
    serverSubscriptions.unsubscribe();
  });

  const context = { eventStore: new EventStore(), pool: pool as unknown as RelayPool };
  const options = { ownerPubkey, coordinatorPubkey, relays, signer, timeoutMs: 2000 };
  const coordinator = createCordnCoordinator(context, options);
  cleanups.push(() => coordinator.close());
  return {
    coordinator,
    context,
    options,
    signer,
    calls,
    published,
    pool,
    bus,
    respond: (value: Record<string, unknown>, error = false) => {
      result = value;
      isError = error;
    },
  };
}

describe("Cordn coordinator", () => {
  it("round-trips real encrypted ContextVM calls with separate account and ephemeral identities", async () => {
    const { coordinator, context, options, calls, published, respond } = await setup();
    await expect(coordinator.listKeyPackages()).resolves.toEqual([{ pk: options.ownerPubkey, kp_ref: "package" }]);
    expect(calls[0].caller).not.toBe(options.ownerPubkey);
    expect(calls[0].caller).toMatch(/^[0-9a-f]{64}$/);

    respond({ kp_ref: "local", at: 1, last_resort: false });
    await coordinator.publishKeyPackage("local", "bWxz");
    expect(calls[1]).toEqual({
      name: "kp_publish",
      args: { kp_ref: "local", kp_64: "bWxz" },
      caller: options.ownerPubkey,
    });
    respond({ welcomes: [] });
    await coordinator.fetchWelcomes();
    expect(calls[2]).toEqual({ name: "welcome_take", args: {}, caller: options.ownerPubkey });

    expect(published.length).toBeGreaterThan(0);
    for (const event of published) {
      expect(event.kind).toBe(21059);
      expect(verifyEvent(event)).toBe(true);
      expect(event.content).not.toContain("kp_publish");
      expect(context.eventStore.getEvent(event.id)).toBeDefined();
    }
  });

  it("preserves independent group cursors and explicit welcome acknowledgements", async () => {
    const { coordinator, calls, respond } = await setup();
    respond({ messages: [{ gid: "one", cursor: 4, msg_64: "encrypted", at: 10 }] });
    const groups = [
      { gid: "one", after: 3 },
      { gid: "two", after: 9 },
    ];
    await expect(coordinator.fetchMessages(groups)).resolves.toHaveLength(1);
    expect(calls[0].args).toEqual({ groups });
    respond({ welcomes: [] });
    await coordinator.fetchWelcomes([{ kp_ref: "done", at: 12 }]);
    expect(calls[1].args).toEqual({ consumed: [{ kp_ref: "done", at: 12 }] });
  });

  it("uses only the ephemeral caller for package consumption, welcomes, and encrypted messages", async () => {
    const { coordinator, calls, respond, options } = await setup();
    respond({ keyPackage: null });
    await expect(coordinator.consumeKeyPackage(options.ownerPubkey)).resolves.toBeNull();
    respond({ at: 10 });
    await coordinator.storeWelcome(options.ownerPubkey, "package", "welcome");
    expect(calls[1].args).toEqual({ target_pk: options.ownerPubkey, kp_ref: "package", welcome_64: "welcome" });
    respond({ gid: "group", cursor: 3, at: 10 });
    await expect(coordinator.postMessage("group", "ciphertext")).resolves.toEqual({ gid: "group", cursor: 3, at: 10 });
    expect(calls[2].args).toEqual({ gid: "group", msg_64: "ciphertext" });
    expect(new Set(calls.map((call) => call.caller)).size).toBe(1);
    expect(calls[0].caller).not.toBe(options.ownerPubkey);
  });

  it("propagates coordinator errors instead of returning empty history", async () => {
    const { coordinator, respond } = await setup();
    respond({}, true);
    await expect(coordinator.listKeyPackages()).rejects.toThrow("Coordinator denied request");
  });

  it("rejects malformed results and messages from unrequested groups", async () => {
    const { coordinator, respond } = await setup();
    respond({ messages: [{ gid: "other", cursor: 1, msg_64: "ciphertext", at: 1 }] });
    await expect(coordinator.fetchMessages([{ gid: "requested" }])).rejects.toThrow("Invalid Cordn messages");
    respond({ welcomes: [{ kp_ref: "a" }] });
    await expect(coordinator.fetchWelcomes()).rejects.toThrow("Invalid Cordn welcomes");
  });

  it("rejects a changed account signer before authenticated publication", async () => {
    const { coordinator, signer, published } = await setup();
    vi.spyOn(signer, "getPublicKey").mockResolvedValue("f".repeat(64));
    await expect(coordinator.publishKeyPackage("local", "bWxz")).rejects.toThrow();
    expect(published).toHaveLength(0);
  });

  it("rejects signer mutation before any account request reaches the relay", async () => {
    const { coordinator, signer, published } = await setup();
    const sign = signer.signEvent.bind(signer);
    vi.spyOn(signer, "signEvent").mockImplementation((template) => sign({ ...template, content: "changed" }));
    await expect(coordinator.publishKeyPackage("local", "bWxz")).rejects.toThrow();
    expect(published).toHaveLength(0);
  });

  it("fails when no shared-pool relay accepts a request", async () => {
    const { coordinator, pool } = await setup();
    pool.publish.mockResolvedValue([{ ok: false, from: relays[0], message: "blocked" }]);
    await expect(coordinator.listKeyPackages()).rejects.toThrow();
  });

  it("cancels pending requests immediately when their owner closes", async () => {
    const { coordinator, pool } = await setup();
    pool.publish.mockResolvedValue([{ ok: true, from: relays[0], message: "accepted" }]);
    const pending = coordinator.listKeyPackages();
    const rejected = expect(pending).rejects.toThrow("closed");
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalled());
    await coordinator.close();
    await rejected;
  });

  it("releases subscriptions and rejects future operations after idempotent close", async () => {
    const { coordinator, context, pool, bus } = await setup();
    await coordinator.listKeyPackages();
    await coordinator.close();
    await coordinator.close();
    expect(context.eventStore.insert$.observed).toBe(false);
    await expect(coordinator.listKeyPackages()).rejects.toThrow("closed");
    expect(pool.publish).toHaveBeenCalled();
    // Only the test server remains subscribed to the shared network.
    expect(bus.observed).toBe(true);
  });

  it("bounds transport startup and never publishes a delayed signer result", async () => {
    const { coordinator, context, options, signer, published } = await setup();
    await coordinator.close();
    let resolveKey!: (key: string) => void;
    vi.spyOn(signer, "getPublicKey").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveKey = resolve;
        }),
    );
    const blocked = createCordnCoordinator(context, { ...options, timeoutMs: 30 });
    cleanups.push(() => blocked.close());
    await expect(blocked.publishKeyPackage("local", "bWxz")).rejects.toThrow();
    resolveKey(options.ownerPubkey);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(published).toHaveLength(0);
  });

  it("rejects missing signer encryption, relays, and invalid deadlines", async () => {
    const { context, options } = await setup();
    expect(() => createCordnCoordinator(context, { ...options, relays: [] })).toThrow("relays");
    expect(() => createCordnCoordinator(context, { ...options, timeoutMs: 0 })).toThrow("timeout");
    expect(() =>
      createCordnCoordinator(context, {
        ...options,
        signer: { getPublicKey: options.signer.getPublicKey, signEvent: options.signer.signEvent },
      }),
    ).toThrow("NIP-44");
  });
});
