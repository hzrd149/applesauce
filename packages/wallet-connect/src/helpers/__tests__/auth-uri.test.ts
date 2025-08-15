import { describe, expect, test } from "vitest";
import { parseWalletAuthURI, createWalletAuthURI, validateWalletAuthURI, WalletAuthURI } from "../auth-uri.js";
import { unixNow } from "applesauce-core/helpers";

describe("parseWalletAuthURI", () => {
  test("should parse valid wallet auth URI with minimal parameters", () => {
    const authURI =
      "nostr+walletauth://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com%2Fv1";

    const result = parseWalletAuthURI(authURI);

    expect(result).toEqual({
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com/v1"],
      name: undefined,
      icon: undefined,
      returnTo: undefined,
      expiresAt: undefined,
      maxAmount: undefined,
      budgetRenewal: undefined,
      methods: undefined,
      notifications: undefined,
      isolated: undefined,
      metadata: undefined,
      walletName: undefined,
    });
  });

  test("should parse valid wallet auth URI with all optional parameters", () => {
    const authURI =
      "nostr+walletauth://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com&name=TestApp&icon=https%3A%2F%2Fexample.com%2Ficon.png&return_to=https%3A%2F%2Fexample.com%2Fcallback&expires_at=1735689600&max_amount=1000000&budget_renewal=daily&request_methods=pay_invoice%20get_balance&notification_types=payment_received%20payment_sent&isolated=true&metadata=%7B%22description%22%3A%22Test%20app%22%7D";

    const result = parseWalletAuthURI(authURI);

    expect(result).toEqual({
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com/"],
      name: "TestApp",
      icon: "https://example.com/icon.png",
      returnTo: "https://example.com/callback",
      expiresAt: 1735689600,
      maxAmount: 1000000,
      budgetRenewal: "daily",
      methods: ["pay_invoice", "get_balance"],
      notifications: ["payment_received", "payment_sent"],
      isolated: true,
      metadata: { description: "Test app" },
      walletName: undefined,
    });
  });

  test("should parse wallet auth URI with specific wallet name", () => {
    const authURI =
      "nostr+walletauth+alby://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com";

    const result = parseWalletAuthURI(authURI);

    expect(result.walletName).toBe("alby");
    expect(result.client).toBe("b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4");
    expect(result.relays).toEqual(["wss://relay.example.com/"]);
  });

  test("should parse wallet auth URI with multiple relays", () => {
    const authURI =
      "nostr+walletauth://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay1.example.com&relay=wss%3A%2F%2Frelay2.example.com";

    const result = parseWalletAuthURI(authURI);

    expect(result.relays).toEqual(["wss://relay1.example.com/", "wss://relay2.example.com/"]);
  });

  test("should throw error when protocol is invalid", () => {
    const authURI =
      "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com";

    expect(() => parseWalletAuthURI(authURI)).toThrow("invalid wallet auth uri protocol");
  });

  test("should throw error when client public key is missing", () => {
    const authURI = "nostr+walletauth://?relay=wss%3A%2F%2Frelay.example.com";

    expect(() => parseWalletAuthURI(authURI)).toThrow("missing client public key in authorization URI");
  });

  test("should throw error when relay parameter is missing", () => {
    const authURI = "nostr+walletauth://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4";

    expect(() => parseWalletAuthURI(authURI)).toThrow("missing required relay parameter in authorization URI");
  });

  test("should throw error when metadata is invalid JSON", () => {
    const authURI =
      "nostr+walletauth://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com&metadata=invalid-json";

    expect(() => parseWalletAuthURI(authURI)).toThrow("invalid metadata parameter in authorization URI");
  });

  test("should throw error for invalid URL", () => {
    const authURI = "invalid-url";

    expect(() => parseWalletAuthURI(authURI)).toThrow();
  });
});

describe("createWalletAuthURI", () => {
  test("should create minimal wallet auth URI", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
    };

    const result = createWalletAuthURI(parts);

    expect(result).toBe(
      "nostr+walletauth://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com",
    );
  });

  test("should create wallet auth URI with all parameters", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
      name: "TestApp",
      icon: "https://example.com/icon.png",
      returnTo: "https://example.com/callback",
      expiresAt: unixNow() + 100,
      maxAmount: 1000000,
      budgetRenewal: "daily",
      methods: ["pay_invoice", "get_balance"],
      notifications: ["payment_received", "payment_sent"],
      isolated: true,
      metadata: { description: "Test app" },
    };

    const result = createWalletAuthURI(parts);

    expect(result).toContain("nostr+walletauth://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4");
    expect(result).toContain("relay=wss%3A%2F%2Frelay.example.com");
    expect(result).toContain("name=TestApp");
    expect(result).toContain("icon=https%3A%2F%2Fexample.com%2Ficon.png");
    expect(result).toContain("return_to=https%3A%2F%2Fexample.com%2Fcallback");
    expect(result).toContain(`expires_at=${unixNow() + 100}`);
    expect(result).toContain("max_amount=1000000");
    expect(result).toContain("budget_renewal=daily");
    expect(result).toContain("request_methods=pay_invoice+get_balance");
    expect(result).toContain("notification_types=payment_received+payment_sent");
    expect(result).toContain("isolated=true");
    expect(result).toContain(`metadata=%257B%2522description%2522%253A%2522Test%2520app%2522%257D`);
  });

  test("should create wallet auth URI with specific wallet name", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
      walletName: "alby",
    };

    const result = createWalletAuthURI(parts);

    expect(result).toBe(
      "nostr+walletauth+alby://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com",
    );
  });

  test("should not include budget_renewal when set to never", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
      budgetRenewal: "never",
    };

    const result = createWalletAuthURI(parts);

    expect(result).not.toContain("budget_renewal");
  });

  test("should handle multiple relays", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
    };

    const result = createWalletAuthURI(parts);

    expect(result).toContain("relay=wss%3A%2F%2Frelay1.example.com");
    expect(result).toContain("relay=wss%3A%2F%2Frelay2.example.com");
  });
});

describe("validateWalletAuthURI", () => {
  test("should validate valid WalletAuthURI", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
    };

    expect(() => validateWalletAuthURI(parts)).not.toThrow();
    expect(validateWalletAuthURI(parts)).toBe(true);
  });

  test("should throw error when client public key is missing", () => {
    const parts: WalletAuthURI = {
      client: "",
      relays: ["wss://relay.example.com"],
    };

    expect(() => validateWalletAuthURI(parts)).toThrow("client public key is required");
  });

  test("should throw error when no relays are provided", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: [],
    };

    expect(() => validateWalletAuthURI(parts)).toThrow("at least one relay is required");
  });

  test("should throw error when expires_at is in the past", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    };

    expect(() => validateWalletAuthURI(parts)).toThrow("expires_at must be in the future");
  });

  test("should throw error when max_amount is negative", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
      maxAmount: -1000,
    };

    expect(() => validateWalletAuthURI(parts)).toThrow("max_amount must be positive");
  });

  test("should throw error when budget_renewal is invalid", () => {
    const parts: WalletAuthURI = {
      client: "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
      relays: ["wss://relay.example.com"],
      budgetRenewal: "invalid" as any,
    };

    expect(() => validateWalletAuthURI(parts)).toThrow("invalid budget_renewal value");
  });
});
