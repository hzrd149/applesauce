import { unixNow } from "applesauce-core/helpers";
import { bytesToHex, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { NEVER } from "rxjs";
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
    const connect = vi.spyOn(NostrConnectSigner.prototype, "connect").mockResolvedValue("ack");

    const imported = await NostrConnectSigner.fromNbunksec(encoded, {
      permissions: ["get_public_key"],
      subscriptionMethod,
      publishMethod,
    });

    expect(imported.remote).toBe(await remote.getPublicKey());
    expect(imported.relays).toEqual(relays);
    expect(imported.signer.key).toEqual(client.key);
    expect(imported.bunkerSecret).toBe("test-secret");
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
