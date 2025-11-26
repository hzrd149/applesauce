import { blueprint, EventBlueprint } from "applesauce-core/event-factory";
import { includeSingletonTag } from "applesauce-factory/operations";
import { setEncryptedContent } from "applesauce-factory/operations/content";

import {
  WALLET_NOTIFICATION_KIND,
  WALLET_LEGACY_NOTIFICATION_KIND,
  WalletNotification,
} from "../helpers/notification.js";

/**
 * Creates a wallet notification event (kind 23197)
 * @param client - The service pubkey
 * @param notification - The notification to create an event for
 * @param encryption - The encryption method to use (defaults to nip44_v2)
 */
export function WalletNotificationBlueprint(client: string, notification: WalletNotification): EventBlueprint {
  return blueprint(
    WALLET_NOTIFICATION_KIND,
    setEncryptedContent(client, JSON.stringify(notification)),
    includeSingletonTag(["p", client]),
  );
}

/**
 * Creates a legacy wallet notification event (kind 23196)
 * @param client - The service pubkey
 * @param notification - The notification to create an event for
 */
export function WalletLegacyNotificationBlueprint(client: string, notification: WalletNotification): EventBlueprint {
  return blueprint(
    WALLET_LEGACY_NOTIFICATION_KIND,
    setEncryptedContent(client, JSON.stringify(notification)),
    includeSingletonTag(["p", client]),
  );
}
