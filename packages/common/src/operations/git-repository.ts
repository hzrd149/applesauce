import { EventOperation } from "applesauce-core/factories";
import { getReplaceableAddressFromPointer } from "applesauce-core/helpers/pointers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { normalizeURL } from "applesauce-core/helpers/url";
import { includeSingletonTag, modifyPublicTags } from "applesauce-core/operations/tags";
import { removeSingletonTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { GIT_REPOSITORY_KIND, GitRepositoryPointer } from "../helpers/git-repository.js";
import { addHashtag, removeHashtag, setHashtags } from "./hashtags.js";

/** NIP-34 uses one tag per name with all values in that tag: `["web", url1, url2, ...]`. */
function collectFlatTagValues(tags: string[][], name: string): string[] {
  const values: string[] = [];
  for (const t of tags) {
    if (t[0] === name && t.length > 1) values.push(...t.slice(1));
  }
  return values;
}

function stripTagsNamed(tags: string[][], name: string): string[][] {
  return tags.filter((t) => t[0] !== name);
}

function withFlatListTag(tags: string[][], name: string, values: string[]): string[][] {
  const base = stripTagsNamed(tags, name);
  if (values.length === 0) return base;
  return [...base, [name, ...values]];
}

/** Sets the repository identifier `d` tag. */
export function setGitRepositoryIdentifier(identifier: string): EventOperation {
  return includeSingletonTag(["d", identifier], true);
}

/** Sets or removes the repository name. */
export function setGitRepositoryName(name: string | null): EventOperation {
  return modifyPublicTags(name === null ? removeSingletonTag("name") : setSingletonTag(["name", name], true));
}

/** Sets or removes the repository description. */
export function setGitRepositoryDescription(description: string | null): EventOperation {
  return modifyPublicTags(
    description === null ? removeSingletonTag("description") : setSingletonTag(["description", description], true),
  );
}

/** Sets the repository web URLs (single `web` tag, NIP-34 flat list). */
export function setGitRepositoryWebUrls(urls: string[]): EventOperation {
  return modifyPublicTags((tags) => withFlatListTag(tags, "web", urls));
}

/** Sets the git clone URLs (single `clone` tag). */
export function setGitRepositoryCloneUrls(urls: string[]): EventOperation {
  return modifyPublicTags((tags) => withFlatListTag(tags, "clone", urls));
}

/** Sets the repository relay URLs (single `relays` tag, normalized). */
export function setGitRepositoryRelays(relays: string[]): EventOperation {
  return modifyPublicTags((tags) => {
    const normalized = relays.map((relay) => new URL(relay).toString());
    return withFlatListTag(tags, "relays", normalized);
  });
}

/** Adds a web browsing URL. */
export function addGitRepositoryWebUrl(url: string): EventOperation {
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "web");
    if (cur.includes(url)) return withFlatListTag(tags, "web", cur);
    return withFlatListTag(tags, "web", [...cur, url]);
  });
}

/** Removes a web browsing URL. */
export function removeGitRepositoryWebUrl(url: string): EventOperation {
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "web").filter((u) => u !== url);
    return withFlatListTag(tags, "web", cur);
  });
}

/** Adds a git clone URL. */
export function addGitRepositoryCloneUrl(url: string): EventOperation {
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "clone");
    if (cur.includes(url)) return withFlatListTag(tags, "clone", cur);
    return withFlatListTag(tags, "clone", [...cur, url]);
  });
}

/** Removes a git clone URL. */
export function removeGitRepositoryCloneUrl(url: string): EventOperation {
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "clone").filter((u) => u !== url);
    return withFlatListTag(tags, "clone", cur);
  });
}

/** Adds a repository relay URL. */
export function addGitRepositoryRelay(relay: string): EventOperation {
  const normalized = new URL(relay).toString();
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "relays");
    if (cur.includes(normalized)) return withFlatListTag(tags, "relays", cur);
    return withFlatListTag(tags, "relays", [...cur, normalized]);
  });
}

/** Removes a repository relay URL. */
export function removeGitRepositoryRelay(relay: string): EventOperation {
  const normalized = new URL(relay).toString();
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "relays").filter((r) => r !== normalized);
    return withFlatListTag(tags, "relays", cur);
  });
}

/** Sets or removes the earliest unique commit marker. */
export function setGitRepositoryEarliestUniqueCommit(commit: string | null): EventOperation {
  return modifyPublicTags((tags) => {
    const filtered = tags.filter((tag) => !(tag[0] === "r" && tag[2] === "euc"));
    return commit === null ? filtered : [...filtered, ["r", commit, "euc"]];
  });
}

/** Sets the recognized maintainer pubkeys (single `maintainers` tag). */
export function setGitRepositoryMaintainers(pubkeys: string[]): EventOperation {
  return modifyPublicTags((tags) => withFlatListTag(tags, "maintainers", pubkeys));
}

/** Adds a recognized maintainer pubkey. */
export function addGitRepositoryMaintainer(pubkey: string): EventOperation {
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "maintainers");
    if (cur.includes(pubkey)) return withFlatListTag(tags, "maintainers", cur);
    return withFlatListTag(tags, "maintainers", [...cur, pubkey]);
  });
}

/** Removes a recognized maintainer pubkey. */
export function removeGitRepositoryMaintainer(pubkey: string): EventOperation {
  return modifyPublicTags((tags) => {
    const cur = collectFlatTagValues(tags, "maintainers").filter((pk) => pk !== pubkey);
    return withFlatListTag(tags, "maintainers", cur);
  });
}

/** Sets repository hashtags (NIP-34: multiple `["t", "<topic>"]` tags). */
export function setGitRepositoryHashtags(hashtags: string[]): EventOperation {
  return setHashtags(hashtags);
}

/** Adds a repository hashtag (NIP-34: `["t", "<topic>"]`). */
export function addGitRepositoryHashtag(hashtag: string): EventOperation {
  return addHashtag(hashtag);
}

/** Removes a repository hashtag. */
export function removeGitRepositoryHashtag(hashtag: string): EventOperation {
  return removeHashtag(hashtag);
}

/**
 * Sets or clears the upstream repository pointer (the repo this one was forked from).
 * Writes a `["u", "30617:<pubkey>:<identifier>", "<relay hint>"]` tag.
 */
export function setGitRepositoryUpstream(pointer: GitRepositoryPointer | null): EventOperation {
  return modifyPublicTags((tags) => {
    const filtered = tags.filter((tag) => tag[0] !== "u");
    if (!pointer) return filtered;
    if (pointer.kind !== GIT_REPOSITORY_KIND)
      throw new Error(`Upstream pointer must reference kind ${GIT_REPOSITORY_KIND}`);
    if (!pointer.identifier) throw new Error("Upstream pointer must include an identifier");
    const address = getReplaceableAddressFromPointer(pointer);
    const hint = pointer.relays?.find((url) => isSafeRelayURL(url));
    const tag = hint ? ["u", address, normalizeURL(hint)] : ["u", address];
    return [...filtered, tag];
  });
}
