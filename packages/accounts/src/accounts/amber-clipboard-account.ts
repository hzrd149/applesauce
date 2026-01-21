import { AmberClipboardSigner } from "applesauce-signers/signers/amber-clipboard-signer";
import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";

/** An account for the amber clipboard api */
export class AmberClipboardAccount<Metadata extends unknown = unknown> extends BaseAccount<
  AmberClipboardSigner,
  void,
  Metadata
> {
  static readonly type = "amber-clipboard";

  toJSON(): SerializedAccount<void, Metadata> {
    return super.saveCommonFields({
      signer: undefined,
    });
  }

  static fromJSON<Metadata extends unknown = unknown>(
    json: SerializedAccount<void, Metadata>,
  ): AmberClipboardAccount<Metadata> {
    const account = new AmberClipboardAccount<Metadata>(json.pubkey, new AmberClipboardSigner());
    return super.loadCommonFields(account, json);
  }
}
