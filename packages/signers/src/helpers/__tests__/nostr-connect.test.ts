import { bytesToHex } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { describe, expect, it } from "vitest";
import { createNbunksec, parseNbunksec } from "../nostr-connect.js";

describe("nbunksec", () => {
  it("should encode and decode a signer session", () => {
    const clientKey = generateSecretKey();
    const remoteKey = generateSecretKey();

    const encoded = createNbunksec({
      remote: getPublicKey(remoteKey),
      clientKey: bytesToHex(clientKey),
      relays: ["wss://relay.example.com"],
      secret: "test-secret",
    });

    expect(encoded).toMatch(/^nbunksec1/);
    expect(parseNbunksec(encoded)).toEqual({
      remote: getPublicKey(remoteKey),
      clientKey: bytesToHex(clientKey),
      relays: ["wss://relay.example.com"],
      secret: "test-secret",
    });
  });

  it("should reject invalid keys", () => {
    expect(() =>
      createNbunksec({
        remote: "invalid",
        clientKey: bytesToHex(generateSecretKey()),
        relays: ["wss://relay.example.com"],
      }),
    ).toThrow("remote is not a valid hex key");
  });

  it("should require relays", () => {
    expect(() =>
      createNbunksec({
        remote: getPublicKey(generateSecretKey()),
        clientKey: bytesToHex(generateSecretKey()),
        relays: [],
      }),
    ).toThrow("missing relays");
  });
});
