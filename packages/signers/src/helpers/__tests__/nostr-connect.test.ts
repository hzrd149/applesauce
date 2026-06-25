import { bytesToHex } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { describe, expect, it } from "vitest";
import {
  createBunkerURI,
  createNbunksec,
  createNostrConnectURI,
  parseBunkerURI,
  parseNbunksec,
  parseNostrConnectURI,
} from "../nostr-connect.js";

describe("bunker uri", () => {
  it("should keep secret as a deprecated alias for bunkerSecret", () => {
    const remote = getPublicKey(generateSecretKey());
    const uri = createBunkerURI({ remote, relays: ["wss://relay.example.com"], secret: "test-secret" });

    expect(parseBunkerURI(uri)).toEqual({
      remote,
      relays: ["wss://relay.example.com"],
      secret: "test-secret",
      bunkerSecret: "test-secret",
    });
  });
});

describe("nostrconnect uri", () => {
  it("should keep secret as a deprecated alias for connectSecret", () => {
    const client = getPublicKey(generateSecretKey());
    const uri = createNostrConnectURI({ client, relays: ["wss://relay.example.com"], secret: "test-secret" });

    expect(parseNostrConnectURI(uri)).toEqual({
      client,
      relays: ["wss://relay.example.com"],
      secret: "test-secret",
      connectSecret: "test-secret",
    });
  });

  it("should require a secret", () => {
    const client = getPublicKey(generateSecretKey());

    expect(() =>
      createNostrConnectURI({ client, relays: ["wss://relay.example.com"] } as Parameters<
        typeof createNostrConnectURI
      >[0]),
    ).toThrow("missing secret");
  });
});

describe("nbunksec", () => {
  it("should encode and decode a signer session", () => {
    const clientKey = generateSecretKey();
    const remoteKey = generateSecretKey();

    const encoded = createNbunksec({
      remote: getPublicKey(remoteKey),
      clientKey: bytesToHex(clientKey),
      relays: ["wss://relay.example.com"],
      bunkerSecret: "test-secret",
    });

    expect(encoded).toMatch(/^nbunksec1/);
    expect(parseNbunksec(encoded)).toEqual({
      remote: getPublicKey(remoteKey),
      clientKey: bytesToHex(clientKey),
      relays: ["wss://relay.example.com"],
      secret: "test-secret",
      bunkerSecret: "test-secret",
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
