import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { BehaviorSubject, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createKehtoShellAdapter } from "../../index.js";
import { createResourceOptions } from "../resource.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const alice = getPublicKey(aliceKey);
const bob = getPublicKey(bobKey);

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
});

describe("list privacy and resource integrity", () => {
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
});

describe("list privacy and resource integrity", () => {
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
});

describe("list privacy and resource integrity", () => {
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
});

describe("list privacy and resource integrity", () => {
  it("allows overriding built-in protocols without advertising duplicates", async () => {
    const handler = vi.fn(async () => new Response("override"));
    const resource = createResourceOptions({ eventStore: store, protocols: { https: handler } });
    const response = await resource.fetch!("https://example.com/", { signal: new AbortController().signal });

    expect(await response.text()).toBe("override");
    expect(resource.resourceInfo?.schemes?.filter(({ scheme }) => scheme === "https")).toHaveLength(1);
  });
});

describe("list privacy and resource integrity", () => {
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
});

describe("list privacy and resource integrity", () => {
  it("blocks private HTTPS hosts before fetching", async () => {
    const fetcher = vi.fn();
    const resource = createResourceOptions({ eventStore: store, fetch: fetcher });
    await expect(resource.fetch!("https://127.0.0.1/secret", { signal: new AbortController().signal })).rejects.toThrow(
      "private host",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
