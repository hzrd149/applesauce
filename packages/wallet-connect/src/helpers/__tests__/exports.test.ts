import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "WALLET_INFO_KIND",
        "WALLET_LEGACY_NOTIFICATION_KIND",
        "WALLET_NOTIFICATION_KIND",
        "WALLET_REQUEST_KIND",
        "WALLET_RESPONSE_KIND",
        "WalletInfoSymbol",
        "WalletNotificationSymbol",
        "WalletRequestSymbol",
        "WalletResponseSymbol",
        "createWalletAuthURI",
        "createWalletConnectURI",
        "getEncryptionMethods",
        "getPreferredEncryption",
        "getSupportedMethods",
        "getSupportedNotifications",
        "getWalletNotification",
        "getWalletRequest",
        "getWalletRequestEncryption",
        "getWalletRequestExpiration",
        "getWalletRequestServicePubkey",
        "getWalletResponse",
        "getWalletResponseClientPubkey",
        "getWalletResponseRequestId",
        "getWalletSupport",
        "isValidWalletNotification",
        "isValidWalletRequest",
        "isValidWalletResponse",
        "isWalletNotificationUnlocked",
        "isWalletRequestExpired",
        "isWalletRequestUnlocked",
        "isWalletResponseUnlocked",
        "nip47EncryptionMethodToNip07EncryptionMethod",
        "parseWalletAuthURI",
        "parseWalletConnectURI",
        "supportsEncryption",
        "supportsMethod",
        "supportsNotificationType",
        "supportsNotifications",
        "unlockWalletNotification",
        "unlockWalletRequest",
        "unlockWalletResponse",
        "validateWalletAuthURI",
      ]
    `);
  });
});
