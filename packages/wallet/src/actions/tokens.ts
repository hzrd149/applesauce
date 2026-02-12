import { CheckStateEnum, Proof, sumProofs, Token, Wallet } from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { DeleteBlueprint } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { WalletHistoryBlueprint } from "../factories/history.js";
import { WalletTokenBlueprint } from "../factories/tokens.js";
import { getProofUID, ignoreDuplicateProofs } from "../helpers/cashu.js";
import { Couch } from "../helpers/couch.js";
import {
  dumbTokenSelection,
  getTokenContent,
  isTokenContentUnlocked,
  UnlockedTokenContent,
  unlockTokenContent,
  WALLET_TOKEN_KIND,
} from "../helpers/tokens.js";
import { getUnlockedWallet } from "./common.js";

// Make sure the wallet$ is registered on the user class
import "../casts/__register__.js";

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
  return async ({ factory, user, publish, signer, sign }) => {
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
  return async ({ factory, user, publish, signer, sign }) => {
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
  return async ({ events, factory, self, sign, user, signer, publish }) => {
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
  return async ({ events, factory, self, sign, user, signer, publish }) => {
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

      // Clear the token from the couch
      await couch.clear();
    }
  };
}

/**
 * Token selection function type that matches dumbTokenSelection signature.
 * Must return tokens from a single mint and ensure all selected tokens are from that mint.
 * If mint is undefined, the function should find a mint with sufficient balance.
 */
export type TokenSelectionFunction = (
  tokens: NostrEvent[],
  minAmount: number,
  mint?: string,
) => { events: NostrEvent[]; proofs: Proof[] };

/**
 * A generic action that safely selects tokens, performs an async operation, and handles change.
 * This action requires a couch for safety - tokens are stored in the couch before the operation
 * and can be recovered if something goes wrong.
 *
 * @param minAmount The minimum amount of tokens to select (in sats)
 * @param operation An async function that receives selected proofs and performs the operation.
 *                  Should return any change proofs. All selected proofs are considered used.
 * @param options Configuration options including mint filter, required couch, and optional custom token selection
 *
 * @example
 * // Use with NutzapProfile
 * await run(TokensOperation, 100, async ({ selectedProofs, mint, cashuWallet }) => {
 *   const { keep, send } = await cashuWallet.ops.send(100, selectedProofs).asP2PK({ pubkey }).run();
 *   await run(NutzapProfile, recipient, { mint, proofs: send, unit: "sat" });
 *   return { change: keep };
 * }, { couch });
 *
 * @example
 * // Use with melt
 * await run(TokensOperation, meltAmount + feeReserve, async ({ selectedProofs, mint, cashuWallet }) => {
 *   const meltQuote = await cashuWallet.createMeltQuoteBolt11(invoice);
 *   const { keep, send } = await cashuWallet.send(meltAmount + meltQuote.fee_reserve, selectedProofs, { includeFees: true });
 *   const meltResponse = await cashuWallet.meltProofs(meltQuote, send);
 *   return { change: meltResponse.change };
 * }, { couch });
 *
 * @example
 * // Use with custom token selection
 * await run(TokensOperation, 100, async ({ selectedProofs, mint, cashuWallet }) => {
 *   // ... operation
 * }, { couch, tokenSelection: myCustomSelectionFunction });
 */
export function TokensOperation(
  minAmount: number,
  operation: (params: { selectedProofs: Proof[]; mint: string; cashuWallet: Wallet }) => Promise<{ change?: Proof[] }>,
  options: { mint?: string; couch: Couch; tokenSelection?: TokenSelectionFunction },
): Action {
  const { mint, couch, tokenSelection = dumbTokenSelection } = options;

  return async ({ events, self, user, signer, run }) => {
    if (!signer) throw new Error("Missing signer");
    if (!couch) throw new Error("Couch is required for TokensOperation");

    await getUnlockedWallet(user, signer);

    // Get all unlocked token events
    const allTokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] }));

    // Unlock tokens if needed
    for (const token of allTokens) {
      if (!isTokenContentUnlocked(token)) {
        try {
          await unlockTokenContent(token, signer);
        } catch {}
      }
    }

    // Filter to unlocked tokens
    const unlockedTokens = allTokens.filter(isTokenContentUnlocked);
    if (unlockedTokens.length === 0) throw new Error("No unlocked tokens available");

    // Select tokens using the provided token selection function (defaults to dumbTokenSelection)
    // The selection function will find a mint with sufficient balance if mint is undefined
    // and ensures all selected tokens are from the same mint
    const { events: selectedTokenEvents, proofs: selectedProofs } = tokenSelection(unlockedTokens, minAmount, mint);

    if (selectedProofs.length === 0) throw new Error("No proofs selected");

    // Get the mint from the first selected token
    // The token selection function guarantees all tokens are from the same mint
    const firstTokenContent = getTokenContent(selectedTokenEvents[0]);
    if (!firstTokenContent) throw new Error("Unable to get content from selected token");

    const selectedMint = firstTokenContent.mint;
    if (!selectedMint) throw new Error("Unable to determine mint from selected tokens");

    // Safety check: Verify all selected tokens are from the same mint
    // (The token selection function should have already ensured this, but verify for safety)
    for (const tokenEvent of selectedTokenEvents) {
      const tokenContent = getTokenContent(tokenEvent);
      if (!tokenContent) throw new Error("Unable to get content from selected token");

      const tokenMint = tokenContent.mint;
      if (tokenMint !== selectedMint)
        throw new Error(`Selected tokens must be from the same mint. Found ${tokenMint} and ${selectedMint}`);
    }

    // Store selected tokens in couch for safety
    const selectedToken: Token = {
      mint: selectedMint,
      proofs: selectedProofs,
      unit: "sat",
    };
    const clearStoredToken = await couch.store(selectedToken);

    try {
      // Create cashu wallet for the mint
      const cashuWallet = new Wallet(selectedMint);
      await cashuWallet.loadMint();

      // Perform the async operation
      // All selected proofs are considered used - the operation only needs to return change (if any)
      const { change } = await operation({
        selectedProofs,
        mint: selectedMint,
        cashuWallet,
      });

      // Create change token from the change proofs returned by the operation (if any)
      const changeToken: Token = {
        mint: selectedMint,
        proofs: change ? change.filter(ignoreDuplicateProofs()) : [],
        unit: "sat",
      };

      // Complete the spend with change (if any)
      // If there's no change, all selected proofs were spent
      await run(CompleteSpend, selectedTokenEvents, changeToken, couch);

      // Clear the stored token from the couch after successful completion
      await clearStoredToken();
    } catch (error) {
      // If an error occurs, don't clear the couch (tokens remain for recovery)
      throw error;
    }
  };
}
