import { EventOperation } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { removeSingletonTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { GitRepositoryPointer } from "../helpers/git-repository.js";
import { setGitThreadRepository } from "./git-thread.js";

/** Returns the `a`, `p` and `r` tags that link an event to a repository */
export { createGitRepositoryTags } from "./git-thread.js";

/**
 * Sets the repository an issue belongs to
 * @throws if the event or pointer is not a valid repository
 */
export function setGitIssueRepository(repo: GitRepositoryPointer | NostrEvent): EventOperation {
  return setGitThreadRepository(repo);
}

/** Sets or removes the issue subject */
export function setGitIssueSubject(subject: string | null): EventOperation {
  return modifyPublicTags(subject === null ? removeSingletonTag("subject") : setSingletonTag(["subject", subject]));
}

/** Adds a label `t` tag */
export function addGitIssueLabel(label: string): EventOperation {
  return modifyPublicTags((tags) => [...tags.filter((t) => !(t[0] === "t" && t[1] === label)), ["t", label]]);
}

/** Removes a label `t` tag */
export function removeGitIssueLabel(label: string): EventOperation {
  return modifyPublicTags((tags) => tags.filter((t) => !(t[0] === "t" && t[1] === label)));
}

/** Replaces all label `t` tags */
export function setGitIssueLabels(labels: string[]): EventOperation {
  return modifyPublicTags((tags) => [
    ...tags.filter((t) => t[0] !== "t"),
    ...[...new Set(labels)].map((label) => ["t", label]),
  ]);
}
