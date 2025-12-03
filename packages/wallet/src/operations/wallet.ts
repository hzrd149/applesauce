import { EventOperation } from "applesauce-core/event-factory";
import { bytesToHex, NostrEvent } from "applesauce-core/helpers/event";
import { setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyHiddenTags } from "applesauce-core/operations/tags";
import { WALLET_KIND } from "../helpers/wallet.js";

/** Sets the content of a kind 375 wallet backup event */
export function setBackupContent(wallet: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    if (wallet.kind !== WALLET_KIND) throw new Error(`Cant create a wallet backup from kind ${wallet.kind}`);
    if (!wallet.content) throw new Error("Wallet missing content");

    const pubkey = await ctx.signer?.getPublicKey();
    if (wallet.pubkey !== pubkey) throw new Error("Wallet pubkey dose not match signer pubkey");

    return { ...draft, content: wallet.content };
  };
}

/** Sets the "mint" tags in a wallet event */
export function setMints(mints: string[]): EventOperation {
  return modifyHiddenTags((tags) => [
    // remove all existing mint tags
    ...tags.filter((t) => t[0] !== "mint"),
    // add new mint tags
    ...mints.map((mint) => ["mint", mint]),
  ]);
}

/** Sets the "privkey" tag on a wallet event */
export function setPrivateKey(privateKey: Uint8Array): EventOperation {
  return modifyHiddenTags(setSingletonTag(["privkey", bytesToHex(privateKey)], true));
}
