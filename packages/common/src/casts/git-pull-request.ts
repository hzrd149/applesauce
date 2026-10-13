import { ChainableObservable } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { castEventStream, castTimelineStream } from "applesauce-core/observable/cast-stream";
import { map, of } from "rxjs";
import {
  getGitPullRequestBranchName,
  getGitPullRequestCloneUrls,
  getGitPullRequestLabels,
  getGitPullRequestMergeBase,
  getGitPullRequestSubject,
  getGitPullRequestTipCommit,
  getGitPullRequestUpdateCloneUrls,
  getGitPullRequestUpdateTarget,
  getGitPullRequestUpdateTipCommit,
  GitPullRequestEvent,
  GitPullRequestUpdateEvent,
  isValidGitPullRequest,
  isValidGitPullRequestUpdate,
  getGitPullRequestPatchId,
  getGitPullRequestUpdateAuthor,
  GitPullRequestState,
  getGitPullRequestUpdatePointer,
  getGitPullRequestPatchPointer,
} from "../helpers/git-pull-request.js";
import { GitPullRequestUpdatesModel, GitPullRequestStateModel } from "../models/git.js";
import { GitPatch } from "./git-patch.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { GitThread } from "./git-thread.js";

/** Cast for NIP-34 pull request update events */
export class GitPullRequestUpdate extends EventCast<GitPullRequestUpdateEvent> {
  /**
   * Creates a pull request update cast
   * @throws if the event is not a valid update
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitPullRequestUpdate(event)) throw new Error("Invalid git pull request update event");
    super(event, store);
  }

  /** The id of the pull request this update targets */
  get pullRequestId() {
    return getGitPullRequestUpdateTarget(this.event)!;
  }
  /** The updated branch tip commit */
  get tipCommit() {
    return getGitPullRequestUpdateTipCommit(this.event);
  }
  /** The clone URLs containing the updated tip */
  get cloneUrls() {
    return getGitPullRequestUpdateCloneUrls(this.event);
  }
  /** The common ancestor with the target branch */
  get mergeBase() {
    return getGitPullRequestMergeBase(this.event);
  }
  /** The author of the targeted pull request */
  get pullRequestAuthor() {
    return getGitPullRequestUpdateAuthor(this.event)!;
  }
  /** The target pull request pointer with its relay and author hints */
  get pullRequestPointer() {
    return getGitPullRequestUpdatePointer(this.event)!;
  }
  /** Subscribes to the targeted pull request */
  get pullRequest$(): ChainableObservable<GitPullRequest | undefined> {
    return this.$$ref("pullRequest$", (store) =>
      store.event(this.pullRequestPointer).pipe(castEventStream(GitPullRequest, store)),
    );
  }
}

/** Cast for NIP-34 pull request events */
export class GitPullRequest extends GitThread<GitPullRequestEvent> {
  /**
   * Creates a pull request cast
   * @throws if the event is not a valid pull request
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitPullRequest(event)) throw new Error("Invalid git pull request event");
    super(event, store);
  }

  /** The pull request subject */
  get subject() {
    return getGitPullRequestSubject(this.event);
  }
  /** The subject or first content line */
  get title() {
    return this.subject ?? super.title;
  }
  /** The pull request labels */
  get labels() {
    return getGitPullRequestLabels(this.event);
  }
  /** The original branch tip commit */
  get tipCommit() {
    return getGitPullRequestTipCommit(this.event);
  }
  /** The original clone URLs */
  get cloneUrls() {
    return getGitPullRequestCloneUrls(this.event);
  }
  /** The recommended branch name */
  get branchName() {
    return getGitPullRequestBranchName(this.event);
  }
  /** The original common ancestor with the target branch */
  get mergeBase() {
    return getGitPullRequestMergeBase(this.event);
  }
  /** The id of the original patch revised by this pull request */
  get patchId() {
    return getGitPullRequestPatchId(this.event);
  }
  /** The pointer to the original patch with its relay hint */
  get patchPointer() {
    return getGitPullRequestPatchPointer(this.event);
  }
  /** Subscribes to the original patch revised by this pull request */
  get patch$(): ChainableObservable<GitPatch | undefined> {
    return this.$$ref("patch$", (store) =>
      this.patchPointer ? store.event(this.patchPointer).pipe(castEventStream(GitPatch, store)) : of(undefined),
    );
  }
  /** Subscribes to the latest coherent tip, clone URLs and merge base */
  get state$(): ChainableObservable<GitPullRequestState> {
    return this.$$ref("state$", (store) => store.model(GitPullRequestStateModel, this.event));
  }

  /** Subscribes to the updates published by the pull request author */
  get updates$(): ChainableObservable<GitPullRequestUpdate[]> {
    return this.$$ref("updates$", (store) =>
      store.model(GitPullRequestUpdatesModel, this.event).pipe(castTimelineStream(GitPullRequestUpdate, store)),
    );
  }

  /** Subscribes to the latest branch tip commit, including updates */
  get latestTipCommit$(): ChainableObservable<string | undefined> {
    return this.$$ref("latestTipCommit$", () => this.state$.pipe(map((state) => state.tipCommit)));
  }
  /** Subscribes to the clone URLs containing the latest tip */
  get latestCloneUrls$(): ChainableObservable<string[]> {
    return this.$$ref("latestCloneUrls$", () => this.state$.pipe(map((state) => state.cloneUrls)));
  }
  /** Subscribes to the latest merge base */
  get latestMergeBase$(): ChainableObservable<string | undefined> {
    return this.$$ref("latestMergeBase$", () => this.state$.pipe(map((state) => state.mergeBase)));
  }

  protected activity$() {
    return this.store.model(GitPullRequestUpdatesModel, this.event);
  }
}
