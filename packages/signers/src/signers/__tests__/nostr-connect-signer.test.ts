import { unixNow } from "applesauce-core/helpers";
import { bytesToHex, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { NEVER, throwError } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NostrConnectSigner } from "../nostr-connect-signer.js";
import { PrivateKeySigner } from "../private-key-signer.js";

const relays = ["wss://relay.signer.com"];
const client = new PrivateKeySigner();
const remote = new PrivateKeySigner();

const subscriptionMethod = vi.fn().mockReturnValue(NEVER);
const publishMethod = vi.fn(async (_relays: string[], _event: NostrEvent) => {});

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

describe("deprecated secret alias", () => {
  it("should map the deprecated secret option to connectSecret", () => {
    const signer = new NostrConnectSigner({ relays, secret: "client-secret", subscriptionMethod, publishMethod });

    expect(signer.connectSecret).toBe("client-secret");
    expect(signer.secret).toBe("client-secret");
  });

  it("should proxy the secret getter/setter to connectSecret", () => {
    signer.secret = "new-secret";

    expect(signer.connectSecret).toBe("new-secret");
    expect(signer.secret).toBe("new-secret");
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
    signer.bunkerSecret = "test-secret";

    expect(NostrConnectSigner.parseNbunksec(signer.getNbunksec())).toEqual({
      remote: await remote.getPublicKey(),
      clientKey: bytesToHex(client.key),
      relays,
      secret: "test-secret",
      bunkerSecret: "test-secret",
    });
  });

  it("should create a signer from an encoded session", async () => {
    const encoded = NostrConnectSigner.createNbunksec({
      remote: await remote.getPublicKey(),
      clientKey: bytesToHex(client.key),
      relays,
      bunkerSecret: "test-secret",
    });
    const connect = vi.spyOn(NostrConnectSigner.prototype, "connect");

    const imported = await NostrConnectSigner.fromNbunksec(encoded, { subscriptionMethod, publishMethod });

    expect(imported.remote).toBe(await remote.getPublicKey());
    expect(imported.relays).toEqual(relays);
    expect(imported.signer.key).toEqual(client.key);
    expect(imported.bunkerSecret).toBe("test-secret");
    expect(imported.listening).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    expect(publishMethod).not.toHaveBeenCalled();
  });
});

describe("close", () => {
  it("it should cancel waiting for signer promie", async () => {
    const p = signer.waitForSigner();
    await signer.close();
    await expect(p).rejects.toThrow("Closed");
  });
});

async function respond(result: unknown) {
  await vi.waitFor(() => expect(publishMethod).toHaveBeenCalled());
  const [, event] = publishMethod.mock.lastCall!;
  const request = JSON.parse(await remote.nip44.decrypt(event.pubkey, event.content));

  await signer.handleEvent(
    await remote.signEvent({
      kind: kinds.NostrConnect,
      created_at: unixNow(),
      tags: [["p", event.pubkey]],
      content: await remote.nip44.encrypt(event.pubkey, JSON.stringify({ id: request.id, result })),
    }),
  );
}

describe("switchRelays", () => {
  beforeEach(() => {
    signer.isConnected = true;
  });

  it("should switch to relays returned as a JSON string", async () => {
    await signer.open();
    const p = signer.switchRelays();
    await respond(JSON.stringify(["wss://new.relay.com"]));

    await expect(p).resolves.toEqual(["wss://new.relay.com"]);
    expect(signer.relays).toEqual(["wss://new.relay.com"]);
    expect(subscriptionMethod).toHaveBeenLastCalledWith(["wss://new.relay.com"], expect.any(Array));
  });

  it("should switch to relays returned as an array", async () => {
    const p = signer.switchRelays();
    await respond(["wss://new.relay.com"]);

    await expect(p).resolves.toEqual(["wss://new.relay.com"]);
    expect(signer.relays).toEqual(["wss://new.relay.com"]);
  });

  it("should keep relays when signer returns a JSON string null", async () => {
    const p = signer.switchRelays();
    await respond("null");

    await expect(p).resolves.toBeNull();
    expect(signer.relays).toEqual(relays);
  });

  it("should keep relays when signer returns null", async () => {
    const p = signer.switchRelays();
    await respond(null);

    await expect(p).resolves.toBeNull();
    expect(signer.relays).toEqual(relays);
  });
});

/** Creates a response event from the remote signer to the client */
async function createResponse(id: string, result: unknown, error?: string, from = remote) {
  const clientPubkey = await client.getPublicKey();
  return from.signEvent({
    kind: kinds.NostrConnect,
    created_at: unixNow(),
    tags: [["p", clientPubkey]],
    content: await from.nip44.encrypt(clientPubkey, JSON.stringify({ id, result, error })),
  });
}

/** Decrypts the last request published by the signer */
async function lastRequest() {
  await vi.waitFor(() => expect(publishMethod).toHaveBeenCalled());
  const [, event] = publishMethod.mock.lastCall!;
  return JSON.parse(await remote.nip44.decrypt(event.pubkey, event.content));
}

describe("nostrconnect handshake", () => {
  let qrSigner: NostrConnectSigner;
  beforeEach(() => {
    qrSigner = new NostrConnectSigner({ relays, signer: client, subscriptionMethod, publishMethod });
  });

  it("should ignore an ack response without the secret", async () => {
    const p = qrSigner.waitForSigner();
    await qrSigner.handleEvent(await createResponse("x", "ack"));

    expect(qrSigner.remote).toBeUndefined();
    expect(qrSigner.isConnected).toBe(false);
    qrSigner.close();
    await expect(p).rejects.toThrow("Closed");
  });

  it("should connect when the response contains the secret", async () => {
    const p = qrSigner.waitForSigner();
    await qrSigner.handleEvent(await createResponse("x", qrSigner.connectSecret));

    await expect(p).resolves.toBeUndefined();
    expect(qrSigner.remote).toBe(await remote.getPublicKey());
    expect(qrSigner.isConnected).toBe(true);
  });

  it("should not close the signer when aborted after connecting", async () => {
    const controller = new AbortController();
    const p = qrSigner.waitForSigner(controller.signal);
    await qrSigner.handleEvent(await createResponse("x", qrSigner.connectSecret));
    await p;

    controller.abort();
    expect(qrSigner.listening).toBe(true);
    expect(qrSigner.isConnected).toBe(true);
  });

  it("should send switch_relays after connecting when autoSwitchRelays is enabled", async () => {
    qrSigner.autoSwitchRelays = true;
    const p = qrSigner.waitForSigner();
    await qrSigner.handleEvent(await createResponse("x", qrSigner.connectSecret));
    await p;

    expect((await lastRequest()).method).toBe("switch_relays");
  });
});

describe("requireConnection", () => {
  it("should resume a known session without sending connect", async () => {
    signer.isConnected = true;
    await signer.open();
    await signer.close();

    const p = signer.getPublicKey();
    const request = await lastRequest();
    expect(request.method).toBe("get_public_key");
    expect(publishMethod).toHaveBeenCalledTimes(1);

    await signer.handleEvent(await createResponse(request.id, await remote.getPublicKey()));
    await expect(p).resolves.toBe(await remote.getPublicKey());
    expect(signer.listening).toBe(true);
  });
});

describe("getPublicKey", () => {
  it("should only request the pubkey once", async () => {
    const p = signer.getPublicKey();
    const request = await lastRequest();
    await signer.handleEvent(await createResponse(request.id, await remote.getPublicKey()));
    await p;

    await expect(signer.getPublicKey()).resolves.toBe(await remote.getPublicKey());
    expect(publishMethod).toHaveBeenCalledTimes(1);
  });
});

describe("connect", () => {
  it("should send client metadata as the fourth param", async () => {
    signer.metadata = { name: "Test App", url: "https://example.com" };
    signer.connect("secret");

    const request = await lastRequest();
    expect(request.params).toEqual([
      await remote.getPublicKey(),
      "secret",
      "",
      JSON.stringify({ name: "Test App", url: "https://example.com" }),
    ]);
  });

  it("should send three params without metadata", async () => {
    signer.connect("secret", ["sign_event:1"]);

    const request = await lastRequest();
    expect(request.params).toEqual([await remote.getPublicKey(), "secret", "sign_event:1"]);
  });
});

describe("request timeout", () => {
  it("should reject when the remote signer does not respond", async () => {
    signer.timeout = 20;
    await expect(signer.getPublicKey()).rejects.toThrow("Remote signer did not respond to get_public_key request");
  });

  it("should reject when publishing fails", async () => {
    publishMethod.mockRejectedValueOnce(new Error("Publish failed"));
    await expect(signer.getPublicKey()).rejects.toThrow("Publish failed");
  });

  it("should reject when a publish observable errors", async () => {
    publishMethod.mockReturnValueOnce(throwError(() => new Error("Relay rejected")) as any);
    await expect(signer.getPublicKey()).rejects.toThrow("Relay rejected");
  });

  it("should reject pending requests when closed", async () => {
    const p = signer.getPublicKey();
    await lastRequest();
    await signer.close();
    await expect(p).rejects.toThrow("Closed");
  });
});

describe("logout", () => {
  beforeEach(async () => {
    signer.isConnected = true;
    await signer.open();
  });

  it("should wait for the remote signer to acknowledge", async () => {
    let done = false;
    const p = signer.logout().then(() => (done = true));

    const request = await lastRequest();
    expect(request.method).toBe("logout");
    expect(done).toBe(false);
    expect(signer.listening).toBe(true);

    await signer.handleEvent(await createResponse(request.id, "ack"));
    await p;
    expect(signer.listening).toBe(false);
  });

  it("should close after the timeout if the remote signer does not respond", async () => {
    await signer.logout({ timeout: 20 });

    expect((await lastRequest()).method).toBe("logout");
    expect(signer.listening).toBe(false);
  });

  it("should reject pending requests when closing", async () => {
    const pending = signer.getPublicKey();
    await lastRequest();

    await signer.logout({ timeout: 20 });
    await expect(pending).rejects.toThrow("Closed");
  });
});

describe("close", () => {
  it("should do nothing when already closed", async () => {
    const log = vi.fn();
    (signer as any).log = log;

    await signer.open();
    await signer.close();
    await signer.close();

    expect(log.mock.calls.filter(([msg]) => msg === "Closed")).toHaveLength(1);
  });
});
