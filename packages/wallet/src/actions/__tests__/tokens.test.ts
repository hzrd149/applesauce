import { Proof, Token, Wallet } from "@cashu/cashu-ts";
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
import { CleanupDeletedTokens, CompleteSpend, MintTokens, RolloverTokens } from "../tokens.js";

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
  it("publishes a delete event for the old tokens by default", async () => {
    const old1 = await addTokenEvent(50);
    const old2 = await addTokenEvent(50);

    await hub.run(RolloverTokens, [old1, old2], makeToken(100));

    const published = publish.mock.calls.map((call) => call[0]);
    const deleteEvent = published.find((e: any) => e.kind === kinds.EventDeletion);
    expect(deleteEvent).toBeDefined();
    const deletedIds = deleteEvent!.tags.filter((t: string[]) => t[0] === "e").map((t: string[]) => t[1]);
    expect(deletedIds).toEqual(expect.arrayContaining([old1.id, old2.id]));
  });

  it("skips the delete event when deleteOldTokens is false but still records the old ids in `del`", async () => {
    const old1 = await addTokenEvent(50);
    const old2 = await addTokenEvent(50);

    await hub.run(RolloverTokens, [old1, old2], makeToken(100), { deleteOldTokens: false });

    const published = publish.mock.calls.map((call) => call[0]);
    expect(published.find((e: any) => e.kind === kinds.EventDeletion)).toBeUndefined();

    const tokenEvent = published.find((e: any) => e.kind === WALLET_TOKEN_KIND);
    expect(tokenEvent).toBeDefined();
    await unlockTokenContent(tokenEvent, signer);
    expect(getTokenContent(tokenEvent)!.del).toEqual(expect.arrayContaining([old1.id, old2.id]));
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
