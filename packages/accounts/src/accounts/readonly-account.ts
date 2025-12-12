import { normalizeToPubkey } from "applesauce-core/helpers/pointers";
import { ReadonlySigner } from "applesauce-signers/signers/readonly-signer";
import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";

/** An account that cannot sign or encrypt anything */
export class ReadonlyAccount<Metadata extends unknown> extends BaseAccount<ReadonlySigner, void, Metadata> {
  static readonly type = "readonly";

  toJSON() {
    return super.saveCommonFields({
      signer: undefined,
    });
  }

  static fromJSON<Metadata extends unknown>(json: SerializedAccount<void, Metadata>): ReadonlyAccount<Metadata> {
    const account = new ReadonlyAccount<Metadata>(json.pubkey, new ReadonlySigner(json.pubkey));
    return super.loadCommonFields(account, json);
  }

  /** Creates a ReadonlyAccount from a hex public key or NIP-19 npub */
  static fromPubkey(pubkey: string) {
    const signer = ReadonlySigner.fromPubkey(pubkey);
    const hex = normalizeToPubkey(pubkey);
    if (!hex) throw new Error("Invalid public key");
    return new ReadonlyAccount(hex, signer);
  }
}
