import { ExtensionSigner } from "applesauce-signers/signers/extension-signer";
import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";

export class ExtensionAccount<Metadata extends unknown = unknown> extends BaseAccount<ExtensionSigner, void, Metadata> {
  static readonly type = "extension";

  constructor(
    pubkey: string,
    override signer: ExtensionSigner,
  ) {
    super(pubkey, signer || new ExtensionSigner());
  }

  toJSON() {
    return super.saveCommonFields({
      signer: undefined,
    });
  }

  static fromJSON<Metadata extends unknown = unknown>(
    json: SerializedAccount<void, Metadata>,
  ): ExtensionAccount<Metadata> {
    const account = new ExtensionAccount<Metadata>(json.pubkey, new ExtensionSigner());
    return super.loadCommonFields(account, json);
  }

  /**
   * Creates a new account from the NIP-07 extension
   * @throws {ExtensionMissingError} if the extension is not installed
   */
  static async fromExtension<Metadata extends unknown = unknown>(): Promise<ExtensionAccount<Metadata>> {
    const signer = new ExtensionSigner();
    const pubkey = await signer.getPublicKey();
    return new ExtensionAccount<Metadata>(pubkey, signer);
  }
}
