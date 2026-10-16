import { TagOperation } from "applesauce-core/factories";
import { createProviderTag, parseProviderTag, TrustedProvider } from "../helpers/trusted-assertions.js";

/** A provider slot, optionally narrowed to a single service pubkey */
export type TrustedProviderSelector = Pick<TrustedProvider, "kind" | "tag"> & { servicePubkey?: string };

/** Checks if a tag matches a provider selector */
function matchesProvider(tag: string[], selector: TrustedProviderSelector): boolean {
  const parsed = parseProviderTag(tag);
  if (!parsed || parsed.kind !== selector.kind || parsed.tag !== selector.tag) return false;
  return selector.servicePubkey === undefined || parsed.servicePubkey === selector.servicePubkey;
}

/** Adds a provider to a kind 10040 tag list, or updates the relay hint of an existing entry */
export function addProviderTag(provider: TrustedProvider): TagOperation {
  return (tags) => {
    const tag = createProviderTag(provider);
    const index = tags.findIndex((t) => matchesProvider(t, provider));
    if (index === -1) return [...tags, tag];
    return tags.map((t, i) => (i === index ? tag : t));
  };
}

/** Removes a provider from a kind 10040 tag list, or every provider in the slot if no pubkey is given */
export function removeProviderTag(selector: TrustedProviderSelector): TagOperation {
  return (tags) => tags.filter((t) => !matchesProvider(t, selector));
}

/** Replaces every provider in the `kind:tag` slot with a single provider */
export function setProviderTag(provider: TrustedProvider): TagOperation {
  return (tags) => [
    ...tags.filter((t) => !matchesProvider(t, { kind: provider.kind, tag: provider.tag })),
    createProviderTag(provider),
  ];
}

/** Removes a service pubkey from every slot in a kind 10040 tag list */
export function removeServiceTags(servicePubkey: string): TagOperation {
  return (tags) => tags.filter((t) => parseProviderTag(t)?.servicePubkey !== servicePubkey);
}
