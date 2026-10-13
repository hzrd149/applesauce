import { expectTypeOf } from "vitest";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  GitIssueFactory,
  GitPatchFactory,
  GitPullRequestFactory,
  GitPullRequestUpdateFactory,
  GitOpenStatusFactory,
  GitAppliedStatusFactory,
  GitClosedStatusFactory,
  GitDraftStatusFactory,
} from "../src/factories/index.js";

declare const event: NostrEvent;
const repo = { kind: 30617 as const, pubkey: "a".repeat(64), identifier: "repo" };
const commit = "a".repeat(40),
  urls = ["git@example.com:repo.git"];

const gitIssueFactory = GitIssueFactory.create(repo).addLabel("bug").subject("Bug");
expectTypeOf(gitIssueFactory).toEqualTypeOf<GitIssueFactory>();
expectTypeOf<Awaited<typeof gitIssueFactory>["kind"]>().toEqualTypeOf<1621>();
expectTypeOf<Awaited<ReturnType<typeof gitIssueFactory.sign>>["kind"]>().toEqualTypeOf<1621>();
expectTypeOf(GitIssueFactory.modify(event).content("Changed")).toEqualTypeOf<GitIssueFactory>();

const gitPatchFactory = GitPatchFactory.create(repo, "Patch").commit(commit).labels(["fix"]);
expectTypeOf(gitPatchFactory).toEqualTypeOf<GitPatchFactory>();
expectTypeOf<Awaited<typeof gitPatchFactory>["kind"]>().toEqualTypeOf<1617>();
expectTypeOf<Awaited<ReturnType<typeof gitPatchFactory.sign>>["kind"]>().toEqualTypeOf<1617>();
expectTypeOf(GitPatchFactory.modify(event).content("Changed")).toEqualTypeOf<GitPatchFactory>();

const gitPullRequestFactory = GitPullRequestFactory.create(repo, "Fix", commit, urls)
  .branchName("fix")
  .tipCommit(commit);
expectTypeOf(gitPullRequestFactory).toEqualTypeOf<GitPullRequestFactory>();
expectTypeOf<Awaited<typeof gitPullRequestFactory>["kind"]>().toEqualTypeOf<1618>();
expectTypeOf<Awaited<ReturnType<typeof gitPullRequestFactory.sign>>["kind"]>().toEqualTypeOf<1618>();
expectTypeOf(GitPullRequestFactory.modify(event).content("Changed")).toEqualTypeOf<GitPullRequestFactory>();

const gitPullRequestUpdateFactory = GitPullRequestUpdateFactory.create(event, commit, urls)
  .mergeBase(commit)
  .target(event);
expectTypeOf(gitPullRequestUpdateFactory).toEqualTypeOf<GitPullRequestUpdateFactory>();
expectTypeOf<Awaited<typeof gitPullRequestUpdateFactory>["kind"]>().toEqualTypeOf<1619>();
expectTypeOf<Awaited<ReturnType<typeof gitPullRequestUpdateFactory.sign>>["kind"]>().toEqualTypeOf<1619>();
expectTypeOf(GitPullRequestUpdateFactory.modify(event).content("Changed")).toEqualTypeOf<GitPullRequestUpdateFactory>();

const gitOpenStatusFactory = GitOpenStatusFactory.create(event).content("Open").root(event);
expectTypeOf(gitOpenStatusFactory).toEqualTypeOf<GitOpenStatusFactory>();
expectTypeOf<Awaited<typeof gitOpenStatusFactory>["kind"]>().toEqualTypeOf<1630>();
expectTypeOf<Awaited<ReturnType<typeof gitOpenStatusFactory.sign>>["kind"]>().toEqualTypeOf<1630>();
expectTypeOf(GitOpenStatusFactory.modify(event).content("Changed")).toEqualTypeOf<GitOpenStatusFactory>();

const gitAppliedStatusFactory = GitAppliedStatusFactory.create(event)
  .appliedPatches([])
  .acceptedRevision(event)
  .mergeCommit(commit);
expectTypeOf(gitAppliedStatusFactory).toEqualTypeOf<GitAppliedStatusFactory>();
expectTypeOf<Awaited<typeof gitAppliedStatusFactory>["kind"]>().toEqualTypeOf<1631>();
expectTypeOf<Awaited<ReturnType<typeof gitAppliedStatusFactory.sign>>["kind"]>().toEqualTypeOf<1631>();
expectTypeOf(GitAppliedStatusFactory.modify(event).content("Changed")).toEqualTypeOf<GitAppliedStatusFactory>();

const gitClosedStatusFactory = GitClosedStatusFactory.create(event).root(event).content("Closed");
expectTypeOf(gitClosedStatusFactory).toEqualTypeOf<GitClosedStatusFactory>();
expectTypeOf<Awaited<typeof gitClosedStatusFactory>["kind"]>().toEqualTypeOf<1632>();
expectTypeOf<Awaited<ReturnType<typeof gitClosedStatusFactory.sign>>["kind"]>().toEqualTypeOf<1632>();
expectTypeOf(GitClosedStatusFactory.modify(event).content("Changed")).toEqualTypeOf<GitClosedStatusFactory>();

const gitDraftStatusFactory = GitDraftStatusFactory.create(event).content("Draft").root(event);
expectTypeOf(gitDraftStatusFactory).toEqualTypeOf<GitDraftStatusFactory>();
expectTypeOf<Awaited<typeof gitDraftStatusFactory>["kind"]>().toEqualTypeOf<1633>();
expectTypeOf<Awaited<ReturnType<typeof gitDraftStatusFactory.sign>>["kind"]>().toEqualTypeOf<1633>();
expectTypeOf(GitDraftStatusFactory.modify(event).content("Changed")).toEqualTypeOf<GitDraftStatusFactory>();

// @ts-expect-error Applied metadata is only available on applied statuses
gitOpenStatusFactory.mergeCommit(commit);
// @ts-expect-error Applied metadata is only available on applied statuses
gitClosedStatusFactory.acceptedRevision(event);
// @ts-expect-error Applied metadata is only available on applied statuses
gitDraftStatusFactory.appliedPatches([]);
// @ts-expect-error Updates do not have a subject builder
gitPullRequestUpdateFactory.subject("Fix");
