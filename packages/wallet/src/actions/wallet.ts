import { Action } from "applesauce-actions";
import { WalletBackupBlueprint, WalletBlueprint } from "../blueprints/wallet.js";
import { unlockHistoryContent, WALLET_HISTORY_KIND } from "../helpers/history.js";
import { NUTZAP_INFO_KIND } from "../helpers/nutzap-info.js";
import { unlockTokenContent, WALLET_TOKEN_KIND } from "../helpers/tokens.js";
import { getWalletMints, unlockWallet, WALLET_KIND } from "../helpers/wallet.js";
import { setNutzapInfoPubkey } from "../operations/nutzap-info.js";
import { setMints, setRelays } from "../operations/wallet.js";
import { getUnlockedWallet } from "./common.js";

// Make sure the wallet$ is registered on the user class
import "../casts/__register__.js";

/** An action that creates a new 17375 wallet event and 375 wallet backup */
export function CreateWallet({
  mints,
  privateKey,
  relays,
}: {
  mints: string[];
  privateKey?: Uint8Array;
  relays?: string[];
}): Action {
  return async ({ events, factory, self, publish }) => {
    if (mints.length === 0) throw new Error("At least one mint is required");

    const existing = events.getReplaceable(WALLET_KIND, self);
    if (existing) throw new Error("Wallet already exists");

    // Create new wallet event
    const wallet = await factory.sign(await factory.create(WalletBlueprint, { mints, privateKey, relays }));

    // Setup nutzap info event
    if (privateKey) {
      // Create a backup event if a private key is provided
      const backup = await factory.sign(await factory.create(WalletBackupBlueprint, wallet));

      const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
      // Always set pubkey if private key is provided (create or update)
      const nutzapInfoDraft = nutzapInfo
        ? await factory.modify(nutzapInfo, setNutzapInfoPubkey(privateKey))
        : await factory.build({ kind: NUTZAP_INFO_KIND }, setNutzapInfoPubkey(privateKey));
      const info = await factory.sign(nutzapInfoDraft);

      // Publish all events at the same time
      await publish([wallet, backup, info], relays);
    } else {
      // Just publish the wallet event
      await publish(wallet, relays);
    }
  };
}

/**
 * Adds a private key to a wallet event
 * @throws if the wallet does not exist or cannot be unlocked
 */
export function WalletAddPrivateKey(privateKey: Uint8Array, override = false): Action {
  return async ({ events, self, factory, user, signer, sign, publish }) => {
    const wallet = await getUnlockedWallet(user, signer);
    if (wallet.privateKey && override !== true) throw new Error("Wallet already has a private key");

    const signed = await factory
      .create(WalletBlueprint, { mints: getWalletMints(wallet.event), privateKey })
      .then(sign);

    // create backup event for wallet
    const backup = await factory.create(WalletBackupBlueprint, signed).then(sign);

    // set nutzap info pubkey for receiving nutzaps
    const nutzapInfo = events.getReplaceable(NUTZAP_INFO_KIND, self);
    const info = nutzapInfo
      ? await factory.modify(nutzapInfo, setNutzapInfoPubkey(privateKey)).then(sign)
      : await factory.build({ kind: NUTZAP_INFO_KIND }, setNutzapInfoPubkey(privateKey)).then(sign);

    // publish all events at the same time
    await publish([signed, backup, info], wallet.relays);
  };
}

/** Unlocks the wallet event and optionally the tokens and history events */
export function UnlockWallet(unlock?: { history?: boolean; tokens?: boolean }): Action {
  return async ({ events, self, factory }) => {
    const signer = factory.services.signer;
    if (!signer) throw new Error("Missing signer");

    const wallet = events.getReplaceable(WALLET_KIND, self);
    if (!wallet) throw new Error("Wallet does not exist");

    await unlockWallet(wallet, signer);

    if (unlock?.tokens) {
      const tokens = events.getTimeline({ kinds: [WALLET_TOKEN_KIND], authors: [self] });
      for (const token of tokens) await unlockTokenContent(token, signer);
    }

    if (unlock?.history) {
      const history = events.getTimeline({ kinds: [WALLET_HISTORY_KIND], authors: [self] });
      for (const entry of history) await unlockHistoryContent(entry, signer);
    }
  };
}

/**
 * Sets the mints on a wallet event
 * @throws if the wallet does not exist or cannot be unlocked
 */
export function SetWalletMints(mints: string[]): Action {
  return async ({ user, signer, factory, sign, publish }) => {
    const wallet = await getUnlockedWallet(user, signer);
    const signed = await factory.modify(wallet.event, setMints(mints, signer)).then(sign);
    await publish(signed, wallet.relays);
  };
}

/**
 * Sets the relays on a wallet event
 * @throws if the wallet does not exist or cannot be unlocked
 */
export function SetWalletRelays(relays: (string | URL)[]): Action {
  return async ({ user, signer, factory, sign, publish }) => {
    const wallet = await getUnlockedWallet(user, signer);
    const signed = await factory.modify(wallet.event, setRelays(relays, signer)).then(sign);
    await publish(signed, relays.map(String));
  };
}
