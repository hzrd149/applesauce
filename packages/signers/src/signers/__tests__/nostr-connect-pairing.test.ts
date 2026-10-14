import { unixNow } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import { NEVER } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { NostrConnectSigner } from "../nostr-connect-signer.js";
import { PrivateKeySigner } from "../private-key-signer.js";

function createClient(remote?: string) {
  return new NostrConnectSigner({
    relays: ["wss://relay.example"],
    remote,
    connectSecret: "pairing-secret",
    subscriptionMethod: () => NEVER,
    publishMethod: vi.fn(async () => {}),
  });
}

async function response(client: NostrConnectSigner, sender: PrivateKeySigner, result: string, error?: string) {
  return sender.signEvent({
    kind: kinds.NostrConnect,
    created_at: unixNow(),
    tags: [["p", client.clientPubkey]],
    content: await sender.nip44.encrypt(client.clientPubkey, JSON.stringify({ id: "connect", result, error })),
  });
}

describe("client-initiated NIP-46 pairing", () => {
  it.each(["ack", "wrong-secret", ""])("does not trust an unsolicited %j result", async (result) => {
    const client = createClient();
    const unrelated = new PrivateKeySigner();
    await client.handleEvent(await response(client, unrelated, result));
    expect(client.isConnected).toBe(false);
    expect(client.remote).toBeUndefined();
  });

  it("pairs only when the response proves knowledge of the secret", async () => {
    const client = createClient();
    const remote = new PrivateKeySigner();
    const paired = client.waitForSigner();
    await client.handleEvent(await response(client, remote, "pairing-secret"));
    await paired;
    expect(client.remote).toBe(await remote.getPublicKey());
    expect(client.isConnected).toBe(true);
    await client.close();
  });

  it("does not treat an error response as successful pairing", async () => {
    const client = createClient();
    await client.handleEvent(await response(client, new PrivateKeySigner(), "pairing-secret", "denied"));
    expect(client.isConnected).toBe(false);
    expect(client.remote).toBeUndefined();
  });

  it("preserves ack responses for a request to a pinned bunker", async () => {
    const remote = new PrivateKeySigner();
    const client = createClient(await remote.getPublicKey());
    const publish = vi.fn(async (_relays, event) => {
      const request = JSON.parse(await remote.nip44.decrypt(event.pubkey, event.content));
      await client.handleEvent(
        await remote.signEvent({
          kind: kinds.NostrConnect,
          created_at: unixNow(),
          tags: [["p", client.clientPubkey]],
          content: await remote.nip44.encrypt(client.clientPubkey, JSON.stringify({ id: request.id, result: "ack" })),
        }),
      );
    });
    Object.assign(client, { publishMethod: publish });
    await expect(client.connect()).resolves.toBe("ack");
    expect(client.isConnected).toBe(true);
    await client.close();
  });
});
