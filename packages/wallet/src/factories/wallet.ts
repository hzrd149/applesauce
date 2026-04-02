import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
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

  /** Creates a new wallet factory from an existing wallet event */
  static modify(event: NostrEvent): WalletFactory {
    if (event.kind !== WALLET_KIND) throw new Error("Event is not a wallet event");
    return new WalletFactory((res) => res(toEventTemplate(event) as WalletTemplate));
  }

  mints(mints: string[]) {
    return this.modifyHiddenTags(setMintTags(mints));
  }

  privateKey(key?: Uint8Array) {
    if (!key) return this;
    return this.modifyHiddenTags(setPrivateKeyTag(key));
  }

  relays(urls?: string[]) {
    if (!urls) return this;
    return this.modifyHiddenTags(setRelayTags(urls));
  }
}

export type WalletBackupTemplate = KnownEventTemplate<typeof WALLET_BACKUP_KIND>;

export class WalletBackupFactory extends EventFactory<typeof WALLET_BACKUP_KIND, WalletBackupTemplate> {
  static create(wallet: NostrEvent): WalletBackupFactory {
    return new WalletBackupFactory((res) => res(blankEventTemplate(WALLET_BACKUP_KIND))).wallet(wallet);
  }

  wallet(event: NostrEvent) {
    let result: this;
    result = this.chain((draft) => setBackupContent(event, result.signer)(draft));
    return result;
  }
}
