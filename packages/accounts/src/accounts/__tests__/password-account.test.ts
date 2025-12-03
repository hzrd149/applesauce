import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { PasswordSigner } from "applesauce-signers/signers/password-signer";
import { encrypt } from "nostr-tools/nip49";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SerializedAccount } from "../../types.js";
import { PasswordAccount } from "../password-account.js";

let testKey: Uint8Array;
let testPubkey: string;
let testPassword: string;
let testNcryptsec: string;

beforeEach(() => {
  testKey = generateSecretKey();
  testPubkey = getPublicKey(testKey);
  testPassword = "test-password-123";
  testNcryptsec = encrypt(testKey, testPassword);
});

describe("constructor", () => {
  it("should create a PasswordAccount with the correct type", () => {
    const signer = new PasswordSigner();
    const account = new PasswordAccount(testPubkey, signer);

    expect(account.type).toBe("ncryptsec");
    expect(account.pubkey).toBe(testPubkey);
    expect(account.signer).toBe(signer);
  });

  it("should have the correct static type", () => {
    expect(PasswordAccount.type).toBe("ncryptsec");
  });
});

describe("unlocked getter", () => {
  it("should return false when signer is locked", () => {
    const signer = new PasswordSigner();
    const account = new PasswordAccount(testPubkey, signer);

    expect(account.unlocked).toBe(false);
  });

  it("should return true when signer is unlocked", async () => {
    const signer = new PasswordSigner();
    signer.ncryptsec = testNcryptsec;
    await signer.unlock(testPassword);
    const account = new PasswordAccount(testPubkey, signer);

    expect(account.unlocked).toBe(true);
  });
});

describe("requestUnlockPassword", () => {
  it("should be customizable", async () => {
    const originalMethod = PasswordAccount.requestUnlockPassword;
    const mockPassword = "custom-password";

    PasswordAccount.requestUnlockPassword = vi.fn().mockResolvedValue(mockPassword);

    const signer = new PasswordSigner();
    const account = new PasswordAccount(testPubkey, signer);

    const result = await PasswordAccount.requestUnlockPassword(account);
    expect(result).toBe(mockPassword);
    expect(PasswordAccount.requestUnlockPassword).toHaveBeenCalledWith(account);

    // Restore original method
    PasswordAccount.requestUnlockPassword = originalMethod;
  });

  it("should request password when account is locked", async () => {
    PasswordAccount.requestUnlockPassword = vi.fn().mockResolvedValue(testPassword);

    const account = PasswordAccount.fromNcryptsec(testPubkey, testNcryptsec);

    await account.getPublicKey();
    expect(PasswordAccount.requestUnlockPassword).toHaveBeenCalledWith(account);
    expect(account.unlocked).toBe(true);
  });
});

describe("unlock", () => {
  it("should unlock the signer with provided password", async () => {
    const signer = new PasswordSigner();
    signer.ncryptsec = testNcryptsec;
    const account = new PasswordAccount(testPubkey, signer);

    expect(account.unlocked).toBe(false);

    await account.unlock(testPassword);

    expect(account.unlocked).toBe(true);
  });

  it("should throw error with wrong password", async () => {
    const signer = new PasswordSigner();
    signer.ncryptsec = testNcryptsec;
    const account = new PasswordAccount(testPubkey, signer);

    await expect(account.unlock("wrong-password")).rejects.toThrow();
  });

  it("should use requestUnlockPassword when no password provided", async () => {
    const originalMethod = PasswordAccount.requestUnlockPassword;
    PasswordAccount.requestUnlockPassword = vi.fn().mockResolvedValue(testPassword);

    const signer = new PasswordSigner();
    signer.ncryptsec = testNcryptsec;
    const account = new PasswordAccount(testPubkey, signer);

    await account.unlock();

    expect(PasswordAccount.requestUnlockPassword).toHaveBeenCalledWith(account);
    expect(account.unlocked).toBe(true);

    // Restore original method
    PasswordAccount.requestUnlockPassword = originalMethod;
  });

  it("should throw error when requestUnlockPassword fails", async () => {
    const originalMethod = PasswordAccount.requestUnlockPassword;
    const testError = new Error("User cancelled");
    PasswordAccount.requestUnlockPassword = vi.fn().mockRejectedValue(testError);

    const signer = new PasswordSigner();
    signer.ncryptsec = testNcryptsec;
    const account = new PasswordAccount(testPubkey, signer);

    await expect(account.unlock()).rejects.toThrow("User cancelled");

    // Restore original method
    PasswordAccount.requestUnlockPassword = originalMethod;
  });
});

describe("toJSON", () => {
  it("should serialize account correctly", () => {
    const signer = new PasswordSigner();
    signer.ncryptsec = testNcryptsec;
    const account = new PasswordAccount(testPubkey, signer);

    const metadata = { name: "Test Account", created: Date.now() };
    account.metadata = metadata;

    const json = account.toJSON();

    expect(json).toEqual({
      id: account.id,
      type: "ncryptsec",
      pubkey: testPubkey,
      signer: {
        ncryptsec: testNcryptsec,
      },
      metadata,
    });
  });

  it("should throw error when ncryptsec is missing", () => {
    const signer = new PasswordSigner();
    const account = new PasswordAccount(testPubkey, signer);

    expect(() => account.toJSON()).toThrow("Cant save account without ncryptsec");
  });

  it("should serialize account without metadata", () => {
    const signer = new PasswordSigner();
    signer.ncryptsec = testNcryptsec;
    const account = new PasswordAccount(testPubkey, signer);

    const json = account.toJSON();

    expect(json).toEqual({
      id: account.id,
      type: "ncryptsec",
      pubkey: testPubkey,
      signer: {
        ncryptsec: testNcryptsec,
      },
      metadata: undefined,
    });
  });
});

describe("fromJSON", () => {
  it("should deserialize account correctly", () => {
    const metadata = { name: "Test Account", created: Date.now() };
    const json: SerializedAccount<{ ncryptsec: string }, typeof metadata> = {
      id: "test-id",
      type: "ncryptsec",
      pubkey: testPubkey,
      signer: {
        ncryptsec: testNcryptsec,
      },
      metadata,
    };

    const account = PasswordAccount.fromJSON(json);

    expect(account.id).toBe("test-id");
    expect(account.type).toBe("ncryptsec");
    expect(account.pubkey).toBe(testPubkey);
    expect(account.signer.ncryptsec).toBe(testNcryptsec);
    expect(account.metadata).toEqual(metadata);
  });

  it("should deserialize account without metadata", () => {
    const json: SerializedAccount<{ ncryptsec: string }, undefined> = {
      id: "test-id",
      type: "ncryptsec",
      pubkey: testPubkey,
      signer: {
        ncryptsec: testNcryptsec,
      },
    };

    const account = PasswordAccount.fromJSON(json);

    expect(account.id).toBe("test-id");
    expect(account.type).toBe("ncryptsec");
    expect(account.pubkey).toBe(testPubkey);
    expect(account.signer.ncryptsec).toBe(testNcryptsec);
    expect(account.metadata).toBeUndefined();
  });

  it("should create account with locked signer", () => {
    const json: SerializedAccount<{ ncryptsec: string }, any> = {
      id: "test-id",
      type: "ncryptsec",
      pubkey: testPubkey,
      signer: {
        ncryptsec: testNcryptsec,
      },
    };

    const account = PasswordAccount.fromJSON(json);

    expect(account.unlocked).toBe(false);
  });

  it("should be able to unlock deserialized account", async () => {
    const json: SerializedAccount<{ ncryptsec: string }, any> = {
      id: "test-id",
      type: "ncryptsec",
      pubkey: testPubkey,
      signer: {
        ncryptsec: testNcryptsec,
      },
    };

    const account = PasswordAccount.fromJSON(json);
    await account.unlock(testPassword);

    expect(account.unlocked).toBe(true);
  });
});

describe("fromNcryptsec", () => {
  it("should create account from ncryptsec string", () => {
    const account = PasswordAccount.fromNcryptsec(testPubkey, testNcryptsec);

    expect(account.type).toBe("ncryptsec");
    expect(account.pubkey).toBe(testPubkey);
    expect(account.signer.ncryptsec).toBe(testNcryptsec);
    expect(account.unlocked).toBe(false);
  });

  it("should create account that can be unlocked", async () => {
    const account = PasswordAccount.fromNcryptsec(testPubkey, testNcryptsec);

    await account.unlock(testPassword);

    expect(account.unlocked).toBe(true);
  });

  it("should create account with typed metadata", () => {
    interface TestMetadata {
      name: string;
      created: number;
    }

    const account = PasswordAccount.fromNcryptsec<TestMetadata>(testPubkey, testNcryptsec);

    // Test that metadata typing works
    account.metadata = { name: "Test", created: Date.now() };
    expect(account.metadata.name).toBe("Test");
  });
});

it("should handle full lifecycle: create -> serialize -> deserialize -> unlock", async () => {
  // Create account
  const account1 = PasswordAccount.fromNcryptsec(testPubkey, testNcryptsec);
  const metadata = { name: "Test Account", created: Date.now() };
  account1.metadata = metadata;

  // Serialize
  const json = account1.toJSON();

  // Deserialize
  const account2 = PasswordAccount.fromJSON(json);

  expect(account2.id).toBe(account1.id);
  expect(account2.pubkey).toBe(testPubkey);
  expect(account2.metadata).toEqual(metadata);
  expect(account2.unlocked).toBe(false);

  // Unlock
  await account2.unlock(testPassword);
  expect(account2.unlocked).toBe(true);
});

describe("error handling", () => {
  it("should throw error when invalid ncryptsec is used", async () => {
    const invalidNcryptsec = "invalid-ncryptsec";
    const account = PasswordAccount.fromNcryptsec(testPubkey, invalidNcryptsec);

    await expect(account.unlock(testPassword)).rejects.toThrow();
  });
});
