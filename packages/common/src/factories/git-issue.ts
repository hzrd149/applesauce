import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { GIT_ISSUE_KIND, isValidGitIssue } from "../helpers/git-issue.js";
import { GitRepositoryPointer } from "../helpers/git-repository.js";
import { GitThreadFactory } from "./internal/git-thread.js";

/** An event template for a NIP-34 issue */
export type GitIssueTemplate = KnownEventTemplate<typeof GIT_ISSUE_KIND>;

/** A factory for NIP-34 issues (kind 1621) */
export class GitIssueFactory extends GitThreadFactory<typeof GIT_ISSUE_KIND> {
  /**
   * Creates an issue for a repository
   * @throws if the repository is invalid
   */
  static create(repo: GitRepositoryPointer | NostrEvent, subject: string | null = null, content = ""): GitIssueFactory {
    return new GitIssueFactory((res) => res(blankEventTemplate(GIT_ISSUE_KIND)))
      .repository(repo)
      .subject(subject)
      .content(content);
  }
  /**
   * Creates a factory for modifying an existing issue draft
   * @throws if the event is not a valid issue
   */
  static modify(event: NostrEvent): GitIssueFactory {
    if (!isValidGitIssue(event)) throw new Error("Expected a valid git issue");
    return new GitIssueFactory((res) => res(toEventTemplate(event)));
  }
}
