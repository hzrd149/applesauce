import { EventFactory } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { GitRepositoryPointer } from "../../helpers/git-repository.js";
import { setGitThreadRepository } from "../../operations/git-thread.js";
import {
  addGitIssueLabel,
  removeGitIssueLabel,
  setGitIssueLabels,
  setGitIssueSubject,
} from "../../operations/git-issue.js";

/** A shared implementation of repository thread operations */
export class GitThreadFactory<K extends 1617 | 1618 | 1621> extends EventFactory<K> {
  /**
   * Sets the repository for this thread
   * @throws if the event or pointer is not a valid repository
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
}
