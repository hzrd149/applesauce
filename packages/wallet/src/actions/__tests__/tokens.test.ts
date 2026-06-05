import { Proof } from "@cashu/cashu-ts";
import { ActionRunner } from "applesauce-actions";
import { User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { beforeEach, describe, expect, it, Mock, vi, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletFactory } from "../../factories/wallet.js";
import { Couch } from "../../helpers/couch.js";
import { CashuWalletProvider } from "../../helpers/cashu-wallet.js";
import { getHistoryContent, unlockHistoryContent, WALLET_HISTORY_KIND } from "../../helpers/history.js";
import { getTokenContent, unlockTokenContent, WALLET_TOKEN_KIND } from "../../helpers/tokens.js";
// Import casts to register wallet$ property on User
import "../../casts/index.js";
import { MintTokens } from "../tokens.js";

const signer = new FakeUser();
const mint = "https://mint.money.com";

let events: EventStore;
let publish: Mock<(...args: any[]) => Promise<void>>;
let hub: ActionRunner;
beforeEach(async () => {
  events = new EventStore();
  publish = vitest.fn().mockResolvedValue(undefined);
  hub = new ActionRunner(events, signer, publish);
  User.cache.clear();

  // Create and unlock a wallet for the signer
  const wallet = await WalletFactory.create([mint], generateSecretKey()).as(signer).sign();
  await events.add(wallet);
});

/** A fake wallet provider whose wallet mints the given proofs */
function mintingProvider(proofs: Proof[]): CashuWalletProvider {
  return vi
    .fn()
    .mockResolvedValue({ mintProofsBolt11: vi.fn().mockResolvedValue(proofs) }) as unknown as CashuWalletProvider;
}

describe("MintTokens", () => {
  const proofs: Proof[] = [{ amount: 100, secret: "secret", C: "C", id: "id" } as unknown as Proof];

  it("mints proofs and publishes a token event and an 'in' history event", async () => {
    await hub.run(MintTokens, mint, 100, "quote-id", { getCashuWallet: mintingProvider(proofs) });

    const published = publish.mock.calls.map((call) => call[0]);
    const tokenEvent = published.find((e: any) => e.kind === WALLET_TOKEN_KIND);
    const historyEvent = published.find((e: any) => e.kind === WALLET_HISTORY_KIND);
    expect(tokenEvent).toBeDefined();
    expect(historyEvent).toBeDefined();

    await unlockTokenContent(tokenEvent, signer);
    expect(getTokenContent(tokenEvent)!.mint).toBe(mint);
    expect(getTokenContent(tokenEvent)!.proofs).toHaveLength(1);

    await unlockHistoryContent(historyEvent, signer);
    const history = getHistoryContent(historyEvent)!;
    expect(history.direction).toBe("in");
    expect(history.amount).toBe(100);
  });

  it("stores the minted token in the couch and clears it after success", async () => {
    const clear = vi.fn();
    const couch = { store: vi.fn().mockResolvedValue(clear), clear: vi.fn(), getAll: vi.fn() } as unknown as Couch;

    await hub.run(MintTokens, mint, 100, "quote-id", { getCashuWallet: mintingProvider(proofs), couch });

    expect(couch.store).toHaveBeenCalledWith(expect.objectContaining({ mint, proofs }));
    expect(clear).toHaveBeenCalled();
  });

  it("keeps the token in the couch when publishing fails", async () => {
    const clear = vi.fn();
    const couch = { store: vi.fn().mockResolvedValue(clear), clear: vi.fn(), getAll: vi.fn() } as unknown as Couch;
    publish.mockRejectedValueOnce(new Error("relay down"));

    await expect(
      hub.run(MintTokens, mint, 100, "quote-id", { getCashuWallet: mintingProvider(proofs), couch }),
    ).rejects.toThrow();

    expect(couch.store).toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
