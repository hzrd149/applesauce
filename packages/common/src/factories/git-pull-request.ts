import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { GIT_PULL_REQUEST_KIND, isValidGitPullRequest } from "../helpers/git-pull-request.js";
import { GitRepositoryPointer } from "../helpers/git-repository.js";
import {
  addGitIssueLabel,
  removeGitIssueLabel,
  setGitIssueLabels,
  setGitIssueSubject,
} from "../operations/git-issue.js";
import { setGitThreadRepository } from "../operations/git-thread.js";
import { setGitPullRequestBranchName, setGitPullRequestPatch } from "../operations/git-pull-request.js";
import { GitPullRequestFetchFactory } from "./internal/git-pull-request.js";

/** An event template for a NIP-34 pull request */
export type GitPullRequestTemplate = KnownEventTemplate<typeof GIT_PULL_REQUEST_KIND>;

/** A factory for NIP-34 pull requests (kind 1618) */
export class GitPullRequestFactory extends GitPullRequestFetchFactory<typeof GIT_PULL_REQUEST_KIND> {
  /**
   * Creates a pull request with a fetchable branch tip
   * @throws if the repository, commit or clone URLs are invalid
   */
  static create(
    repo: GitRepositoryPointer | NostrEvent,
    subject: string,
    tipCommit: string,
    cloneUrls: string[],
    content = "",
  ): GitPullRequestFactory {
    return new GitPullRequestFactory((res) => res(blankEventTemplate(GIT_PULL_REQUEST_KIND)))
      .repository(repo)
      .subject(subject)
      .tipCommit(tipCommit)
      .cloneUrls(cloneUrls)
      .content(content);
  }
  /**
   * Creates a factory for modifying a pull request draft
   * @throws if the event is not a valid pull request
   */
  static modify(event: NostrEvent): GitPullRequestFactory {
    if (!isValidGitPullRequest(event)) throw new Error("Expected a valid pull request");
    return new GitPullRequestFactory((res) => res(toEventTemplate(event)));
  }
  /**
   * Sets the target repository
   * @throws if the repository is invalid
   */
  repository(repo: GitRepositoryPointer | NostrEvent) {
    return this.chain(setGitThreadRepository(repo));
  }
  /** Sets or removes the subject */
  subject(subject: string | null) {
    return this.chain(setGitIssueSubject(subject));
  }
  /** Replaces all labels */
  labels(labels: string[]) {
    return this.chain(setGitIssueLabels(labels));
  }
  /** Adds a label */
  addLabel(label: string) {
    return this.chain(addGitIssueLabel(label));
  }
  /** Removes a label */
  removeLabel(label: string) {
    return this.chain(removeGitIssueLabel(label));
  }
  /** Sets or removes the recommended branch name */
  branchName(name: string | null) {
    return this.chain(setGitPullRequestBranchName(name));
  }
  /**
   * Sets or removes the root patch revised by this pull request
   * @throws if the patch is not a root patch or its id is invalid
   */
  patch(patch: NostrEvent | string | null) {
    return this.chain(setGitPullRequestPatch(patch));
  }
}
