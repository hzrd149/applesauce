import { CheckStateEnum, Proof, Token, Wallet, Mint } from "@cashu/cashu-ts";
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

/**
 * Adds a cashu token to the wallet and marks a list of nutzaps as redeemed
 * @param token the cashu token to add
 * @param redeemed an array of nutzap event ids to mark as redeemed
 */
export function ReceiveToken(token: Token, redeemed?: string[], fee?: number): Action {
  return async function* ({ factory }) {
    const amount = token.proofs.reduce((t, p) => t + p.amount, 0);

    const tokenEvent = await factory.sign(await factory.create(WalletTokenBlueprint, token, []));
    const history = await factory.sign(
      await factory.create(
        WalletHistoryBlueprint,
        { direction: "in", amount, mint: token.mint, created: [tokenEvent.id], fee },
        redeemed ?? [],
      ),
    );

    yield tokenEvent;
    yield history;
  };
}

/** An action that deletes old tokens and creates a new one but does not add a history event */
export function RolloverTokens(tokens: NostrEvent[], token: Token): Action {
  return async function* ({ factory }) {
    // create a delete event for old tokens
    const deleteDraft = await factory.create(DeleteBlueprint, tokens);
    // create a new token event
    const tokenDraft = await factory.create(
      WalletTokenBlueprint,
      token,
      tokens.map((e) => e.id),
    );

    // sign events
    const signedDelete = await factory.sign(deleteDraft);
    const signedToken = await factory.sign(tokenDraft);

    // publish events
    yield signedDelete;
    yield signedToken;
  };
}

/** An action that deletes old token events and adds a spend history item */
export function CompleteSpend(spent: NostrEvent[], change: Token): Action {
  return async function* ({ factory }) {
    if (spent.length === 0) throw new Error("Cant complete spent with no token events");
    if (spent.some((s) => isTokenContentUnlocked(s))) throw new Error("Cant complete spend with locked tokens");

    // create the nip-09 delete event for previous events
    const deleteDraft = await factory.create(DeleteBlueprint, spent);

    const changeAmount = change.proofs.reduce((t, p) => t + p.amount, 0);

    // create a new token event if needed
    const changeDraft =
      changeAmount > 0
        ? await factory.create(
            WalletTokenBlueprint,
            change,
            spent.map((e) => e.id),
          )
        : undefined;

    const total = spent.reduce(
      (total, token) => total + getTokenContent(token)!.proofs.reduce((t, p) => t + p.amount, 0),
      0,
    );

    // calculate the amount that was spent
    const diff = total - changeAmount;

    // sign delete and token
    const signedDelete = await factory.sign(deleteDraft);
    const signedToken = changeDraft && (await factory.sign(changeDraft));

    // create a history entry
    const history = await factory.create(
      WalletHistoryBlueprint,
      { direction: "out", mint: change.mint, amount: diff, created: signedToken ? [signedToken.id] : [] },
      [],
    );

    // sign history
    const signedHistory = await factory.sign(history);

    // publish events
    yield signedDelete;
    if (signedToken) yield signedToken;
    yield signedHistory;
  };
}

/** Combines all unlocked token events into a single event per mint */
export function ConsolidateTokens(opts?: { ignoreLocked?: boolean }): Action {
  return async function* ({ events, factory, self }) {
    const tokens = Array.from(events.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [self] })).filter((token) => {
      if (isTokenContentUnlocked(token)) {
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
      const cashuMint = new Mint(mint);
      const cashuWallet = new Wallet(cashuMint);

      // get all tokens proofs
      const proofs = tokens
        .map((t) => getTokenContent(t)!.proofs)
        .flat()
        // filter out duplicate proofs
        .filter(ignoreDuplicateProofs());

      // NOTE: this assumes that the states array is the same length and order as the proofs array
      const states = await cashuWallet.checkProofsStates(proofs);
      const notSpent: Proof[] = proofs.filter((_, i) => states[i].state !== CheckStateEnum.SPENT);

      // create delete and token event
      const deleteDraft = await factory.create(DeleteBlueprint, tokens);
      const tokenDraft = await factory.create(
        WalletTokenBlueprint,
        { mint, proofs: notSpent },
        tokens.map((t) => t.id),
      );

      // sign events
      const signedToken = await factory.sign(tokenDraft);
      const signedDelete = await factory.sign(deleteDraft);

      // publish events for mint
      yield signedToken;
      yield signedDelete;
    }
  };
}
