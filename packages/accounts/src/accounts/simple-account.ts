import { getPublicKey } from "nostr-tools";
import { SimpleSigner } from "applesauce-signer/signers/simple-signer";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";

type SignerData = {
  key: string;
};

export class SimpleAccount<Metadata extends unknown> extends BaseAccount<SimpleSigner, SignerData, Metadata> {
  static type = "nsec";

  toJSON(): SerializedAccount<SignerData, Metadata> {
    return {
      type: SimpleAccount.type,
      id: this.id,
      pubkey: this.pubkey,
      metadata: this.metadata,
      signer: { key: bytesToHex(this.signer.key) },
    };
  }

  static fromJSON<Metadata extends unknown>(json: SerializedAccount<SignerData, Metadata>): SimpleAccount<Metadata> {
    const key = hexToBytes(json.signer.key);
    return new SimpleAccount(json.pubkey, new SimpleSigner(key));
  }

  static fromKey<Metadata extends unknown>(key: Uint8Array | string): SimpleAccount<Metadata> {
    if (typeof key === "string") key = hexToBytes(key);
    const pubkey = getPublicKey(key);
    return new SimpleAccount(pubkey, new SimpleSigner(key));
  }
}
