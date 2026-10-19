import { Amount, getDecodedToken, getEncodedToken, type Token } from "@cashu/cashu-ts";
import { afterEach, expect, it, vi } from "vitest";
import { decodeTokenFromEmojiString, encodeTokenToEmoji } from "../cashu.js";
import { LocalStorageCouch } from "../local-storage-couch.js";

const token: Token = {
  mint: "https://mint.example.com",
  unit: "sat",
  proofs: [{ id: "01" + "ab".repeat(32), amount: Amount.from(1), secret: "secret", C: "02" + "cd".repeat(32) }],
};

afterEach(() => vi.unstubAllGlobals());

it("preserves full v2 keyset IDs across recovery and removal", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  expect(() => getDecodedToken(getEncodedToken(token), [])).toThrow("no keysets");
  const couch = new LocalStorageCouch();
  const clear = couch.store(token);
  expect(new LocalStorageCouch().getAll()).toEqual([token]);
  couch.remove(token);
  expect(couch.getAll()).toEqual([]);
  couch.store(token);
  clear();
  expect(couch.getAll()).toHaveLength(1);
});

it("resolves emoji tokens with the caller's full keyset IDs", () => {
  const emoji = encodeTokenToEmoji(token);
  expect(decodeTokenFromEmojiString(emoji)).toBeUndefined();
  expect(decodeTokenFromEmojiString(emoji, [token.proofs[0].id])).toEqual(token);
});
