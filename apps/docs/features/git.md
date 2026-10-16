---
description: Read and publish git repositories, issues, patches, pull requests, and their statuses
---

# Git

Git collaboration on Nostr (NIP-34) is built around **repository announcements**. Issues, patches, and pull requests are threads that point at a repository, and status events from the author or a maintainer mark each thread open, applied, closed, or draft.

## Reading a repository

The `GitRepository` cast exposes an announcement's metadata and subscribes to its threads. `issues$`, `pullRequests$`, and `patches$` list what is already in the store, and `patches$` only includes the first patch of each series.

```ts
const repo = castEvent(announcement, GitRepository, store);
const issues = use$(repo.issues$);
const prs = use$(repo.pullRequests$);
```

A user cast exposes `gitRepositories$`, `favoriteGitRepos$`, `gitAuthors$`, and `graspServers$` once `applesauce-common/casts` is imported.

## Displaying threads

`GitIssue`, `GitPullRequest`, and `GitPatch` share `repository$`, `maintainers$`, `comments$`, `status$`, `statusEvent$`, and `updatedAt$`.

```ts
const issue = castEvent(event, GitIssue, store);
const status = use$(issue.status$); // "open" | "applied" | "closed" | "draft"
const comments = use$(issue.comments$);
```

Status defaults to `open`, and only the thread author or a repository maintainer can change it. Until the announcement loads, the repository owner is the only maintainer.

## Following a pull request

A pull request's fetch state changes when its author publishes updates. `state$` returns the tip, clone URLs, and merge base from the latest valid update, so all three always come from the same event.

```ts
const pr = castEvent(event, GitPullRequest, store);
const { tipCommit, cloneUrls, mergeBase } = await pr.state$.$first();
```

Updates from anyone but the PR author, malformed updates, and updates older than the PR are ignored. `tipCommit`, `cloneUrls`, and `mergeBase` on the cast are the original values, and `latestTipCommit$`, `latestCloneUrls$`, and `latestMergeBase$` follow updates. `patch$` resolves the patch a PR revises, and `GitPullRequestUpdate.pullRequest$` resolves an update's target.

## Walking patch series

Each patch points at the one before it. `GitPatch` resolves that chain into a series and groups revisions under the original root.

```ts
const patch = castEvent(event, GitPatch, store);
const series = use$(patch.series$); // dependency order
const original = await patch.originalRoot$.$first();
```

`previous$` resolves the preceding patch, `seriesRoot$` the root of the current revision, and `revisions$` every revision root. Missing ancestors resolve to `undefined` until they load, and invalid or cyclic chains stay unresolved. A patch's status comes from its original root: a revision is applied when it is the accepted revision or one of its patches is listed as applied, and closed otherwise.

## Using models directly

The casts are built on models from `applesauce-common/models`. Use them when you don't need a cast, and pass maintainer pubkeys yourself to the status models.

```ts
const issues$ = store.model(GitRepositoryIssuesModel, repoPointer);
const state$ = store.model(GitPullRequestStateModel, pr);
const status$ = store.model(GitPatchStatusModel, patch, maintainers);
```

Other models include `GitRepositoryPullRequestsModel`, `GitRepositoryPatchesModel`, `GitThreadCommentsModel`, `GitPullRequestUpdatesModel`, `GitPatchSeriesModel`, `GitPatchSeriesRootModel`, `GitPatchOriginalRootModel`, `GitPatchRevisionsModel`, `GitStatusModel`, and `GitStatusEventModel`.

## Publishing issues and pull requests

Each factory targets one event kind. Repository arguments take an announcement or a `GitRepositoryPointer`; pass the announcement to include its earliest unique commit in the discovery tags.

```ts
const issue = await GitIssueFactory.create(repo, "Bug", "Steps to reproduce").addLabel("bug").sign(signer);
const pr = await GitPullRequestFactory.create(repo, "Fix", tip, cloneUrls, "Description").sign(signer);
const update = await GitPullRequestUpdateFactory.create(pr, nextTip, cloneUrls).sign(signer);
```

Sign PR updates with the PR author's signer. Each update carries a complete tip and clone URL set, and leaving out `.mergeBase(commit)` clears the merge base.

## Publishing patches and statuses

`GitPatchFactory` builds the relationships between patches, and the status factories (`GitOpenStatusFactory`, `GitAppliedStatusFactory`, `GitClosedStatusFactory`, `GitDraftStatusFactory`) mark a thread's root.

```ts
const root = await GitPatchFactory.create(repo, formatPatch).sign(signer);
const next = await GitPatchFactory.next(root, nextFormatPatch).sign(signer);
const revision = await GitPatchFactory.revision(root, revisedFormatPatch).sign(signer);

const applied = await GitAppliedStatusFactory.create(root)
  .acceptedRevision(revision)
  .appliedPatches([revision.id])
  .appliedCommits([commit])
  .sign(maintainer);
```

Only the applied factory has `acceptedRevision()`, `appliedPatches()`, `appliedCommits()`, and `mergeCommit()`. Threads, updates, and statuses are regular events, so `modify(event)` produces a new event rather than an edit; publish an update or status to change a thread's state. Use `GitRepositoryFactory` to publish the repository announcement itself.

## Sending events to the repository

Publish to the relays the repository advertises, with the author's [outboxes](/features/outbox) as extra targets. Reply to any thread with `CommentFactory.create(thread, text)`, which adds the NIP-22 threading tags.

```ts
const relays = relaySet(getGitRepositoryRelays(announcement), outboxes);
const results = await pool.publish(relays, issue);
if (results.some((r) => r.ok)) store.add(issue);
```

Models never query relays on their own. Load repository threads, PR updates, statuses, and comments into the store with [loaders](/loading/loaders/timeline-loader) or [subscriptions](/loading/relays/pool), and set up an [event loader](/loading/loaders/event-loader) so patch ancestors and announcements can be fetched by pointer.

**Example:** [Pull Request Dashboard](https://applesauce.build/examples/#/example/git/pull-request-dashboard)

## Best Practices

- Read `state$` for fetch instructions so the tip and clone URLs come from the same update
- Use `GitPatchStatusModel` or `GitPatch.status$` for patches so revisions inherit the original root's status
- Build patch chains with `GitPatchFactory.next()` and `revision()` instead of setting tags by hand
- Target the original root in status events, and mark the applied revision with `acceptedRevision()`
- Sign statuses as the thread author or a repository maintainer, or they are ignored
- Set `.mergeCommit()` or `.appliedCommits()` on applied statuses so clients can find them by commit
- Keep threads, announcements, and statuses in one EventStore so casts can resolve each other
