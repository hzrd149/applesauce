import { CheckStateEnum, Mint, Proof, sumProofs, Token, Wallet } from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { DeleteBlueprint } from "applesauce-common/blueprints/delete";
import { NostrEvent } from "applesauce-core/helpers/event";
import { WalletHistoryBlueprint } from "../blueprints/history.js";
import { WalletTokenBlueprint } from "../blueprints/tokens.js";
import {
  getTokenContent,
  ignoreDuplicateProofs,
  isTokenContentUnlocked,
  WALLET_TOKEN_KIND,
} from "../helpers/tokens.js";
import { getUnlockedWallet } from "./common.js";

/**
 * Adds a cashu token to the wallet and creates a history event
 * @param token the cashu token to add
 * @param redeemed an array of event ids to mark as redeemed
 */
export function AddToken(token: Token, redeemed?: string[], fee?: number): Action {
  return async ({ factory, user, publish, signer, sign }) => {
    const wallet = await getUnlockedWallet(user, signer);
    const amount = sumProofs(token.proofs);

    // Create the token and history events
    const tokenEvent = await factory.create(WalletTokenBlueprint, token).then(sign);
    const history = await factory
      .create(
        WalletHistoryBlueprint,
        { direction: "in", amount, mint: token.mint, created: [tokenEvent.id], fee },
        redeemed ?? [],
      )
      .then(sign);

    // Publish the events
    await publish([tokenEvent, history], wallet.relays);
  };
}

/** Similar to the AddToken action but swaps the tokens before receiving them */
export function ReceiveToken(token: Token): Action {
  return async ({ run }) => {
    // Get the cashu wallet
    const cashuWallet = new Wallet(token.mint);
    await cashuWallet.loadMint();

    // Swap cashu tokens
    const receivedProofs = await cashuWallet.ops.receive(token).run();

    // Create a new token with the received proofs
    const receivedToken: Token = {
      ...token,
      proofs: receivedProofs,
    };

    // Run the add token action
    await run(AddToken, receivedToken);
  };
}

/** An action that deletes old tokens and creates a new one but does not add a history event */
export function RolloverTokens(tokens: NostrEvent[], token: Token): Action {
  return async function* ({ factory, user, publish, signer, sign }) {
    const wallet = await getUnlockedWallet(user, signer);

    // create a new token event
    const tokenEvent = await factory
      .create(
        WalletTokenBlueprint,
        token,
        tokens.map((e) => e.id),
      )
      .then(sign);
    // create a delete event for old tokens
    const deleteDraft = await factory.create(DeleteBlueprint, tokens).then(sign);

    // publish events
    await publish([tokenEvent, deleteDraft], wallet.relays);
  };
}

/** An action that deletes old token events and adds a spend history item */
export function CompleteSpend(spent: NostrEvent[], change: Token): Action {
  return async function* ({ factory, user, publish, signer, sign }) {
    if (spent.length === 0) throw new Error("Cant complete spent with no token events");

    const unlocked = spent.filter(isTokenContentUnlocked);
    if (unlocked.length !== spent.length) throw new Error("Cant complete spend with locked tokens");
    const wallet = await getUnlockedWallet(user, signer);

    const changeAmount = sumProofs(change.proofs);

    // create a new token event if needed
    const tokenEvent =
      changeAmount > 0
        ? await factory
            .create(
              WalletTokenBlueprint,
              change,
              spent.map((e) => e.id),
            )
            .then(sign)
        : undefined;

    // Get tokens total amount
    const total = sumProofs(unlocked.map((s) => getTokenContent(s).proofs).flat());

    // calculate the amount that was spent
    const diff = total - changeAmount;

    // sign delete and token
    const deleteEvent = await factory.create(DeleteBlueprint, spent).then(sign);

    // create a history entry
    const history = await factory
      .create(
        WalletHistoryBlueprint,
        { direction: "out", mint: change.mint, amount: diff, created: tokenEvent ? [tokenEvent.id] : [] },
        [],
      )
      .then(sign);

    // publish events
    await publish(
      [tokenEvent, deleteEvent, history].filter((e) => !!e),
      wallet.relays,
    );
  };
}

/** Combines all unlocked token events into a single event per mint */
export function ConsolidateTokens(opts?: { ignoreLocked?: boolean }): Action {
  return async function* ({ events, factory, self }) {
    const tokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] })).filter((token) => {
      if (!isTokenContentUnlocked(token)) {
        if (opts?.ignoreLocked) return false;
        else throw new Error("Token is locked");
      } else return true;
    });

    const byMint = tokens.reduce((map, token) => {
      const mint = getTokenContent(token)!.mint;
      if (!map.has(mint)) map.set(mint, []);
      map.get(mint)!.push(token);
      return map;
    }, new Map<string, NostrEvent[]>());

    // loop over each mint and consolidate proofs
    for (const [mint, tokens] of byMint) {
      // get all tokens proofs
      const proofs = tokens
        .map((t) => getTokenContent(t)!.proofs)
        .flat()
        // filter out duplicate proofs
        .filter(ignoreDuplicateProofs());

      // If there are no proofs, just delete the old tokens without interacting with the mint
      if (proofs.length === 0) {
        const deleteDraft = await factory.create(DeleteBlueprint, tokens);
        const signedDelete = await factory.sign(deleteDraft);
        yield signedDelete;
        continue;
      }

      // Only interact with the mint if there are proofs to check
      const cashuMint = new Mint(mint);
      const cashuWallet = new Wallet(cashuMint);

      // NOTE: this assumes that the states array is the same length and order as the proofs array
      const states = await cashuWallet.checkProofsStates(proofs);
      const notSpent: Proof[] = proofs.filter((_, i) => states[i].state !== CheckStateEnum.SPENT);

      // create delete event
      const deleteDraft = await factory.create(DeleteBlueprint, tokens);

      // Only create a token event if there are unspent proofs
      const tokenDraft =
        notSpent.length > 0
          ? await factory.create(
              WalletTokenBlueprint,
              { mint, proofs: notSpent },
              tokens.map((t) => t.id),
            )
          : undefined;

      // sign events
      const signedDelete = await factory.sign(deleteDraft);
      const signedToken = tokenDraft ? await factory.sign(tokenDraft) : undefined;

      // publish events for mint
      if (signedToken) yield signedToken;
      yield signedDelete;
    }
  };
}
