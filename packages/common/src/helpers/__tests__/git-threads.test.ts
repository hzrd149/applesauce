import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getGitIssueLabels, getGitIssueSubject, GIT_ISSUE_KIND, isValidGitIssue } from "../git-issue.js";
import {
  getGitPatchLabels,
  getGitPatchCommitter,
  getGitPatchPreviousPointer,
  getGitPatchCommitSignature,
  getGitPatchSubject,
  GIT_PATCH_KIND,
  isGitPatchRoot,
  isValidGitPatch,
} from "../git-patch.js";
import {
  getGitPullRequestCloneUrls,
  getGitPullRequestSubject,
  getGitPullRequestTipCommit,
  getGitPullRequestUpdateTarget,
  getGitPullRequestUpdatePointer,
  getGitPullRequestPatchPointer,
  GIT_PULL_REQUEST_KIND,
  GIT_PULL_REQUEST_UPDATE_KIND,
  isValidGitPullRequest,
  isValidGitPullRequestUpdate,
} from "../git-pull-request.js";
import { getGitRepositoryReference, GIT_REPOSITORY_KIND } from "../git-repository.js";

const user = new FakeUser();
const OWNER = "b".repeat(64);
const repoTag = ["a", `${GIT_REPOSITORY_KIND}:${OWNER}:applesauce`, "wss://relay.example.com"];

describe("git thread helpers", () => {
  it("parses the repository reference", () => {
    const issue = user.event({ kind: GIT_ISSUE_KIND, tags: [repoTag] });
    expect(getGitRepositoryReference(issue)).toEqual({
      kind: GIT_REPOSITORY_KIND,
      pubkey: OWNER,
      identifier: "applesauce",
      relays: ["wss://relay.example.com/"],
    });
  });

  it("parses issues", () => {
    const issue = user.event({ kind: GIT_ISSUE_KIND, tags: [repoTag, ["subject", "Bug"], ["t", "bug"]] });
    expect(isValidGitIssue(issue)).toBe(true);
    expect(isValidGitIssue(user.event({ kind: GIT_ISSUE_KIND }))).toBe(false);
    expect(getGitIssueSubject(issue)).toBe("Bug");
    expect(getGitIssueLabels(issue)).toEqual(["bug"]);
  });

  it("parses patches", () => {
    const content = "From abc Mon Sep 17 00:00:00 2001\nSubject: [PATCH 1/2] Fix the\n thing\n\nbody";
    const patch = user.event({ kind: GIT_PATCH_KIND, content, tags: [repoTag, ["t", "root"], ["t", "fix"]] });
    expect(isValidGitPatch(patch)).toBe(true);
    expect(isGitPatchRoot(patch)).toBe(true);
    expect(getGitPatchSubject(patch)).toBe("Fix the thing");
    expect(getGitPatchLabels(patch)).toEqual(["fix"]);
  });

  it("parses pull requests and updates", () => {
    const pr = user.event({
      kind: GIT_PULL_REQUEST_KIND,
      tags: [repoTag, ["subject", "Feature"], ["c", "c".repeat(40)], ["clone", "https://git.example/a.git"]],
    });
    expect(isValidGitPullRequest(pr)).toBe(true);
    expect(getGitPullRequestSubject(pr)).toBe("Feature");
    expect(getGitPullRequestTipCommit(pr)).toBe("c".repeat(40));
    expect(getGitPullRequestCloneUrls(pr)).toEqual(["https://git.example/a.git"]);

    const update = user.event({
      kind: GIT_PULL_REQUEST_UPDATE_KIND,
      tags: [repoTag, ["E", pr.id], ["P", pr.pubkey], ["c", "d".repeat(40)], ["clone", "https://git.example/a.git"]],
    });
    expect(isValidGitPullRequestUpdate(update)).toBe(true);
    expect(getGitPullRequestUpdateTarget(update)).toBe(pr.id);
  });
});

describe("NIP-34 malformed input handling", () => {
  it("rejects PRs without fetchable tips and invalid update targets or authors", () => {
    const valid = [repoTag, ["c", "a".repeat(40)], ["clone", "git@example.com:repo.git"]];
    expect(isValidGitPullRequest(user.event({ kind: GIT_PULL_REQUEST_KIND, tags: valid }))).toBe(true);
    for (const tags of [
      [repoTag],
      [repoTag, ["c", "bad"], ["clone", "url"]],
      [repoTag, ["c", "a".repeat(40)], ["clone", " "]],
    ])
      expect(isValidGitPullRequest(user.event({ kind: GIT_PULL_REQUEST_KIND, tags }))).toBe(false);
    const update = [
      ["E", "a".repeat(64)],
      ["P", OWNER],
      ["c", "b".repeat(40)],
      ["clone", "git@example.com:repo.git"],
    ];
    for (const name of ["E", "P", "c", "clone"])
      expect(
        isValidGitPullRequestUpdate(
          user.event({ kind: GIT_PULL_REQUEST_UPDATE_KIND, tags: update.filter((t) => t[0] !== name) }),
        ),
      ).toBe(false);
    expect(getGitPullRequestUpdateTarget(user.event({ tags: [["E", "bad"]] }))).toBeUndefined();
  });

  it("retains unsigned commit signatures and validates committer numbers", () => {
    const patch = user.event({
      kind: GIT_PATCH_KIND,
      tags: [
        ["commit-pgp-sig", ""],
        ["committer", "A", "a@b", "100", "-60"],
      ],
    });
    expect(getGitPatchCommitSignature(patch)).toBe("");
    expect(getGitPatchCommitter(patch)).toEqual({ name: "A", email: "a@b", timestamp: 100, timezoneOffset: -60 });
    expect(getGitPatchCommitter(user.event({ tags: [["committer", "A", "a@b", "bad", "0"]] }))).toBeUndefined();
    expect(getGitPatchPreviousPointer(user.event({ tags: [["e", "bad", "", "reply"]] }))).toBeUndefined();
  });
});

it("preserves safe relay and author hints in git event pointers", () => {
  const id = "a".repeat(64);
  const event = user.event({
    tags: [
      ["E", id, "wss://relay.example.com"],
      ["P", OWNER],
      ["e", id, "wss://patch.example.com"],
    ],
  });
  expect(getGitPullRequestUpdatePointer(event)).toEqual({ id, author: OWNER, relays: ["wss://relay.example.com/"] });
  expect(getGitPullRequestPatchPointer(event)).toEqual({ id, relays: ["wss://patch.example.com/"] });
  expect(
    getGitPatchPreviousPointer(user.event({ tags: [["e", id, "https://invalid.example", "reply", OWNER]] })),
  ).toEqual({ id, author: OWNER });
});
