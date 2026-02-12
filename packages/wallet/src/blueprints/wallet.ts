import { buildEvent, EventFactoryServices } from "applesauce-core";

import { NostrEvent } from "applesauce-core/helpers/event";
import { modifyHiddenTags } from "applesauce-core/operations";
import { WALLET_BACKUP_KIND, WALLET_KIND } from "../helpers/wallet.js";
import { setBackupContent, setMintTags, setPrivateKeyTag, setRelayTags } from "../operations/wallet.js";

/** A blueprint to create a new 17375 wallet */
export function WalletBlueprint({
  mints,
  privateKey,
  relays,
}: {
  mints: string[];
  privateKey?: Uint8Array;
  relays?: string[];
}) {
  return async (services: EventFactoryServices) => {
    return buildEvent(
      { kind: WALLET_KIND },
      services,
      // Use top level modifyHiddenTags to avoid multiple encryption operations
      modifyHiddenTags(
        services.signer,
        setMintTags(mints),
        privateKey ? setPrivateKeyTag(privateKey) : undefined,
        relays ? setRelayTags(relays) : undefined,
      ),
    );
  };
}

/** A blueprint that creates a new 375 wallet backup event */
export function WalletBackupBlueprint(wallet: NostrEvent) {
  return async (services: EventFactoryServices) => {
    return buildEvent({ kind: WALLET_BACKUP_KIND }, services, setBackupContent(wallet, services.signer));
  };
}
