import { Proof, Token } from "@cashu/cashu-ts";
import { EventStore } from "applesauce-core";
import { EncryptedContentSymbol } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { firstValueFrom } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletTokenFactory } from "../../factories/tokens.js";
import { unlockTokenContent } from "../../helpers/tokens.js";
import {
  WalletBalanceModel,
  WalletDeletedTokenIdsModel,
  WalletDeletedTokensModel,
  WalletTokensModel,
} from "../tokens.js";

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

/** Signs a token event and adds it to the store while keeping its content locked */
async function addLockedToken(amount: number, del: string[] = []): Promise<NostrEvent> {
  const event = await WalletTokenFactory.create(makeToken(amount), del).sign(signer);
  // Lock the content to simulate an event received from a relay that has not been decrypted
  Reflect.deleteProperty(event, EncryptedContentSymbol);
  await events.add(event);
  return event;
}

/**
 * Builds a signed token event with an explicit created_at without adding it to the store. When `locked` is
 * true the decrypted content is removed to simulate an event that arrived from a relay but has not been
 * decrypted yet (its public `del` tags are still readable).
 */
async function buildToken(amount: number, created: number, del: string[] = [], locked = false): Promise<NostrEvent> {
  const event = await WalletTokenFactory.create(makeToken(amount), del).created(created).sign(signer);
  if (locked) Reflect.deleteProperty(event, EncryptedContentSymbol);
  else await unlockTokenContent(event, signer);
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

  it("excludes deleted tokens using the public `del` tags without decrypting", async () => {
    const old1 = await addLockedToken(50);
    const old2 = await addLockedToken(50);
    // a newer locked token event that consumed both old tokens
    const current = await addLockedToken(100, [old1.id, old2.id]);

    const tokens = await firstValueFrom(events.model(WalletTokensModel, signer.pubkey));
    expect(tokens.map((t) => t.id)).toEqual([current.id]);
  });

});

describe("WalletDeletedTokenIdsModel", () => {
  it("collects deleted ids from public tags without decrypting", async () => {
    const old1 = await addLockedToken(50);
    const old2 = await addLockedToken(50);
    await addLockedToken(100, [old1.id, old2.id]);

    const ids = await firstValueFrom(events.model(WalletDeletedTokenIdsModel, signer.pubkey));
    expect([...ids].sort()).toEqual([old1.id, old2.id].sort());
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

  it("balance never decreases while streaming the wallet newest-first", async () => {
    // A wallet history where each consolidation spends older tokens. Built newest -> oldest, the order a
    // relay streams events in. `del` ids on the newer events are public, so the older spent tokens are
    // known to be deleted the moment the newer event arrives - before the older tokens are even loaded.
    const t = 1_000;
    const a = await buildToken(50, t + 100); // spent by C
    const b = await buildToken(50, t + 0); // spent by C
    const d = await buildToken(70, t + 200); // an unspent deposit, never deleted
    const c = await buildToken(100, t + 300, [a.id, b.id]); // newest: consolidates A + B

    const balances: number[] = [];
    const sub = events.model(WalletBalanceModel, signer.pubkey).subscribe((b) => balances.push(b[mint] ?? 0));

    // Stream the events newest-first, the way a relay delivers them
    for (const event of [c, d, a, b]) await events.add(event);

    sub.unsubscribe();

    // Balance must be monotonically non-decreasing across every emission
    for (let i = 1; i < balances.length; i++) expect(balances[i]).toBeGreaterThanOrEqual(balances[i - 1]);

    // The spent tokens (A + B = 100) are never counted; only C (100) and D (70) remain
    expect(balances.at(-1)).toBe(170);
  });

  it("does not count spent tokens before the newer token is decrypted", async () => {
    // The newer consolidation token stays locked (cannot read its proofs/amount) but its public `del` tags
    // are visible. The older spent tokens are unlocked and would be counted if the `del` ids were only
    // available in the encrypted content.
    const t = 2_000;
    const a = await buildToken(11, t + 100); // unlocked, spent
    const b = await buildToken(13, t + 0); // unlocked, spent
    const d = await buildToken(70, t + 200); // unlocked, unspent
    const c = await buildToken(100, t + 300, [a.id, b.id], true); // newest, LOCKED, del tags public

    const balances: number[] = [];
    const sub = events.model(WalletBalanceModel, signer.pubkey).subscribe((bal) => balances.push(bal[mint] ?? 0));

    // Stream newest-first: the locked consolidation token arrives before the spent tokens
    for (const event of [c, d, a, b]) await events.add(event);

    sub.unsubscribe();

    // Balance never decreases and the spent tokens are never counted even though they are unlocked
    for (let i = 1; i < balances.length; i++) expect(balances[i]).toBeGreaterThanOrEqual(balances[i - 1]);
    // Only the unspent deposit D (70) is counted - C is locked so its 100 is not yet visible
    expect(balances.at(-1)).toBe(70);
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
