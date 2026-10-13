import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { GIT_PATCH_KIND, GitPatchCommitter, isGitPatchRoot, isValidGitPatch } from "../helpers/git-patch.js";
import { GitRepositoryPointer, getGitRepositoryReference } from "../helpers/git-repository.js";
import {
  setGitPatchRoot,
  setGitPatchPrevious,
  setGitPatchLabels,
  setGitPatchCommit,
  setGitPatchParentCommit,
  setGitPatchCommitSignature,
  setGitPatchCommitter,
} from "../operations/git-patch.js";
import { GitThreadFactory } from "./internal/git-thread.js";

/** An event template for a NIP-34 patch */
export type GitPatchTemplate = KnownEventTemplate<typeof GIT_PATCH_KIND>;

/** A factory for NIP-34 patches (kind 1617) */
export class GitPatchFactory extends GitThreadFactory<typeof GIT_PATCH_KIND> {
  /**
   * Creates the first patch or cover letter of a new series
   * @throws if the repository is invalid
   */
  static create(repo: GitRepositoryPointer | NostrEvent, content: string): GitPatchFactory {
    return new GitPatchFactory((res) => res(blankEventTemplate(GIT_PATCH_KIND)))
      .repository(repo)
      .content(content)
      .root();
  }
  /**
   * Creates the next patch in a series
   * @throws if the previous event is not a valid patch
   */
  static next(previous: NostrEvent, content: string): GitPatchFactory {
    if (!isValidGitPatch(previous)) throw new Error("Expected a valid patch");
    return GitPatchFactory.create(getGitRepositoryReference(previous)!, content)
      .seriesMarker(null)
      .previous(previous)
      .copyRepositoryCommit(previous);
  }
  /**
   * Creates the first patch of a revision linked to the original root
   * @throws if the original event is not an original root patch
   */
  static revision(original: NostrEvent, content: string): GitPatchFactory {
    if (
      !isValidGitPatch(original) ||
      !isGitPatchRoot(original) ||
      original.tags.some((t) => t[0] === "t" && t[1] === "root-revision")
    )
      throw new Error("Expected an original root patch");
    return GitPatchFactory.create(getGitRepositoryReference(original)!, content)
      .seriesMarker("root-revision")
      .previous(original)
      .copyRepositoryCommit(original);
  }
  /**
   * Creates a factory for modifying a patch draft
   * @throws if the event is not a valid patch
   */
  static modify(event: NostrEvent): GitPatchFactory {
    if (!isValidGitPatch(event)) throw new Error("Expected a valid patch");
    return new GitPatchFactory((res) => res(toEventTemplate(event)));
  }
  private copyRepositoryCommit(source: NostrEvent) {
    const commit = source.tags.find((t) => t[0] === "commit")?.[1];
    const euc = source.tags.find(
      (t) => t[0] === "r" && (t[1] !== commit || source.tags.filter((r) => r[0] === "r" && r[1] === commit).length > 1),
    )?.[1];
    return euc ? this.modifyPublicTags((tags) => [...tags, ["r", euc]]) : this;
  }
  /** Marks this as the first patch of a new series */
  root() {
    return this.seriesMarker("root").previous(null);
  }
  /** Sets or removes the series marker */
  seriesMarker(type: "root" | "root-revision" | null) {
    return this.chain(setGitPatchRoot(type));
  }
  /**
   * Sets or removes the previous patch or original root
   * @throws if the pointer has an invalid event id
   */
  previous(patch: NostrEvent | EventPointer | null) {
    return this.chain(setGitPatchPrevious(patch));
  }
  /** Replaces labels while preserving series markers */
  labels(labels: string[]) {
    return this.chain(setGitPatchLabels(labels));
  }
  /**
   * Sets or removes the commit id
   * @throws if the commit is not a Git object id
   */
  commit(commit: string | null) {
    return this.chain(setGitPatchCommit(commit));
  }
  /**
   * Sets or removes the parent commit
   * @throws if the commit is not a Git object id
   */
  parentCommit(commit: string | null) {
    return this.chain(setGitPatchParentCommit(commit));
  }
  /** Sets or removes the commit signature */
  commitSignature(signature: string | null) {
    return this.chain(setGitPatchCommitSignature(signature));
  }
  /**
   * Sets or removes committer metadata
   * @throws if the timestamp or timezone is invalid
   */
  committer(committer: GitPatchCommitter | null) {
    return this.chain(setGitPatchCommitter(committer));
  }
}
