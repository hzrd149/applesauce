import { bytesToHex } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { NostrConnectSigner, PrivateKeySigner } from "applesauce-signers";
import { NEVER } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SerializedAccount } from "../../types.js";
import { NostrConnectAccount } from "../nostr-connect-account.js";

beforeEach(() => {
  NostrConnectSigner.subscriptionMethod = vi.fn().mockReturnValue(NEVER);
  NostrConnectSigner.publishMethod = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  NostrConnectSigner.subscriptionMethod = undefined;
  NostrConnectSigner.publishMethod = undefined;
});

describe("NostrConnectAccount", () => {
  it("should serialize the connection secret", () => {
    const clientKey = generateSecretKey();
    const remote = getPublicKey(generateSecretKey());
    const signer = new NostrConnectSigner({
      relays: ["wss://relay.example.com"],
      remote,
      bunkerSecret: "test-secret",
      signer: new PrivateKeySigner(clientKey),
    });
    const account = new NostrConnectAccount("user-pubkey", signer);
    account.id = "test-id";

    expect(account.toJSON()).toEqual({
      id: "test-id",
      type: "nostr-connect",
      pubkey: "user-pubkey",
      signer: {
        clientKey: bytesToHex(clientKey),
        remote,
        relays: ["wss://relay.example.com"],
        bunkerSecret: "test-secret",
      },
      metadata: undefined,
    });
  });

  it("should restore the connection secret", () => {
    const clientKey = generateSecretKey();
    const remote = getPublicKey(generateSecretKey());
    const json: SerializedAccount<any, any> = {
      id: "test-id",
      type: "nostr-connect",
      pubkey: "user-pubkey",
      signer: {
        clientKey: bytesToHex(clientKey),
        remote,
        relays: ["wss://relay.example.com"],
        bunkerSecret: "test-secret",
      },
    };

    const account = NostrConnectAccount.fromJSON(json);

    expect(account.id).toBe("test-id");
    expect(account.signer.remote).toBe(remote);
    expect(account.signer.relays).toEqual(["wss://relay.example.com"]);
    expect(account.signer.signer.key).toEqual(clientKey);
    expect(account.signer.bunkerSecret).toBe("test-secret");
  });
});
