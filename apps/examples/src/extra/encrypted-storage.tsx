import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import { cbc } from "@noble/ciphers/aes";
import { hexToBytes, utf8ToBytes, bytesToUtf8 } from "@noble/hashes/utils";

// Salt for key derivation (in a real app, you might want to store this securely)
const SALT = hexToBytes(
  "3053020101300506032b657004220420d8f35f4eb7b8f494b1604490edb3ca0d1324ed200627a220b1e15794bb7810ab",
);

// Encryption utility class
export default class SecureStorage {
  private key: Uint8Array | null = null;
  get unlocked() {
    return this.key !== null;
  }

  constructor(public database: LocalForageDbMethods) {}

  // Generate encryption key from PIN
  private static deriveKey(pin: string): Uint8Array {
    // Convert PIN to bytes
    const pinBytes = utf8ToBytes(pin);

    // Use PBKDF2 to derive a key from the PIN
    // 32 bytes key for AES-256, with 10000 iterations
    const key = pbkdf2(sha256, pinBytes, SALT, { c: 10000, dkLen: 32 });

    return key;
  }

  // Encrypt and store data
  async setItem(key: string, value: string, encryptionKey = this.key): Promise<boolean> {
    if (!encryptionKey) throw new Error("Storage locked");

    try {
      // Convert value to string if it's an object
      const valueBytes = utf8ToBytes(value);

      // Generate a random IV for CBC mode
      const iv = crypto.getRandomValues(new Uint8Array(16));

      // Create AES-CBC cipher
      const cipher = cbc(encryptionKey, iv);

      // Encrypt the data
      const encryptedData = cipher.encrypt(valueBytes);

      // Store IV and encrypted data directly as binary
      const dataToStore = { iv, data: encryptedData };

      // Store the encrypted data - LocalForage can handle this directly
      await this.database.setItem(key, dataToStore);
      return true;
    } catch (error) {
      console.error("Encryption error:", error);
      return false;
    }
  }

  // Retrieve and decrypt data
  async getItem(key: string, encryptionKey = this.key): Promise<string | null> {
    if (!encryptionKey) throw new Error("Storage locked");

    // Get encrypted data
    const encryptedPackage = (await this.database.getItem(key)) as { iv: Uint8Array; data: Uint8Array } | null;
    if (!encryptedPackage) return null;

    // Create AES-CBC decipher
    const decipher = cbc(encryptionKey, encryptedPackage.iv);

    // Decrypt the data
    let decryptedBytes: Uint8Array;
    try {
      decryptedBytes = decipher.decrypt(encryptedPackage.data);
    } catch (e) {
      throw new Error("Decryption failed, incorrect PIN");
    }

    // Convert bytes to UTF-8 string
    const decryptedText = bytesToUtf8(decryptedBytes);

    return decryptedText;
  }

  // Remove an item
  async removeItem(key: string): Promise<void> {
    return this.database.removeItem(key);
  }

  // Clear all stored data
  async clear(): Promise<void> {
    return this.database.clear();
  }

  // Verify if a PIN can decrypt stored data
  async unlock(pin: string, testKey: string = "_pintest_"): Promise<boolean> {
    // Create a key from the pin
    const key = SecureStorage.deriveKey(pin);

    try {
      // Try to get a known test value with this PIN
      const testValue = await this.getItem(testKey, key);

      // If we've never set a test value with this PIN before, set one
      if (testValue === null) {
        // First setup
        await this.setItem(testKey, "PIN verification data", key);
        this.key = SecureStorage.deriveKey(pin);
        return true;
      } else if (testValue === "PIN verification data") {
        // Save the key for later
        this.key = SecureStorage.deriveKey(pin);
        return true;
      }
    } catch (error) {
      // decryption failed, do nothing
    }

    return false;
  }
}
