import { EventOperation } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { isHexKey } from "applesauce-core/helpers/string";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { removeSingletonTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { GitPatchCommitter } from "../helpers/git-patch.js";
import { isGitCommitId } from "../helpers/git.js";
import { replaceGitCommitReferences } from "./internal/git-commits.js";

/** Sets the patch series marker, preserving ordinary labels */
export function setGitPatchRoot(type: "root" | "root-revision" | null): EventOperation {
  return modifyPublicTags((tags) => [
    ...tags.filter((t) => !(t[0] === "t" && ["root", "root-revision"].includes(t[1]))),
    ...(type ? [["t", type]] : []),
  ]);
}

/** Replaces patch labels while preserving series markers */
export function setGitPatchLabels(labels: string[]): EventOperation {
  return modifyPublicTags((tags) => [
    ...tags.filter((t) => t[0] !== "t" || ["root", "root-revision"].includes(t[1])),
    ...[...new Set(labels)].filter((label) => !["root", "root-revision"].includes(label)).map((label) => ["t", label]),
  ]);
}

/**
 * Sets or removes the previous patch or original root reference
 * @throws if the pointer has an invalid event id
 */
export function setGitPatchPrevious(patch: NostrEvent | EventPointer | null): EventOperation {
  if (patch && !isHexKey(patch.id)) throw new Error("Invalid patch id");
  const relay = patch && "relays" in patch ? patch.relays?.[0] : "";
  const author = patch && "pubkey" in patch ? patch.pubkey : patch?.author;
  return modifyPublicTags((tags) => [
    ...tags.filter((t) => !(t[0] === "e" && t[3] === "reply")),
    ...(patch ? [["e", patch.id, relay || "", "reply", ...(author ? [author] : [])]] : []),
  ]);
}

/**
 * Sets or removes the patch commit and its matching discovery tag
 * @throws if the commit is not a Git object id
 */
export function setGitPatchCommit(commit: string | null): EventOperation {
  if (commit !== null && !isGitCommitId(commit)) throw new Error("Invalid Git commit id");
  return modifyPublicTags((tags) => replaceGitCommitReferences(tags, "commit", commit ? [commit] : []));
}

/**
 * Sets or removes the parent commit
 * @throws if the commit is not a Git object id
 */
export function setGitPatchParentCommit(commit: string | null): EventOperation {
  if (commit !== null && !isGitCommitId(commit)) throw new Error("Invalid Git commit id");
  return modifyPublicTags(
    commit === null ? removeSingletonTag("parent-commit") : setSingletonTag(["parent-commit", commit]),
  );
}

/** Sets or removes the commit signature, retaining an empty string for unsigned commits */
export function setGitPatchCommitSignature(signature: string | null): EventOperation {
  return modifyPublicTags(
    signature === null ? removeSingletonTag("commit-pgp-sig") : setSingletonTag(["commit-pgp-sig", signature]),
  );
}

/**
 * Sets or removes reproducible committer metadata
 * @throws if the timestamp or timezone is invalid
 */
export function setGitPatchCommitter(committer: GitPatchCommitter | null): EventOperation {
  if (
    committer &&
    (!Number.isSafeInteger(committer.timestamp) ||
      committer.timestamp < 0 ||
      !Number.isInteger(committer.timezoneOffset))
  )
    throw new Error("Invalid committer timestamp or timezone");
  return modifyPublicTags(
    committer === null
      ? removeSingletonTag("committer")
      : setSingletonTag([
          "committer",
          committer.name,
          committer.email,
          String(committer.timestamp),
          String(committer.timezoneOffset),
        ]),
  );
}
