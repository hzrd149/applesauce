import { describe, expect, it, vi } from "vitest";
import { loadCashuWallet } from "../cashu-wallet.js";

describe("loadCashuWallet", () => {
  it("delegates to the provider when one is given", async () => {
    const wallet = {} as never;
    const provider = vi.fn().mockResolvedValue(wallet);
    expect(await loadCashuWallet("https://mint.example.com", provider)).toBe(wallet);
    expect(provider).toHaveBeenCalledWith("https://mint.example.com");
  });
});
