import {
  HiddenContentSigner,
  isHiddenContentUnlocked,
  KnownEvent,
  notifyEventUpdate,
  setHiddenContentEncryptionMethod,
  UnlockedHiddenContent,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { Transaction } from "./response.js";

export const WALLET_NOTIFICATION_KIND = 23197;
export const WALLET_LEGACY_NOTIFICATION_KIND = 23196;

/** A type for validated wallet notification events */
export type WalletNotificationEvent =
  | KnownEvent<typeof WALLET_NOTIFICATION_KIND>
  | KnownEvent<typeof WALLET_LEGACY_NOTIFICATION_KIND>;

/** A symbol used to cache the wallet notification on the event */
export const WalletNotificationSymbol = Symbol("wallet-notification");

/** A type for unlocked notifications events */
export type UnlockedWalletNotification = UnlockedHiddenContent & {
  [WalletNotificationSymbol]: WalletNotification;
};

// Setup the encryption method to use for notification kinds
setHiddenContentEncryptionMethod(WALLET_NOTIFICATION_KIND, "nip44");
setHiddenContentEncryptionMethod(WALLET_LEGACY_NOTIFICATION_KIND, "nip04");

/** Supported notification types */
export type NotificationType = "payment_received" | "payment_sent";

/** Base notification structure */
export interface BaseNotification<TNotificationType extends NotificationType, TNotification> {
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
export function isWalletNotificationUnlocked(notification: any): notification is UnlockedWalletNotification {
  return isHiddenContentUnlocked(notification) && Reflect.has(notification, WalletNotificationSymbol) === true;
}

/** Unlocks a kind 23196 or 23197 event */
export async function unlockWalletNotification(
  notification: NostrEvent,
  signer: HiddenContentSigner,
): Promise<WalletNotification | undefined> {
  if (isWalletNotificationUnlocked(notification)) return notification[WalletNotificationSymbol];

  const content = await unlockHiddenContent(notification, signer);
  const parsed = JSON.parse(content) as WalletNotification;

  // Save the parsed content
  Reflect.set(notification, WalletNotificationSymbol, parsed);
  notifyEventUpdate(notification);

  return parsed;
}

/** Gets the wallet notification from a kind 23196 or 23197 event */
export function getWalletNotification(notification: NostrEvent): WalletNotification | undefined {
  if (isWalletNotificationUnlocked(notification)) return notification[WalletNotificationSymbol];
  else return undefined;
}

/** Checks if an event is a valid wallet notification event */
export function isValidWalletNotification(notification: NostrEvent): notification is WalletNotificationEvent {
  return notification.kind === WALLET_NOTIFICATION_KIND || notification.kind === WALLET_LEGACY_NOTIFICATION_KIND;
}
