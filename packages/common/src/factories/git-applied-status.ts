import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { GIT_STATUS_APPLIED_KIND, isValidGitStatus } from "../helpers/git-status.js";
import { GitStatusTargetFactory } from "./internal/git-status.js";
import { EventPointer } from "applesauce-core/helpers/pointers";
import {
  setGitStatusAcceptedRevision,
  setGitStatusAppliedPatches,
  setGitStatusAppliedCommits,
  setGitStatusMergeCommit,
} from "../operations/git-status.js";

/** An event template for a NIP-34 applied status */
export type GitAppliedStatusTemplate = KnownEventTemplate<typeof GIT_STATUS_APPLIED_KIND>;

/** A factory for NIP-34 applied statuses (kind 1631) */
export class GitAppliedStatusFactory extends GitStatusTargetFactory<typeof GIT_STATUS_APPLIED_KIND> {
  /**
   * Creates a applied status for an original thread root
   * @throws if the target is not a supported original root
   */
  static create(root: NostrEvent, content = ""): GitAppliedStatusFactory {
    return new GitAppliedStatusFactory((res) => res(blankEventTemplate(GIT_STATUS_APPLIED_KIND)))
      .root(root)
      .content(content);
  }
  /**
   * Creates a factory for modifying a applied status draft
   * @throws if the event is not a valid applied status
   */
  static modify(event: NostrEvent): GitAppliedStatusFactory {
    if (!isValidGitStatus(event) || event.kind !== GIT_STATUS_APPLIED_KIND)
      throw new Error("Expected a applied status");
    return new GitAppliedStatusFactory((res) => res(toEventTemplate({ ...event, kind: GIT_STATUS_APPLIED_KIND })));
  }
  /**
   * Sets or removes the accepted revision
   * @throws if the patch is not a revision of this status root
   */
  acceptedRevision(revision: NostrEvent | null, relay?: string) {
    return this.chain(setGitStatusAcceptedRevision(revision, relay));
  }
  /**
   * Replaces the applied patch references
   * @throws if a patch id is invalid
   */
  appliedPatches(patches: (string | EventPointer)[]) {
    return this.chain(setGitStatusAppliedPatches(patches));
  }
  /**
   * Replaces the applied commit ids
   * @throws if a commit is not a Git object id
   */
  appliedCommits(commits: string[]) {
    return this.chain(setGitStatusAppliedCommits(commits));
  }
  /**
   * Sets or removes the merge commit
   * @throws if the commit is not a Git object id
   */
  mergeCommit(commit: string | null) {
    return this.chain(setGitStatusMergeCommit(commit));
  }
}
