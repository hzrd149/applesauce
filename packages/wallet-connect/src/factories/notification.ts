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

export class WalletNotificationFactory extends EventFactory<
  typeof WALLET_NOTIFICATION_KIND,
  WalletNotificationTemplate
> {
  static create(client: string, notification: WalletNotification): WalletNotificationFactory {
    return new WalletNotificationFactory((res) => res(blankEventTemplate(WALLET_NOTIFICATION_KIND)))
      .client(client)
      .notification(notification, client);
  }

  client(pubkey: string) {
    return this.chain((draft) => includeSingletonTag(["p", pubkey])(draft));
  }

  notification(notification: WalletNotification, client: string): this {
    let result: this;
    result = this.chain(async (draft) => {
      return setEncryptedContent(client, JSON.stringify(notification), result.signer)(draft);
    });
    return result;
  }
}

export class WalletLegacyNotificationFactory extends EventFactory<
  typeof WALLET_LEGACY_NOTIFICATION_KIND,
  WalletLegacyNotificationTemplate
> {
  static create(client: string, notification: WalletNotification): WalletLegacyNotificationFactory {
    return new WalletLegacyNotificationFactory((res) => res(blankEventTemplate(WALLET_LEGACY_NOTIFICATION_KIND)))
      .client(client)
      .notification(notification, client);
  }

  client(pubkey: string) {
    return this.chain((draft) => includeSingletonTag(["p", pubkey])(draft));
  }

  notification(notification: WalletNotification, client: string): this {
    let result: this;
    result = this.chain(async (draft) => {
      return setEncryptedContent(client, JSON.stringify(notification), result.signer)(draft);
    });
    return result;
  }
}
