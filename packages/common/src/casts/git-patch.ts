import { NostrEvent } from "applesauce-core/helpers/event";
import { ChainableObservable } from "applesauce-core";
import { castEventStream, castTimelineStream } from "applesauce-core/observable/cast-stream";
import { of, switchMap } from "rxjs";
import {
  getGitPatchCommit,
  getGitPatchLabels,
  getGitPatchParentCommit,
  getGitPatchSubject,
  GitPatchEvent,
  isGitPatchRoot,
  isGitPatchRootRevision,
  isValidGitPatch,
  getGitPatchPreviousPointer,
  getGitPatchCommitter,
  getGitPatchCommitSignature,
} from "../helpers/git-patch.js";
import { GitStatus } from "../helpers/git-status.js";
import {
  GitPatchOriginalRootModel,
  GitPatchSeriesRootModel,
  GitPatchSeriesModel,
  GitPatchRevisionsModel,
  GitPatchStatusModel,
  GitPatchStatusEventModel,
} from "../models/git.js";
import { CastRefEventStore } from "./cast.js";
import { GitThread } from "./git-thread.js";

/** Cast for NIP-34 patch events */
export class GitPatch extends GitThread<GitPatchEvent> {
  /**
   * Creates a patch cast
   * @throws if the event is not a valid patch
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitPatch(event)) throw new Error("Invalid git patch event");
    super(event, store);
  }

  /** The subject parsed from the patch header */
  get subject() {
    return getGitPatchSubject(this.event);
  }
  /** The patch subject or first content line */
  get title() {
    return this.subject ?? super.title;
  }
  /** The patch labels without series markers */
  get labels() {
    return getGitPatchLabels(this.event);
  }
  /** True if this is the first patch in a series or revision */
  get isRoot() {
    return isGitPatchRoot(this.event);
  }
  /** True if this is the first patch of a revision */
  get isRootRevision() {
    return isGitPatchRootRevision(this.event);
  }
  /** The proposed commit id */
  get commit() {
    return getGitPatchCommit(this.event);
  }
  /** The parent commit id */
  get parentCommit() {
    return getGitPatchParentCommit(this.event);
  }

  /** The pointer to the previous patch or original root */
  get previousPointer() {
    return getGitPatchPreviousPointer(this.event);
  }
  /** The committer metadata for reproducing the commit */
  get committer() {
    return getGitPatchCommitter(this.event);
  }
  /** The commit signature, with an empty string for unsigned commits */
  get commitSignature() {
    return getGitPatchCommitSignature(this.event);
  }
  /** Subscribes to the previous patch or original root */
  get previous$(): ChainableObservable<GitPatch | undefined> {
    return this.$$ref("previous$", (store) =>
      this.previousPointer ? store.event(this.previousPointer).pipe(castEventStream(GitPatch, store)) : of(undefined),
    );
  }
  /** Subscribes to the root of the current series or revision */
  get seriesRoot$(): ChainableObservable<GitPatch | undefined> {
    return this.$$ref("seriesRoot$", (store) =>
      store.model(GitPatchSeriesRootModel, this.event).pipe(castEventStream(GitPatch, store)),
    );
  }
  /** Subscribes to the original root patch */
  get originalRoot$(): ChainableObservable<GitPatch | undefined> {
    return this.$$ref("originalRoot$", (store) =>
      store.model(GitPatchOriginalRootModel, this.event).pipe(castEventStream(GitPatch, store)),
    );
  }
  /** Subscribes to patches in this series in dependency order */
  get series$(): ChainableObservable<GitPatch[]> {
    return this.$$ref("series$", (store) =>
      store.model(GitPatchSeriesModel, this.event).pipe(castTimelineStream(GitPatch, store)),
    );
  }
  /** Subscribes to revisions of the original series */
  get revisions$(): ChainableObservable<GitPatch[]> {
    return this.$$ref("revisions$", (store) =>
      store.model(GitPatchRevisionsModel, this.event).pipe(castTimelineStream(GitPatch, store)),
    );
  }
  /** Subscribes to status inherited from the original root */
  get status$(): ChainableObservable<GitStatus> {
    return this.$$ref("status$", (store) =>
      this.maintainers$.pipe(switchMap((maintainers) => store.model(GitPatchStatusModel, this.event, maintainers))),
    );
  }
  /** Subscribes to the latest authorized status of the original root */
  get statusEvent$(): ChainableObservable<NostrEvent | undefined> {
    return this.$$ref("statusEvent$", (store) =>
      this.maintainers$.pipe(
        switchMap((maintainers) => store.model(GitPatchStatusEventModel, this.event, maintainers)),
      ),
    );
  }
  protected activity$() {
    return this.store.model(GitPatchRevisionsModel, this.event);
  }
}
