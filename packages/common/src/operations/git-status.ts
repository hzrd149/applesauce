import { EventOperation } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { isHexKey } from "applesauce-core/helpers/string";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { isValidGitIssue } from "../helpers/git-issue.js";
import { isGitPatchRoot, isGitPatchRootRevision, isValidGitPatch } from "../helpers/git-patch.js";
import { isValidGitPullRequest } from "../helpers/git-pull-request.js";
import { getGitRepositoryReference } from "../helpers/git-repository.js";
import { isGitCommitId } from "../helpers/git.js";
import { createGitRepositoryTags } from "./git-thread.js";
import { replaceGitCommitReferences } from "./internal/git-commits.js";

/**
 * Sets the original root and removes tags belonging to a replaced target
 * @throws if the target is not an issue, pull request or original root patch
 */
export function setGitStatusRoot(root: NostrEvent, relay = ""): EventOperation {
  if (
    !(
      isValidGitIssue(root) ||
      isValidGitPullRequest(root) ||
      (isValidGitPatch(root) && isGitPatchRoot(root) && !isGitPatchRootRevision(root))
    ) ||
    !isHexKey(root.id) ||
    !isHexKey(root.pubkey)
  )
    throw new Error("Expected an issue, pull request or original root patch");
  return modifyPublicTags((tags) => {
    const oldRoot = tags.find((t) => t[0] === "e" && t[3] === "root");
    const changed = !!oldRoot && oldRoot[1] !== root.id;
    const oldOwner = getGitRepositoryReference({ tags } as NostrEvent)?.pubkey;
    const oldAuthor = oldRoot?.[4];
    const oldRevisionAuthor = tags.find((t) => t[0] === "e" && t[3] === "reply")?.[4];
    const scoped = ["q", "merge-commit", "applied-as-commits"];
    const next = tags.filter(
      (t) =>
        t[0] !== "a" &&
        t[0] !== "r" &&
        !(t[0] === "e" && (t[3] === "root" || (changed && t[3] === "reply"))) &&
        !(
          changed &&
          (scoped.includes(t[0]) || (t[0] === "p" && [oldOwner, oldAuthor, oldRevisionAuthor].includes(t[1])))
        ),
    );
    // The fifth field preserves the generated author when the target is replaced later.
    next.push(["e", root.id, relay, "root", root.pubkey]);
    const repo = getGitRepositoryReference(root)!;
    for (const tag of createGitRepositoryTags(repo)) if (tag[0] !== "p") next.push(tag);
    const patchCommit = root.tags.find((t) => t[0] === "commit")?.[1];
    const euc = root.tags.find(
      (t) =>
        t[0] === "r" &&
        (t[1] !== patchCommit || root.tags.filter((r) => r[0] === "r" && r[1] === patchCommit).length > 1),
    )?.[1];
    if (euc) next.push(["r", euc]);
    for (const pubkey of new Set([root.pubkey, repo.pubkey]))
      if (!next.some((t) => t[0] === "p" && t[1] === pubkey)) next.push(["p", pubkey]);
    for (const commit of next.filter((t) => scoped.slice(1).includes(t[0])).flatMap((t) => t.slice(1)))
      next.push(["r", commit]);
    return next;
  });
}

/**
 * Replaces the applied patch references, retaining relay and author hints
 * @throws if a patch id is invalid
 */
export function setGitStatusAppliedPatches(patches: (string | EventPointer)[]): EventOperation {
  if (patches.some((patch) => !isHexKey(typeof patch === "string" ? patch : patch.id)))
    throw new Error("Invalid patch id");
  return modifyPublicTags((tags) => [
    ...tags.filter((t) => t[0] !== "q"),
    ...patches.map((patch) =>
      typeof patch === "string"
        ? ["q", patch]
        : ["q", patch.id, patch.relays?.[0] || "", ...(patch.author ? [patch.author] : [])],
    ),
  ]);
}

/**
 * Sets or removes the accepted revision root and tags its author
 * @throws if the event is not a revision root patch
 */
export function setGitStatusAcceptedRevision(revision: NostrEvent | null, relay = ""): EventOperation {
  if (
    revision &&
    (!isValidGitPatch(revision) ||
      !isGitPatchRootRevision(revision) ||
      !isHexKey(revision.id) ||
      !isHexKey(revision.pubkey))
  )
    throw new Error("Expected a revision root patch");
  return modifyPublicTags((tags) => {
    const root = tags.find((t) => t[0] === "e" && t[3] === "root");
    const previous = revision?.tags.find((t) => t[0] === "e" && t[3] === "reply")?.[1];
    if (revision && (!root || previous !== root[1])) throw new Error("Revision must reference the status root");
    const oldAuthor = tags.find((t) => t[0] === "e" && t[3] === "reply")?.[4];
    const repository = getGitRepositoryReference({ tags } as NostrEvent);
    const revisionRepository = revision && getGitRepositoryReference(revision);
    if (
      revision &&
      (repository?.pubkey !== revisionRepository?.pubkey || repository?.identifier !== revisionRepository?.identifier)
    )
      throw new Error("Revision must belong to the status repository");
    const owner = repository?.pubkey;
    const next = tags.filter(
      (t) =>
        !(t[0] === "e" && t[3] === "reply") &&
        !(t[0] === "p" && t[1] === oldAuthor && t[1] !== root?.[4] && t[1] !== owner),
    );
    if (revision) {
      next.push(["e", revision.id, relay, "reply", revision.pubkey]);
      if (!next.some((t) => t[0] === "p" && t[1] === revision.pubkey)) next.push(["p", revision.pubkey]);
    }
    return next;
  });
}

/**
 * Sets or removes the merge commit and its discovery tag
 * @throws if the commit is not a Git object id
 */
export function setGitStatusMergeCommit(commit: string | null): EventOperation {
  if (commit !== null && !isGitCommitId(commit)) throw new Error("Invalid Git commit id");
  return modifyPublicTags((tags) => replaceGitCommitReferences(tags, "merge-commit", commit ? [commit] : []));
}

/**
 * Replaces the applied commit ids and their discovery tags
 * @throws if a commit is not a Git object id
 */
export function setGitStatusAppliedCommits(commits: string[]): EventOperation {
  if (commits.some((commit) => !isGitCommitId(commit))) throw new Error("Invalid Git commit id");
  return modifyPublicTags((tags) => replaceGitCommitReferences(tags, "applied-as-commits", commits));
}
