import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WS } from "vitest-websocket-mock";
import { kinds } from "nostr-tools";
import { nanoid } from "nanoid";

import { FakeUser } from "../../__tests__/fake-user";
import { NostrConnectProvider } from "../nostr-connect-provider";
import { SimpleSigner } from "../simple-signer";
import { NostrPool } from "../nostr-connect-signer";
import {
  buildSigningPermissions,
  createNostrConnectURI,
  NostrConnectMethod,
  NostrConnectRequest,
} from "../../helpers/nostr-connect";

let relay: WS;
let pool: NostrPool;
beforeEach(async () => {
  relay = new WS("wss://test", { jsonProtocol: true });
  pool = {
    subscription: vi.fn().mockReturnValue({
      subscribe: vi.fn().mockReturnValue({
        unsubscribe: vi.fn(),
      }),
    }),
    publish: vi.fn().mockResolvedValue(undefined),
  };

  NostrConnectProvider.pool = pool;
});
afterEach(async () => {
  await WS.clean();
});

const user = new FakeUser();

describe("getBunkerURI", () => {
  it("should create a bunker uri", async () => {
    const provider = new NostrConnectProvider({
      upstream: user,
      signer: new SimpleSigner(),
      relays: ["wss://relay.nsec.app"],
    });

    expect(await provider.getBunkerURI()).toBe(
      `bunker://${await provider.signer.getPublicKey()}?relay=${encodeURIComponent(provider.relays[0])}`,
    );
  });

  it("should create a bunker uri with secret", async () => {
    const provider = new NostrConnectProvider({
      upstream: user,
      signer: new SimpleSigner(),
      relays: ["wss://relay.nsec.app"],
      secret: "test-secret",
    });

    expect(await provider.getBunkerURI()).toBe(
      `bunker://${await provider.signer.getPublicKey()}?relay=${encodeURIComponent(provider.relays[0])}&secret=${encodeURIComponent(provider.secret!)}`,
    );
  });
});

describe("start", () => {
  it("should subscribe to relays for new requests", async () => {
    const signer = new SimpleSigner();
    const provider = new NostrConnectProvider({
      upstream: user,
      signer,
      relays: ["wss://relay.nsec.app"],
    });

    await provider.start();

    expect(pool.subscription).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      [
        {
          kinds: [kinds.NostrConnect],
          "#p": [await signer.getPublicKey()],
        },
      ],
    );
  });

  it("should update subscription when `connect` is received", async () => {
    const client = new FakeUser();
    const signer = new SimpleSigner();
    const provider = new NostrConnectProvider({
      upstream: user,
      signer,
      relays: ["wss://relay.nsec.app"],
      secret: "test-secret",
    });

    await provider.start();
    expect(pool.subscription).toHaveBeenCalledOnce();

    const providerPubkey = await signer.getPublicKey();

    // Send mock `connect` request
    await provider.handleEvent(
      client.event({
        kind: kinds.NostrConnect,
        content: await client.nip44.encrypt(
          providerPubkey,
          JSON.stringify({
            id: nanoid(),
            method: NostrConnectMethod.Connect,
            params: [providerPubkey, "test-secret"],
          } satisfies NostrConnectRequest<NostrConnectMethod.Connect>),
        ),
      }),
    );

    expect(pool.subscription).toHaveBeenCalledTimes(2);
    expect(pool.subscription).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      [
        {
          kinds: [kinds.NostrConnect],
          "#p": [providerPubkey],
          authors: [client.pubkey],
        },
      ],
    );
  });
});

describe("waitForClient", () => {
  it("should respond to `connect` request", async () => {
    const onConnect = vi.fn().mockResolvedValue(true);

    const signer = new FakeUser();
    const provider = new NostrConnectProvider({
      upstream: user,
      signer,
      relays: ["wss://relay.nsec.app"],
      secret: "test-secret",
      onConnect,
    });

    const promise = provider.waitForClient();

    const client = new FakeUser();

    // Send `connect` request to provider
    await provider.handleEvent(
      client.event({
        kind: kinds.NostrConnect,
        content: await client.nip44.encrypt(
          signer.pubkey,
          JSON.stringify({
            id: nanoid(),
            method: NostrConnectMethod.Connect,
            params: [signer.pubkey, "test-secret", buildSigningPermissions([1, 3]).join(",")],
          } satisfies NostrConnectRequest<NostrConnectMethod.Connect>),
        ),
      }),
    );

    expect(onConnect).toHaveBeenCalledOnce();
    expect(onConnect).toHaveBeenCalledWith(client.pubkey, buildSigningPermissions([1, 3]));
    expect(provider.client).toBe(client.pubkey);
    expect(provider.connected).toBe(true);
    await expect(promise).resolves.toBe(client.pubkey);
  });

  it("should accept `connect` when no secret is set", async () => {
    const onConnect = vi.fn().mockResolvedValue(true);

    const signer = new FakeUser();
    const provider = new NostrConnectProvider({
      upstream: user,
      signer,
      relays: ["wss://relay.nsec.app"],
      onConnect,
    });

    const promise = provider.waitForClient();

    const client = new FakeUser();

    // Send `connect` request to provider
    await provider.handleEvent(
      client.event({
        kind: kinds.NostrConnect,
        content: await client.nip44.encrypt(
          signer.pubkey,
          JSON.stringify({
            id: nanoid(),
            method: NostrConnectMethod.Connect,
            params: [signer.pubkey],
          } satisfies NostrConnectRequest<NostrConnectMethod.Connect>),
        ),
      }),
    );

    // Should accept connection since no secret is set
    expect(onConnect).toHaveBeenCalledOnce();
    expect(onConnect).toHaveBeenCalledWith(client.pubkey, []);
    expect(provider.client).toBe(client.pubkey);
    expect(provider.connected).toBe(true);
    await expect(promise).resolves.toBe(client.pubkey);
  });

  it("should reject `connect` when secret is set and incorrect", async () => {
    const onConnect = vi.fn().mockResolvedValue(true);

    const signer = new FakeUser();
    const provider = new NostrConnectProvider({
      upstream: user,
      signer,
      relays: ["wss://relay.nsec.app"],
      secret: "test-secret",
      onConnect,
    });

    provider.waitForClient();

    const client = new FakeUser();

    // Send `connect` request to provider
    await provider.handleEvent(
      client.event({
        kind: kinds.NostrConnect,
        content: await client.nip44.encrypt(
          signer.pubkey,
          JSON.stringify({
            id: nanoid(),
            method: NostrConnectMethod.Connect,
            params: [signer.pubkey],
          } satisfies NostrConnectRequest<NostrConnectMethod.Connect>),
        ),
      }),
    );

    // Should have rejected connection
    expect(onConnect).not.toHaveBeenCalledOnce();
    expect(provider.client).toBeUndefined();
    expect(provider.connected).toBe(false);

    // Should send `connect` error response
    expect(pool.publish).toHaveBeenCalledOnce();
    expect(pool.publish).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      expect.objectContaining({
        kind: kinds.NostrConnect,
        pubkey: signer.pubkey,
        tags: [["p", client.pubkey]],
      }),
    );
  });
});

describe("initiated by client", () => {
  it("should respond to initial nostrconnect:// URI", async () => {
    const client = new FakeUser();

    const uri = createNostrConnectURI({
      client: client.pubkey,
      secret: "test-secret",
      relays: ["wss://relay.nsec.app"],
    });

    const signer = new SimpleSigner();
    const provider = new NostrConnectProvider({
      upstream: user,
      signer,
      relays: ["wss://relay.nsec.app"],
    });

    await provider.start(uri);

    // Should start subscription for new requests
    expect(pool.subscription).toHaveBeenCalledOnce();
    expect(pool.subscription).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      [
        {
          kinds: [kinds.NostrConnect],
          "#p": [await provider.signer.getPublicKey()],
          authors: [client.pubkey],
        },
      ],
    );

    // Should send `connect` response
    expect(pool.publish).toHaveBeenCalledOnce();
    expect(pool.publish).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      expect.objectContaining({
        kind: kinds.NostrConnect,
        tags: [["p", client.pubkey]],
      }),
    );
  });

  it("should respond to initial `connect` request to provider pubkey", async () => {
    const client = new FakeUser();

    const signer = new FakeUser();
    const provider = new NostrConnectProvider({
      upstream: user,
      signer,
      relays: ["wss://relay.nsec.app"],
    });

    // Create a `connect` request to the provider pubkey
    const request = await client.event({
      kind: kinds.NostrConnect,
      content: await client.nip44.encrypt(
        signer.pubkey,
        JSON.stringify({
          id: nanoid(),
          method: NostrConnectMethod.Connect,
          params: [signer.pubkey],
        } satisfies NostrConnectRequest<NostrConnectMethod.Connect>),
      ),
      tags: [["p", signer.pubkey]],
    });

    // Start provider with `connect` request
    await provider.start(request);

    // Should start subscription for new requests
    expect(pool.subscription).toHaveBeenCalledOnce();
    expect(pool.subscription).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      [
        {
          kinds: [kinds.NostrConnect],
          "#p": [signer.pubkey],
          authors: [client.pubkey],
        },
      ],
    );

    // Should send `connect` response
    expect(pool.publish).toHaveBeenCalledOnce();
    expect(pool.publish).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      expect.objectContaining({
        kind: kinds.NostrConnect,
        pubkey: signer.pubkey,
        tags: [["p", client.pubkey]],
      }),
    );
  });

  it("should respond to initial `connect` request to user pubkey", async () => {
    const client = new FakeUser();

    const provider = new NostrConnectProvider({
      upstream: user,
      signer: user,
      relays: ["wss://relay.nsec.app"],
    });

    // Create a `connect` request to the user pubkey
    const request = await client.event({
      kind: kinds.NostrConnect,
      content: await client.nip44.encrypt(
        user.pubkey,
        JSON.stringify({
          id: nanoid(),
          method: NostrConnectMethod.Connect,
          params: [user.pubkey],
        } satisfies NostrConnectRequest<NostrConnectMethod.Connect>),
      ),
      tags: [["p", user.pubkey]],
    });

    // Start provider with `connect` request
    await provider.start(request);

    // Should start subscription for new requests
    expect(pool.subscription).toHaveBeenCalledOnce();
    expect(pool.subscription).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      [
        {
          kinds: [kinds.NostrConnect],
          "#p": [user.pubkey],
          authors: [client.pubkey],
        },
      ],
    );

    // Should send `connect` response
    expect(pool.publish).toHaveBeenCalledOnce();
    expect(pool.publish).toHaveBeenCalledWith(
      ["wss://relay.nsec.app"],
      expect.objectContaining({
        kind: kinds.NostrConnect,
        pubkey: user.pubkey,
        tags: [["p", client.pubkey]],
      }),
    );
  });
});
