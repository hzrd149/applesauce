import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer, getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { isHexKey } from "applesauce-core/helpers/string";
import { getGitRepositoryReference } from "./git-repository.js";

/** The NIP-34 patch event kind */
export const GIT_PATCH_KIND = 1617;

/** A validated NIP-34 patch event */
export type GitPatchEvent = KnownEvent<typeof GIT_PATCH_KIND>;

/** The cache key for patch subjects */
export const GitPatchSubjectSymbol = Symbol.for("git-patch-subject");
/** The cache key for patch labels */
export const GitPatchLabelsSymbol = Symbol.for("git-patch-labels");

/** Checks if an event is a valid NIP-34 patch that references a repository */
export function isValidGitPatch(event?: NostrEvent): event is GitPatchEvent {
  return !!event && event.kind === GIT_PATCH_KIND && !!getGitRepositoryReference(event);
}

/** Checks if a patch is the first patch in a series or revision */
export function isGitPatchRoot(event: NostrEvent): boolean {
  return event.tags.some((t) => t[0] === "t" && (t[1] === "root" || t[1] === "root-revision"));
}

/** Checks if a patch is the first patch of a revision to an earlier patch series */
export function isGitPatchRootRevision(event: NostrEvent): boolean {
  return event.tags.some((t) => t[0] === "t" && t[1] === "root-revision");
}

/** Returns the patch subject from the `Subject:` header of the `git format-patch` content */
export function getGitPatchSubject(event: NostrEvent): string | undefined {
  return getOrComputeCachedValue(event, GitPatchSubjectSymbol, () => {
    // Subject headers can be folded onto multiple lines that start with whitespace
    const match = event.content.match(/^Subject:[ \t]*((?:.*)(?:\r?\n[ \t]+.*)*)/m);
    if (!match) return undefined;
    const subject = match[1]
      .replace(/\r?\n[ \t]+/g, " ")
      .replace(/^\[[^\]]*\]\s*/, "")
      .trim();
    return subject || undefined;
  });
}

/** Returns the patch labels from the `t` tags, excluding the `root` and `root-revision` markers */
export function getGitPatchLabels(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, GitPatchLabelsSymbol, () =>
    event.tags.filter((t) => t[0] === "t" && t[1] && t[1] !== "root" && t[1] !== "root-revision").map((t) => t[1]),
  );
}

/** Returns the commit id of the patch from the `commit` tag */
export function getGitPatchCommit(event: NostrEvent): string | undefined {
  return getTagValue(event, "commit") || undefined;
}

/** Returns the parent commit id of the patch from the `parent-commit` tag */
export function getGitPatchParentCommit(event: NostrEvent): string | undefined {
  return getTagValue(event, "parent-commit") || undefined;
}

/** Returns the previous patch, or the original root for the first patch of a revision */
export function getGitPatchPreviousPointer(event: NostrEvent): EventPointer | undefined {
  const tag = event.tags.find((t) => t[0] === "e" && t[3] === "reply");
  const pointer = tag && getEventPointerFromETag(tag);
  if (!tag || !pointer) return undefined;
  if (tag[4] && isHexKey(tag[4])) pointer.author = tag[4];
  return pointer;
}

/** Returns the commit signature, including an empty string for unsigned commits */
export function getGitPatchCommitSignature(event: NostrEvent): string | undefined {
  return getTagValue(event, "commit-pgp-sig");
}

/** The committer metadata needed to reproduce a patch commit */
export interface GitPatchCommitter {
  /** The committer name */
  name: string;
  /** The committer email */
  email: string;
  /** The commit timestamp in seconds */
  timestamp: number;
  /** The timezone offset in minutes */
  timezoneOffset: number;
}

/** Returns the committer metadata when its timestamp and timezone are valid */
export function getGitPatchCommitter(event: NostrEvent): GitPatchCommitter | undefined {
  const tag = event.tags.find((t) => t[0] === "committer");
  if (!tag || tag.length < 5 || !tag[3] || !tag[4]) return undefined;
  const timestamp = Number(tag[3]),
    timezoneOffset = Number(tag[4]);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 && Number.isInteger(timezoneOffset)
    ? { name: tag[1], email: tag[2], timestamp, timezoneOffset }
    : undefined;
}
