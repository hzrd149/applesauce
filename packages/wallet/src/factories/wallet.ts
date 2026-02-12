import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { modifyHiddenTags } from "applesauce-core/operations";
import { WALLET_BACKUP_KIND, WALLET_KIND } from "../helpers/wallet.js";
import { setBackupContent, setMintTags, setPrivateKeyTag, setRelayTags } from "../operations/wallet.js";

export type WalletTemplate = KnownEventTemplate<typeof WALLET_KIND>;

export class WalletFactory extends EventFactory<typeof WALLET_KIND, WalletTemplate> {
  static create(mints: string[], privateKey?: Uint8Array, relays?: string[]): WalletFactory {
    return new WalletFactory((res) => res(blankEventTemplate(WALLET_KIND)))
      .mints(mints)
      .privateKey(privateKey)
      .relays(relays);
  }

  mints(mints: string[]) {
    return this.chain((draft) => modifyHiddenTags(this.signer, setMintTags(mints))(draft));
  }

  privateKey(key?: Uint8Array) {
    if (!key) return this;
    return this.chain((draft) => modifyHiddenTags(this.signer, setPrivateKeyTag(key))(draft));
  }

  relays(urls?: string[]) {
    if (!urls) return this;
    return this.chain((draft) => modifyHiddenTags(this.signer, setRelayTags(urls))(draft));
  }
}

export type WalletBackupTemplate = KnownEventTemplate<typeof WALLET_BACKUP_KIND>;

export class WalletBackupFactory extends EventFactory<typeof WALLET_BACKUP_KIND, WalletBackupTemplate> {
  static create(wallet: NostrEvent): WalletBackupFactory {
    return new WalletBackupFactory((res) => res(blankEventTemplate(WALLET_BACKUP_KIND)))
      .wallet(wallet);
  }

  wallet(event: NostrEvent) {
    return this.chain((draft) => setBackupContent(event, this.signer)(draft));
  }
}

// Legacy blueprint functions for backwards compatibility
import type { EventTemplate } from "applesauce-core/helpers";

export function WalletBlueprint(options: {
  mints: string[];
  privateKey?: Uint8Array;
  relays?: string[];
}) {
  return async (_services: any): Promise<EventTemplate> => {
    return WalletFactory.create(options.mints, options.privateKey, options.relays);
  };
}

export function WalletBackupBlueprint(wallet: NostrEvent) {
  return async (_services: any): Promise<EventTemplate> => {
    return WalletBackupFactory.create(wallet);
  };
}
