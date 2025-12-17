import { Proof, sumProofs, Token, Wallet } from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { bytesToHex, NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { WalletHistoryBlueprint } from "../blueprints/history.js";
import { WalletTokenBlueprint } from "../blueprints/tokens.js";
import { NutzapBlueprint, ProfileNutzapBlueprint } from "../blueprints/zaps.js";
import { getNutzapMint, getNutzapProofs, isValidNutzap, NutzapEvent } from "../helpers/nutzap.js";
import { getWalletPrivateKey, isWalletUnlocked, unlockWallet, WALLET_KIND } from "../helpers/wallet.js";
import { NUTZAP_INFO_KIND, verifyProofsLocked } from "../helpers/nutzap-info.js";

/** Creates a NIP-61 nutzap event for an event with a token */
export function NutzapEvent(event: NostrEvent, token: Token, comment?: string): Action {
  return async function* ({ events, factory }) {
    const recipient = event.pubkey;
    const info = events.getReplaceable(NUTZAP_INFO_KIND, recipient);
    if (!info) throw new Error("Nutzap info not found");

    // Verify all tokens are p2pk locked
    verifyProofsLocked(token.proofs, info);

    // NOTE: Disabled because mints and units should be checked by the app before
    // const mints = getNutzapInfoMints(info);
    // if (!mints.some((m) => m.mint === token.mint)) throw new Error("Token mint not found in nutzap info");

    const nutzap = await factory.sign(await factory.create(NutzapBlueprint, event, token, comment || token.memo));
    yield nutzap;
  };
}

/** Creates a NIP-61 nutzap event to a users profile */
export function NutzapProfile(user: string | ProfilePointer, token: Token, comment?: string): Action {
  return async function* ({ events, factory }) {
    const info = events.getReplaceable(NUTZAP_INFO_KIND, typeof user === "string" ? user : user.pubkey);
    if (!info) throw new Error("Nutzap info not found");

    // Verify all tokens are p2pk locked
    verifyProofsLocked(token.proofs, info);

    const nutzap = await factory.sign(await factory.create(ProfileNutzapBlueprint, user, token, comment || token.memo));
    yield nutzap;
  };
}

/**
 * Receives a P2PK-locked cashu token from a nutzap event(s) by unlocking it with the wallet's private key
 * and marks the nutzap event(s) as redeemed
 * Supports nutzaps with different mints by grouping them by mint and redeeming each group separately
 * @param nutzaps single nutzap event or array of nutzap events
 */
export function ReceiveNutzaps(nutzaps: NostrEvent | NostrEvent[]): Action {
  return async function* ({ events, factory, self }) {
    const signer = factory.context.signer;
    if (!signer) throw new Error("Missing signer");

    // Normalize to array
    nutzaps = Array.isArray(nutzaps) ? nutzaps : [nutzaps];
    if (nutzaps.length === 0) throw new Error("No nutzap events provided");

    // Filter out nutzaps without mints or proofs (ignore them)
    const validNutzaps = nutzaps.filter((n) => isValidNutzap(n));
    if (validNutzaps.length === 0) throw new Error("No valid nutzaps with mints and proofs found");

    // Get private key from current wallet event
    const wallet = events.getReplaceable(WALLET_KIND, self);
    if (!wallet) throw new Error("Wallet not found");

    if (!isWalletUnlocked(wallet)) {
      await unlockWallet(wallet, signer);
    }

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

    const privateKey = getWalletPrivateKey(wallet);
    if (!privateKey) throw new Error("No private key found in wallet");

    // Convert private key to hex string for cashu-ts
    const privkeyHex = bytesToHex(privateKey);

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

      const tokenEvent = await factory.sign(await factory.create(WalletTokenBlueprint, receivedToken, []));

      // Create history event marking nutzap events as redeemed
      const nutzapIds = mintNutzaps.map((n) => n.id);
      const history = await factory.sign(
        await factory.create(
          WalletHistoryBlueprint,
          { direction: "in", amount, mint, created: [tokenEvent.id] },
          nutzapIds,
        ),
      );

      // Immediately yield both events after successful redeem
      yield tokenEvent;
      yield history;
    }
  };
}
