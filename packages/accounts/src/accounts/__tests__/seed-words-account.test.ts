import { wordlist } from "@scure/bip39/wordlists/english.js";
import { verifyEvent } from "applesauce-core/helpers";
import { SeedWordsSigner } from "applesauce-signers/signers/seed-words-signer";
import { describe, expect, it } from "vitest";
import { AccountManager } from "../../manager.js";
import { SeedWordsAccount } from "../seed-words-account.js";

const words = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const pubkey = "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917";

describe("SeedWordsAccount", () => {
  it("creates an account with a seed words signer and signs events", async () => {
    const account = SeedWordsAccount.fromWords(words, { wordlist });
    expect(account.type).toBe("seed-words");
    expect(account.signer).toBeInstanceOf(SeedWordsSigner);
    expect(await account.getPublicKey()).toBe(pubkey);
    const event = await account.signEvent({ kind: 1, content: "hello", created_at: 1, tags: [] });
    expect(event.pubkey).toBe(pubkey);
    expect(verifyEvent(event)).toBe(true);
  });

  it("round-trips the derived key, id, and metadata through JSON", async () => {
    const account = SeedWordsAccount.fromWords<{ name: string }>(words, {
      wordlist,
      account: 1,
      passphrase: "test",
    });
    account.id = "seed-account";
    account.metadata = { name: "Test" };
    const json = JSON.parse(JSON.stringify(account.toJSON()));
    expect(Object.keys(json.signer)).toEqual(["key"]);
    expect(json.signer.key).toMatch(/^[0-9a-f]{64}$/);
    const restored = SeedWordsAccount.fromJSON(json);
    expect(restored.toJSON()).toEqual(account.toJSON());
    expect(restored.signer).toBeInstanceOf(SeedWordsSigner);
    expect(await restored.getPublicKey()).toBe(await account.getPublicKey());
  });

  it("restores through explicit account registration", () => {
    const account = SeedWordsAccount.fromWords(words, { wordlist });
    const manager = new AccountManager();
    manager.registerType(SeedWordsAccount);
    manager.fromJSON([account.toJSON()]);
    expect(manager.getAccount(account.id)).toBeInstanceOf(SeedWordsAccount);
  });

  it("rejects invalid seed words and serialized keys", () => {
    expect(() => SeedWordsAccount.fromWords("invalid", { wordlist })).toThrow("Invalid mnemonic");
    const json = SeedWordsAccount.fromWords(words, { wordlist }).toJSON();
    json.signer.key = "invalid";
    expect(() => SeedWordsAccount.fromJSON(json)).toThrow("Invalid private key");
  });
});
