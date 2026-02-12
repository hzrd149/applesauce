import { EventOperation, TagOperation } from "applesauce-core/event-factory";
import { bytesToHex, NostrEvent } from "applesauce-core/helpers/event";
import { normalizeURL } from "applesauce-core/helpers/url";
import { setSingletonTag } from "applesauce-core/operations/tag/common";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyHiddenTags } from "applesauce-core/operations/tags";
import { WALLET_KIND } from "../helpers/wallet.js";

/**
 * Sets the content of a kind 375 wallet backup event
 * @param wallet - Wallet event to backup
 * @param signer - EventSigner to verify pubkey match
 */
export function setBackupContent(
  wallet: NostrEvent,
  signer?: import("applesauce-core/event-factory").EventSigner,
): EventOperation {
  return async (draft) => {
    if (wallet.kind !== WALLET_KIND) throw new Error(`Cant create a wallet backup from kind ${wallet.kind}`);
    if (!wallet.content) throw new Error("Wallet missing content");

    const pubkey = signer ? await signer.getPublicKey() : undefined;
    if (wallet.pubkey !== pubkey) throw new Error("Wallet pubkey dose not match signer pubkey");

    return { ...draft, content: wallet.content };
  };
}

/** Sets the "mint" tags in a wallet event */
export function setMintTags(mints: string[]): TagOperation {
  return (tags) => [
    // remove all existing mint tags
    ...tags.filter((t) => t[0] !== "mint"),
    // add new mint tags
    ...mints.map((mint) => ["mint", mint]),
  ];
}
export function setMints(
  mints: string[],
  signer?: import("applesauce-core/event-factory").EventSigner,
): EventOperation {
  return modifyHiddenTags(signer, setMintTags(mints));
}

/** Sets the "privkey" tag on a wallet event */
export function setPrivateKeyTag(privateKey: Uint8Array): TagOperation {
  return setSingletonTag(["privkey", bytesToHex(privateKey)]);
}
export function setPrivateKey(
  privateKey: Uint8Array,
  signer?: import("applesauce-core/event-factory").EventSigner,
): EventOperation {
  return modifyHiddenTags(signer, setSingletonTag(["privkey", bytesToHex(privateKey)], true));
}

/** Adds a relay tag to a wallet event */
export function addWalletRelay(
  url: string | URL,
  signer?: import("applesauce-core/event-factory").EventSigner,
): EventOperation {
  url = normalizeURL(url).toString();

  return modifyHiddenTags(signer, addRelayTag(url, "relay", true));
}

/** Removes a relay tag from a wallet event */
export function removeWalletRelay(
  url: string | URL,
  signer?: import("applesauce-core/event-factory").EventSigner,
): EventOperation {
  url = normalizeURL(url).toString();

  return modifyHiddenTags(signer, removeRelayTag(url, "relay"));
}

/** Sets the relay tags on a wallet event, replacing all existing relay tags */
export function setRelayTags(relays: (string | URL)[]): TagOperation {
  return (tags) => [
    // remove all existing relay tags
    ...tags.filter((t) => t[0] !== "relay"),
    // add new relay tags
    ...relays.map((relay) => ["relay", normalizeURL(relay).toString()]),
  ];
}
export function setRelays(
  relays: (string | URL)[],
  signer?: import("applesauce-core/event-factory").EventSigner,
): EventOperation {
  return modifyHiddenTags(signer, setRelayTags(relays));
}
