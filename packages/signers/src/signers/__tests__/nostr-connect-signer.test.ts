import { bytesToHex } from "applesauce-core/helpers/event";
import { NEVER } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NostrConnectSigner } from "../nostr-connect-signer.js";
import { PrivateKeySigner } from "../private-key-signer.js";

const relays = ["wss://relay.signer.com"];
const client = new PrivateKeySigner();
const remote = new PrivateKeySigner();

const subscriptionMethod = vi.fn().mockReturnValue(NEVER);
const publishMethod = vi.fn(async () => {});

let signer: NostrConnectSigner;

beforeEach(async () => {
  subscriptionMethod.mockClear();
  publishMethod.mockClear();

  signer = new NostrConnectSigner({
    relays,
    remote: await remote.getPublicKey(),
    signer: client,
    subscriptionMethod,
    publishMethod,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connection", () => {
  it("should call subscription method with filters", async () => {
    signer.connect();

    expect(subscriptionMethod).toHaveBeenCalledWith(relays, [{ "#p": [await client.getPublicKey()], kinds: [24133] }]);
  });
});

describe("open", () => {
  it("should call subscription method with filters", async () => {
    signer.open();

    expect(subscriptionMethod).toHaveBeenCalledWith(relays, [{ "#p": [await client.getPublicKey()], kinds: [24133] }]);
  });
});

describe("waitForSigner", () => {
  it("should accept an abort signal", async () => {
    const signer = new NostrConnectSigner({
      relays: ["wss://relay.signer.com"],
      signer: client,
      subscriptionMethod,
      publishMethod,
    });

    const controller = new AbortController();
    const p = signer.waitForSigner(controller.signal);

    setTimeout(() => {
      controller.abort();
    }, 10);

    await expect(p).rejects.toThrow("Aborted");
    expect(signer.listening).toBe(false);
  });
});

describe("nbunksec", () => {
  it("should export the current session", async () => {
    signer.connectSecret = "test-secret";

    expect(NostrConnectSigner.parseNbunksec(signer.getNbunksec())).toEqual({
      remote: await remote.getPublicKey(),
      clientKey: bytesToHex(client.key),
      relays,
      secret: "test-secret",
    });
  });

  it("should create a signer from an encoded session", async () => {
    const encoded = NostrConnectSigner.createNbunksec({
      remote: await remote.getPublicKey(),
      clientKey: bytesToHex(client.key),
      relays,
      secret: "test-secret",
    });
    const connect = vi.spyOn(NostrConnectSigner.prototype, "connect").mockResolvedValue("ack");

    const imported = await NostrConnectSigner.fromNbunksec(encoded, {
      permissions: ["get_public_key"],
      subscriptionMethod,
      publishMethod,
    });

    expect(imported.remote).toBe(await remote.getPublicKey());
    expect(imported.relays).toEqual(relays);
    expect(imported.signer.key).toEqual(client.key);
    expect(imported.connectSecret).toBe("test-secret");
    expect(connect).toHaveBeenCalledWith("test-secret", ["get_public_key"]);
  });
});

describe("close", () => {
  it("it should cancel waiting for signer promie", async () => {
    const p = signer.waitForSigner();
    await signer.close();
    await expect(p).rejects.toThrow("Closed");
  });
});
