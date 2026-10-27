import { EventStore } from "applesauce-core";
import { finalizeEvent, type NostrEvent, unixNow } from "applesauce-core/helpers";
import { nip44 } from "applesauce-core/helpers/encryption";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCvmOptions,
  createCvmTransport,
  createKehtoCvmService,
  type KehtoCvmTransport,
  type KehtoCvmService,
} from "../cvm.js";

const serverKey = new Uint8Array(32).fill(7);
const serverPubkey = getPublicKey(serverKey);
const wrapKey = new Uint8Array(32).fill(8);
const relays = ["wss://cvm.example.com/"];

function create() {
  const incoming = new Subject<any>();
  const eventStore = new EventStore();
  const pool = {
    req: vi.fn(() => incoming),
    publish: vi.fn(async (_relays: string[], _event: NostrEvent) => [
      { from: relays[0], ok: true, message: "accepted" },
    ]),
  };
  const context = { eventStore, pool: pool as unknown as RelayPool };
  const service = createKehtoCvmService(context, { defaultRelays: relays, timeoutMs: 1000 });
  services.push(service);

  return { incoming, eventStore, pool, service, context };
}

function readRequest(wrap: NostrEvent) {
  const key = nip44.getConversationKey(serverKey, wrap.pubkey);
  const inner = JSON.parse(nip44.decrypt(wrap.content, key)) as NostrEvent;
  return { clientPubkey: inner.pubkey, message: JSON.parse(inner.content) };
}

function response(clientPubkey: string, id: string) {
  const inner = finalizeEvent(
    {
      kind: 25910,
      created_at: unixNow(),
      tags: [["p", clientPubkey]],
      content: JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } }),
    },
    serverKey,
  );
  const key = nip44.getConversationKey(wrapKey, clientPubkey);
  return finalizeEvent(
    {
      kind: 21059,
      created_at: unixNow(),
      tags: [["p", clientPubkey]],
      content: nip44.encrypt(JSON.stringify(inner), key),
    },
    wrapKey,
  );
}

const request = {
  type: "cvm.request",
  id: "napplet-request",
  server: { pubkey: serverPubkey },
  message: { jsonrpc: "2.0" as const, id: "original-id", method: "tools/list" },
};

let services: KehtoCvmService[];
let transports: KehtoCvmTransport[];
beforeEach(() => {
  services = [];
  transports = [];
  vi.useFakeTimers();
});
afterEach(() => {
  for (const service of services) service.dispose();
  for (const transport of transports) transport.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("CVM", () => {
  it("creates a standalone transport for encrypted MCP requests", async () => {
    const { incoming, pool, context } = create();
    const transport = createCvmTransport(context, { defaultRelays: relays, timeoutMs: 1000 });
    transports.push(transport);
    const result = transport.request(request.server, request.message);
    await vi.advanceTimersByTimeAsync(0);

    const { clientPubkey, message } = readRequest(pool.publish.mock.calls[0][1] as NostrEvent);
    incoming.next({ type: "EVENT", event: response(clientPubkey, message.id), from: relays[0] });
    await expect(result).resolves.toEqual({ jsonrpc: "2.0", id: "original-id", result: { tools: [] } });

    transport.dispose();
    transport.dispose();
    expect(incoming.observed).toBe(false);
    await expect(transport.discover()).rejects.toThrow("CVM transport disposed");
    await expect(transport.request(request.server, request.message)).rejects.toThrow("CVM transport disposed");
    expect(pool.publish).toHaveBeenCalledTimes(1);
  });

  it("creates options for Kehto's own service factory with owned transport cleanup", async () => {
    const { incoming, context } = create();
    const options = createCvmOptions(context, { defaultRelays: relays });
    const service = createCvmService(options);
    services.push(service);
    const send = vi.fn();
    service.handleMessage("custom", { type: "cvm.discover", id: "discover" }, send);
    incoming.next({ type: "EOSE", from: relays[0] });
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledWith({ type: "cvm.discover.result", id: "discover", servers: [] });
    service.dispose();
    expect(incoming.observed).toBe(false);
    await expect(options.transport.discover()).rejects.toThrow("CVM transport disposed");
  });

  it("disposes a standalone transport while requests are pending", async () => {
    const { incoming, context } = create();
    const transport = createCvmTransport(context, { defaultRelays: relays });
    transports.push(transport);
    const result = transport.request(request.server, request.message);
    const rejected = expect(result).rejects.toThrow("transport disposed");

    transport.dispose();
    await rejected;
    expect(incoming.observed).toBe(false);
  });

  it("discovers servers through the shared store and tears down discovery subscriptions", async () => {
    const { incoming, eventStore, pool, service } = create();
    const send = vi.fn();
    const announcement = finalizeEvent(
      {
        kind: 11316,
        created_at: unixNow(),
        content: "",
        tags: [["name", "Example"]],
      },
      serverKey,
    );

    service.handleMessage("one", { type: "cvm.discover", id: "discover" }, send);
    expect(pool.req).toHaveBeenCalledWith(relays, [expect.objectContaining({ kinds: [11316, 11317] })]);
    incoming.next({ type: "EVENT", event: announcement, from: relays[0] });
    incoming.next({ type: "EOSE", from: relays[0] });
    await vi.advanceTimersByTimeAsync(0);

    expect(eventStore.getEvent(announcement.id)).toEqual(announcement);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cvm.discover.result",
        id: "discover",
        servers: [expect.objectContaining({ pubkey: serverPubkey, name: "Example" })],
      }),
    );

    service.onWindowDestroyed!("one");
    expect(incoming.observed).toBe(false);
  });

  it("round-trips encrypted MCP requests and preserves original correlation ids", async () => {
    const { incoming, pool, service } = create();
    const send = vi.fn();
    service.handleMessage("one", request, send);
    await vi.advanceTimersByTimeAsync(0);

    const wrap = pool.publish.mock.calls[0][1] as NostrEvent;
    expect(wrap.kind).toBe(21059);
    const { clientPubkey, message } = readRequest(wrap);
    expect(message.method).toBe("tools/list");
    incoming.next({ type: "EVENT", event: response(clientPubkey, message.id), from: relays[0] });
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledWith({
      type: "cvm.request.result",
      id: "napplet-request",
      message: { jsonrpc: "2.0", id: "original-id", result: { tools: [] } },
    });
  });

  it("isolates same-server sessions and same-id requests across windows", async () => {
    const { incoming, pool, service } = create();
    const first = vi.fn();
    const second = vi.fn();
    service.handleMessage("one", request, first);
    service.handleMessage("two", request, second);
    await vi.advanceTimersByTimeAsync(0);

    const firstRequest = readRequest(pool.publish.mock.calls[0][1] as NostrEvent);
    const secondRequest = readRequest(pool.publish.mock.calls[1][1] as NostrEvent);
    expect(firstRequest.clientPubkey).not.toBe(secondRequest.clientPubkey);
    service.onWindowDestroyed!("one");

    incoming.next({
      type: "EVENT",
      event: response(secondRequest.clientPubkey, secondRequest.message.id),
      from: relays[0],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cvm.request.result", message: expect.any(Object) }),
    );

    service.onUnregistered!();
    service.dispose();
    expect(incoming.observed).toBe(false);
    service.handleMessage("three", request, first);
    expect(pool.publish).toHaveBeenCalledTimes(2);
  });

  it("reports relay rejection rather than caching unaccepted publication", async () => {
    const { eventStore, pool, service } = create();
    pool.publish.mockResolvedValue([{ from: relays[0], ok: false, message: "rejected" }]);
    const send = vi.fn();
    service.handleMessage("one", request, send);
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledWith({ type: "cvm.request.result", id: "napplet-request", error: "rejected" });
    const wrap = pool.publish.mock.calls[0][1] as NostrEvent;
    expect(eventStore.getEvent(wrap.id)).toBeUndefined();
  });

  it("closes only the requesting window's server session", async () => {
    const { incoming, pool, service } = create();
    const first = vi.fn();
    const second = vi.fn();
    service.handleMessage("one", request, first);
    service.handleMessage("two", request, second);
    await vi.advanceTimersByTimeAsync(0);

    const secondRequest = readRequest(pool.publish.mock.calls[1][1] as NostrEvent);
    service.handleMessage("one", { type: "cvm.close", id: "close", server: request.server }, first);
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledWith({ type: "cvm.close.result", id: "close" });

    incoming.next({
      type: "EVENT",
      event: response(secondRequest.clientPubkey, secondRequest.message.id),
      from: relays[0],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cvm.request.result",
        message: expect.any(Object),
      }),
    );
  });

  it("suppresses late discovery results when a window id is reused", async () => {
    const { incoming, service } = create();
    const previous = vi.fn();
    const current = vi.fn();
    service.handleMessage("one", { type: "cvm.discover", id: "old" }, previous);
    service.onWindowDestroyed!("one");
    service.handleMessage("one", { type: "cvm.discover", id: "new" }, current);
    incoming.next({ type: "EOSE", from: relays[0] });
    await vi.advanceTimersByTimeAsync(4000);

    expect(previous).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledWith({ type: "cvm.discover.result", id: "new", servers: [] });
  });

  it("times out unanswered requests", async () => {
    const { service } = create();
    const send = vi.fn();
    service.handleMessage("one", request, send);
    await vi.advanceTimersByTimeAsync(1000);

    expect(send).toHaveBeenCalledWith({ type: "cvm.request.result", id: "napplet-request", error: "relay timeout" });
  });
});
import { createCvmService } from "@kehto/services";
