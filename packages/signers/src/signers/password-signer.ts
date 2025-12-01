import { normalizeToSecretKey } from "applesauce-core/helpers";
import { createDefer, Deferred } from "applesauce-core/promise";
import { EventTemplate, finalizeEvent, getPublicKey, nip04, nip44 } from "nostr-tools";
import { decrypt, encrypt } from "nostr-tools/nip49";
import { ISigner } from "../interop.js";

/** A NIP-49 (Private Key Encryption) signer */
export class PasswordSigner implements ISigner {
  key: Uint8Array | null = null;

  ncryptsec?: string;

  nip04: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
  nip44: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };

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

  /** Sets the ncryptsec from the key and password */
  public async setPassword(password: string) {
    if (!this.key) throw new Error("Cant set password until unlocked");

    this.ncryptsec = encrypt(this.key, password);
  }

  /** Tests if the provided password is correct by decrypting the ncryptsec */
  public async testPassword(password: string) {
    if (this.ncryptsec) {
      const key = decrypt(this.ncryptsec, password);
      if (!key) throw new Error("Failed to decrypt key");
    } else throw new Error("Missing ncryptsec");
  }

  /** Unlocks the signer by decrypting the ncryptsec using the provided password */
  public async unlock(password: string) {
    if (this.key) return;

    if (this.ncryptsec) {
      try {
        this.key = decrypt(this.ncryptsec, password);
        if (!this.key) throw new Error("Failed to decrypt key");
      } catch (error) {
        throw new Error("failed to decrypt key: " + (error instanceof Error ? error.message : String(error)));
      }
    } else throw new Error("Missing ncryptsec");
  }

  /** Locks the signer by removing the unencrypted key from memory */
  public lock() {
    this.key = null;
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

  /** Creates a PasswordSigner from a hex private key or NIP-19 nsec and password */
  static async fromPrivateKey(privateKey: Uint8Array | string, password: string) {
    const signer = new PasswordSigner();
    signer.key = normalizeToSecretKey(privateKey);
    await signer.setPassword(password);
    return signer;
  }

  /** Creates a PasswordSigner from a ncryptsec and unlocks it with the provided password */
  static async fromNcryptsec(ncryptsec: string, password?: string) {
    const signer = new PasswordSigner();
    signer.ncryptsec = ncryptsec;
    if (password) await signer.unlock(password);
    return signer;
  }
}
