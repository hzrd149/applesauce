import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { processTags } from "applesauce-core/helpers/tags";

export const EXTERNAL_IDENTITIES_KIND = 10011;
export const ExternalIdentitiesSymbol = Symbol.for("external-identities");

export type ExternalIdentitiesEvent = KnownEvent<typeof EXTERNAL_IDENTITIES_KIND>;

/** An external identity claimed by a NIP-39 "i" tag */
export type ExternalIdentity = {
  /** The platform name (github, twitter, mastodon, telegram, bluesky, discord, etc) */
  platform: string;
  /** The identity on the platform */
  identity: string;
  /** A platform specific pointer to the proof of ownership */
  proof: string;
};

/** Checks if an event is a NIP-39 external identities list */
export function isValidExternalIdentities(event?: NostrEvent): event is ExternalIdentitiesEvent {
  return !!event && event.kind === EXTERNAL_IDENTITIES_KIND;
}

/** Parses a NIP-39 ["i", "platform:identity", "proof"] tag */
export function getExternalIdentityFromTag(tag: string[]): ExternalIdentity | undefined {
  if (tag[0] !== "i" || !tag[1] || !tag[2]) return undefined;

  const index = tag[1].indexOf(":");
  if (index <= 0 || index === tag[1].length - 1) return undefined;

  return { platform: tag[1].slice(0, index), identity: tag[1].slice(index + 1), proof: tag[2] };
}

/** Creates a NIP-39 "i" tag for an external identity */
export function createExternalIdentityTag(identity: ExternalIdentity): string[] {
  return ["i", `${identity.platform}:${identity.identity}`, identity.proof];
}

/**
 * Returns the external identities from a NIP-39 identities list
 * @see https://github.com/nostr-protocol/nips/blob/master/39.md
 */
export function getExternalIdentities(event?: NostrEvent): ExternalIdentity[] {
  if (!isValidExternalIdentities(event)) return [];
  return getOrComputeCachedValue(event, ExternalIdentitiesSymbol, () =>
    processTags(event.tags, getExternalIdentityFromTag),
  );
}

/**
 * Returns the URL of the proof for an external identity, or undefined for unknown platforms
 * @see https://github.com/nostr-protocol/nips/blob/master/39.md
 */
export function getExternalIdentityProofUrl({ platform, identity, proof }: ExternalIdentity): string | undefined {
  switch (platform) {
    case "github":
      return `https://gist.github.com/${identity}/${proof}`;
    case "twitter":
      return `https://twitter.com/${identity}/status/${proof}`;
    case "mastodon":
      return `https://${identity}/${proof}`;
    case "telegram":
      return `https://t.me/${proof}`;
    case "bluesky":
      return `https://bsky.app/profile/${identity}/post/${proof}`;
    case "discord":
      return `https://discord.com/channels/${proof}`;
    default:
      return undefined;
  }
}
