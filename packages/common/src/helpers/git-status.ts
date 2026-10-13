import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { isHexKey } from "applesauce-core/helpers/string";
import { isGitCommitId } from "./git.js";

/** The NIP-34 open status event kind */
export const GIT_STATUS_OPEN_KIND = 1630;
/** The NIP-34 applied status event kind */
export const GIT_STATUS_APPLIED_KIND = 1631;
/** The NIP-34 closed status event kind */
export const GIT_STATUS_CLOSED_KIND = 1632;
/** The NIP-34 draft status event kind */
export const GIT_STATUS_DRAFT_KIND = 1633;

/** All NIP-34 status event kinds */
export const GIT_STATUS_KINDS = [
  GIT_STATUS_OPEN_KIND,
  GIT_STATUS_APPLIED_KIND,
  GIT_STATUS_CLOSED_KIND,
  GIT_STATUS_DRAFT_KIND,
];

/** The status of a NIP-34 issue, patch or pull request. "applied" means merged for patches and resolved for issues */
export type GitStatus = "open" | "applied" | "closed" | "draft";

/** The event kinds used for NIP-34 statuses */
export type GitStatusKind =
  | typeof GIT_STATUS_OPEN_KIND
  | typeof GIT_STATUS_APPLIED_KIND
  | typeof GIT_STATUS_CLOSED_KIND
  | typeof GIT_STATUS_DRAFT_KIND;

/** A validated NIP-34 status event */
export type GitStatusEvent = KnownEvent<GitStatusKind>;

/** Map of status types to event kinds */
export const GIT_STATUS_KIND_MAP: Record<GitStatus, GitStatusKind> = {
  open: GIT_STATUS_OPEN_KIND,
  applied: GIT_STATUS_APPLIED_KIND,
  closed: GIT_STATUS_CLOSED_KIND,
  draft: GIT_STATUS_DRAFT_KIND,
};

/** Checks if an event is a valid NIP-34 status event with a root `e` tag */
export function isValidGitStatus(event?: NostrEvent): event is GitStatusEvent {
  return !!event && GIT_STATUS_KINDS.includes(event.kind) && !!getGitStatusRootId(event);
}

/** Returns the status type of a status event */
export function getGitStatusType(event: GitStatusEvent): GitStatus;
export function getGitStatusType(event: NostrEvent): GitStatus | undefined;
export function getGitStatusType(event: NostrEvent): GitStatus | undefined {
  switch (event.kind) {
    case GIT_STATUS_OPEN_KIND:
      return "open";
    case GIT_STATUS_APPLIED_KIND:
      return "applied";
    case GIT_STATUS_CLOSED_KIND:
      return "closed";
    case GIT_STATUS_DRAFT_KIND:
      return "draft";
    default:
      return undefined;
  }
}

/** Returns the id of the issue, pull request or root patch a status event applies to */
export function getGitStatusRootId(event: NostrEvent): string | undefined {
  const tag = event.tags.find((t) => t[0] === "e" && t[3] === "root") ?? event.tags.find((t) => t[0] === "e" && !t[3]);
  return tag?.[1] && isHexKey(tag[1]) ? tag[1] : undefined;
}

/** Returns the ids of the patches applied or merged by a status event from the `q` tags */
export function getGitStatusAppliedPatchIds(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "q" && t[1] && isHexKey(t[1])).map((t) => t[1]);
}

/** Returns the merge commit id from the `merge-commit` tag */
export function getGitStatusMergeCommit(event: NostrEvent): string | undefined {
  return event.tags.find((t) => t[0] === "merge-commit")?.[1] || undefined;
}

/**
 * Returns the latest status event from the root author or a maintainer
 * @param maintainers Pubkeys allowed to set the status in addition to the root author
 */
export function getGitCurrentStatusEvent(
  root: NostrEvent,
  statuses: NostrEvent[],
  maintainers: string[] = [],
): GitStatusEvent | undefined {
  let latest: GitStatusEvent | undefined;
  for (const status of statuses) {
    if (!isValidGitStatus(status) || getGitStatusRootId(status) !== root.id) continue;
    if (status.pubkey !== root.pubkey && !maintainers.includes(status.pubkey)) continue;
    if (
      !latest ||
      status.created_at > latest.created_at ||
      (status.created_at === latest.created_at && status.id < latest.id)
    )
      latest = status;
  }
  return latest;
}

/**
 * Returns the current status of an issue, patch or pull request, defaulting to "open"
 * @param maintainers Pubkeys allowed to set the status in addition to the root author
 */
export function getGitCurrentStatus(root: NostrEvent, statuses: NostrEvent[], maintainers: string[] = []): GitStatus {
  const latest = getGitCurrentStatusEvent(root, statuses, maintainers);
  return latest ? getGitStatusType(latest) : "open";
}

/** Returns the accepted revision root id from the marked reply tag */
export function getGitStatusAcceptedRevisionId(event: NostrEvent): string | undefined {
  const id = event.tags.find((t) => t[0] === "e" && t[3] === "reply")?.[1];
  return id && isHexKey(id) ? id : undefined;
}

/** Returns the commits produced by applying the patches */
export function getGitStatusAppliedCommits(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === "applied-as-commits")
    .flatMap((t) => t.slice(1))
    .filter(isGitCommitId);
}
