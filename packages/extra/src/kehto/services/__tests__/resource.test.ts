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

    const response = await resource.fetch!(`blossom:${hash}?xs=url.example&xs=request.example`, {
      signal: new AbortController().signal,
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

    const response = await resource.fetch!(`blossom:${hash}?xs=hint.example&xs=hint.example`, {
      signal: new AbortController().signal,
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
    const request = { signal: new AbortController().signal, windowId: "example" };
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

describe("resource host policy", () => {
  const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  const request = () => ({ signal: new AbortController().signal });

  it.each([
    "localhost",
    "localhost.",
    "app.localhost",
    "app.localhost.",
    "router.local",
    "0.0.0.0",
    "127.0.0.1",
    "2130706433",
    "0177.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[fd00::1]",
  ])("blocks %s for direct requests and Blossom hints", async (host) => {
    const fetcher = vi.fn();
    const resource = createResourceOptions({ eventStore: store, fetch: fetcher });
    const url = `https://${host}/`;

    await expect(resource.fetch!(url, request())).rejects.toMatchObject({ code: "blocked-by-policy" });
    await expect(resource.fetch!(`blossom:${hash}?xs=${encodeURIComponent(url)}`, request())).rejects.toMatchObject({
      code: "not-found",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["100.63.255.255", "100.128.0.1", "172.15.0.1", "172.32.0.1", "localhost.example"])(
    "allows public boundary host %s",
    async (host) => {
      const fetcher = vi.fn(async () => new Response("hello"));
      const resource = createResourceOptions({ eventStore: store, fetch: fetcher });
      expect(await (await resource.fetch!(`https://${host}/`, request())).text()).toBe("hello");
    },
  );

  it("filters every Blossom server source and falls back to an allowed server", async () => {
    event(aliceKey, 10063, [["server", "https://192.168.1.1/"]]);
    const fetcher = vi.fn(async () => new Response("hello"));
    const resource = createResourceOptions({
      eventStore: store,
      pubkey: alice,
      fetch: fetcher,
      fallbackServers: ["https://100.64.0.1/", "https://public.example/"],
    });

    const response = await resource.fetch!(
      `blossom:${hash}?xs=http://127.0.0.1&xs=https://app.localhost&xs=https://10.0.0.1/&xs=http://public.example/`,
      request(),
    );
    expect(await response.text()).toBe("hello");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      new URL(`https://public.example/${hash}`),
      expect.objectContaining({
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it.each([false, true])("supports replacing the default filter (async: %s)", async (asyncPolicy) => {
    const policy = (url: URL) => url.hostname === "127.0.0.1";
    const allowHost = vi.fn(asyncPolicy ? async (url: URL) => policy(url) : policy);
    const fetcher = vi.fn(async () => new Response("hello"));
    const resource = createResourceOptions({ eventStore: store, fetch: fetcher, allowHost });

    await expect(resource.fetch!("https://public.example/", request())).rejects.toMatchObject({
      code: "blocked-by-policy",
    });
    expect(await (await resource.fetch!("https://127.0.0.1/", request())).text()).toBe("hello");
    expect(await (await resource.fetch!(`blossom:${hash}?xs=https://127.0.0.1`, request())).text()).toBe("hello");
    await expect(resource.fetch!(`blossom:${hash}?xs=http://127.0.0.1`, request())).rejects.toMatchObject({
      code: "not-found",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(allowHost).toHaveBeenCalledTimes(3);
  });

  it("rejects redirecting requests and tries the next Blossom server", async () => {
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      if (init?.redirect === "error") throw new TypeError("Redirect rejected");
      return new Response("hello");
    });
    const resource = createResourceOptions({ eventStore: store, fetch: fetcher });
    await expect(resource.fetch!("https://redirect.example/", request())).rejects.toThrow("Redirect rejected");

    fetcher.mockImplementation(async (url, init) => {
      if (url.hostname === "redirect.example" && init?.redirect === "error") throw new TypeError("Redirect rejected");
      return new Response("hello");
    });
    const response = await resource.fetch!(
      `blossom:${hash}?xs=https://redirect.example&xs=https://public.example`,
      request(),
    );
    expect(await response.text()).toBe("hello");
    expect(fetcher.mock.calls.map(([url]) => url.hostname)).toEqual([
      "redirect.example",
      "redirect.example",
      "public.example",
    ]);
  });
});
