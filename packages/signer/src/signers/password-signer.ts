import { EventTemplate, finalizeEvent, getPublicKey, nip04, nip44 } from "nostr-tools";
import { encrypt, decrypt } from "nostr-tools/nip49";
import { createDefer, Deferred } from "applesauce-core/promise";

import { Nip07Interface } from "../nip-07.js";

/** A NIP-49 (Private Key Encryption) signer */
export class PasswordSigner implements Nip07Interface {
  key: Uint8Array | null = null;

  ncryptsec?: string;

  nip04?:
    | {
        encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
        decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
      }
    | undefined;
  nip44?:
    | {
        encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
        decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
      }
    | undefined;

  get unlocked() {
    return !!this.key;
  }

  constructor() {
    this.nip04 = {
      encrypt: this.nip04Encrypt.bind(this),
      decrypt: this.nip04Decrypt.bind(this),
    };
    this.nip44 = {
      encrypt: this.nip44Encrypt.bind(this),
      decrypt: this.nip44Decrypt.bind(this),
    };
  }

  unlockPromise?: Deferred<void>;
  protected requestUnlock() {
    if (this.key) return;
    if (this.unlockPromise) return this.unlockPromise;
    const p = createDefer<void>();
    this.unlockPromise = p;
    return p;
  }

  public async setPassword(password: string) {
    if (!this.key) throw new Error("Cant set password until unlocked");

    this.ncryptsec = encrypt(this.key, password);
  }

  public async testPassword(password: string) {
    if (this.ncryptsec) {
      const key = decrypt(this.ncryptsec, password);
      if (!key) throw new Error("Failed to decrypt key");
    } else throw new Error("Missing ncryptsec");
  }

  public async unlock(password: string) {
    if (this.key) return;

    if (this.ncryptsec) {
      this.key = decrypt(this.ncryptsec, password);
      if (!this.key) throw new Error("Failed to decrypt key");
    } else throw new Error("Missing ncryptsec");
  }

  // public methods
  public async getPublicKey() {
    await this.requestUnlock();
    return getPublicKey(this.key!);
  }
  public async signEvent(event: EventTemplate) {
    await this.requestUnlock();
    return finalizeEvent(event, this.key!);
  }

  // NIP-04
  async nip04Encrypt(pubkey: string, plaintext: string) {
    await this.requestUnlock();
    return nip04.encrypt(this.key!, pubkey, plaintext);
  }
  async nip04Decrypt(pubkey: string, ciphertext: string) {
    await this.requestUnlock();
    return nip04.decrypt(this.key!, pubkey, ciphertext);
  }

  // NIP-44
  async nip44Encrypt(pubkey: string, plaintext: string) {
    await this.requestUnlock();
    return nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(this.key!, pubkey));
  }
  async nip44Decrypt(pubkey: string, ciphertext: string) {
    await this.requestUnlock();
    return nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(this.key!, pubkey));
  }
}