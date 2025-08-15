import { describe, expect, test } from "vitest";
import { parseWalletConnectURI } from "../connect-uri.js";

describe("parseWalletConnectURI", () => {
  test("should parse valid NWC connection string with single relay", () => {
    const connectionString =
      "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c";

    const result = parseWalletConnectURI(connectionString);

    expect(result).toEqual({
      service: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.damus.io/"],
      secret: "71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c",
    });
  });

  test("should parse valid NWC connection string with multiple relays", () => {
    const connectionString =
      "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io&relay=wss%3A%2F%2Frelay.snort.social&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c";

    const result = parseWalletConnectURI(connectionString);

    expect(result).toEqual({
      service: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.damus.io/", "wss://relay.snort.social/"],
      secret: "71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c",
    });
  });

  test("should throw error when service is missing", () => {
    const connectionString =
      "nostr+walletconnect://?relay=wss%3A%2F%2Frelay.damus.io&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c";

    expect(() => parseWalletConnectURI(connectionString)).toThrow("invalid connection string");
  });

  test("should throw error when no relays are provided", () => {
    const connectionString =
      "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c";

    expect(() => parseWalletConnectURI(connectionString)).toThrow("invalid connection string");
  });

  test("should throw error when secret is missing", () => {
    const connectionString =
      "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io";

    expect(() => parseWalletConnectURI(connectionString)).toThrow("invalid connection string");
  });

  test("should throw error for invalid URL", () => {
    const connectionString = "invalid-url";

    expect(() => parseWalletConnectURI(connectionString)).toThrow();
  });
});
