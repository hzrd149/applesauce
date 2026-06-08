import {
  CheckStateEnum,
  MintQuoteBolt11Response,
  normalizeProofAmounts,
  Proof,
  ProofLike,
  sumProofs,
  Token,
  Wallet,
} from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { DeleteFactory } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { WalletHistoryFactory } from "../factories/history.js";
import { WalletTokenFactory } from "../factories/tokens.js";
import { getProofUID, ignoreDuplicateProofs } from "../helpers/cashu.js";
import { Couch } from "../helpers/couch.js";
import {
  dumbTokenSelection,
  getTokenContent,
  getTokenDeletedIds,
  isTokenContentUnlocked,
  UnlockedTokenContent,
  unlockTokenContent,
  WALLET_TOKEN_KIND,
} from "../helpers/tokens.js";
import { getUnlockedWallet } from "./common.js";

// Make sure the wallet$ is registered on the user class
import "../casts/__register__.js";

/** A function that returns a loaded cashu {@link Wallet} for a mint url */
type CashuWalletProvider = (mint: string) => Promise<Wallet>;

/**
 * Returns a loaded cashu {@link Wallet} for a mint url. Resolves in priority order: a pre-loaded `wallet`
 * instance when given (so a caller can reuse a single instance across operations), then the `getCashuWallet`
 * provider (so a caller can supply a cached, wallet-specific instance), otherwise creates and loads a fresh wallet.
 */
async function loadCashuWallet(
  mint: string,
  options?: { wallet?: Wallet; getCashuWallet?: CashuWalletProvider },
): Promise<Wallet> {
  if (options?.wallet) return options.wallet;
  if (options?.getCashuWallet) return options.getCashuWallet(mint);
  const wallet = new Wallet(mint);
  await wallet.loadMint();
  return wallet;
}

/**
 * Adds a cashu token to the wallet and creates a history event
 * @param token the cashu token to add
 * @param redeemed an array of event ids to mark as redeemed
 */
export function AddToken(token: Token, options?: { redeemed?: string[]; fee?: number; addHistory?: boolean }): Action {
  const { redeemed, fee, addHistory = true } = options ?? {};

  return async ({ signer, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const wallet = await getUnlockedWallet(user, signer);
    const amount = sumProofs(token.proofs).toNumber();

    // Create the token and history events
    const tokenEvent = await WalletTokenFactory.create(token).sign(signer);

    let history: NostrEvent | undefined;
    if (addHistory || redeemed?.length) {
      let historyFactory = WalletHistoryFactory.create({
        direction: "in",
        amount,
        mint: token.mint,
        created: [tokenEvent.id],
        fee,
      });
      if (redeemed?.length) historyFactory = historyFactory.redeemed(redeemed);
      history = await historyFactory.sign(signer);
    }

    // Publish the events
    await publish(
      [tokenEvent, history].filter((e) => !!e),
      wallet.relays,
    );
  };
}

/** Similar to the AddToken action but swaps the tokens before receiving them */
export function ReceiveToken(
  token: Token,
  options?: { addHistory?: boolean; couch?: Couch; wallet?: Wallet; getCashuWallet?: CashuWalletProvider },
): Action {
  return async ({ run }) => {
    const { couch, wallet, getCashuWallet, ...restOptions } = options ?? {};

    // Get the cashu wallet
    const cashuWallet = await loadCashuWallet(token.mint, { wallet, getCashuWallet });

    const amount = sumProofs(token.proofs).toNumber();

    // Swap cashu tokens
    const receivedProofs = await cashuWallet.ops.receive(token).run();

    const fee = amount - sumProofs(receivedProofs).toNumber();

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

/**
 * Mints new proofs from an already-paid bolt11 mint quote and adds them to the wallet
 * @param mint the mint url to mint the proofs from
 * @param amount the amount of the paid mint quote in sats
 * @param quote the paid mint quote id or response
 * @param options.couch optional couch interface for temporarily storing the minted token
 * @param options.wallet optional pre-loaded cashu Wallet for the mint
 * @param options.getCashuWallet optional provider returning a cached cashu Wallet for a mint
 */
export function MintTokens(
  mint: string,
  amount: number,
  quote: string | MintQuoteBolt11Response,
  options?: { couch?: Couch; wallet?: Wallet; getCashuWallet?: CashuWalletProvider },
): Action {
  return async ({ run }) => {
    const { couch, wallet, getCashuWallet } = options ?? {};

    // Mint the new proofs from the paid quote (throws if the quote has not been paid)
    const cashuWallet = await loadCashuWallet(mint, { wallet, getCashuWallet });
    const proofs = await cashuWallet.mintProofsBolt11(amount, quote);

    const token: Token = { mint, proofs, unit: "sat" };

    // Store the token in the couch immediately after minting it
    const clearStoredToken = await couch?.store(token);

    try {
      // Add the minted token to the wallet (creates a token event + "in" history)
      await run(AddToken, token);

      // Clear the stored token from the couch after successful completion
      await clearStoredToken?.();
    } catch (error) {
      // If an error occurs, don't clear the couch (tokens remain for recovery)
      throw error;
    }
  };
}

/**
 * An action that deletes old token events and adds a spend history item
 * @param options.deleteOldTokens whether to publish a NIP-09 delete event for the spent token events
 *   (default true). The change token event always references the spent ids in its `del` field, so the
 *   wallet can reconcile its balance without the delete event; skipping it saves a signing operation at
 *   the cost of leaving the spent token events on relays until {@link CleanupDeletedTokens}.
 */
export function CompleteSpend(
  spent: NostrEvent[],
  change: Token,
  couch?: Couch,
  options?: { deleteOldTokens?: boolean },
): Action {
  const deleteOldTokens = options?.deleteOldTokens ?? true;

  return async ({ signer, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    if (spent.length === 0) throw new Error("Cant complete spent with no token events");

    const unlocked = spent.filter(isTokenContentUnlocked);
    if (unlocked.length !== spent.length) throw new Error("Cant complete spend with locked tokens");
    const wallet = await getUnlockedWallet(user, signer);

    const changeAmount = sumProofs(change.proofs).toNumber();

    // Store change token in couch before creating token event
    let clearStoredToken: (() => void | Promise<void>) | undefined;
    if (couch && changeAmount > 0) {
      clearStoredToken = await couch.store(change);
    }

    try {
      // create a new token event if needed
      const tokenEvent =
        changeAmount > 0
          ? await WalletTokenFactory.create(
              change,
              spent.map((e) => e.id),
            ).sign(signer)
          : undefined;

      // Get tokens total amount
      const total = sumProofs(unlocked.map((s) => getTokenContent(s).proofs).flat()).toNumber();

      // calculate the amount that was spent
      const diff = total - changeAmount;

      // optionally sign a delete event for the spent tokens
      const deleteEvent = deleteOldTokens ? await DeleteFactory.fromEvents(spent).sign(signer) : undefined;

      // create a history entry
      const history = await WalletHistoryFactory.create({
        direction: "out",
        mint: change.mint,
        amount: diff,
        created: tokenEvent ? [tokenEvent.id] : [],
      })
        .redeemed([])
        .sign(signer);

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

/**
 * Combines all unlocked token events into a single event per mint
 * @param options.deleteOldTokens whether to publish a single batched NIP-09 delete event for the old
 *   token events (default true). The new token events always reference the old ids in their `del` field.
 */
export function ConsolidateTokens(options?: {
  unlockTokens?: boolean;
  getCashuWallet?: CashuWalletProvider;
  deleteOldTokens?: boolean;
}): Action {
  const deleteOldTokens = options?.deleteOldTokens ?? true;

  return async ({ events, signer, self, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const wallet = await getUnlockedWallet(user, signer);
    const tokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] }));

    // Unlock tokens if requested
    if (options?.unlockTokens) {
      for (const token of tokens) {
        if (!isTokenContentUnlocked(token)) {
          try {
            await unlockTokenContent(token, signer);
          } catch {}
        }
      }
    }

    // Collect the ids that other token events have already marked as deleted (public `del` tags merged with
    // the decrypted content). Those proofs are most likely already spent at the mint, so consolidating them
    // would fail the state check (or repackage spent proofs); exclude them just like {@link RolloverTokens}.
    const deleted = new Set<string>();
    for (const token of tokens) {
      for (const id of getTokenDeletedIds(token)) deleted.add(id);
      if (isTokenContentUnlocked(token)) for (const id of getTokenContent(token).del) deleted.add(id);
    }

    // Collect unlocked, not-yet-deleted tokens
    const unlockedTokens = tokens.filter(isTokenContentUnlocked).filter((token) => !deleted.has(token.id));

    // group tokens by mint
    const byMint = unlockedTokens.reduce((map, token) => {
      const mint = getTokenContent(token).mint;
      if (!map.has(mint)) map.set(mint, []);
      map.get(mint)!.push(token);
      return map;
    }, new Map<string, (UnlockedTokenContent & NostrEvent)[]>());

    // Collect the new consolidated token events and the old tokens to delete across all mints,
    // so the old tokens can be removed with a single batched delete event instead of one per mint
    const newTokenEvents: NostrEvent[] = [];
    const deletedTokens: NostrEvent[] = [];

    // loop over each mint and consolidate proofs
    for (const [mint, tokens] of byMint) {
      // Skip mints that already have a single token event (nothing to consolidate)
      if (tokens.length < 2) continue;

      // get all tokens proofs
      const proofs = tokens
        .map((token) => getTokenContent(token).proofs)
        .flat()
        // filter out duplicate proofs
        .filter(ignoreDuplicateProofs());

      // If there are no proofs, just queue the old tokens for deletion without interacting with the mint
      if (proofs.length === 0) {
        deletedTokens.push(...tokens);
        continue;
      }

      // Only interact with the mint if there are proofs to check
      const cashuWallet = await loadCashuWallet(mint, { getCashuWallet: options?.getCashuWallet });

      // NOTE: this assumes that the states array is the same length and order as the proofs array
      const states = await cashuWallet.checkProofsStates(proofs);
      const notSpent = proofs.filter((_, i) => states[i].state !== CheckStateEnum.SPENT);

      // Only create a token event if there are unspent proofs
      if (notSpent.length > 0)
        newTokenEvents.push(
          await WalletTokenFactory.create(
            { mint, proofs: notSpent },
            tokens.map((t) => t.id),
          ).sign(signer),
        );

      // Queue the old tokens for the batched delete
      deletedTokens.push(...tokens);
    }

    // Nothing to consolidate
    if (deletedTokens.length === 0) return;

    // Optionally create a single delete event for all of the old tokens across every mint
    const deleteEvent = deleteOldTokens ? await DeleteFactory.fromEvents(deletedTokens).sign(signer) : undefined;

    // Publish the new token events and the single batched delete event together
    await publish(
      [...newTokenEvents, deleteEvent].filter((e) => !!e),
      wallet.relays,
    );
  };
}

/**
 * Rolls every unlocked token over to a fresh cashu token. For each mint the proofs are swapped at the mint
 * (rotating the secrets) and a single new token event is created whose `del` field references the
 * rolled-over token events. Token events that another token has already marked as deleted are skipped so a
 * repeated rollover does not try to swap already-spent proofs.
 *
 * To keep signer operations to a minimum, every new token event is published together with a *single*
 * batched NIP-09 delete event covering the rolled-over token events across *all* mints — never one delete
 * per mint.
 *
 * @param options.deleteOldTokens whether to publish the single batched NIP-09 delete event (default true).
 *   The new token events always reference the old ids in their `del` field, so the wallet can reconcile its
 *   balance without the delete event; skipping it leaves the spent token events on relays until
 *   {@link CleanupDeletedTokens} removes them.
 * @param options.couch optional couch used to keep each fresh token safe until everything is published
 */
export function RolloverTokens(options?: {
  unlockTokens?: boolean;
  couch?: Couch;
  getCashuWallet?: CashuWalletProvider;
  deleteOldTokens?: boolean;
}): Action {
  const deleteOldTokens = options?.deleteOldTokens ?? true;

  return async ({ events, signer, self, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const wallet = await getUnlockedWallet(user, signer);
    const tokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] }));

    // Unlock tokens if requested
    if (options?.unlockTokens) {
      for (const token of tokens) {
        if (!isTokenContentUnlocked(token)) {
          try {
            await unlockTokenContent(token, signer);
          } catch {}
        }
      }
    }

    // Collect the ids that other token events have already marked as deleted (public `del` tags merged with
    // the decrypted content). With delete events disabled the rolled-over token events stay in the store, so
    // they must be excluded here or a later rollover would try to swap their already-spent proofs.
    const deleted = new Set<string>();
    for (const token of tokens) {
      for (const id of getTokenDeletedIds(token)) deleted.add(id);
      if (isTokenContentUnlocked(token)) for (const id of getTokenContent(token).del) deleted.add(id);
    }

    // Group the unlocked, not-yet-deleted token events by mint
    const byMint = new Map<string, (UnlockedTokenContent & NostrEvent)[]>();
    for (const token of tokens) {
      if (!isTokenContentUnlocked(token) || deleted.has(token.id)) continue;
      const mint = getTokenContent(token).mint;
      if (!byMint.has(mint)) byMint.set(mint, []);
      byMint.get(mint)!.push(token);
    }

    // Collect the new token events and the old tokens to delete across all mints, so the old tokens can be
    // removed with a single batched delete event instead of one per mint
    const newTokenEvents: NostrEvent[] = [];
    const deletedTokens: NostrEvent[] = [];
    const clearStored: (() => void | Promise<void>)[] = [];

    // loop over each mint and swap its proofs for fresh ones
    for (const [mint, mintTokens] of byMint) {
      // gather every proof across the mint's token events, ignoring duplicates
      const proofs = mintTokens.flatMap((token) => getTokenContent(token).proofs).filter(ignoreDuplicateProofs());
      if (proofs.length === 0) continue;

      // The unit the tokens are denominated in (cashu-ts rejects a token whose unit does not match the wallet)
      const unit = getTokenContent(mintTokens[0]).unit ?? "sat";

      // Swap the proofs for fresh ones at the mint (the mint marks the old proofs spent)
      const cashuWallet = await loadCashuWallet(mint, { getCashuWallet: options?.getCashuWallet });
      const freshProofs = await cashuWallet.ops.receive({ mint, proofs: normalizeProofAmounts(proofs), unit }).run();
      const freshToken: Token = { mint, proofs: freshProofs, unit };

      // Keep the fresh token in the couch until everything is published
      const clear = await options?.couch?.store(freshToken);
      if (clear) clearStored.push(clear);

      // Create the new token event (the rolled-over token ids are recorded in its `del` field)
      newTokenEvents.push(
        await WalletTokenFactory.create(
          freshToken,
          mintTokens.map((t) => t.id),
        ).sign(signer),
      );

      // Queue the old tokens for the single batched delete
      deletedTokens.push(...mintTokens);
    }

    // Nothing to roll over
    if (newTokenEvents.length === 0) return;

    // Optionally create a SINGLE delete event for all of the rolled-over tokens across every mint
    const deleteEvent = deleteOldTokens ? await DeleteFactory.fromEvents(deletedTokens).sign(signer) : undefined;

    // Publish the new token events and the single batched delete event together
    await publish(
      [...newTokenEvents, deleteEvent].filter((e) => !!e),
      wallet.relays,
    );

    // Clear the couch once everything has been published
    for (const clear of clearStored) await clear();
  };
}

/**
 * Detects token events that have been marked as deleted by a newer token event's `del` field but are
 * still present, and publishes a single NIP-09 delete event for them. Use this to clean up the old
 * token events left behind when operations run with `deleteOldTokens: false`, batching what would
 * otherwise be many per-operation delete events into a single signing operation.
 */
export function CleanupDeletedTokens(): Action {
  return async ({ events, signer, self, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const wallet = await getUnlockedWallet(user, signer);

    const tokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] }));

    // Unlock tokens so their `del` references can be read
    for (const token of tokens) {
      if (!isTokenContentUnlocked(token)) {
        try {
          await unlockTokenContent(token, signer);
        } catch {}
      }
    }

    // Collect the ids that newer token events have marked as deleted, merging the public `del` tags
    // (no decryption needed) with the decrypted content for events that only store the ids there
    const deleted = new Set<string>();
    for (const token of tokens) {
      for (const id of getTokenDeletedIds(token)) deleted.add(id);
      if (isTokenContentUnlocked(token)) for (const id of getTokenContent(token).del) deleted.add(id);
    }

    // Find token events that are marked deleted but still present in the store
    const stale = tokens.filter((token) => deleted.has(token.id));
    if (stale.length === 0) return;

    // Publish a single delete event for all stale token events
    const deleteEvent = await DeleteFactory.fromEvents(stale).sign(signer);
    await publish(deleteEvent, wallet.relays);
  };
}

/**
 * Recovers tokens from a couch by checking if they exist in the wallet, verifying they are unspent, and
 * creating token events for any recoverable proofs. Once every token has been processed the couch is
 * cleared, so tokens that are already in the wallet or have been spent are cleaned out too. Any token
 * whose recovered token event failed to publish is left in the couch so it can be retried on a later run.
 * @param couch the couch interface to recover tokens from
 * @param options.getCashuWallet optional provider returning a cached cashu Wallet for a mint
 */
export function RecoverFromCouch(couch: Couch, options?: { getCashuWallet?: CashuWalletProvider }): Action {
  return async ({ events, signer, self, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const wallet = await getUnlockedWallet(user, signer);

    // Get all tokens from the couch
    const tokens = await couch.getAll();
    if (tokens.length === 0) return; // No tokens to recover

    // Get all token events from the wallet
    const walletTokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] }));

    // Unlock wallet tokens if needed
    for (const token of walletTokens) {
      if (!isTokenContentUnlocked(token)) {
        try {
          await unlockTokenContent(token, signer);
        } catch {}
      }
    }

    // Create a set of proof UIDs already held by the wallet so we never recover a duplicate
    const seenProofUIDs = new Set<string>();
    for (const token of walletTokens.filter(isTokenContentUnlocked))
      for (const proof of getTokenContent(token).proofs) seenProofUIDs.add(getProofUID(proof));

    // Tokens whose recovered token event failed to publish — kept in the couch for a later retry
    const failed = new Set<Token>();

    // Recover every token first, so we don't clear the couch until all recoverable proofs are published
    for (const token of tokens) {
      // Skip proofs that are already in the wallet (or were recovered from an earlier token this run)
      const newProofs = token.proofs.filter((proof) => {
        const uid = getProofUID(proof);
        if (seenProofUIDs.has(uid)) return false;
        seenProofUIDs.add(uid);
        return true;
      });

      // Nothing new to publish — already in the wallet or recovered earlier; cleared at the end
      if (newProofs.length === 0) continue;

      // Keep only the proofs the mint reports as unspent
      const cashuWallet = await loadCashuWallet(token.mint, { getCashuWallet: options?.getCashuWallet });
      const states = await cashuWallet.checkProofsStates(newProofs);
      const unspentProofs: Proof[] = newProofs.filter((_, i) => states[i].state !== CheckStateEnum.SPENT);

      // No unspent proofs to publish — fully spent leftovers; cleared at the end
      if (unspentProofs.length === 0) continue;

      // Create and publish a token event for the recovered proofs
      const recoveredToken: Token = { mint: token.mint, proofs: unspentProofs, unit: token.unit };
      const tokenEvent = await WalletTokenFactory.create(recoveredToken).sign(signer);

      try {
        await publish(tokenEvent, wallet.relays);
      } catch {
        // Keep this token so its proofs can be recovered on a later run
        failed.add(token);
      }
    }

    // Recovery complete: clear the couch. If every recovery published, clear it all in one call;
    // otherwise remove each processed token individually and leave the failed ones for a retry.
    if (failed.size === 0) await couch.clear();
    else for (const token of tokens) if (!failed.has(token)) await couch.remove(token);
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
) => { events: NostrEvent[]; proofs: ProofLike[] };

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
  operation: (params: {
    selectedProofs: ProofLike[];
    mint: string;
    cashuWallet: Wallet;
  }) => Promise<{ change?: Proof[] }>,
  options: {
    mint?: string;
    couch: Couch;
    tokenSelection?: TokenSelectionFunction;
    wallet?: Wallet;
    getCashuWallet?: CashuWalletProvider;
    deleteOldTokens?: boolean;
  },
): Action {
  const { mint, couch, wallet, getCashuWallet, deleteOldTokens, tokenSelection = dumbTokenSelection } = options;

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

    // Store selected tokens in couch for safety (normalize to cashu Amount proofs for encoding)
    const selectedToken: Token = {
      mint: selectedMint,
      proofs: normalizeProofAmounts(selectedProofs),
      unit: "sat",
    };
    const clearStoredToken = await couch.store(selectedToken);

    try {
      // Create cashu wallet for the mint
      const cashuWallet = await loadCashuWallet(selectedMint, { wallet, getCashuWallet });

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
      await run(CompleteSpend, selectedTokenEvents, changeToken, couch, { deleteOldTokens });

      // Clear the stored token from the couch after successful completion
      await clearStoredToken();
    } catch (error) {
      // If an error occurs, don't clear the couch (tokens remain for recovery)
      throw error;
    }
  };
}
