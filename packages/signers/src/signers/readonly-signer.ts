import { isHexKey, normalizeToPubkey } from "applesauce-core/helpers";
import { VerifiedEvent } from "applesauce-core/helpers/event";
import { ISigner } from "../interop.js";

/** A signer that only implements getPublicKey and throws on ever other method */
export class ReadonlySigner implements ISigner {
  nip04: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
  nip44: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };

  constructor(private pubkey: string) {
    if (!isHexKey(pubkey)) throw new Error("Invalid public key");

    this.nip04 = {
      encrypt: this.nip04Encrypt.bind(this),
      decrypt: this.nip04Decrypt.bind(this),
    };
    this.nip44 = {
      encrypt: this.nip44Encrypt.bind(this),
      decrypt: this.nip44Decrypt.bind(this),
    };
  }

  async getPublicKey() {
    return this.pubkey;
  }

  async signEvent(): Promise<VerifiedEvent> {
    throw new Error("Cant sign events with readonly");
  }

  async nip04Encrypt(): Promise<string> {
    throw new Error("Cant encrypt with readonly");
  }
  async nip04Decrypt(): Promise<string> {
    throw new Error("Cant decrypt with readonly");
  }
  async nip44Encrypt(): Promise<string> {
    throw new Error("Cant encrypt with readonly");
  }
  async nip44Decrypt(): Promise<string> {
    throw new Error("Cant decrypt with readonly");
  }

  /** Creates a ReadonlySigner from a hex public key or NIP-19 npub */
  static fromPubkey(pubkey: string) {
    return new ReadonlySigner(normalizeToPubkey(pubkey));
  }
}
