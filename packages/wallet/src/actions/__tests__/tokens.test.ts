import { CheckStateEnum, Proof, Token, Wallet } from "@cashu/cashu-ts";
import { ActionRunner } from "applesauce-actions";
import { User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { NostrEvent } from "applesauce-core/helpers/event";
import { kinds } from "applesauce-core/helpers";
import { beforeEach, describe, expect, it, Mock, vi, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletFactory } from "../../factories/wallet.js";
import { WalletTokenFactory } from "../../factories/tokens.js";
import { Couch } from "../../helpers/couch.js";
import { getHistoryContent, unlockHistoryContent, WALLET_HISTORY_KIND } from "../../helpers/history.js";
import { getTokenContent, unlockTokenContent, WALLET_TOKEN_KIND } from "../../helpers/tokens.js";
// Import casts to register wallet$ property on User
import "../../casts/index.js";
import {
  CleanupDeletedTokens,
  CompleteSpend,
  MintTokens,
  RecoverFromCouch,
  RolloverTokens,
} from "../tokens.js";

const signer = new FakeUser();
const mint = "https://mint.money.com";

let proofCounter = 0;
/** Builds a Token with a single uniquely-secreted proof for the shared mint */
function makeToken(amount: number): Token {
  return { mint, proofs: [{ amount, secret: `secret-${proofCounter++}`, C: "C", id: "id" } as unknown as Proof] };
}

/** Signs a token event, adds it to the store and returns it */
async function addTokenEvent(amount: number, del: string[] = []): Promise<NostrEvent> {
  const event = await WalletTokenFactory.create(makeToken(amount), del).sign(signer);
  await events.add(event);
  return event;
}

/** A function that returns a loaded cashu Wallet for a mint url */
type CashuWalletProvider = (mint: string) => Promise<Wallet>;

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

describe("RolloverTokens", () => {
  const mintA = "https://mint-a.money.com";
  const mintB = "https://mint-b.money.com";

  /** Builds a token event for a specific mint and adds it to the store */
  async function addTokenForMint(mint: string, amount: number): Promise<NostrEvent> {
    const token: Token = {
      mint,
      proofs: [{ amount, secret: `secret-${proofCounter++}`, C: "C", id: "id" } as unknown as Proof],
    };
    const event = await WalletTokenFactory.create(token).sign(signer);
    await events.add(event);
    return event;
  }

  /** A provider whose cashu wallet swaps proofs for fresh ones (new secrets) */
  function swappingProvider(): CashuWalletProvider {
    let counter = 0;
    return vi.fn().mockResolvedValue({
      ops: {
        receive: (token: Token) => ({
          run: async () => token.proofs.map((p) => ({ ...p, secret: `fresh-${counter++}` })),
        }),
      },
    }) as unknown as CashuWalletProvider;
  }

  it("publishes a single delete event for the rolled-over tokens across all mints", async () => {
    const a1 = await addTokenForMint(mintA, 50);
    const a2 = await addTokenForMint(mintA, 50);
    const b1 = await addTokenForMint(mintB, 30);

    await hub.run(RolloverTokens, { getCashuWallet: swappingProvider() });

    const published = publish.mock.calls.map(([e]) => e);

    // Exactly one kind:5 delete event covering every rolled-over token across both mints
    const deleteEvents = published.filter((e: any) => e.kind === kinds.EventDeletion);
    expect(deleteEvents).toHaveLength(1);
    const deletedIds = deleteEvents[0].tags.filter((t: string[]) => t[0] === "e").map((t: string[]) => t[1]);
    expect(deletedIds.sort()).toEqual([a1.id, a2.id, b1.id].sort());

    // One new token event per mint
    const tokenEvents = published.filter((e: any) => e.kind === WALLET_TOKEN_KIND);
    expect(tokenEvents).toHaveLength(2);
  });

  it("publishes no delete event when deleteOldTokens is false", async () => {
    await addTokenForMint(mintA, 50);
    await addTokenForMint(mintB, 30);

    await hub.run(RolloverTokens, { getCashuWallet: swappingProvider(), deleteOldTokens: false });

    const published = publish.mock.calls.map(([e]) => e);
    expect(published.filter((e: any) => e.kind === kinds.EventDeletion)).toHaveLength(0);
    // The new token events still record the rolled-over ids in their `del` field
    expect(published.filter((e: any) => e.kind === WALLET_TOKEN_KIND)).toHaveLength(2);
  });
});

describe("CompleteSpend", () => {
  it("skips the delete event when deleteOldTokens is false", async () => {
    const spent = await addTokenEvent(100);
    await unlockTokenContent(spent, signer);

    await hub.run(CompleteSpend, [spent], makeToken(40), undefined, { deleteOldTokens: false });

    const published = publish.mock.calls.map((call) => call[0]);
    expect(published.find((e: any) => e.kind === kinds.EventDeletion)).toBeUndefined();
    // the change token still records the spent id in its `del` field
    const tokenEvent = published.find((e: any) => e.kind === WALLET_TOKEN_KIND);
    await unlockTokenContent(tokenEvent, signer);
    expect(getTokenContent(tokenEvent)!.del).toContain(spent.id);
  });
});

describe("RecoverFromCouch", () => {
  /** A minimal in-memory couch seeded with the given tokens */
  function memoryCouch(initial: Token[] = []): Couch {
    let tokens = [...initial];
    const removeToken = (token: Token) => {
      tokens = tokens.filter((t) => t !== token);
    };
    return {
      store: (token: Token) => {
        tokens.push(token);
        return () => removeToken(token);
      },
      clear: () => {
        tokens = [];
      },
      getAll: () => tokens,
      remove: (token: Token) => removeToken(token),
    };
  }

  /** A provider whose cashu wallet reports the given secrets as spent and everything else as unspent */
  function checkingProvider(spentSecrets: Set<string> = new Set()): CashuWalletProvider {
    return vi.fn().mockResolvedValue({
      checkProofsStates: vi.fn(async (proofs: Proof[]) =>
        proofs.map((p) => ({ state: spentSecrets.has(p.secret) ? CheckStateEnum.SPENT : CheckStateEnum.UNSPENT })),
      ),
    }) as unknown as CashuWalletProvider;
  }

  it("recovers an unspent couch token and clears the couch", async () => {
    const couch = memoryCouch([makeToken(100)]);

    await hub.run(RecoverFromCouch, couch, { getCashuWallet: checkingProvider() });

    const tokenEvent = publish.mock.calls.map(([e]) => e).find((e: any) => e.kind === WALLET_TOKEN_KIND);
    expect(tokenEvent).toBeDefined();
    await unlockTokenContent(tokenEvent, signer);
    expect(getTokenContent(tokenEvent)!.proofs).toHaveLength(1);
    // the couch is cleared once recovery completes
    expect(await couch.getAll()).toHaveLength(0);
  });

  it("clears spent couch tokens without publishing them", async () => {
    const spent: Token = { mint, proofs: [{ amount: 100, secret: "spent-secret", C: "C", id: "id" } as unknown as Proof] };
    const couch = memoryCouch([spent]);

    await hub.run(RecoverFromCouch, couch, {
      getCashuWallet: checkingProvider(new Set(["spent-secret"])),
    });

    expect(publish.mock.calls.find(([e]: any) => e.kind === WALLET_TOKEN_KIND)).toBeUndefined();
    // spent leftovers are cleaned out of the couch
    expect(await couch.getAll()).toHaveLength(0);
  });

  it("clears couch tokens whose proofs are already in the wallet without republishing them", async () => {
    const proof = { amount: 100, secret: "dup-secret", C: "C", id: "id" } as unknown as Proof;
    const token: Token = { mint, proofs: [proof] };
    // The same proofs already exist as a wallet token event
    const event = await WalletTokenFactory.create(token).sign(signer);
    await events.add(event);
    const couch = memoryCouch([token]);

    await hub.run(RecoverFromCouch, couch, { getCashuWallet: checkingProvider() });

    expect(publish.mock.calls.find(([e]: any) => e.kind === WALLET_TOKEN_KIND)).toBeUndefined();
    // already-in-wallet tokens are cleaned out of the couch
    expect(await couch.getAll()).toHaveLength(0);
  });

  it("keeps only the entry whose recovered token failed to publish", async () => {
    const recoverable = makeToken(100);
    const alreadyInWallet: Token = {
      mint,
      proofs: [{ amount: 50, secret: "dup-secret", C: "C", id: "id" } as unknown as Proof],
    };
    await events.add(await WalletTokenFactory.create(alreadyInWallet).sign(signer));
    // recoverable is processed first; its publish fails
    const couch = memoryCouch([recoverable, alreadyInWallet]);
    publish.mockRejectedValueOnce(new Error("relay down"));

    await hub.run(RecoverFromCouch, couch, { getCashuWallet: checkingProvider() });

    // the failed entry is kept for a retry, the already-in-wallet one is cleaned out
    const remaining = await couch.getAll();
    expect(remaining).toEqual([recoverable]);
  });
});

describe("CleanupDeletedTokens", () => {
  it("publishes a single delete event for tokens marked deleted by a newer token", async () => {
    const old1 = await addTokenEvent(50);
    const old2 = await addTokenEvent(50);
    // a newer token event that consumed both old tokens
    await addTokenEvent(100, [old1.id, old2.id]);

    await hub.run(CleanupDeletedTokens);

    const deleteEvents = publish.mock.calls.map((call) => call[0]).filter((e: any) => e.kind === kinds.EventDeletion);
    expect(deleteEvents).toHaveLength(1);
    const deletedIds = deleteEvents[0].tags.filter((t: string[]) => t[0] === "e").map((t: string[]) => t[1]);
    expect(deletedIds).toEqual(expect.arrayContaining([old1.id, old2.id]));
  });

  it("does nothing when there are no stale token events", async () => {
    await addTokenEvent(100);

    await hub.run(CleanupDeletedTokens);

    expect(publish.mock.calls.find(([e]: any) => e.kind === kinds.EventDeletion)).toBeUndefined();
  });
});
