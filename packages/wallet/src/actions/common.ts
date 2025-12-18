import { User } from "applesauce-common/casts";
import { EventSigner } from "applesauce-core";
import { unlockWallet } from "../helpers/wallet.js";

export async function getUnlockedWallet(user: User, signer?: EventSigner) {
  // NOTE: hard coding the timeout here isn't ideal, but no idea where else to put it
  const wallet = await user.wallet$.$first(5_000).catch(() => undefined);
  if (!wallet) throw new Error("Unable to find wallet");

  if (!wallet.unlocked) {
    if (!signer) throw new Error("Missing signer");
    await unlockWallet(wallet.event, signer);
  }

  return wallet;
}
