import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";
import {
  WALLET_NOTIFICATION_KIND,
  WALLET_LEGACY_NOTIFICATION_KIND,
  WalletNotification,
} from "../helpers/notification.js";

export type WalletNotificationTemplate = KnownEventTemplate<typeof WALLET_NOTIFICATION_KIND>;
export type WalletLegacyNotificationTemplate = KnownEventTemplate<typeof WALLET_LEGACY_NOTIFICATION_KIND>;

export class WalletNotificationFactory extends EventFactory<typeof WALLET_NOTIFICATION_KIND, WalletNotificationTemplate> {
  static create(client: string, notification: WalletNotification): WalletNotificationFactory {
    return new WalletNotificationFactory((res) => res(blankEventTemplate(WALLET_NOTIFICATION_KIND)))
      .client(client)
      .notification(notification, client);
  }

  client(pubkey: string) {
    return this.chain((draft) => includeSingletonTag(["p", pubkey])(draft));
  }

  notification(notification: WalletNotification, client: string) {
    return this.chain(async (draft) => {
      return setEncryptedContent(client, JSON.stringify(notification), this.signer)(draft);
    });
  }
}

export class WalletLegacyNotificationFactory extends EventFactory<typeof WALLET_LEGACY_NOTIFICATION_KIND, WalletLegacyNotificationTemplate> {
  static create(client: string, notification: WalletNotification): WalletLegacyNotificationFactory {
    return new WalletLegacyNotificationFactory((res) => res(blankEventTemplate(WALLET_LEGACY_NOTIFICATION_KIND)))
      .client(client)
      .notification(notification, client);
  }

  client(pubkey: string) {
    return this.chain((draft) => includeSingletonTag(["p", pubkey])(draft));
  }

  notification(notification: WalletNotification, client: string) {
    return this.chain(async (draft) => {
      return setEncryptedContent(client, JSON.stringify(notification), this.signer)(draft);
    });
  }
}

// Legacy blueprint functions for backwards compatibility
import type { EventTemplate } from "applesauce-core/helpers";

export function WalletNotificationBlueprint(client: string, notification: WalletNotification) {
  return async (_services: any): Promise<EventTemplate> => {
    return WalletNotificationFactory.create(client, notification);
  };
}

export function WalletLegacyNotificationBlueprint(client: string, notification: WalletNotification) {
  return async (_services: any): Promise<EventTemplate> => {
    return WalletLegacyNotificationFactory.create(client, notification);
  };
}
