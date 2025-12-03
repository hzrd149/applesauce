import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { nprofileEncode, npubEncode } from "applesauce-core/helpers/pointers";
import { ReadonlySigner } from "applesauce-signers/signers/readonly-signer";
import { beforeEach, describe, expect, it } from "vitest";
import { SerializedAccount } from "../../types.js";
import { ReadonlyAccount } from "../readonly-account.js";

let testKey: Uint8Array;
let testPubkey: string;
let testNpub: string;
let testNprofile: string;

beforeEach(() => {
  testKey = generateSecretKey();
  testPubkey = getPublicKey(testKey);
  testNpub = npubEncode(testPubkey);
  testNprofile = nprofileEncode({
    pubkey: testPubkey,
    relays: ["wss://relay.damus.io", "wss://nos.lol"],
  });
});

describe("constructor", () => {
  it("should create a ReadonlyAccount with the correct type", () => {
    const signer = new ReadonlySigner(testPubkey);
    const account = new ReadonlyAccount(testPubkey, signer);

    expect(account.type).toBe("readonly");
    expect(account.pubkey).toBe(testPubkey);
    expect(account.signer).toBe(signer);
  });

  it("should have the correct static type", () => {
    expect(ReadonlyAccount.type).toBe("readonly");
  });
});

describe("toJSON", () => {
  it("should serialize account to JSON with correct structure", () => {
    const signer = new ReadonlySigner(testPubkey);
    const account = new ReadonlyAccount(testPubkey, signer);
    account.id = "test-id";
    account.metadata = { name: "Test Account" };

    const json = account.toJSON();

    expect(json).toEqual({
      id: "test-id",
      type: "readonly",
      pubkey: testPubkey,
      signer: undefined,
      metadata: { name: "Test Account" },
    });
  });

  it("should serialize account without metadata", () => {
    const signer = new ReadonlySigner(testPubkey);
    const account = new ReadonlyAccount(testPubkey, signer);
    account.id = "test-id";

    const json = account.toJSON();

    expect(json).toEqual({
      id: "test-id",
      type: "readonly",
      pubkey: testPubkey,
      signer: undefined,
      metadata: undefined,
    });
  });

  it("should always set signer to undefined in JSON", () => {
    const signer = new ReadonlySigner(testPubkey);
    const account = new ReadonlyAccount(testPubkey, signer);

    const json = account.toJSON();

    expect(json.signer).toBeUndefined();
  });
});

describe("fromJSON", () => {
  it("should deserialize JSON to ReadonlyAccount", () => {
    const json: SerializedAccount<void, any> = {
      id: "test-id",
      type: "readonly",
      pubkey: testPubkey,
      signer: undefined,
      metadata: { name: "Test Account" },
    };

    const account = ReadonlyAccount.fromJSON(json);

    expect(account.id).toBe("test-id");
    expect(account.type).toBe("readonly");
    expect(account.pubkey).toBe(testPubkey);
    expect(account.metadata).toEqual({ name: "Test Account" });
    expect(account.signer).toBeInstanceOf(ReadonlySigner);
  });

  it("should deserialize JSON without metadata", () => {
    const json: SerializedAccount<void, any> = {
      id: "test-id",
      type: "readonly",
      pubkey: testPubkey,
      signer: undefined,
    };

    const account = ReadonlyAccount.fromJSON(json);

    expect(account.id).toBe("test-id");
    expect(account.type).toBe("readonly");
    expect(account.pubkey).toBe(testPubkey);
    expect(account.metadata).toBeUndefined();
    expect(account.signer).toBeInstanceOf(ReadonlySigner);
  });

  it("should create ReadonlySigner with correct pubkey", async () => {
    const json: SerializedAccount<void, any> = {
      id: "test-id",
      type: "readonly",
      pubkey: testPubkey,
      signer: undefined,
    };

    const account = ReadonlyAccount.fromJSON(json);

    expect(await account.signer.getPublicKey()).toBe(testPubkey);
  });
});

describe("fromPubkey", () => {
  describe("hex public key", () => {
    it("should create ReadonlyAccount from hex public key", () => {
      const account = ReadonlyAccount.fromPubkey(testPubkey);

      expect(account.type).toBe("readonly");
      expect(account.pubkey).toBe(testPubkey);
      expect(account.signer).toBeInstanceOf(ReadonlySigner);
    });

    it("should create signer that returns correct pubkey", async () => {
      const account = ReadonlyAccount.fromPubkey(testPubkey);

      expect(await account.signer.getPublicKey()).toBe(testPubkey);
      expect(await account.getPublicKey()).toBe(testPubkey);
    });

    it("should reject invalid hex public key", () => {
      expect(() => ReadonlyAccount.fromPubkey("invalid-hex")).toThrow();
      expect(() => ReadonlyAccount.fromPubkey("")).toThrow();
      expect(() => ReadonlyAccount.fromPubkey("123")).toThrow();
    });
  });

  describe("npub public key", () => {
    it("should create ReadonlyAccount from npub", () => {
      const account = ReadonlyAccount.fromPubkey(testNpub);

      expect(account.type).toBe("readonly");
      expect(account.pubkey).toBe(testPubkey);
      expect(account.signer).toBeInstanceOf(ReadonlySigner);
    });

    it("should create signer that returns correct pubkey", async () => {
      const account = ReadonlyAccount.fromPubkey(testNpub);

      expect(await account.signer.getPublicKey()).toBe(testPubkey);
      expect(await account.getPublicKey()).toBe(testPubkey);
    });

    it("should reject invalid npub", () => {
      expect(() => ReadonlyAccount.fromPubkey("npub1invalid")).toThrow();
      expect(() => ReadonlyAccount.fromPubkey("npub")).toThrow();
    });
  });

  describe("nprofile public key", () => {
    it("should create ReadonlyAccount from nprofile", () => {
      const account = ReadonlyAccount.fromPubkey(testNprofile);

      expect(account.type).toBe("readonly");
      expect(account.pubkey).toBe(testPubkey);
      expect(account.signer).toBeInstanceOf(ReadonlySigner);
    });

    it("should create signer that returns correct pubkey", async () => {
      const account = ReadonlyAccount.fromPubkey(testNprofile);

      expect(await account.signer.getPublicKey()).toBe(testPubkey);
      expect(await account.getPublicKey()).toBe(testPubkey);
    });

    it("should extract pubkey from nprofile with relay hints", () => {
      const nprofileWithRelays = nprofileEncode({
        pubkey: testPubkey,
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
      });

      const account = ReadonlyAccount.fromPubkey(nprofileWithRelays);

      expect(account.pubkey).toBe(testPubkey);
    });

    it("should reject invalid nprofile", () => {
      expect(() => ReadonlyAccount.fromPubkey("nprofile1invalid")).toThrow();
      expect(() => ReadonlyAccount.fromPubkey("nprofile")).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle uppercase hex pubkey", () => {
      const uppercaseHex = testPubkey.toUpperCase();
      const account = ReadonlyAccount.fromPubkey(uppercaseHex);

      expect(account.pubkey).toBe(testPubkey); // Should normalize to lowercase
    });

    it("should reject empty string", () => {
      expect(() => ReadonlyAccount.fromPubkey("")).toThrow();
    });

    it("should reject null/undefined", () => {
      expect(() => ReadonlyAccount.fromPubkey(null as any)).toThrow();
      expect(() => ReadonlyAccount.fromPubkey(undefined as any)).toThrow();
    });
  });
});

describe("integration tests", () => {
  it("should roundtrip through JSON serialization", () => {
    const originalAccount = ReadonlyAccount.fromPubkey(testPubkey);
    originalAccount.id = "test-id";
    originalAccount.metadata = { name: "Test Account", description: "A test account" };

    const json = originalAccount.toJSON();
    const restoredAccount = ReadonlyAccount.fromJSON(json);

    expect(restoredAccount.id).toBe(originalAccount.id);
    expect(restoredAccount.type).toBe(originalAccount.type);
    expect(restoredAccount.pubkey).toBe(originalAccount.pubkey);
    expect(restoredAccount.metadata).toEqual(originalAccount.metadata);
  });

  it("should roundtrip through JSON with different pubkey formats", () => {
    const formats = [testPubkey, testNpub, testNprofile];

    formats.forEach((format) => {
      const originalAccount = ReadonlyAccount.fromPubkey(format);
      originalAccount.id = "test-id";

      const json = originalAccount.toJSON();
      const restoredAccount = ReadonlyAccount.fromJSON(json);

      expect(restoredAccount.pubkey).toBe(testPubkey);
    });
  });

  it("should maintain signer functionality after JSON roundtrip", async () => {
    const originalAccount = ReadonlyAccount.fromPubkey(testNpub);
    const json = originalAccount.toJSON();
    const restoredAccount = ReadonlyAccount.fromJSON(json);

    // Should be able to get public key
    expect(await restoredAccount.getPublicKey()).toBe(testPubkey);

    // Should throw on signing attempts
    await expect(
      restoredAccount.signEvent({
        kind: 1,
        content: "test",
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      }),
    ).rejects.toThrow("Cant sign events with readonly");
  });
});
