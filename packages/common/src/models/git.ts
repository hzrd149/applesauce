import { Model } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { getReplaceableAddressFromPointer } from "applesauce-core/helpers/pointers";
import { combineLatest, map, of, switchMap } from "rxjs";
import { COMMENT_KIND, getCommentRootPointer, isValidComment } from "../helpers/comment.js";
import { GIT_ISSUE_KIND } from "../helpers/git-issue.js";
import {
  GIT_PATCH_KIND,
  getGitPatchPreviousPointer,
  GitPatchEvent,
  isGitPatchRoot,
  isGitPatchRootRevision,
  isValidGitPatch,
} from "../helpers/git-patch.js";
import {
  GIT_PULL_REQUEST_KIND,
  GIT_PULL_REQUEST_UPDATE_KIND,
  getGitPullRequestUpdateAuthor,
  getGitPullRequestUpdateTarget,
  getGitPullRequestState,
  GitPullRequestEvent,
  GitPullRequestUpdateEvent,
  GitPullRequestState,
  isValidGitPullRequestUpdate,
} from "../helpers/git-pull-request.js";
import { GitRepositoryPointer, getGitRepositoryReference } from "../helpers/git-repository.js";
import {
  getGitCurrentStatusEvent,
  getGitStatusType,
  GIT_STATUS_KINDS,
  GitStatus,
  GitStatusEvent,
  getGitStatusAcceptedRevisionId,
  getGitStatusAppliedPatchIds,
} from "../helpers/git-status.js";

/** A model that returns the latest authorized status event for an issue, patch or pull request */
export function GitStatusEventModel(root: NostrEvent, maintainers: string[] = []): Model<GitStatusEvent | undefined> {
  return (store) =>
    store
      .timeline({ kinds: GIT_STATUS_KINDS, "#e": [root.id] })
      .pipe(map((statuses) => getGitCurrentStatusEvent(root, statuses, maintainers)));
}

/** A model that returns the current status of an issue, patch or pull request */
export function GitStatusModel(root: NostrEvent, maintainers: string[] = []): Model<GitStatus> {
  return (store) =>
    store
      .model(GitStatusEventModel, root, maintainers)
      .pipe(map((status) => (status ? getGitStatusType(status) : "open")));
}

/** A model that returns all NIP-22 comments in an issue, patch or pull request thread */
export function GitThreadCommentsModel(root: NostrEvent): Model<NostrEvent[]> {
  return (store) =>
    store.timeline({ kinds: [COMMENT_KIND], "#E": [root.id] }).pipe(
      map((comments) =>
        comments.filter((event) => {
          if (!isValidComment(event)) return false;
          const pointer = getCommentRootPointer(event);
          return pointer.type === "event" && pointer.id === root.id && pointer.kind === root.kind;
        }),
      ),
    );
}

/** A model that returns the updates to a pull request */
export function GitPullRequestUpdatesModel(pr: NostrEvent): Model<GitPullRequestUpdateEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [GIT_PULL_REQUEST_UPDATE_KIND], "#E": [pr.id] })
      .pipe(
        map((updates) =>
          updates.filter(
            (update): update is GitPullRequestUpdateEvent =>
              isValidGitPullRequestUpdate(update) &&
              getGitPullRequestUpdateTarget(update) === pr.id &&
              getGitPullRequestUpdateAuthor(update) === pr.pubkey &&
              update.pubkey === pr.pubkey &&
              update.created_at >= pr.created_at,
          ),
        ),
      );
}

/** A model that returns the latest complete fetch state of a pull request */
export function GitPullRequestStateModel(pr: GitPullRequestEvent): Model<GitPullRequestState> {
  return (store) =>
    store.model(GitPullRequestUpdatesModel, pr).pipe(map((updates) => getGitPullRequestState(updates[0] ?? pr)));
}

function patchRootModel(
  patch: NostrEvent,
  original: boolean,
  visited: string[] = [],
): Model<GitPatchEvent | undefined> {
  return (store) => {
    if (!isValidGitPatch(patch) || visited.includes(patch.id)) return of(undefined);
    if (isGitPatchRoot(patch) && (!original || !isGitPatchRootRevision(patch))) return of(patch);
    const previous = getGitPatchPreviousPointer(patch);
    if (!previous) return of(undefined);
    return store.event(previous).pipe(
      switchMap((parent) => {
        if (
          !parent ||
          getGitRepositoryReference(parent)?.pubkey !== getGitRepositoryReference(patch)?.pubkey ||
          getGitRepositoryReference(parent)?.identifier !== getGitRepositoryReference(patch)?.identifier
        )
          return of(undefined);
        return patchRootModel(parent, original, [...visited, patch.id])(store);
      }),
    );
  };
}

/** A model that resolves the first patch of the current series or revision */
export function GitPatchSeriesRootModel(patch: NostrEvent): Model<GitPatchEvent | undefined> {
  return patchRootModel(patch, false);
}

/** A model that resolves the original root through patch and revision ancestors */
export function GitPatchOriginalRootModel(patch: NostrEvent): Model<GitPatchEvent | undefined> {
  return patchRootModel(patch, true);
}

/** A model that returns patches in dependency order within a series, excluding other revisions */
export function GitPatchSeriesModel(patch: NostrEvent): Model<GitPatchEvent[]> {
  return (store) =>
    store.model(GitPatchSeriesRootModel, patch).pipe(
      switchMap((root) => {
        const repo = root && getGitRepositoryReference(root);
        if (!root || !repo) return of([]);
        return store.timeline({ kinds: [GIT_PATCH_KIND], "#a": [getReplaceableAddressFromPointer(repo)] }).pipe(
          map((events) => {
            const result: GitPatchEvent[] = [root];
            const seen = new Set([root.id]);
            let frontier = [root.id];
            while (frontier.length) {
              const next = events
                .filter(
                  (event): event is GitPatchEvent =>
                    isValidGitPatch(event) &&
                    !isGitPatchRoot(event) &&
                    !seen.has(event.id) &&
                    frontier.includes(getGitPatchPreviousPointer(event)?.id ?? ""),
                )
                .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
              result.push(...next);
              frontier = next.map((event) => event.id);
              for (const id of frontier) seen.add(id);
            }
            return result;
          }),
        );
      }),
    );
}

/** A model that returns revision roots pointing to the original root patch */
export function GitPatchRevisionsModel(patch: NostrEvent): Model<GitPatchEvent[]> {
  return (store) =>
    store.model(GitPatchOriginalRootModel, patch).pipe(
      switchMap((root) => {
        if (!root) return of([]);
        return store
          .timeline({ kinds: [GIT_PATCH_KIND], "#e": [root.id] })
          .pipe(
            map((events) =>
              events.filter(
                (event): event is GitPatchEvent =>
                  isValidGitPatch(event) &&
                  isGitPatchRootRevision(event) &&
                  getGitPatchPreviousPointer(event)?.id === root.id &&
                  getGitRepositoryReference(event)?.pubkey === getGitRepositoryReference(root)?.pubkey &&
                  getGitRepositoryReference(event)?.identifier === getGitRepositoryReference(root)?.identifier,
              ),
            ),
          );
      }),
    );
}

/** A model that returns the original root's latest authorized status event for a patch */
export function GitPatchStatusEventModel(
  patch: NostrEvent,
  maintainers: string[] = [],
): Model<GitStatusEvent | undefined> {
  return (store) =>
    store
      .model(GitPatchOriginalRootModel, patch)
      .pipe(switchMap((root) => (root ? store.model(GitStatusEventModel, root, maintainers) : of(undefined))));
}

/** A model that inherits original status and closes unaccepted revisions after application */
export function GitPatchStatusModel(patch: NostrEvent, maintainers: string[] = []): Model<GitStatus> {
  return (store) =>
    combineLatest([
      store.model(GitPatchSeriesRootModel, patch),
      store.model(GitPatchStatusEventModel, patch, maintainers),
      store.model(GitPatchSeriesModel, patch),
    ]).pipe(
      map(([seriesRoot, status, series]) => {
        const type = status ? getGitStatusType(status) : "open";
        if (type !== "applied" || !seriesRoot || !isGitPatchRootRevision(seriesRoot) || !status) return type;
        const accepted = getGitStatusAcceptedRevisionId(status);
        const applied = getGitStatusAppliedPatchIds(status);
        return accepted === seriesRoot.id || series.some((event) => applied.includes(event.id)) ? "applied" : "closed";
      }),
    );
}

/** A model that returns the issues of a repository */
export function GitRepositoryIssuesModel(repo: GitRepositoryPointer): Model<NostrEvent[]> {
  return (store) => store.timeline({ kinds: [GIT_ISSUE_KIND], "#a": [getReplaceableAddressFromPointer(repo)] });
}

/** A model that returns the pull requests of a repository */
export function GitRepositoryPullRequestsModel(repo: GitRepositoryPointer): Model<NostrEvent[]> {
  return (store) => store.timeline({ kinds: [GIT_PULL_REQUEST_KIND], "#a": [getReplaceableAddressFromPointer(repo)] });
}

/** A model that returns the root patches (the first patch of each series) of a repository */
export function GitRepositoryPatchesModel(repo: GitRepositoryPointer): Model<NostrEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [GIT_PATCH_KIND], "#a": [getReplaceableAddressFromPointer(repo)] })
      .pipe(map((patches) => patches.filter(isGitPatchRoot)));
}
