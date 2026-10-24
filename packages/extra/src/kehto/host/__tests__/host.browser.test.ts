import { CacheStorageNappletArtifactCache } from "@kehto/nip/5d";
import type { ServiceHandler } from "@kehto/runtime";
import { originRegistry } from "@kehto/shell";
import { EventStore } from "applesauce-core";
import { finalizeEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKehtoHost, type KehtoHost } from "../index.js";

const hosts: KehtoHost[] = [];
const frames: HTMLIFrameElement[] = [];
const cacheNames: string[] = [];
const key = new Uint8Array(32).fill(1);

function createHost(options: Parameters<typeof createKehtoHost>[1] = {}) {
  const eventStore = new EventStore();
  const pool = {
    req: vi.fn(() => new Subject()),
    publish: vi.fn(),
    close: vi.fn(),
  };
  const signer = new BehaviorSubject<ISigner | undefined>(undefined);
  const host = createKehtoHost({ eventStore, pool: pool as unknown as RelayPool, signer, timeout: 10 }, options);
  host.bridge.runtime.aclState.clear();
  hosts.push(host);
  return { host, eventStore, pool, signer };
}

async function artifact(html = "<!doctype html><html><body>Napplet</body></html>") {
  const bytes = new TextEncoder().encode(html);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const event = finalizeEvent(
    {
      kind: 35129,
      content: "Test napplet",
      created_at: 1,
      tags: [
        ["d", "test"],
        ["x", hash],
      ],
    },
    key,
  );
  return { event, fetchBlob: async () => bytes };
}

function frame() {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  frames.push(iframe);
  return iframe;
}

function service(name: string): ServiceHandler {
  return {
    descriptor: { name, version: "1.0.0" },
    handleMessage: vi.fn(),
    onRegistered: vi.fn(),
    onWindowDestroyed: vi.fn(),
    onUnregistered: vi.fn(),
  };
}

afterEach(async () => {
  for (const host of hosts.splice(0)) host.destroy();
  for (const iframe of frames.splice(0)) iframe.remove();
  vi.restoreAllMocks();
  await Promise.all(cacheNames.splice(0).map((name) => caches.delete(name)));
});

describe("browser napplet host", () => {
  it("mounts two instances of one artifact and tears down each independently", async () => {
    const custom = service("intent");
    const { host, pool, signer } = createHost({ services: { intent: custom } });
    const fixture = await artifact();
    const first = await host.resolve(fixture.event, fixture);
    const second = await host.resolve(fixture.event, fixture);
    expect(first.windowId).not.toBe(second.windowId);
    expect(first.source).toBe("fetch");
    const firstFrame = frame();
    first.mount(firstFrame);
    second.mount(frame());
    await Promise.all([first.whenReady(), second.whenReady()]);

    expect(first.environment?.capabilities.domains).toContain("intent");
    expect(originRegistry.getWindowId(first.window!)).toBe(first.windowId);
    expect(firstFrame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(custom.onRegistered).toHaveBeenCalledOnce();
    first.destroy();
    first.destroy();
    expect(custom.onWindowDestroyed).toHaveBeenCalledExactlyOnceWith(first.windowId);
    expect(host.bridge.runtime.sessionRegistry.isRegistered(first.windowId)).toBe(false);
    expect(host.bridge.runtime.sessionRegistry.isRegistered(second.windowId)).toBe(true);
    expect(second.destroyed).toBe(false);
    expect(custom.onUnregistered).not.toHaveBeenCalled();

    host.destroy();
    host.destroy();
    expect(custom.onUnregistered).toHaveBeenCalledOnce();
    expect(custom.onWindowDestroyed).toHaveBeenCalledTimes(2);
    expect(second.window).toBeUndefined();
    expect(signer.observed).toBe(false);
    expect(pool.close).not.toHaveBeenCalled();
  });

  it("routes messages from registered windows and applies recipient ACL checks", async () => {
    const custom = service("intent");
    const { host } = createHost({ services: { intent: custom } });
    const fixture = await artifact();
    const instance = await host.resolve(fixture.event, fixture);
    expect(instance.send({ type: "intent.deliver" })).toBe(false);
    instance.mount(frame());
    await instance.whenReady();

    // Default policy grants reads; unknown host message types are never delivered.
    expect(instance.send({ type: "unknown.push" })).toBe(false);
    expect(instance.send({ type: "intent.deliver", delivery: {} })).toBe(false);
    expect(instance.send({ type: "intent.changed", availability: {} })).toBe(true);
    expect(
      instance.send({
        type: "intent.deliver",
        delivery: { sender: "host", archetype: "test", action: "open", convention: "napplet:test/open" },
      }),
    ).toBe(true);
    host.bridge.runtime.aclState.block("", instance.resolved.dTag, instance.resolved.aggregateHash);
    expect(instance.send({ type: "intent.changed", availability: {} })).toBe(false);
    expect(
      instance.send({
        type: "intent.deliver",
        delivery: { sender: "host", archetype: "test", action: "open", convention: "napplet:test/open" },
      }),
    ).toBe(false);
  });

  it("keeps identical request IDs scoped to their source windows", async () => {
    const custom = service("intent");
    const { host } = createHost({ services: { intent: custom } });
    const fixture = await artifact(`<html><body><script>
      addEventListener("message", (event) => {
        if (event.data.type === "shell.init") {
          parent.postMessage({ type: "intent.available", id: "same", archetype: "test" }, "*");
        }
      });
    </script></body></html>`);
    const first = await host.resolve(fixture.event, fixture);
    const second = await host.resolve(fixture.event, fixture);
    first.mount(frame());
    second.mount(frame());
    await Promise.all([first.whenReady(), second.whenReady()]);
    await vi.waitFor(() => expect(custom.handleMessage).toHaveBeenCalledTimes(2));
    const callers = vi
      .mocked(custom.handleMessage)
      .mock.calls.map(([windowId, message]) => [windowId, "id" in message ? message.id : undefined]);
    expect(callers).toEqual(
      expect.arrayContaining([
        [first.windowId, "same"],
        [second.windowId, "same"],
      ]),
    );
  });

  it("does not route an unregistered iframe to services", async () => {
    const custom = service("intent");
    createHost({ services: { intent: custom } });
    const iframe = frame();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: { type: "intent.available", id: "same", archetype: "test" },
      }),
    );
    expect(custom.handleMessage).not.toHaveBeenCalled();
  });

  it("uses the default Blossom fetcher and reuses verified cached artifacts", async () => {
    const cacheName = `applesauce-host-test-${crypto.randomUUID()}`;
    cacheNames.push(cacheName);
    const cache = new CacheStorageNappletArtifactCache({ cacheName });
    const fixture = await artifact();
    const bytes = await fixture.fetchBlob();
    const event = finalizeEvent(
      {
        ...fixture.event,
        tags: [...fixture.event.tags, ["server", "https://blossom.example/"]],
      },
      key,
    );
    const fetchArtifact = vi.fn(async () => new Response(bytes));
    const { host } = createHost({ cache, fetch: fetchArtifact });
    const first = await host.resolve(event);
    const second = await host.resolve(event);
    expect(first.source).toBe("fetch");
    expect(second.source).toBe("cache");
    expect(fetchArtifact).toHaveBeenCalledExactlyOnceWith(
      `https://blossom.example/${event.tags.find((tag) => tag[0] === "x")![1]}`,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("broadcasts account changes through the bridge and stops observing on shutdown", async () => {
    const { host, signer } = createHost();
    const publishIdentity = vi.spyOn(host.bridge, "publishIdentityChanged");
    const fixture = await artifact();
    const account: ISigner = {
      getPublicKey: async () => fixture.event.pubkey,
      signEvent: async (template) => finalizeEvent(template, key),
    };
    signer.next(account);
    await vi.waitFor(() => expect(publishIdentity).toHaveBeenCalledWith(expect.any(String)));
    expect(publishIdentity).toHaveBeenLastCalledWith(await account.getPublicKey());
    signer.next(undefined);
    expect(publishIdentity).toHaveBeenLastCalledWith("");
    host.destroy();
    expect(signer.observed).toBe(false);
  });

  it("rejects invalid artifact bytes without registering a window", async () => {
    const { host } = createHost();
    const fixture = await artifact();
    await expect(host.resolve(fixture.event, { fetchBlob: async () => new Uint8Array([1]) })).rejects.toThrow();
  });

  it("does not create an instance when resolution finishes after destruction", async () => {
    const { host } = createHost();
    const fixture = await artifact();
    let release!: (bytes: Uint8Array) => void;
    const pending = host.resolve(fixture.event, {
      fetchBlob: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    host.destroy();
    release(await fixture.fetchBlob());
    await expect(pending).rejects.toThrow("host is destroyed");
    await expect(host.resolve(fixture.event, fixture)).rejects.toThrow("host is destroyed");
  });

  it("rejects readiness on destruction before mounting and prevents frame reuse", async () => {
    const { host } = createHost();
    const fixture = await artifact();
    const first = await host.resolve(fixture.event, fixture);
    const second = await host.resolve(fixture.event, fixture);
    const iframe = frame();
    first.mount(iframe);
    first.mount(iframe);
    expect(() => second.mount(iframe)).toThrow("already registered");
    expect(() => first.mount(frame())).toThrow("already mounted");
    second.destroy();
    await expect(second.whenReady()).rejects.toThrow("instance is destroyed");
    expect(() => second.mount(frame())).toThrow("instance is destroyed");
  });

  it("times out initialization and removes its registration", async () => {
    const { host } = createHost({ readyTimeout: 100 });
    vi.spyOn(host.bridge, "handleMessage").mockImplementation(() => {});
    const fixture = await artifact();
    const instance = await host.resolve(fixture.event, fixture);
    instance.mount(frame());
    await expect(instance.whenReady()).rejects.toThrow("timed out");
    expect(instance.destroyed).toBe(true);
    expect(originRegistry.getAllWindowIds()).not.toContain(instance.windowId);
  });

  it("finishes host cleanup even when a custom scoped relay cleanup throws", async () => {
    const closeScopedRelay = vi.fn(() => {
      throw new Error("custom cleanup failed");
    });
    const custom = service("intent");
    const { host, signer } = createHost({
      services: { intent: custom },
      shell: { relayPool: { closeScopedRelay } },
    });
    const fixture = await artifact();
    const first = await host.resolve(fixture.event, fixture);
    const second = await host.resolve(fixture.event, fixture);
    first.mount(frame());
    second.mount(frame());
    await Promise.all([first.whenReady(), second.whenReady()]);
    expect(() => host.destroy()).toThrow("Kehto cleanup failed");
    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(true);
    expect(closeScopedRelay).toHaveBeenCalledTimes(2);
    expect(custom.onUnregistered).toHaveBeenCalledOnce();
    expect(signer.observed).toBe(false);
  });

  it("revokes an instance on a subsequent document load", async () => {
    const { host } = createHost();
    const fixture = await artifact();
    const instance = await host.resolve(fixture.event, fixture);
    const iframe = frame();
    instance.mount(iframe);
    await instance.whenReady();
    iframe.srcdoc = "<html><body>Changed document</body></html>";
    await vi.waitFor(() => expect(instance.destroyed).toBe(true));
    expect(originRegistry.getAllWindowIds()).not.toContain(instance.windowId);
  });
});
