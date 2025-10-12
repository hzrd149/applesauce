import { getOrComputeCachedValue, getTagValue, isEvent } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { WalletConnectEncryptionMethod } from "./encryption.js";
import { TWalletMethod } from "./methods.js";
import { NotificationType } from "./notification.js";

export const WALLET_INFO_KIND = 13194;

/** A symbol used to cache the wallet info on the event */
export const WalletInfoSymbol = Symbol("wallet-info");

/** Wallet service capabilities and information */
export interface WalletSupport<Methods extends TWalletMethod = TWalletMethod> {
  /** List of supported methods for this wallet service */
  methods: Array<Methods["method"]>;
  /** List of supported encryption methods */
  encryption: WalletConnectEncryptionMethod[];
  /** List of supported notifications, optional */
  notifications?: NotificationType[];
}

/** Gets the wallet info from a kind 13194 event */
export function getWalletSupport<Methods extends TWalletMethod = TWalletMethod>(
  info: NostrEvent,
): WalletSupport<Methods> | null {
  if (info.kind !== WALLET_INFO_KIND) return null;

  return getOrComputeCachedValue(info, WalletInfoSymbol, () => {
    const content = info.content.trim();
    if (!content) return null;

    // Parse methods from content (space-separated)
    const contentParts = content.split(/\s+/);
    const methods = contentParts.filter((part) => part !== "notifications") as Array<Methods["method"]>;

    // Parse encryption methods from encryption tag
    const encryptionTag = getTagValue(info, "encryption");
    const encryption: WalletConnectEncryptionMethod[] = encryptionTag
      ? encryptionTag
          .split(/\s+/)
          .filter((method): method is WalletConnectEncryptionMethod => method === "nip44_v2" || method === "nip04")
      : ["nip04"]; // Default to nip04 if no encryption tag is present

    // Parse notifications from notifications tag
    const notificationsTag = getTagValue(info, "notifications");
    const notifications: NotificationType[] | undefined = notificationsTag
      ? notificationsTag
          .split(/\s+/)
          .filter((notif): notif is NotificationType => notif === "payment_received" || notif === "payment_sent")
      : undefined;

    return {
      methods,
      encryption,
      notifications,
    };
  });
}

/** Gets the encryption methods from a wallet info event */
export function getEncryptionMethods(info: NostrEvent | WalletSupport): WalletConnectEncryptionMethod[] {
  const walletInfo = isEvent(info) ? getWalletSupport(info) : (info as WalletSupport);
  return walletInfo?.encryption ?? [];
}

/** Checks if the wallet service supports a specific encryption method */
export function supportsEncryption(
  info: NostrEvent | WalletSupport,
  encryption: WalletConnectEncryptionMethod,
): boolean {
  const encryptionMethods = getEncryptionMethods(info);
  return encryptionMethods.includes(encryption);
}

/** Gets the preferred encryption method (nip44_v2 preferred over nip04) */
export function getPreferredEncryption(info: NostrEvent | WalletSupport): WalletConnectEncryptionMethod {
  const encryptionMethods = getEncryptionMethods(info);
  if (encryptionMethods.length === 0) return "nip04";

  // Prefer nip44_v2 over nip04
  if (encryptionMethods.includes("nip44_v2")) return "nip44_v2";
  if (encryptionMethods.includes("nip04")) return "nip04";

  // Absence of this tag implies that the wallet only supports nip04.
  return "nip04";
}

/** Checks if the wallet service supports a specific method */
export function supportsMethod(info: NostrEvent | WalletSupport, method: string): boolean {
  const walletInfo = isEvent(info) ? getWalletSupport(info) : (info as WalletSupport);
  return walletInfo?.methods.includes(method) ?? false;
}

/** Checks if the wallet service supports notifications */
export function supportsNotifications(info: NostrEvent | WalletSupport): boolean {
  const walletInfo = isEvent(info) ? getWalletSupport(info) : (info as WalletSupport);
  return (walletInfo?.notifications?.length ?? 0) > 0;
}

/** Checks if the wallet service supports a specific notification type */
export function supportsNotificationType(
  info: NostrEvent | WalletSupport,
  notificationType: NotificationType,
): boolean {
  const walletInfo = isEvent(info) ? getWalletSupport(info) : (info as WalletSupport);
  return walletInfo?.notifications?.includes(notificationType) ?? false;
}

/** Gets all supported methods from the wallet info */
export function getSupportedMethods(info: NostrEvent | WalletSupport): string[] {
  const walletInfo = isEvent(info) ? getWalletSupport(info) : (info as WalletSupport);
  return walletInfo?.methods ?? [];
}

/** Gets all supported notifications from the wallet info */
export function getSupportedNotifications(info: NostrEvent | WalletSupport): NotificationType[] {
  const walletInfo = isEvent(info) ? getWalletSupport(info) : (info as WalletSupport);
  return walletInfo?.notifications ?? [];
}
