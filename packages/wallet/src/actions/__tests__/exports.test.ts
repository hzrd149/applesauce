import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AddNutzapInfoMint",
        "AddNutzapInfoRelay",
        "AddToken",
        "CompleteSpend",
        "ConsolidateTokens",
        "CreateWallet",
        "NutzapEvent",
        "NutzapProfile",
        "ReceiveNutzaps",
        "ReceiveToken",
        "RecommendMint",
        "RecoverFromCouch",
        "RemoveNutzapInfoMint",
        "RemoveNutzapInfoRelay",
        "RolloverTokens",
        "SetNutzapInfoMints",
        "SetNutzapInfoPubkey",
        "SetNutzapInfoRelays",
        "SetWalletMints",
        "SetWalletRelays",
        "TokensOperation",
        "UnlockWallet",
        "UpdateMintRecommendation",
        "UpdateNutzapInfo",
        "WalletAddPrivateKey",
      ]
    `);
  });
});
