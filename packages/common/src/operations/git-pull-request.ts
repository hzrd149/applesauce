import { EventOperation } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { isHexKey } from "applesauce-core/helpers/string";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { removeSingletonTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { isGitCommitId } from "../helpers/git.js";
import { isGitPatchRoot, isValidGitPatch } from "../helpers/git-patch.js";
import { isValidGitPullRequest } from "../helpers/git-pull-request.js";
import { getGitRepositoryReference } from "../helpers/git-repository.js";
import { setGitThreadRepository } from "./git-thread.js";

/**
 * Sets the branch tip commit of a pull request or update
 * @throws if the commit is not a Git object id
 */
export function setGitPullRequestTipCommit(commit: string): EventOperation {
  if (!isGitCommitId(commit)) throw new Error("Invalid Git commit id");
  return modifyPublicTags(setSingletonTag(["c", commit]));
}

/**
 * Replaces the clone URLs of a pull request or update
 * @throws if there are no nonempty clone URLs
 */
export function setGitPullRequestCloneUrls(urls: string[]): EventOperation {
  if (!urls.length || urls.some((url) => !url.trim())) throw new Error("Expected at least one clone URL");
  return modifyPublicTags((tags) => [...tags.filter((t) => t[0] !== "clone"), ["clone", ...new Set(urls)]]);
}

/** Sets or removes the recommended branch name */
export function setGitPullRequestBranchName(name: string | null): EventOperation {
  return modifyPublicTags(name === null ? removeSingletonTag("branch-name") : setSingletonTag(["branch-name", name]));
}

/**
 * Sets or removes the common ancestor with the target branch
 * @throws if the commit is not a Git object id
 */
export function setGitPullRequestMergeBase(commit: string | null): EventOperation {
  if (commit !== null && !isGitCommitId(commit)) throw new Error("Invalid Git commit id");
  return modifyPublicTags(commit === null ? removeSingletonTag("merge-base") : setSingletonTag(["merge-base", commit]));
}

/**
 * Sets or removes the original patch revised by a pull request
 * @throws if the target is not a root patch or its id is invalid
 */
export function setGitPullRequestPatch(patch: NostrEvent | string | null): EventOperation {
  if (patch !== null && typeof patch !== "string" && (!isValidGitPatch(patch) || !isGitPatchRoot(patch)))
    throw new Error("Expected a root patch");
  const id = typeof patch === "string" ? patch : patch?.id;
  if (id !== undefined && !isHexKey(id)) throw new Error("Invalid patch id");
  return modifyPublicTags(id === undefined ? removeSingletonTag("e") : setSingletonTag(["e", id]));
}

/**
 * Sets the pull request targeted by an update and copies its repository tags
 * @throws if the target is not a valid pull request
 */
export function setGitPullRequestUpdateTarget(pr: NostrEvent, relay = ""): EventOperation {
  if (!isValidGitPullRequest(pr) || !isHexKey(pr.id) || !isHexKey(pr.pubkey))
    throw new Error("Expected a valid pull request");
  const repo = getGitRepositoryReference(pr)!;
  const repository = setGitThreadRepository(repo);
  return async (draft) => {
    const next = await repository(draft);
    return modifyPublicTags((tags) => {
      const oldAuthor = tags.find((t) => t[0] === "P")?.[1];
      const result = tags.filter(
        (t) =>
          t[0] !== "E" && t[0] !== "P" && t[0] !== "r" && !(t[0] === "p" && t[1] === oldAuthor && t[1] !== repo.pubkey),
      );
      const euc = pr.tags.find((t) => t[0] === "r")?.[1];
      if (euc) result.push(["r", euc]);
      if (!result.some((t) => t[0] === "p" && t[1] === pr.pubkey)) result.push(["p", pr.pubkey]);
      return [...result, ["E", pr.id, relay], ["P", pr.pubkey]];
    })(next);
  };
}
