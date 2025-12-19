import { Proof, sumProofs, Token, Wallet } from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { castUser } from "applesauce-common/casts";
import { bytesToHex, NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { WalletHistoryBlueprint } from "../blueprints/history.js";
import { WalletTokenBlueprint } from "../blueprints/tokens.js";
import { NutzapBlueprint, ProfileNutzapBlueprint } from "../blueprints/zaps.js";
import { Couch } from "../helpers/couch.js";
import { verifyProofsLocked } from "../helpers/nutzap-info.js";
import { getNutzapMint, getNutzapProofs, isValidNutzap, NutzapEvent } from "../helpers/nutzap.js";
import { getUnlockedWallet } from "./common.js";

// Make sure the nutzap$ is registered on the user class
import "../casts/__register__.js";

/** Creates a NIP-61 nutzap event for an event with a token */
export function NutzapEvent(event: NostrEvent, token: Token, options?: { comment?: string; couch?: Couch }): Action {
  return async ({ events, factory, user, signer, sign, publish }) => {
    const { comment, couch } = options ?? {};

    const clearStoredToken = await couch?.store(token);
    try {
      const recipient = castUser(event.pubkey, events);

      // Get the recipient's nutzap info
      const info = await recipient.nutzap$.$first(5000, undefined);
      if (!info) throw new Error("Nutzap info not found");

      // Get the users wallet
      const wallet = await getUnlockedWallet(user, signer);

      // Verify all tokens are p2pk locked
      verifyProofsLocked(token.proofs, info.event);

      // Create the nutzap event
      const nutzap = await factory.create(NutzapBlueprint, event, token, comment || token.memo).then(sign);

      // Publish the nutzap event
      await publish(nutzap, wallet.relays);
    } catch {}

    await clearStoredToken?.();
  };
}

/** Creates a NIP-61 nutzap event to a users profile */
export function NutzapProfile(
  user: string | ProfilePointer,
  token: Token,
  options?: { comment?: string; couch?: Couch },
): Action {
  return async ({ events, factory, sign, publish }) => {
    const { comment, couch } = options ?? {};

    const clearStoredToken = await couch?.store(token);
    try {
      const recipient = castUser(user, events);

      // Get the target's nutzap info
      const info = await recipient.nutzap$.$first(5000, undefined);
      if (!info) throw new Error("Nutzap info not found");

      // Verify all tokens are p2pk locked
      verifyProofsLocked(token.proofs, info.event);

      // Create the nutzap event
      const nutzap = await factory.create(ProfileNutzapBlueprint, recipient, token, comment || token.memo).then(sign);

      // Publish the nutzap event
      await publish(nutzap, info.relays);
    } catch {}

    await clearStoredToken?.();
  };
}

/**
 * Receives a P2PK-locked cashu token from a nutzap event(s) by unlocking it with the wallet's private key
 * and marks the nutzap event(s) as redeemed
 * Supports nutzaps with different mints by grouping them by mint and redeeming each group separately
 * @param nutzaps single nutzap event or array of nutzap events
 * @param couch optional couch interface for temporarily storing tokens during the operation
 */
export function ReceiveNutzaps(nutzaps: NostrEvent | NostrEvent[], couch?: Couch): Action {
  return async ({ factory, user, signer, sign, publish }) => {
    if (!signer) throw new Error("Missing signer");

    // Normalize to array
    nutzaps = Array.isArray(nutzaps) ? nutzaps : [nutzaps];
    if (nutzaps.length === 0) throw new Error("No nutzap events provided");

    // Filter out nutzaps without mints or proofs (ignore them)
    const validNutzaps = nutzaps.filter((n) => isValidNutzap(n));
    if (validNutzaps.length === 0) throw new Error("No valid nutzaps with mints and proofs found");

    // Get private key from current wallet event
    const wallet = await getUnlockedWallet(user, signer);

    // Group nutzaps by mint
    const nutzapsByMint = new Map<string, NutzapEvent[]>();
    for (const nutzap of validNutzaps) {
      const mint = getNutzapMint(nutzap);
      if (!mint) continue; // Should not happen after filtering, but TypeScript needs this
      if (!nutzapsByMint.has(mint)) {
        nutzapsByMint.set(mint, []);
      }
      nutzapsByMint.get(mint)!.push(nutzap);
    }

    if (nutzapsByMint.size === 0) throw new Error("No valid nutzaps with mints found");
    if (!wallet.privateKey) throw new Error("No private key found in wallet");

    // Convert private key to hex string for cashu-ts
    const privkeyHex = bytesToHex(wallet.privateKey);

    // Track clear methods for all stored tokens
    const clearMethods: (() => void | Promise<void>)[] = [];

    try {
      // Process each mint group separately
      for (const [mint, mintNutzaps] of nutzapsByMint) {
        // Extract all proofs from nutzaps for this mint
        const allProofs = mintNutzaps.flatMap(getNutzapProofs);
        if (allProofs.length === 0) continue;

        // Construct token from nutzap proofs
        const token: Token = {
          mint,
          proofs: allProofs,
          unit: "sat",
        };

        // Use cashu-ts to receive/unlock the P2PK-locked token
        const cashuWallet = new Wallet(mint);
        await cashuWallet.loadMint();

        // Receive the token using the new wallet.ops API
        // This will swap P2PK-locked proofs with unlocked proofs
        let receivedProofs: Proof[];
        try {
          receivedProofs = await cashuWallet.ops.receive(token).privkey(privkeyHex).run();
        } catch (error) {
          throw new Error(
            `Failed to receive token for mint ${mint}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        // Calculate total amount
        const amount = sumProofs(receivedProofs);

        // Create token event with received unlocked proofs
        const receivedToken: Token = {
          mint,
          proofs: receivedProofs,
          unit: "sat",
        };

        // Store token in couch immediately after receiving it
        const clearStoredToken = await couch?.store(receivedToken);
        if (clearStoredToken) {
          clearMethods.push(clearStoredToken);
        }

        const tokenEvent = await factory.create(WalletTokenBlueprint, receivedToken, []).then(sign);

        // Create history event marking nutzap events as redeemed
        const nutzapIds = mintNutzaps.map((n) => n.id);
        const history = await factory
          .create(WalletHistoryBlueprint, { direction: "in", amount, mint, created: [tokenEvent.id] }, nutzapIds)
          .then(sign);

        // Publish events
        await publish(tokenEvent, wallet.relays);
        await publish(history, wallet.relays);
      }

      // Clear all stored tokens from the couch after successfully publishing all events for all mints
      await Promise.all(clearMethods.map((clear) => clear()));
    } catch (error) {
      // If an error occurs, don't clear the couch (tokens remain for recovery)
      throw error;
    }
  };
}
