import { relaySet } from "applesauce-core/helpers";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getReplaceableIdentifier, getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { normalizeURL } from "applesauce-core/helpers/url";

export const GIT_REPOSITORY_KIND = 30617;

export type GitRepositoryEvent = KnownEvent<typeof GIT_REPOSITORY_KIND>;
export type GitRepositoryPointer = AddressPointer & { kind: typeof GIT_REPOSITORY_KIND };

export const GitRepositoryWebUrlsSymbol = Symbol.for("git-repository-web-urls");
export const GitRepositoryCloneUrlsSymbol = Symbol.for("git-repository-clone-urls");
export const GitRepositoryRelaysSymbol = Symbol.for("git-repository-relays");
export const GitRepositoryMaintainersSymbol = Symbol.for("git-repository-maintainers");
export const GitRepositoryHashtagsSymbol = Symbol.for("git-repository-hashtags");
export const GitRepositoryUpstreamSymbol = Symbol.for("git-repository-upstream");

function getTagValues(event: NostrEvent, name: string) {
  return event.tags.filter((tag) => tag[0] === name && tag[1]).flatMap((tag) => tag.slice(1));
}

/** Checks if an event is a valid NIP-34 repository announcement. */
export function isValidGitRepository(event?: NostrEvent): event is GitRepositoryEvent {
  return !!event && event.kind === GIT_REPOSITORY_KIND && !!getReplaceableIdentifier(event);
}

/** Returns the repository identifier from the `d` tag. */
export function getGitRepositoryIdentifier(event: GitRepositoryEvent): string;
export function getGitRepositoryIdentifier(event?: NostrEvent): string | undefined;
export function getGitRepositoryIdentifier(event?: NostrEvent | GitRepositoryEvent): string | undefined {
  if (!isValidGitRepository(event)) return undefined;
  return getReplaceableIdentifier(event) || undefined;
}

/** Returns the repository display name. */
export function getGitRepositoryName(event?: NostrEvent): string | undefined {
  if (!isValidGitRepository(event)) return undefined;
  return getTagValue(event, "name") || undefined;
}

/** Returns the repository description. */
export function getGitRepositoryDescription(event?: NostrEvent): string | undefined {
  if (!isValidGitRepository(event)) return undefined;
  return getTagValue(event, "description") || undefined;
}

/** Returns all web URLs declared by the repository announcement. */
export function getGitRepositoryWebUrls(event?: NostrEvent): string[] {
  if (!isValidGitRepository(event)) return [];
  return getOrComputeCachedValue(event, GitRepositoryWebUrlsSymbol, () => getTagValues(event, "web"));
}

/** Returns all clone URLs declared by the repository announcement. */
export function getGitRepositoryCloneUrls(event?: NostrEvent): string[] {
  if (!isValidGitRepository(event)) return [];
  return getOrComputeCachedValue(event, GitRepositoryCloneUrlsSymbol, () => getTagValues(event, "clone"));
}

/** Returns relays monitored by the repository. */
export function getGitRepositoryRelays(event?: NostrEvent): string[] {
  if (!isValidGitRepository(event)) return [];
  return getOrComputeCachedValue(event, GitRepositoryRelaysSymbol, () => relaySet(getTagValues(event, "relays")));
}

/** Returns the earliest unique commit ID, if declared. */
export function getGitRepositoryEarliestUniqueCommit(event?: NostrEvent): string | undefined {
  if (!isValidGitRepository(event)) return undefined;
  return event.tags.find((tag) => tag[0] === "r" && tag[2] === "euc")?.[1];
}

/** Returns all recognized maintainer pubkeys. */
export function getGitRepositoryMaintainers(event?: NostrEvent): string[] {
  if (!isValidGitRepository(event)) return [];
  return getOrComputeCachedValue(event, GitRepositoryMaintainersSymbol, () => getTagValues(event, "maintainers"));
}

/** Returns repository topic tags (NIP-34: values from each `["t", ...]` tag). */
export function getGitRepositoryHashtags(event?: NostrEvent): string[] {
  if (!isValidGitRepository(event)) return [];
  return getOrComputeCachedValue(event, GitRepositoryHashtagsSymbol, () => getTagValues(event, "t"));
}

/**
 * Returns the upstream repository pointer (the repo this one was forked from), if declared.
 * Parsed from the `["u", "30617:<pubkey>:<identifier>", "<relay hint>"]` tag.
 */
export function getGitRepositoryUpstream(event?: NostrEvent): GitRepositoryPointer | undefined {
  if (!isValidGitRepository(event)) return undefined;
  return getOrComputeCachedValue(event, GitRepositoryUpstreamSymbol, () => {
    const tag = event.tags.find((t) => t[0] === "u" && t[1]);
    if (!tag || !tag[1]) return undefined;
    const parts = tag[1].split(":");
    if (parts.length < 3) return undefined;
    const kind = parseInt(parts[0]);
    const pubkey = parts[1];
    const identifier = parts.slice(2).join(":");
    if (kind !== GIT_REPOSITORY_KIND) return undefined;
    if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return undefined;
    if (!identifier) return undefined;
    const pointer: GitRepositoryPointer = { kind: GIT_REPOSITORY_KIND, pubkey: pubkey.toLowerCase(), identifier };
    if (tag[2] && isSafeRelayURL(tag[2])) pointer.relays = [normalizeURL(tag[2])];
    return pointer;
  });
}
