import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GitIssueFactory } from "../git-issue.js";
import { GitPatchFactory } from "../git-patch.js";
import { GitPullRequestFactory } from "../git-pull-request.js";
import { GitPullRequestUpdateFactory } from "../git-pull-request-update.js";
import { GitOpenStatusFactory } from "../git-open-status.js";
import { GitAppliedStatusFactory } from "../git-applied-status.js";
import { GitClosedStatusFactory } from "../git-closed-status.js";
import { GitDraftStatusFactory } from "../git-draft-status.js";
import { GitRepositoryFactory } from "../git-repository.js";
import { isValidGitIssue } from "../../helpers/git-issue.js";
import {
  getGitPatchCommitter,
  getGitPatchLabels,
  getGitPatchPreviousPointer,
  getGitPatchCommitSignature,
} from "../../helpers/git-patch.js";
import {
  getGitPullRequestPatchId,
  isValidGitPullRequest,
  isValidGitPullRequestUpdate,
} from "../../helpers/git-pull-request.js";
import {
  getGitStatusAcceptedRevisionId,
  getGitStatusAppliedCommits,
  isValidGitStatus,
} from "../../helpers/git-status.js";

const owner = new FakeUser(),
  contributor = new FakeUser();
const repo = { kind: 30617 as const, pubkey: owner.pubkey, identifier: "repo" };
const commit = "a".repeat(40),
  nextCommit = "b".repeat(40);
const urls = ["git@example.com:repo.git"];
const statusFactories = [GitOpenStatusFactory, GitAppliedStatusFactory, GitClosedStatusFactory, GitDraftStatusFactory];

describe("NIP-34 factories", () => {
  it("creates and modifies optional issue metadata without changing the source", async () => {
    const event = await GitIssueFactory.create(repo, null, "Body").labels(["bug", "bug"]).sign(contributor);
    const original = structuredClone(event);
    const draft = await GitIssueFactory.modify(event).subject("Bug").addLabel("fix").removeLabel("bug");
    expect(draft.tags).toContainEqual(["subject", "Bug"]);
    expect(draft.tags.filter((t) => t[0] === "t")).toEqual([["t", "fix"]]);
    expect(JSON.parse(JSON.stringify(event))).toEqual(original);
    expect(isValidGitIssue(event)).toBe(true);
  });

  it("creates and modifies complete pull requests", async () => {
    const patch = await GitPatchFactory.create(repo, "Subject: [PATCH] Fix").sign(contributor);
    const event = await GitPullRequestFactory.create(repo, "Fix", commit, urls, "Body")
      .branchName("fix")
      .mergeBase(nextCommit)
      .patch(patch)
      .addLabel("bug")
      .sign(contributor);
    expect(isValidGitPullRequest(event)).toBe(true);
    expect(getGitPullRequestPatchId(event)).toBe(patch.id);
    const original = structuredClone(event);
    const draft = await GitPullRequestFactory.modify(event)
      .tipCommit(nextCommit)
      .cloneUrls(["https://git.example/repo.git"])
      .branchName(null)
      .mergeBase(null)
      .patch(null)
      .subject(null)
      .labels(["feature"]);
    expect(draft.kind).toBe(1618);
    expect(draft.tags).toContainEqual(["c", nextCommit]);
    expect(draft.tags.some((t) => ["branch-name", "merge-base", "e", "subject"].includes(t[0]))).toBe(false);
    expect(JSON.parse(JSON.stringify(event))).toEqual(original);
  });

  it("creates updates with target, author, repository and fetch state", async () => {
    const announcement = await GitRepositoryFactory.create("repo").earliestUniqueCommit(commit).sign(owner);
    const pr = await GitPullRequestFactory.create(announcement, "Fix", commit, urls).sign(contributor);
    const update = await GitPullRequestUpdateFactory.create(pr, nextCommit, urls).mergeBase(commit).sign(contributor);
    expect(isValidGitPullRequestUpdate(update)).toBe(true);
    expect(update.tags).toEqual(
      expect.arrayContaining([
        ["E", pr.id, ""],
        ["P", pr.pubkey],
        ["r", commit],
      ]),
    );
    const otherOwner = new FakeUser();
    const otherPr = await GitPullRequestFactory.create(
      { ...repo, pubkey: otherOwner.pubkey },
      "Other",
      commit,
      urls,
    ).sign(owner);
    const draft = await GitPullRequestUpdateFactory.modify(update).target(otherPr).tipCommit(commit).mergeBase(null);
    expect(draft.tags.filter((t) => t[0] === "E")).toEqual([["E", otherPr.id, ""]]);
    expect(draft.tags.filter((t) => t[0] === "P")).toEqual([["P", otherPr.pubkey]]);
    expect(draft.tags.filter((t) => t[0] === "p")).toEqual(
      expect.arrayContaining([
        ["p", otherOwner.pubkey],
        ["p", owner.pubkey],
      ]),
    );
    expect(draft.tags).not.toContainEqual(["p", contributor.pubkey]);
    expect(draft.tags.some((t) => t[0] === "r")).toBe(false);
  });

  it("creates patch series and revisions with reproducible metadata", async () => {
    const announcement = await GitRepositoryFactory.create("repo").earliestUniqueCommit(nextCommit).sign(owner);
    const committer = { name: "Alice", email: "alice@example.com", timestamp: 100, timezoneOffset: -60 };
    const root = await GitPatchFactory.create(announcement, "Subject: [PATCH] Fix")
      .commit(commit)
      .parentCommit(nextCommit)
      .committer(committer)
      .commitSignature("")
      .labels(["fix"])
      .sign(contributor);
    expect(getGitPatchCommitter(root)).toEqual(committer);
    expect(getGitPatchCommitSignature(root)).toBe("");
    const next = await GitPatchFactory.next(root, "Subject: [PATCH 2/2] More").sign(contributor);
    const revision = await GitPatchFactory.revision(root, "Subject: [PATCH v2] Better")
      .labels(["fix"])
      .sign(contributor);
    expect(getGitPatchPreviousPointer(next)?.id).toBe(root.id);
    expect(next.tags).not.toContainEqual(["t", "root"]);
    expect(next.tags).toContainEqual(["r", nextCommit]);
    expect(revision.tags).toContainEqual(["t", "root-revision"]);
    expect(getGitPatchPreviousPointer(revision)?.id).toBe(root.id);
    expect(getGitPatchLabels(revision)).toEqual(["fix"]);
    const draft = await GitPatchFactory.modify(root)
      .commit(null)
      .parentCommit(null)
      .committer(null)
      .commitSignature(null);
    expect(draft.tags.some((t) => ["commit", "parent-commit", "committer", "commit-pgp-sig"].includes(t[0]))).toBe(
      false,
    );
    expect(() => GitPatchFactory.revision(next, "bad")).toThrow();
    expect(() => GitPatchFactory.revision(revision, "bad")).toThrow();
  });

  it.each(statusFactories)("creates and modifies one concrete status kind", async (Factory) => {
    const issue = await GitIssueFactory.create(repo, "Bug").sign(contributor);
    const event = await Factory.create(issue, "Reason").sign(owner);
    expect(isValidGitStatus(event)).toBe(true);
    const draft = await Factory.modify(event).content("Changed");
    expect(draft.kind).toBe(event.kind);
    expect(draft.content).toBe("Changed");
    for (const Other of statusFactories) {
      if (Other !== Factory) expect(() => Other.modify(event)).toThrow();
    }
  });

  it("records accepted revisions and applied commits", async () => {
    const root = await GitPatchFactory.create(repo, "Patch").sign(contributor);
    const revision = await GitPatchFactory.revision(root, "Revision").sign(contributor);
    const event = await GitAppliedStatusFactory.create(root)
      .acceptedRevision(revision)
      .appliedPatches([{ id: revision.id, author: contributor.pubkey, relays: ["wss://relay.example"] }])
      .appliedCommits([commit, nextCommit])
      .mergeCommit(commit)
      .sign(owner);
    expect(getGitStatusAcceptedRevisionId(event)).toBe(revision.id);
    expect(getGitStatusAppliedCommits(event)).toEqual([commit, nextCommit]);
    const draft = await GitAppliedStatusFactory.modify(event)
      .acceptedRevision(null)
      .appliedPatches([])
      .appliedCommits([])
      .mergeCommit(null);
    expect(draft.tags.some((t) => ["q", "r", "merge-commit", "applied-as-commits"].includes(t[0]))).toBe(false);
    const other = await GitPatchFactory.create(repo, "Other").sign(contributor);
    await expect(GitAppliedStatusFactory.create(other).acceptedRevision(revision)).rejects.toThrow();
    expect(() => GitAppliedStatusFactory.create(revision)).toThrow();
  });

  it("rejects invalid repository inputs and malformed drafts", () => {
    const note = owner.event({ kind: 1 });
    const wrongRepo = owner.event({ kind: 30023, tags: [["d", "article"]] });
    for (const Factory of [
      GitIssueFactory,
      GitPatchFactory,
      GitPullRequestFactory,
      GitPullRequestUpdateFactory,
      ...statusFactories,
    ])
      expect(() => Factory.modify(note)).toThrow();
    expect(() => GitIssueFactory.create(wrongRepo)).toThrow();
    expect(() => GitIssueFactory.create({ ...repo, pubkey: "bad" })).toThrow();
    expect(() => GitPullRequestFactory.create(repo, "Bad", "bad", urls)).toThrow();
    expect(() => GitPullRequestFactory.create(repo, "Bad", commit, [])).toThrow();
    expect(() => GitPullRequestUpdateFactory.create(note, commit, urls)).toThrow();
    expect(() => GitIssueFactory.modify(owner.event({ kind: 1621 }))).toThrow();
    expect(() => GitClosedStatusFactory.create(note)).toThrow();
  });
});
