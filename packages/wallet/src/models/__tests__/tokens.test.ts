import { Proof, Token } from "@cashu/cashu-ts";
import { EventStore } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { firstValueFrom } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletTokenFactory } from "../../factories/tokens.js";
import { unlockTokenContent } from "../../helpers/tokens.js";
import { WalletBalanceModel, WalletDeletedTokensModel, WalletTokensModel } from "../tokens.js";

const signer = new FakeUser();
const mint = "https://mint.money.com";

let events: EventStore;
let counter = 0;

beforeEach(() => {
  events = new EventStore();
  counter = 0;
});

/** Builds a Token with a single uniquely-secreted proof for the shared mint */
function makeToken(amount: number): Token {
  return { mint, proofs: [{ amount, secret: `secret-${counter++}`, C: "C", id: "id" } as unknown as Proof] };
}

/** Signs an unlocked token event, adds it to the store and returns it */
async function addToken(amount: number, del: string[] = []): Promise<NostrEvent> {
  const event = await WalletTokenFactory.create(makeToken(amount), del).sign(signer);
  // Unlock before adding so the model sees the decrypted `del` field on its first emission
  await unlockTokenContent(event, signer);
  await events.add(event);
  return event;
}

describe("WalletTokensModel", () => {
  it("excludes token events that a newer token marked as deleted", async () => {
    const old1 = await addToken(50);
    const old2 = await addToken(50);
    // a newer token event that consumed both old tokens
    const current = await addToken(100, [old1.id, old2.id]);

    const tokens = await firstValueFrom(events.model(WalletTokensModel, signer.pubkey));
    expect(tokens.map((t) => t.id)).toEqual([current.id]);
  });

  it("handles delete chains (A deleted by B, B deleted by C)", async () => {
    const a = await addToken(100);
    const b = await addToken(100, [a.id]);
    const c = await addToken(100, [b.id]);

    const tokens = await firstValueFrom(events.model(WalletTokensModel, signer.pubkey));
    expect(tokens.map((t) => t.id)).toEqual([c.id]);
  });
});

describe("WalletBalanceModel", () => {
  it("does not double count tokens that have been replaced", async () => {
    const old1 = await addToken(50);
    const old2 = await addToken(50);
    await addToken(100, [old1.id, old2.id]);

    const balance = await firstValueFrom(events.model(WalletBalanceModel, signer.pubkey));
    expect(balance[mint]).toBe(100);
  });
});

describe("WalletDeletedTokensModel", () => {
  it("returns token events marked deleted but still present", async () => {
    const old1 = await addToken(50);
    const old2 = await addToken(50);
    await addToken(100, [old1.id, old2.id]);

    const stale = await firstValueFrom(events.model(WalletDeletedTokensModel, signer.pubkey));
    expect(stale.map((t) => t.id).sort()).toEqual([old1.id, old2.id].sort());
  });

  it("returns nothing when no tokens are marked deleted", async () => {
    await addToken(100);

    const stale = await firstValueFrom(events.model(WalletDeletedTokensModel, signer.pubkey));
    expect(stale).toEqual([]);
  });
});
