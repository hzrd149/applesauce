import { EventStore } from "applesauce-core/event-store";
import { EventSigner } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { relaySet } from "applesauce-core/helpers/relays";
import { castEvent, GitPullRequest, GitPatch } from "../src/casts/index.js";
import {
  GitIssueFactory,
  GitPullRequestFactory,
  GitPullRequestUpdateFactory,
  GitPatchFactory,
  GitAppliedStatusFactory,
  CommentFactory,
} from "../src/factories/index.js";
import { getGitRepositoryRelays, GitRepositoryPointer } from "../src/helpers/git-repository.js";
import { GitRepositoryIssuesModel, GitPullRequestStateModel, GitPatchSeriesModel } from "../src/models/git.js";

declare const repo: NostrEvent, event: NostrEvent;
declare const signer: EventSigner, maintainer: EventSigner;
declare const tip: string, nextTip: string, commit: string;
declare const formatPatch: string, nextFormatPatch: string, revisedFormatPatch: string;
declare const cloneUrls: string[], outboxes: string[], repoPointer: GitRepositoryPointer;
declare const pool: { publish(relays: string[], event: NostrEvent): Promise<{ ok: boolean }[]> };
declare function showFetchInstructions(tip: string, urls: string[], mergeBase?: string): void;
declare function renderPatches(patches: GitPatch[]): void;
const store = new EventStore();

const issue = await GitIssueFactory.create(repo, "Bug", "Steps to reproduce").addLabel("bug").sign(signer);
const pr = await GitPullRequestFactory.create(repo, "Fix", tip, cloneUrls, "Description").sign(signer);
await GitPullRequestUpdateFactory.create(pr, nextTip, cloneUrls).sign(signer);
const root = await GitPatchFactory.create(repo, formatPatch).sign(signer);
await GitPatchFactory.next(root, nextFormatPatch).sign(signer);
const revision = await GitPatchFactory.revision(root, revisedFormatPatch).sign(signer);
await GitAppliedStatusFactory.create(root)
  .acceptedRevision(revision)
  .appliedPatches([revision.id])
  .appliedCommits([commit])
  .sign(maintainer);
const relays = relaySet(getGitRepositoryRelays(repo), outboxes);
const results = await pool.publish(relays, issue);
if (results.some((result) => result.ok)) store.add(issue);
await CommentFactory.create(root, "Review").sign(signer);

const prCast = castEvent(event, GitPullRequest, store);
const sub = prCast.state$.subscribe(({ tipCommit, cloneUrls, mergeBase }) =>
  showFetchInstructions(tipCommit, cloneUrls, mergeBase),
);
sub.unsubscribe();
const patch = castEvent(event, GitPatch, store);
const patchesSub = patch.series$.subscribe(renderPatches);
await patch.originalRoot$.$first();
patchesSub.unsubscribe();
store.model(GitRepositoryIssuesModel, repoPointer);
store.model(GitPullRequestStateModel, pr);
store.model(GitPatchSeriesModel, patch.event);
