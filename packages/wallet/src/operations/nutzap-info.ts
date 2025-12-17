import { EventOperation } from "applesauce-core";
import { modifyPublicTags } from "applesauce-core/operations";
import { removeNameValueTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { normalizeURL } from "applesauce-core/helpers/url";
import { createNutzapInfoPubkeyTag } from "../helpers/nutzap-info.js";

/** Sets the relays for a nutzap info event, replacing all existing relay tags */
export function setNutzapInfoRelays(relays: string[]): EventOperation {
  return modifyPublicTags((tags) => [
    // remove all existing relay tags
    ...tags.filter((t) => t[0] !== "relay"),
    // add new relay tags
    ...relays.map((relay) => ["relay", relay]),
  ]);
}

/** Sets the mints for a nutzap info event, replacing all existing mint tags */
export function setNutzapInfoMints(mints: Array<{ url: string; units?: string[] }>): EventOperation {
  return modifyPublicTags((tags) => [
    // remove all existing mint tags
    ...tags.filter((t) => t[0] !== "mint"),
    // add new mint tags
    ...mints.map((mint) => {
      return mint.units ? ["mint", mint.url, ...mint.units] : ["mint", mint.url];
    }),
  ]);
}

/** Adds a relay tag to a nutzap info event */
export function addNutzapInfoRelay(url: string | URL): EventOperation {
  url = normalizeURL(url).toString();

  return modifyPublicTags(addRelayTag(url, "relay", false));
}

/** Removes a relay tag from a nutzap info event */
export function removeNutzapInfoRelay(url: string | URL): EventOperation {
  url = normalizeURL(url).toString();

  return modifyPublicTags(removeRelayTag(url, "relay"));
}

/** Adds a mint tag to a nutzap info event */
export function addNutzapInfoMint(mint: { url: string; units?: string[] }): EventOperation {
  return modifyPublicTags((tags) => {
    // Find existing mint tag with the same URL
    const existingIndex = tags.findIndex((t) => t[0] === "mint" && t[1] === mint.url);

    if (existingIndex !== -1) {
      // Merge units if mint tag already exists
      const existingTag = tags[existingIndex];
      const existingUnits = existingTag.slice(2); // Get units from existing tag (everything after ["mint", url])
      const newUnits = mint.units || [];

      // Merge units, removing duplicates while preserving order
      const mergedUnits = [...existingUnits];
      for (const unit of newUnits) {
        if (!mergedUnits.includes(unit)) {
          mergedUnits.push(unit);
        }
      }

      // Replace existing tag with merged tag
      const mergedTag = mergedUnits.length > 0 ? ["mint", mint.url, ...mergedUnits] : ["mint", mint.url];

      return tags.map((t, i) => (i === existingIndex ? mergedTag : t));
    } else {
      // Add new tag if it doesn't exist
      const tag = mint.units ? ["mint", mint.url, ...mint.units] : ["mint", mint.url];
      return [...tags, tag];
    }
  });
}

/** Removes a mint tag from a nutzap info event */
export function removeNutzapInfoMint(url: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["mint", url]));
}

/** Sets the pubkey for a nutzap info event */
export function setNutzapInfoPubkey(key: Uint8Array): EventOperation {
  return modifyPublicTags(setSingletonTag(createNutzapInfoPubkeyTag(key), true));
}
