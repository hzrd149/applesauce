import { getOrComputeCachedValue, getTagValue, isEvent } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { EncryptionMethods } from "./encryption.js";
import { WalletMethods } from "./methods.js";
import { NotificationTypes } from "./notification.js";

export const WALLET_INFO_KIND = 13194;

/** A symbol used to cache the wallet info on the event */
export const WalletInfoSymbol = Symbol("wallet-info");

/** Wallet service capabilities and information */
export interface WalletInfo {
  /** List of supported methods for this wallet service */
  methods: WalletMethods[];
  /** List of supported encryption methods */
  encryption_methods: EncryptionMethods[];
  /** List of supported notifications, optional */
  notifications?: NotificationTypes[];
}

/** Gets the wallet info from a kind 13194 event */
export function getWalletInfo(info: NostrEvent): WalletInfo | null {
  if (info.kind !== WALLET_INFO_KIND) return null;

  return getOrComputeCachedValue(info, WalletInfoSymbol, () => {
    const content = info.content.trim();
    if (!content) return null;

    // Parse methods from content (space-separated)
    const contentParts = content.split(/\s+/);
    const methods = contentParts
      .filter((part) =>
        [
          "pay_invoice",
          "multi_pay_invoice",
          "pay_keysend",
          "multi_pay_keysend",
          "make_invoice",
          "lookup_invoice",
          "list_transactions",
          "get_balance",
          "get_info",
          "notifications",
        ].includes(part),
      )
      .filter((part) => part !== "notifications") as WalletMethods[];

    // Parse encryption methods from encryption tag
    const encryptionTag = getTagValue(info, "encryption");
    const encryption_methods: EncryptionMethods[] = encryptionTag
      ? encryptionTag
          .split(/\s+/)
          .filter((method): method is EncryptionMethods => method === "nip44_v2" || method === "nip04")
      : ["nip04"]; // Default to nip04 if no encryption tag is present

    // Parse notifications from notifications tag
    const notificationsTag = getTagValue(info, "notifications");
    const notifications: NotificationTypes[] | undefined = notificationsTag
      ? notificationsTag
          .split(/\s+/)
          .filter((notif): notif is NotificationTypes => notif === "payment_received" || notif === "payment_sent")
      : undefined;

    return {
      methods,
      encryption_methods,
      notifications,
    };
  });
}

/** Gets the encryption methods from a wallet info event */
export function getEncryptionMethods(info: NostrEvent | WalletInfo): EncryptionMethods[] {
  const walletInfo = isEvent(info) ? getWalletInfo(info) : (info as WalletInfo);
  return walletInfo?.encryption_methods ?? [];
}

/** Checks if the wallet service supports a specific encryption method */
export function supportsEncryption(info: NostrEvent | WalletInfo, encryption: EncryptionMethods): boolean {
  const encryptionMethods = getEncryptionMethods(info);
  return encryptionMethods.includes(encryption);
}

/** Gets the preferred encryption method (nip44_v2 preferred over nip04) */
export function getPreferredEncryption(info: NostrEvent | WalletInfo): EncryptionMethods {
  const encryptionMethods = getEncryptionMethods(info);
  if (encryptionMethods.length === 0) return "nip04";

  // Prefer nip44_v2 over nip04
  if (encryptionMethods.includes("nip44_v2")) return "nip44_v2";
  if (encryptionMethods.includes("nip04")) return "nip04";

  // Absence of this tag implies that the wallet only supports nip04.
  return "nip04";
}

/** Checks if the wallet service supports a specific method */
export function supportsMethod(info: NostrEvent | WalletInfo, method: WalletMethods): boolean {
  const walletInfo = isEvent(info) ? getWalletInfo(info) : (info as WalletInfo);
  return walletInfo?.methods.includes(method) ?? false;
}

/** Checks if the wallet service supports notifications */
export function supportsNotifications(info: NostrEvent | WalletInfo): boolean {
  const walletInfo = isEvent(info) ? getWalletInfo(info) : (info as WalletInfo);
  return (walletInfo?.notifications?.length ?? 0) > 0;
}

/** Checks if the wallet service supports a specific notification type */
export function supportsNotificationType(info: NostrEvent | WalletInfo, notificationType: NotificationTypes): boolean {
  const walletInfo = isEvent(info) ? getWalletInfo(info) : (info as WalletInfo);
  return walletInfo?.notifications?.includes(notificationType) ?? false;
}

/** Gets all supported methods from the wallet info */
export function getSupportedMethods(info: NostrEvent | WalletInfo): WalletMethods[] {
  const walletInfo = isEvent(info) ? getWalletInfo(info) : (info as WalletInfo);
  return walletInfo?.methods ?? [];
}

/** Gets all supported notifications from the wallet info */
export function getSupportedNotifications(info: NostrEvent | WalletInfo): NotificationTypes[] {
  const walletInfo = isEvent(info) ? getWalletInfo(info) : (info as WalletInfo);
  return walletInfo?.notifications ?? [];
}
