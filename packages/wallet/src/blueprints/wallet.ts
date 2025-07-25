import { blueprint } from "applesauce-factory";

import { NostrEvent } from "nostr-tools";
import { WALLET_BACKUP_KIND, WALLET_KIND } from "../helpers/wallet.js";
import { setBackupContent, setMints, setPrivateKey } from "../operations/wallet.js";

/** A blueprint to create a new 17375 wallet */
export function WalletBlueprint(mints: string[], privateKey?: Uint8Array) {
  return blueprint(WALLET_KIND, setMints(mints), privateKey ? setPrivateKey(privateKey) : undefined);
}

/** A blueprint that creates a new 375 wallet backup event */
export function WalletBackupBlueprint(wallet: NostrEvent) {
  return blueprint(WALLET_BACKUP_KIND, setBackupContent(wallet));
}
