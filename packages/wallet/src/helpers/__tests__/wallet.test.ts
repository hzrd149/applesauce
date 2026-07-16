// Wave 0 gap: wallet.ts had only exports-snapshot coverage before this file. These tests
// exercise the setCachedValue migration (05.1-11): WalletMintsSymbol, WalletPrivateKeySymbol,
// and WalletRelaysSymbol must all be non-enumerable and dropped by a plain spread. The
// private-key case is a security-relevant V8 improvement (T-05.1-05): a spread of the wallet
// event must no longer carry the decrypted private key along with it.

import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletFactory } from "../../factories/wallet.js";
import {
  getWalletMints,
  getWalletPrivateKey,
  getWalletRelays,
  isWalletUnlocked,
  WalletMintsSymbol,
  WalletPrivateKeySymbol,
  WalletRelaysSymbol,
} from "../wallet.js";

const user = new FakeUser();

describe("getWalletMints / getWalletPrivateKey / getWalletRelays", () => {
  it("memoize non-enumerably, and a plain spread drops the decrypted private key", async () => {
    const privateKey = generateSecretKey();
    const wallet = await WalletFactory.create(["https://mint.example"], privateKey, ["wss://relay.example/"])
      .as(user)
      .sign();

    expect(isWalletUnlocked(wallet)).toBe(true);

    // Unattempted before the first read.
    expect(WalletMintsSymbol in wallet).toBe(false);
    expect(WalletPrivateKeySymbol in wallet).toBe(false);
    expect(WalletRelaysSymbol in wallet).toBe(false);

    const mints = getWalletMints(wallet);
    const key = getWalletPrivateKey(wallet);
    const relays = getWalletRelays(wallet);

    expect(mints).toEqual(["https://mint.example"]);
    expect(key).toEqual(privateKey);
    expect(relays).toEqual(["wss://relay.example/"]);

    for (const sym of [WalletMintsSymbol, WalletPrivateKeySymbol, WalletRelaysSymbol]) {
      expect(Reflect.ownKeys(wallet)).toContain(sym);
      expect(Object.getOwnPropertyDescriptor(wallet, sym)?.enumerable).toBe(false);
    }

    // A plain spread drops every memo -- most importantly, the decrypted private key does
    // not ride along on an unrelated object copy (the V8 improvement this migration makes).
    const spread = { ...wallet };
    expect(WalletPrivateKeySymbol in spread).toBe(false);
    expect(WalletMintsSymbol in spread).toBe(false);
    expect(WalletRelaysSymbol in spread).toBe(false);
    expect((spread as Record<symbol, unknown>)[WalletPrivateKeySymbol]).toBeUndefined();

    // Re-reading returns the exact same memoized objects (short-circuits recompute).
    expect(getWalletMints(wallet)).toBe(mints);
    expect(getWalletPrivateKey(wallet)).toBe(key);
    expect(getWalletRelays(wallet)).toBe(relays);
  });
});
