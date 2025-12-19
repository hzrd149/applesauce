import { CheckStateEnum, Proof, sumProofs, Token, Wallet } from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { DeleteBlueprint } from "applesauce-common/blueprints/delete";
import { NostrEvent } from "applesauce-core/helpers/event";
import { WalletHistoryBlueprint } from "../blueprints/history.js";
import { WalletTokenBlueprint } from "../blueprints/tokens.js";
import { getProofUID, ignoreDuplicateProofs } from "../helpers/cashu.js";
import { Couch } from "../helpers/couch.js";
import {
  getTokenContent,
  isTokenContentUnlocked,
  UnlockedTokenContent,
  unlockTokenContent,
  WALLET_TOKEN_KIND,
} from "../helpers/tokens.js";
import { getUnlockedWallet } from "./common.js";

/**
 * Adds a cashu token to the wallet and creates a history event
 * @param token the cashu token to add
 * @param redeemed an array of event ids to mark as redeemed
 */
export function AddToken(token: Token, options?: { redeemed?: string[]; fee?: number; addHistory?: boolean }): Action {
  const { redeemed, fee, addHistory = true } = options ?? {};

  return async ({ factory, user, publish, signer, sign }) => {
    const wallet = await getUnlockedWallet(user, signer);
    const amount = sumProofs(token.proofs);

    // Create the token and history events
    const tokenEvent = await factory.create(WalletTokenBlueprint, token).then(sign);

    let history: NostrEvent | undefined;
    if (addHistory || redeemed?.length) {
      history = await factory
        .create(
          WalletHistoryBlueprint,
          { direction: "in", amount, mint: token.mint, created: [tokenEvent.id], fee },
          redeemed,
        )
        .then(sign);
    }

    // Publish the events
    await publish(
      [tokenEvent, history].filter((e) => !!e),
      wallet.relays,
    );
  };
}

/** Similar to the AddToken action but swaps the tokens before receiving them */
export function ReceiveToken(token: Token, options?: { addHistory?: boolean; couch?: Couch }): Action {
  return async ({ run }) => {
    const { couch, ...restOptions } = options ?? {};

    // Get the cashu wallet
    const cashuWallet = new Wallet(token.mint);
    await cashuWallet.loadMint();

    const amount = sumProofs(token.proofs);

    // Swap cashu tokens
    const receivedProofs = await cashuWallet.ops.receive(token).run();

    const fee = amount - sumProofs(receivedProofs);

    // Create a new token with the received proofs
    const receivedToken: Token = {
      ...token,
      proofs: receivedProofs,
    };

    // Store token in couch immediately after receiving it
    const clearStoredToken = await couch?.store(receivedToken);

    try {
      // Run the add token action
      await run(AddToken, receivedToken, { ...restOptions, fee });

      // Clear the stored token from the couch after successful completion
      await clearStoredToken?.();
    } catch (error) {
      // If an error occurs, don't clear the couch (tokens remain for recovery)
      throw error;
    }
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
export function CompleteSpend(spent: NostrEvent[], change: Token, couch?: Couch): Action {
  return async function* ({ factory, user, publish, signer, sign }) {
    if (spent.length === 0) throw new Error("Cant complete spent with no token events");

    const unlocked = spent.filter(isTokenContentUnlocked);
    if (unlocked.length !== spent.length) throw new Error("Cant complete spend with locked tokens");
    const wallet = await getUnlockedWallet(user, signer);

    const changeAmount = sumProofs(change.proofs);

    // Store change token in couch before creating token event
    let clearStoredToken: (() => void | Promise<void>) | undefined;
    if (couch && changeAmount > 0) {
      clearStoredToken = await couch.store(change);
    }

    try {
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

      // Clear the stored token from the couch after successful completion
      await clearStoredToken?.();
    } catch (error) {
      // If an error occurs, don't clear the couch (tokens remain for recovery)
      throw error;
    }
  };
}

/** Combines all unlocked token events into a single event per mint */
export function ConsolidateTokens(options?: { unlockTokens?: boolean }): Action {
  return async function* ({ events, factory, self, sign, user, signer, publish }) {
    const wallet = await getUnlockedWallet(user, signer);
    const tokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] }));

    // Unlock tokens if requested
    if (options?.unlockTokens) {
      if (!signer) throw new Error("Missing signer");
      for (const token of tokens) {
        if (!isTokenContentUnlocked(token)) {
          try {
            await unlockTokenContent(token, signer);
          } catch {}
        }
      }
    }

    // Collect unlocked tokens
    const unlockedTokens = tokens.filter(isTokenContentUnlocked);

    // group tokens by mint
    const byMint = unlockedTokens.reduce((map, token) => {
      const mint = getTokenContent(token).mint;
      if (!map.has(mint)) map.set(mint, []);
      map.get(mint)!.push(token);
      return map;
    }, new Map<string, (UnlockedTokenContent & NostrEvent)[]>());

    // loop over each mint and consolidate proofs
    for (const [mint, tokens] of byMint) {
      // get all tokens proofs
      const proofs = tokens
        .map((token) => getTokenContent(token).proofs)
        .flat()
        // filter out duplicate proofs
        .filter(ignoreDuplicateProofs());

      // If there are no proofs, just delete the old tokens without interacting with the mint
      if (proofs.length === 0) {
        const deleteEvent = await factory.create(DeleteBlueprint, tokens).then(sign);
        await publish(deleteEvent, wallet.relays);
        continue;
      }

      // Only interact with the mint if there are proofs to check
      const cashuWallet = new Wallet(mint);
      await cashuWallet.loadMint();

      // NOTE: this assumes that the states array is the same length and order as the proofs array
      const states = await cashuWallet.checkProofsStates(proofs);
      const notSpent: Proof[] = proofs.filter((_, i) => states[i].state !== CheckStateEnum.SPENT);

      // Only create a token event if there are unspent proofs
      const tokenEvent =
        notSpent.length > 0
          ? await factory
              .create(
                WalletTokenBlueprint,
                { mint, proofs: notSpent },
                tokens.map((t) => t.id),
              )
              .then(sign)
          : undefined;

      // create delete event
      const deleteEvent = await factory.create(DeleteBlueprint, tokens).then(sign);

      // Publish events
      await publish(
        [tokenEvent, deleteEvent].filter((e) => !!e),
        wallet.relays,
      );
    }
  };
}

/**
 * Recovers tokens from a couch by checking if they exist in the wallet,
 * verifying they are unspent, and creating token events for any recoverable tokens
 * @param couch the couch interface to recover tokens from
 */
export function RecoverFromCouch(couch: Couch): Action {
  return async function* ({ events, factory, self, sign, user, signer, publish }) {
    const wallet = await getUnlockedWallet(user, signer);

    // Get all tokens from the couch
    const couchTokens = await couch.getAll();
    if (couchTokens.length === 0) return; // No tokens to recover

    // Get all token events from the wallet
    const walletTokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] }));

    // Unlock wallet tokens if needed
    if (signer) {
      for (const token of walletTokens) {
        if (!isTokenContentUnlocked(token)) {
          try {
            await unlockTokenContent(token, signer);
          } catch {}
        }
      }
    }

    // Collect all proofs from wallet tokens
    const walletProofs = walletTokens
      .filter(isTokenContentUnlocked)
      .map((token) => getTokenContent(token).proofs)
      .flat();

    // Create a set of seen proof UIDs from wallet
    const seenProofUIDs = new Set<string>();
    walletProofs.forEach((proof) => {
      seenProofUIDs.add(getProofUID(proof));
    });

    // Group couch tokens by mint
    const couchTokensByMint = new Map<string, Token[]>();
    for (const token of couchTokens) {
      if (!couchTokensByMint.has(token.mint)) {
        couchTokensByMint.set(token.mint, []);
      }
      couchTokensByMint.get(token.mint)!.push(token);
    }

    // Process each mint group
    for (const [mint, tokens] of couchTokensByMint) {
      // Get all proofs from couch tokens for this mint
      const couchProofs = tokens.flatMap((token) => token.proofs);

      // Filter out proofs that are already in the wallet
      const newProofs = couchProofs.filter((proof) => {
        const uid = getProofUID(proof);
        if (seenProofUIDs.has(uid)) return false;
        seenProofUIDs.add(uid);
        return true;
      });

      if (newProofs.length === 0) continue; // No new proofs to recover

      // Check if proofs are unspent from the mint
      const cashuWallet = new Wallet(mint);
      await cashuWallet.loadMint();

      const states = await cashuWallet.checkProofsStates(newProofs);
      const unspentProofs: Proof[] = newProofs.filter((_, i) => states[i].state !== CheckStateEnum.SPENT);

      if (unspentProofs.length === 0) continue; // No unspent proofs to recover

      // Create a token event with the recovered proofs
      const recoveredToken: Token = {
        mint,
        proofs: unspentProofs,
        unit: tokens[0]?.unit,
      };

      const tokenEvent = await factory.create(WalletTokenBlueprint, recoveredToken).then(sign);

      // Publish the token event
      await publish(tokenEvent, wallet.relays);
    }
  };
}
