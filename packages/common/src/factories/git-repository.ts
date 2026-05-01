import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { GIT_REPOSITORY_KIND, GitRepositoryPointer, isValidGitRepository } from "../helpers/git-repository.js";
import {
  addGitRepositoryCloneUrl,
  addGitRepositoryHashtag,
  addGitRepositoryMaintainer,
  addGitRepositoryRelay,
  addGitRepositoryWebUrl,
  removeGitRepositoryCloneUrl,
  removeGitRepositoryHashtag,
  removeGitRepositoryMaintainer,
  removeGitRepositoryRelay,
  removeGitRepositoryWebUrl,
  setGitRepositoryCloneUrls,
  setGitRepositoryDescription,
  setGitRepositoryEarliestUniqueCommit,
  setGitRepositoryHashtags,
  setGitRepositoryIdentifier,
  setGitRepositoryMaintainers,
  setGitRepositoryName,
  setGitRepositoryRelays,
  setGitRepositoryUpstream,
  setGitRepositoryWebUrls,
} from "../operations/git-repository.js";

export type GitRepositoryTemplate = KnownEventTemplate<typeof GIT_REPOSITORY_KIND>;

/** Factory for NIP-34 repository announcement events. */
export class GitRepositoryFactory extends EventFactory<typeof GIT_REPOSITORY_KIND, GitRepositoryTemplate> {
  /** Creates a repository announcement factory. */
  static create(identifier: string): GitRepositoryFactory {
    return new GitRepositoryFactory((res) => res(blankEventTemplate(GIT_REPOSITORY_KIND))).identifier(identifier);
  }

  /** Creates a factory configured to modify an existing repository announcement. */
  static modify(event: NostrEvent): GitRepositoryFactory {
    if (!isValidGitRepository(event)) throw new Error("Expected a git repository announcement event");
    return new GitRepositoryFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the replaceable repository `d` identifier tag. */
  identifier(value: string) {
    return this.chain(setGitRepositoryIdentifier(value));
  }

  /** Sets or clears the display name (`name` tag). */
  name(value: string | null) {
    return this.chain(setGitRepositoryName(value));
  }

  /** Sets or clears the repository description. */
  description(value: string | null) {
    return this.chain(setGitRepositoryDescription(value));
  }

  /** Replaces all web browsing URLs. */
  setWebUrls(urls: string[]) {
    return this.chain(setGitRepositoryWebUrls(urls));
  }

  /** Appends a web browsing URL. */
  addWebUrl(url: string) {
    return this.chain(addGitRepositoryWebUrl(url));
  }

  /** Removes a web browsing URL. */
  removeWebUrl(url: string) {
    return this.chain(removeGitRepositoryWebUrl(url));
  }

  /** Replaces all git clone URLs. */
  setCloneUrls(urls: string[]) {
    return this.chain(setGitRepositoryCloneUrls(urls));
  }

  /** Appends a git clone URL. */
  addClone(url: string) {
    return this.chain(addGitRepositoryCloneUrl(url));
  }

  /** Removes a git clone URL. */
  removeClone(url: string) {
    return this.chain(removeGitRepositoryCloneUrl(url));
  }

  /** Replaces all relay URLs (normalized). */
  setRelays(relays: string[]) {
    return this.chain(setGitRepositoryRelays(relays));
  }

  /** Appends a relay URL. */
  addRelay(url: string) {
    return this.chain(addGitRepositoryRelay(url));
  }

  /** Removes a relay URL. */
  removeRelay(url: string) {
    return this.chain(removeGitRepositoryRelay(url));
  }

  /** Sets or clears the earliest unique commit (`r` … `euc` tag). */
  earliestUniqueCommit(commit: string | null) {
    return this.chain(setGitRepositoryEarliestUniqueCommit(commit));
  }

  /** Replaces all maintainer pubkeys. */
  setMaintainers(pubkeys: string[]) {
    return this.chain(setGitRepositoryMaintainers(pubkeys));
  }

  /** Appends a maintainer pubkey. */
  maintainer(pubkey: string) {
    return this.chain(addGitRepositoryMaintainer(pubkey));
  }

  /** Removes a maintainer pubkey. */
  removeMaintainer(pubkey: string) {
    return this.chain(removeGitRepositoryMaintainer(pubkey));
  }

  /** Replaces subject hashtags. */
  setHashtags(hashtags: string[]) {
    return this.chain(setGitRepositoryHashtags(hashtags));
  }

  /** Appends a subject hashtag (`t` tag). */
  hashtag(hashtag: string) {
    return this.chain(addGitRepositoryHashtag(hashtag));
  }

  /** Removes a subject hashtag. */
  removeHashtag(hashtag: string) {
    return this.chain(removeGitRepositoryHashtag(hashtag));
  }

  /** Sets or clears the upstream repository pointer (the repo this one was forked from). */
  upstream(pointer: GitRepositoryPointer | null) {
    return this.chain(setGitRepositoryUpstream(pointer));
  }
}
