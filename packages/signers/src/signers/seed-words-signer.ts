import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { PrivateKeySigner } from "./private-key-signer.js";

/** Options for deriving a signer from BIP-39 seed words */
export interface SeedWordsSignerOptions {
  /** The NIP-06 account index, default 0 */
  account?: number;
  /** The BIP-39 passphrase, default empty */
  passphrase?: string;
  /** The BIP-39 wordlist used to validate the seed words; import only the language needed */
  wordlist: string[];
}

/** A private key signer derived from BIP-39 seed words using NIP-06 */
export class SeedWordsSigner extends PrivateKeySigner {
  /**
   * Creates a SeedWordsSigner from a hex private key or NIP-19 nsec
   * @throws If the private key is invalid
   */
  static override fromKey(privateKey: Uint8Array | string): SeedWordsSigner {
    return new SeedWordsSigner(PrivateKeySigner.fromKey(privateKey).key);
  }

  /**
   * Creates a signer from validated seed words
   * @throws If the mnemonic is invalid, the account is outside 0–2147483647, or key derivation fails
   */
  static fromWords(words: string, options: SeedWordsSignerOptions): SeedWordsSigner {
    const { account = 0, passphrase, wordlist } = options;
    if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) throw new Error("Invalid account index");
    if (!validateMnemonic(words, wordlist)) throw new Error("Invalid mnemonic");

    const seed = mnemonicToSeedSync(words, passphrase);
    const root = HDKey.fromMasterSeed(seed);
    try {
      const child = root.derive(`m/44'/1237'/${account}'/0/0`);
      try {
        if (!child.privateKey) throw new Error("Could not derive private key");
        return new SeedWordsSigner(new Uint8Array(child.privateKey));
      } finally {
        child.wipePrivateData();
      }
    } finally {
      seed.fill(0);
      root.wipePrivateData();
    }
  }
}
