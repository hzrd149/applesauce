import { beforeEach, describe, expect, it, vi } from "vitest";
import { DnsIdentityLoader } from "../dns-identity-loader.js";
import { unixNow } from "applesauce-core/helpers";
import { Identity, IdentityStatus } from "../../helpers/dns-identity.js";

let loader: DnsIdentityLoader;
beforeEach(() => {
  loader = new DnsIdentityLoader();
});

describe("fetch", () => {
  it("should not assign this in fetch method", async () => {
    const loader = new DnsIdentityLoader();

    let that: any = undefined;
    function custom() {
      //@ts-expect-error
      that = this;
      throw new Error("not implemented");
    }

    // @ts-expect-error
    loader.fetch = custom;

    await loader.fetchIdentity("_", "hzrd149.com");
    expect(that).not.toBe(loader);
  });

  it("should url encode the name", async () => {
    loader.fetch = vi.fn().mockRejectedValue(new Error("error"));
    await loader.fetchIdentity("alice&evil=true", "example.com");
    expect(loader.fetch).toHaveBeenCalledWith(
      "https://example.com/.well-known/nostr.json?name=alice%26evil%3Dtrue",
      expect.anything(),
    );
  });
});

describe("requestIdentity", () => {
  it("should load from cache first", async () => {
    const cache = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue({
        name: "_",
        domain: "hzrd149.com",
        pubkey: "pubkey",
        checked: unixNow(),
        status: IdentityStatus.Found,
      } satisfies Identity),
    };

    loader.cache = cache;
    loader.fetch = vi.fn().mockRejectedValue(new Error("error"));

    await loader.requestIdentity("_", "hzrd149.com");
    expect(cache.load).toHaveBeenCalledWith("_@hzrd149.com");
    expect(loader.fetch).not.toHaveBeenCalled();
  });

  it("should fetch if cache is too old", async () => {
    const cache = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue({
        name: "_",
        domain: "hzrd149.com",
        pubkey: "pubkey",
        checked: unixNow() - 60 * 60 * 24 * 7 * 2,
        status: IdentityStatus.Found,
      } satisfies Identity),
    };

    loader.cache = cache;
    loader.fetch = vi.fn().mockRejectedValue(new Error("error"));

    await loader.requestIdentity("_", "hzrd149.com");
    expect(cache.load).toHaveBeenCalledWith("_@hzrd149.com");
    expect(loader.fetch).toHaveBeenCalled();
  });

  it("should reuse a recent failure", async () => {
    loader.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(loader.requestIdentity("_", "example.com")).resolves.toMatchObject({ status: IdentityStatus.Error });
    await loader.requestIdentity("_", "example.com");
    expect(loader.fetch).toHaveBeenCalledTimes(1);
  });

  it("should retry a failure after the error expiration", async () => {
    loader.errorExpiration = -1;
    loader.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response(JSON.stringify({ names: { _: "pubkey" } }), { status: 200 }));

    await expect(loader.requestIdentity("_", "example.com")).resolves.toMatchObject({ status: IdentityStatus.Error });
    await expect(loader.requestIdentity("_", "example.com")).resolves.toMatchObject({
      status: IdentityStatus.Found,
      pubkey: "pubkey",
    });
  });

  it("should refetch an identity after it expires", async () => {
    loader.fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ names: { _: "pubkey" } }), { status: 200 }));

    await loader.requestIdentity("_", "example.com");
    loader.expiration = -1;
    await loader.requestIdentity("_", "example.com");
    expect(loader.fetch).toHaveBeenCalledTimes(2);
  });
});
