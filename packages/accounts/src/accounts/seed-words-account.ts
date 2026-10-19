import { bytesToHex } from "applesauce-core/helpers/event";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { SeedWordsSigner, type SeedWordsSignerOptions } from "applesauce-signers/signers/seed-words-signer";
import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";

/** Serialized signer data containing only the derived private key */
export type SeedWordsAccountSignerData = {
  /** The derived private key encoded as hex */
  key: string;
};

/** An account derived from BIP-39 seed words using NIP-06 */
export class SeedWordsAccount<Metadata extends unknown = unknown> extends BaseAccount<
  SeedWordsSigner,
  SeedWordsAccountSignerData,
  Metadata
> {
  /** The serialized account type */
  static readonly type = "seed-words";

  /** Returns the account data with its derived key */
  toJSON(): SerializedAccount<SeedWordsAccountSignerData, Metadata> {
    return super.saveCommonFields({ signer: { key: bytesToHex(this.signer.key) } });
  }

  /**
   * Restores an account from its serialized derived key
   * @throws If the private key is invalid
   */
  static fromJSON<Metadata extends unknown = unknown>(
    json: SerializedAccount<SeedWordsAccountSignerData, Metadata>,
  ): SeedWordsAccount<Metadata> {
    const signer = SeedWordsSigner.fromKey(json.signer.key);
    const account = new SeedWordsAccount<Metadata>(json.pubkey, signer);
    return super.loadCommonFields(account, json);
  }

  /**
   * Creates an account from validated seed words
   * @throws If the mnemonic or account index is invalid, or key derivation fails
   */
  static fromWords<Metadata extends unknown = unknown>(
    words: string,
    options: SeedWordsSignerOptions,
  ): SeedWordsAccount<Metadata> {
    const signer = SeedWordsSigner.fromWords(words, options);
    return new SeedWordsAccount<Metadata>(getPublicKey(signer.key), signer);
  }
}
