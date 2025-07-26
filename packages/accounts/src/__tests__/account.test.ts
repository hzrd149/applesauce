import { SimpleSigner } from "applesauce-signers";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BaseAccount, SignerMismatchError } from "../account.js";
import { SimpleAccount } from "../accounts/simple-account.js";

describe("request queue", () => {
  let signer: SimpleSigner;
  beforeEach(() => {
    signer = new SimpleSigner();
  });
  it("should queue signing requests by default", async () => {
    const account = new BaseAccount(await signer.getPublicKey(), signer);

    let resolve: (() => void)[] = [];
    vi.spyOn(signer, "signEvent").mockImplementation(() => {
      return new Promise((res) => {
        resolve.push(() => res(finalizeEvent({ kind: 1, content: "mock", created_at: 0, tags: [] }, signer.key)));
      });
    });

    // make two signing requests
    expect(account.signEvent({ kind: 1, content: "first", created_at: 0, tags: [] })).toEqual(expect.any(Promise));
    expect(account.signEvent({ kind: 1, content: "second", created_at: 0, tags: [] })).toEqual(expect.any(Promise));

    await Promise.resolve();

    expect(signer.signEvent).toHaveBeenCalledOnce();
    expect(signer.signEvent).toHaveBeenCalledWith(expect.objectContaining({ content: "first" }));

    // resolve first
    resolve.shift()?.();

    // wait next tick
    await new Promise((res) => setTimeout(res, 0));

    expect(signer.signEvent).toHaveBeenCalledTimes(2);
    expect(signer.signEvent).toHaveBeenCalledWith(expect.objectContaining({ content: "second" }));

    // resolve second
    resolve.shift()?.();

    // wait next tick
    await new Promise((res) => setTimeout(res, 0));

    expect(Reflect.get(account, "queueLength")).toBe(0);
    expect(Reflect.get(account, "lock")).toBeNull();
  });

  it("should cancel queue if request throws", () => {});

  it("should not use queueing if its disabled", async () => {
    const account = new BaseAccount(await signer.getPublicKey(), signer);
    account.disableQueue = true;

    let resolve: (() => void)[] = [];
    vi.spyOn(signer, "signEvent").mockImplementation(() => {
      return new Promise((res) => {
        resolve.push(() => res(finalizeEvent({ kind: 1, content: "mock", created_at: 0, tags: [] }, signer.key)));
      });
    });

    // make two signing requests
    account.signEvent({ kind: 1, content: "first", created_at: 0, tags: [] });
    account.signEvent({ kind: 1, content: "second", created_at: 0, tags: [] });

    // Wait for next tick
    await Promise.resolve();

    expect(Reflect.get(account, "lock")).toBeNull();
    expect(signer.signEvent).toHaveBeenCalledTimes(2);
    expect(signer.signEvent).toHaveBeenCalledWith(expect.objectContaining({ content: "first" }));
    expect(signer.signEvent).toHaveBeenCalledWith(expect.objectContaining({ content: "second" }));

    // resolve both
    resolve.shift()?.();
    resolve.shift()?.();
  });
});

describe("type", () => {
  it("should return static account type", () => {
    const account = SimpleAccount.fromKey(generateSecretKey());

    expect(account.type).toBe("nsec");
  });
});

describe("nip04 and nip44", () => {
  it("should return undefined when signer does not support nip04/nip44", () => {
    const signer: Nip07Interface = {
      getPublicKey: async () => "test-pubkey",
      signEvent: async () => ({
        id: "",
        pubkey: "test-pubkey",
        created_at: 0,
        kind: 1,
        tags: [],
        content: "",
        sig: "",
      }),
    };

    const account = new BaseAccount("test-pubkey", signer);

    expect(account.nip04).toBeUndefined();
    expect(account.nip44).toBeUndefined();
  });

  it("should return nip04/nip44 interface when signer supports them", async () => {
    const signer: Nip07Interface = {
      getPublicKey: async () => "test-pubkey",
      signEvent: async () => ({
        id: "",
        pubkey: "test-pubkey",
        created_at: 0,
        kind: 1,
        tags: [],
        content: "",
        sig: "",
      }),
      nip04: {
        encrypt: async () => "encrypted",
        decrypt: async () => "decrypted",
      },
      nip44: {
        encrypt: async () => "encrypted",
        decrypt: async () => "decrypted",
      },
    };

    const account = new BaseAccount("test-pubkey", signer);

    expect(account.nip04).toBeDefined();
    expect(account.nip44).toBeDefined();

    const nip04Result = await account.nip04!.encrypt("pubkey", "test");
    expect(nip04Result).toBe("encrypted");

    const nip44Result = await account.nip44!.encrypt("pubkey", "test");
    expect(nip44Result).toBe("encrypted");
  });

  it("should reflect changes in signer nip04/nip44 support", () => {
    const signer: Nip07Interface = {
      getPublicKey: async () => "test-pubkey",
      signEvent: async () => ({
        id: "",
        pubkey: "test-pubkey",
        created_at: 0,
        kind: 1,
        tags: [],
        content: "",
        sig: "",
      }),
    };

    const account = new BaseAccount("test-pubkey", signer);
    expect(account.nip04).toBeUndefined();
    expect(account.nip44).toBeUndefined();

    // Add nip04 support
    signer.nip04 = {
      encrypt: async () => "encrypted",
      decrypt: async () => "decrypted",
    };
    expect(account.nip04).toBeDefined();
    expect(account.nip44).toBeUndefined();

    // Add nip44 support
    signer.nip44 = {
      encrypt: async () => "encrypted",
      decrypt: async () => "decrypted",
    };
    expect(account.nip04).toBeDefined();
    expect(account.nip44).toBeDefined();

    // Remove nip04 support
    signer.nip04 = undefined;
    expect(account.nip04).toBeUndefined();
    expect(account.nip44).toBeDefined();
  });
});

describe("signEvent", () => {
  it("should set pubkey if not present", async () => {
    const signer = new SimpleSigner();
    const account = new BaseAccount(await signer.getPublicKey(), signer);
    vi.spyOn(signer, "signEvent");

    await account.signEvent({ kind: 1, content: "test", created_at: 0, tags: [] });
    expect(signer.signEvent).toHaveBeenCalledWith(expect.objectContaining({ pubkey: account.pubkey }));
  });

  it("should throw if signer returns an event with the wrong pubkey", async () => {
    const signer = new SimpleSigner();
    const account = new BaseAccount(await signer.getPublicKey(), signer);

    // Mock return wrong pubkey
    vi.spyOn(signer, "signEvent").mockResolvedValue(
      finalizeEvent({ kind: 1, content: "test", created_at: 0, tags: [] }, generateSecretKey()),
    );

    await expect(account.signEvent({ kind: 1, content: "test", created_at: 0, tags: [] })).rejects.toThrow(
      SignerMismatchError,
    );
  });

  it("should throw if signer returns an event with the wrong id", async () => {
    const signer = new SimpleSigner();
    const account = new BaseAccount(await signer.getPublicKey(), signer);

    // Mock return wrong pubkey
    vi.spyOn(signer, "signEvent").mockResolvedValue(
      finalizeEvent({ kind: 1, content: "test", created_at: 0, tags: [["t", "extra"]] }, signer.key),
    );

    await expect(account.signEvent({ kind: 1, content: "test", created_at: 0, tags: [] })).rejects.toThrow(
      SignerMismatchError,
    );
  });
});
