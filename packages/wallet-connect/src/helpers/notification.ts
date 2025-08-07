import {
  getHiddenContent,
  getOrComputeCachedValue,
  HiddenContentSigner,
  isHiddenContentLocked,
  setHiddenContentEncryptionMethod,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { Transaction } from "./response.js";

export const WALLET_NOTIFICATION_KIND = 23197;
export const WALLET_LEGACY_NOTIFICATION_KIND = 23196;

/** A symbol used to cache the wallet notification on the event */
export const WalletNotificationSymbol = Symbol("wallet-notification");

// Setup the encryption method to use for notification kinds
setHiddenContentEncryptionMethod(WALLET_NOTIFICATION_KIND, "nip44");
setHiddenContentEncryptionMethod(WALLET_LEGACY_NOTIFICATION_KIND, "nip04");

/** Supported notification types */
export type NotificationTypes = "payment_received" | "payment_sent";

/** Base notification structure */
export interface BaseNotification<TNotificationType extends NotificationTypes, TNotification> {
  /** Indicates the structure of the notification field */
  notification_type: TNotificationType;
  /** Notification data */
  notification: TNotification;
}

/** Payment received notification */
export type PaymentReceivedNotification = BaseNotification<"payment_received", Transaction>;

/** Payment sent notification */
export type PaymentSentNotification = BaseNotification<"payment_sent", Transaction>;

/** Union type for all NIP-47 notification types */
export type WalletNotification = PaymentReceivedNotification | PaymentSentNotification;

/** Checks if a kind 23196 or 23197 event is locked */
export function isWalletNotificationLocked(notification: NostrEvent) {
  return isHiddenContentLocked(notification);
}

/** Unlocks a kind 23196 or 23197 event */
export async function unlockWalletNotification(
  notification: NostrEvent,
  signer: HiddenContentSigner,
): Promise<WalletNotification | undefined | null> {
  await unlockHiddenContent(notification, signer);

  return getWalletNotification(notification);
}

/** Gets the wallet notification from a kind 23196 or 23197 event */
export function getWalletNotification(notification: NostrEvent): WalletNotification | undefined | null {
  if (isWalletNotificationLocked(notification)) return undefined;

  return getOrComputeCachedValue(notification, WalletNotificationSymbol, () => {
    const content = getHiddenContent(notification);
    if (!content) return null;

    return JSON.parse(content) as WalletNotification;
  });
}
