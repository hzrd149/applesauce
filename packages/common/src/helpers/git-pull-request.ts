import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { isHexKey } from "applesauce-core/helpers/string";
import { EventPointer, getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { isGitCommitId } from "./git.js";
import { getGitRepositoryReference } from "./git-repository.js";

/** The NIP-34 pull request event kind */
export const GIT_PULL_REQUEST_KIND = 1618;
/** The NIP-34 pull request update event kind */
export const GIT_PULL_REQUEST_UPDATE_KIND = 1619;

/** A validated NIP-34 pull request event */
export type GitPullRequestEvent = KnownEvent<typeof GIT_PULL_REQUEST_KIND>;
/** A validated NIP-34 pull request update event */
export type GitPullRequestUpdateEvent = KnownEvent<typeof GIT_PULL_REQUEST_UPDATE_KIND>;

/** The cache key for pull request labels */
export const GitPullRequestLabelsSymbol = Symbol.for("git-pull-request-labels");
/** The cache key for pull request clone URLs */
export const GitPullRequestCloneUrlsSymbol = Symbol.for("git-pull-request-clone-urls");

function getCloneUrls(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, GitPullRequestCloneUrlsSymbol, () =>
    event.tags
      .filter((t) => t[0] === "clone")
      .flatMap((t) => t.slice(1))
      .filter((url) => !!url.trim()),
  );
}

/** Checks if an event is a valid NIP-34 pull request that references a repository */
export function isValidGitPullRequest(event?: NostrEvent): event is GitPullRequestEvent {
  return (
    !!event &&
    event.kind === GIT_PULL_REQUEST_KIND &&
    !!getGitRepositoryReference(event) &&
    isGitCommitId(getGitPullRequestTipCommit(event)) &&
    getCloneUrls(event).length > 0 &&
    (!getTagValue(event, "merge-base") || isGitCommitId(getTagValue(event, "merge-base")))
  );
}

/** Returns the pull request subject from the `subject` tag */
export function getGitPullRequestSubject(event: NostrEvent): string | undefined {
  return getTagValue(event, "subject") || undefined;
}

/** Returns the pull request labels from the `t` tags */
export function getGitPullRequestLabels(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, GitPullRequestLabelsSymbol, () =>
    event.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]),
  );
}

/** Returns the commit id of the pull request branch tip from the `c` tag */
export function getGitPullRequestTipCommit(event: NostrEvent): string | undefined {
  return getTagValue(event, "c") || undefined;
}

/** Returns the clone URLs where the pull request commits can be fetched */
export function getGitPullRequestCloneUrls(event: NostrEvent): string[] {
  return getCloneUrls(event);
}

/** Returns the recommended branch name from the `branch-name` tag */
export function getGitPullRequestBranchName(event: NostrEvent): string | undefined {
  return getTagValue(event, "branch-name") || undefined;
}

/** Returns the most recent common ancestor with the target branch from the `merge-base` tag */
export function getGitPullRequestMergeBase(event: NostrEvent): string | undefined {
  return getTagValue(event, "merge-base") || undefined;
}

/** Checks if an event is a valid NIP-34 pull request update that points to a pull request */
export function isValidGitPullRequestUpdate(event?: NostrEvent): event is GitPullRequestUpdateEvent {
  return (
    !!event &&
    event.kind === GIT_PULL_REQUEST_UPDATE_KIND &&
    !!getGitPullRequestUpdateTarget(event) &&
    !!getGitPullRequestUpdateAuthor(event) &&
    isGitCommitId(getGitPullRequestUpdateTipCommit(event)) &&
    getCloneUrls(event).length > 0 &&
    (!getTagValue(event, "merge-base") || isGitCommitId(getTagValue(event, "merge-base")))
  );
}

/** Returns the id of the pull request an update targets from the `E` tag */
export function getGitPullRequestUpdateTarget(event: NostrEvent): string | undefined {
  const id = getTagValue(event, "E");
  return id && isHexKey(id) ? id : undefined;
}

/** Returns the author of the pull request targeted by an update */
export function getGitPullRequestUpdateAuthor(event: NostrEvent): string | undefined {
  const pubkey = getTagValue(event, "P");
  return pubkey && isHexKey(pubkey) ? pubkey : undefined;
}

/** Returns the original patch a pull request revises */
export function getGitPullRequestPatchId(event: NostrEvent): string | undefined {
  const id = getTagValue(event, "e");
  return id && isHexKey(id) ? id : undefined;
}

/** The fetch state of a pull request or its latest valid update */
export interface GitPullRequestState {
  /** The event supplying this state */
  event: GitPullRequestEvent | GitPullRequestUpdateEvent;
  /** The proposed branch tip commit */
  tipCommit: string;
  /** The clone URLs containing the proposed commit */
  cloneUrls: string[];
  /** The common ancestor with the target branch, when declared */
  mergeBase?: string;
}

/** Returns a coherent fetch state from a validated pull request or update */
export function getGitPullRequestState(event: GitPullRequestEvent | GitPullRequestUpdateEvent): GitPullRequestState {
  return {
    event,
    tipCommit: getTagValue(event, "c")!,
    cloneUrls: getCloneUrls(event),
    mergeBase: getGitPullRequestMergeBase(event),
  };
}

/** Returns the updated branch tip commit id from the `c` tag */
export function getGitPullRequestUpdateTipCommit(event: NostrEvent): string | undefined {
  return getTagValue(event, "c") || undefined;
}

/** Returns the updated clone URLs of a pull request update */
export function getGitPullRequestUpdateCloneUrls(event: NostrEvent): string[] {
  return getCloneUrls(event);
}

/** Returns the target pull request pointer with its relay and author hints */
export function getGitPullRequestUpdatePointer(event: NostrEvent): EventPointer | undefined {
  const tag = event.tags.find((t) => t[0] === "E");
  const pointer = tag && getEventPointerFromETag(tag);
  if (!pointer) return undefined;
  const author = getGitPullRequestUpdateAuthor(event);
  if (author) pointer.author = author;
  return pointer;
}

/** Returns the original patch pointer with its relay hint */
export function getGitPullRequestPatchPointer(event: NostrEvent): EventPointer | undefined {
  const tag = event.tags.find((t) => t[0] === "e");
  return (tag && getEventPointerFromETag(tag)) || undefined;
}
