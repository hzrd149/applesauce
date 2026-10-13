import { NostrEvent } from "applesauce-core/helpers/event";
import { getGitIssueLabels, getGitIssueSubject, GitIssueEvent, isValidGitIssue } from "../helpers/git-issue.js";
import { CastRefEventStore } from "./cast.js";
import { GitThread } from "./git-thread.js";

/** Cast for NIP-34 issue events */
export class GitIssue extends GitThread<GitIssueEvent> {
  /**
   * Creates an issue cast
   * @throws if the event is not a valid issue
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitIssue(event)) throw new Error("Invalid git issue event");
    super(event, store);
  }

  /** The optional issue subject */
  get subject() {
    return getGitIssueSubject(this.event);
  }
  /** The subject or first content line */
  get title() {
    return this.subject ?? super.title;
  }
  /** The issue labels */
  get labels() {
    return getGitIssueLabels(this.event);
  }
}
