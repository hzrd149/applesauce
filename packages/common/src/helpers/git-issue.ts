import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { getGitRepositoryReference } from "./git-repository.js";

/** The NIP-34 issue event kind */
export const GIT_ISSUE_KIND = 1621;

/** A validated NIP-34 issue event */
export type GitIssueEvent = KnownEvent<typeof GIT_ISSUE_KIND>;

/** The cache key for issue labels */
export const GitIssueLabelsSymbol = Symbol.for("git-issue-labels");

/** Checks if an event is a valid NIP-34 issue that references a repository */
export function isValidGitIssue(event?: NostrEvent): event is GitIssueEvent {
  return !!event && event.kind === GIT_ISSUE_KIND && !!getGitRepositoryReference(event);
}

/** Returns the issue subject from the `subject` tag */
export function getGitIssueSubject(event: NostrEvent): string | undefined {
  return getTagValue(event, "subject") || undefined;
}

/** Returns the issue labels from the `t` tags */
export function getGitIssueLabels(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, GitIssueLabelsSymbol, () =>
    event.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]),
  );
}
