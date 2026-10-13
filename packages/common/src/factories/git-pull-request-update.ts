import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { GIT_PULL_REQUEST_UPDATE_KIND, isValidGitPullRequestUpdate } from "../helpers/git-pull-request.js";
import { setGitPullRequestUpdateTarget } from "../operations/git-pull-request.js";
import { GitPullRequestFetchFactory } from "./internal/git-pull-request.js";

/** An event template for a NIP-34 pull request update */
export type GitPullRequestUpdateTemplate = KnownEventTemplate<typeof GIT_PULL_REQUEST_UPDATE_KIND>;

/** A factory for NIP-34 pull request updates (kind 1619) */
export class GitPullRequestUpdateFactory extends GitPullRequestFetchFactory<typeof GIT_PULL_REQUEST_UPDATE_KIND> {
  /**
   * Creates a complete fetch-state update for a pull request
   * @throws if the pull request, commit or clone URLs are invalid
   */
  static create(pr: NostrEvent, tipCommit: string, cloneUrls: string[]): GitPullRequestUpdateFactory {
    return new GitPullRequestUpdateFactory((res) => res(blankEventTemplate(GIT_PULL_REQUEST_UPDATE_KIND)))
      .target(pr)
      .tipCommit(tipCommit)
      .cloneUrls(cloneUrls);
  }
  /**
   * Creates a factory for modifying a pull request update draft
   * @throws if the event is not a valid pull request update
   */
  static modify(event: NostrEvent): GitPullRequestUpdateFactory {
    if (!isValidGitPullRequestUpdate(event)) throw new Error("Expected a valid pull request update");
    return new GitPullRequestUpdateFactory((res) => res(toEventTemplate(event)));
  }
  /**
   * Sets the pull request targeted by this update
   * @throws if the pull request is invalid
   */
  target(pr: NostrEvent, relay?: string) {
    return this.chain(setGitPullRequestUpdateTarget(pr, relay));
  }
}
