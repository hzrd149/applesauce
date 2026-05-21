import { beforeEach, describe, expect, it, vi } from "vitest";
import { unixNow } from "applesauce-core/helpers";

import { NamecoinIdentityLoader } from "../namecoin-identity-loader.js";
import { Identity, IdentityStatus } from "../../helpers/namecoin-identity.js";

const PK1 = "460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c";

let loader: NamecoinIdentityLoader;
beforeEach(() => {
  loader = new NamecoinIdentityLoader();
});

describe("fetchIdentity", () => {
  it("throws a clear error when no resolver is configured", async () => {
    const result = await loader.fetchIdentity("alice", "d/example");
    expect(result.status).toBe(IdentityStatus.Error);
    expect((result as { error: string }).error).toMatch(/No Namecoin resolver configured/);
  });

  it("parses the extended `nostr` form returned by the resolver", async () => {
    loader.resolve = vi.fn().mockResolvedValue(
      JSON.stringify({
        nostr: {
          names: { alice: PK1 },
          relays: { [PK1]: ["wss://relay.example.com"] },
        },
      }),
    );

    const identity = await loader.fetchIdentity("alice", "d/example");
    expect(loader.resolve).toHaveBeenCalledWith("d/example");
    expect(identity.status).toBe(IdentityStatus.Found);
    expect((identity as { pubkey: string }).pubkey).toBe(PK1);
    expect((identity as { relays?: string[] }).relays).toEqual(["wss://relay.example.com"]);
  });

  it("parses the simple `nostr: hex` form on the root entry", async () => {
    loader.resolve = vi.fn().mockResolvedValue(JSON.stringify({ nostr: PK1 }));

    const identity = await loader.fetchIdentity("_", "d/example");
    expect(identity.status).toBe(IdentityStatus.Found);
    expect((identity as { pubkey: string }).pubkey).toBe(PK1);
  });

  it("returns IdentityStatus.Missing when the value has no nostr field", async () => {
    loader.resolve = vi.fn().mockResolvedValue(JSON.stringify({ ip: "1.2.3.4" }));

    const identity = await loader.fetchIdentity("alice", "d/example");
    expect(identity.status).toBe(IdentityStatus.Missing);
  });

  it("returns IdentityStatus.Error on invalid JSON", async () => {
    loader.resolve = vi.fn().mockResolvedValue("not json");

    const identity = await loader.fetchIdentity("_", "d/example");
    expect(identity.status).toBe(IdentityStatus.Error);
  });

  it("returns IdentityStatus.Error when the resolver throws", async () => {
    loader.resolve = vi.fn().mockRejectedValue(new Error("boom"));

    const identity = await loader.fetchIdentity("_", "d/example");
    expect(identity.status).toBe(IdentityStatus.Error);
    expect((identity as { error: string }).error).toBe("boom");
  });

  it("populates the resolved-identity map on success", async () => {
    loader.resolve = vi.fn().mockResolvedValue(JSON.stringify({ nostr: { names: { alice: PK1 } } }));
    await loader.fetchIdentity("alice", "d/example");
    expect(loader.getIdentity("alice", "d/example")?.status).toBe(IdentityStatus.Found);
  });

  it("does not bind `this` to the loader inside resolve", async () => {
    let captured: unknown = undefined;
    loader.resolve = function (this: unknown) {
      captured = this;
      return Promise.resolve(JSON.stringify({ nostr: PK1 }));
    };
    await loader.fetchIdentity("_", "d/example");
    expect(captured).not.toBe(loader);
  });
});

describe("loadIdentity / cache", () => {
  it("loads from the cache when fresh", async () => {
    const fresh: Identity = {
      name: "_",
      domain: "d/example",
      pubkey: PK1,
      checked: unixNow(),
      status: IdentityStatus.Found,
    };
    const cache = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(fresh),
    };
    loader.cache = cache;
    loader.resolve = vi.fn().mockRejectedValue(new Error("should not be called"));

    const identity = await loader.loadIdentity("_", "d/example");
    expect(cache.load).toHaveBeenCalledWith("d/example#_");
    expect(loader.resolve).not.toHaveBeenCalled();
    expect(identity).toBe(fresh);
  });

  it("falls through to fetch when the cached identity is expired", async () => {
    const stale: Identity = {
      name: "_",
      domain: "d/example",
      pubkey: PK1,
      checked: unixNow() - 60 * 60 * 24 * 30,
      status: IdentityStatus.Found,
    };
    const cache = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(stale),
    };
    loader.cache = cache;
    loader.resolve = vi.fn().mockResolvedValue(JSON.stringify({ nostr: PK1 }));

    await loader.loadIdentity("_", "d/example");
    expect(loader.resolve).toHaveBeenCalled();
    expect(cache.save).toHaveBeenCalled();
  });

  it("falls through to fetch when the cache misses", async () => {
    const cache = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    };
    loader.cache = cache;
    loader.resolve = vi.fn().mockResolvedValue(JSON.stringify({ nostr: PK1 }));

    await loader.loadIdentity("_", "d/example");
    expect(loader.resolve).toHaveBeenCalled();
  });
});

describe("requestIdentity", () => {
  it("accepts a single identifier string and resolves it", async () => {
    loader.resolve = vi.fn().mockResolvedValue(JSON.stringify({ nostr: { names: { alice: PK1 } } }));
    const identity = await loader.requestIdentity("alice@example.bit");
    expect(loader.resolve).toHaveBeenCalledWith("d/example");
    expect(identity.status).toBe(IdentityStatus.Found);
  });

  it("rejects when given an unparseable identifier", async () => {
    await expect(loader.requestIdentity("alice@example.com")).rejects.toThrow(/Invalid Namecoin identifier/);
  });

  it("deduplicates concurrent in-flight requests for the same identifier", async () => {
    let resolveFn!: (s: string) => void;
    const inflight = new Promise<string>((resolve) => {
      resolveFn = resolve;
    });
    loader.resolve = vi.fn().mockReturnValue(inflight);

    const p1 = loader.requestIdentity("alice", "d/example");
    const p2 = loader.requestIdentity("alice", "d/example");
    resolveFn(JSON.stringify({ nostr: { names: { alice: PK1 } } }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(loader.resolve).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });
});
