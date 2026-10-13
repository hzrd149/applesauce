import { EventFactory } from "applesauce-core/factories";
import {
  setGitPullRequestTipCommit,
  setGitPullRequestCloneUrls,
  setGitPullRequestMergeBase,
} from "../../operations/git-pull-request.js";

/** A shared implementation of pull request fetch operations */
export class GitPullRequestFetchFactory<K extends 1618 | 1619> extends EventFactory<K> {
  /**
   * Sets the proposed branch tip
   * @throws if the commit is not a Git object id
   */
  tipCommit(commit: string) {
    return this.chain(setGitPullRequestTipCommit(commit));
  }
  /**
   * Replaces the clone URLs containing the tip
   * @throws if there are no nonempty URLs
   */
  cloneUrls(urls: string[]) {
    return this.chain(setGitPullRequestCloneUrls(urls));
  }
  /**
   * Sets or removes the merge base
   * @throws if the commit is not a Git object id
   */
  mergeBase(commit: string | null) {
    return this.chain(setGitPullRequestMergeBase(commit));
  }
}
