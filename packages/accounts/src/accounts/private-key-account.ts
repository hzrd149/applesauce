import { generateSecretKey, getPublicKey } from "nostr-tools";
import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";

export type PrivateKeyAccountSignerData = {
  key: string;
};

/** A simple account that hold the private key in memory */
export class PrivateKeyAccount<Metadata extends unknown> extends BaseAccount<
  PrivateKeySigner,
  PrivateKeyAccountSignerData,
  Metadata
> {
  static readonly type = "nsec";

  toJSON(): SerializedAccount<PrivateKeyAccountSignerData, Metadata> {
    return super.saveCommonFields({
      signer: { key: bytesToHex(this.signer.key) },
    });
  }

  static fromJSON<Metadata extends unknown>(
    json: SerializedAccount<PrivateKeyAccountSignerData, Metadata>,
  ): PrivateKeyAccount<Metadata> {
    const key = hexToBytes(json.signer.key);
    const account = new PrivateKeyAccount<Metadata>(json.pubkey, new PrivateKeySigner(key));
    return super.loadCommonFields(account, json);
  }

  /** Creates a PrivateKeyAccount from a hex private key or NIP-19 nsec */
  static fromKey<Metadata extends unknown>(privateKey: Uint8Array | string): PrivateKeyAccount<Metadata> {
    const signer = PrivateKeySigner.fromKey(privateKey);
    const pubkey = getPublicKey(signer.key);
    return new PrivateKeyAccount(pubkey, signer);
  }

  /** Creates a new PrivateKeyAccount with a random private key */
  static generateNew<Metadata extends unknown>(): PrivateKeyAccount<Metadata> {
    const key = generateSecretKey();
    return PrivateKeyAccount.fromKey(key);
  }
}
