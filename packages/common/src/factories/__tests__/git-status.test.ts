import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GIT_ISSUE_KIND } from "../../helpers/git-issue.js";
import { GIT_STATUS_APPLIED_KIND, GIT_STATUS_CLOSED_KIND } from "../../helpers/git-status.js";
import { GitIssueFactory } from "../git-issue.js";
import { GitRepositoryFactory } from "../git-repository.js";
import { GitAppliedStatusFactory } from "../git-applied-status.js";
import { GitClosedStatusFactory } from "../git-closed-status.js";

const owner = new FakeUser();
const user = new FakeUser();

describe("GitIssueFactory", () => {
  it("creates an issue for a repository", async () => {
    const repo = await GitRepositoryFactory.create("applesauce").earliestUniqueCommit("e".repeat(40)).sign(owner);
    const draft = await GitIssueFactory.create(repo, "Bug", "It broke").addLabel("bug");

    expect(draft.kind).toBe(GIT_ISSUE_KIND);
    expect(draft.content).toBe("It broke");
    expect(draft.tags).toEqual([
      ["a", `30617:${owner.pubkey}:applesauce`],
      ["p", owner.pubkey],
      ["r", "e".repeat(40)],
      ["subject", "Bug"],
      ["t", "bug"],
    ]);
  });
});

describe("git status factories", () => {
  it("creates a status for an issue", async () => {
    const issue = await GitIssueFactory.create({ kind: 30617, pubkey: owner.pubkey, identifier: "a" }, "Bug").sign(
      user,
    );
    const draft = await GitClosedStatusFactory.create(issue, "Duplicate");

    expect(draft.kind).toBe(GIT_STATUS_CLOSED_KIND);
    expect(draft.content).toBe("Duplicate");
    expect(draft.tags).toEqual([
      ["e", issue.id, "", "root", user.pubkey],
      ["a", `30617:${owner.pubkey}:a`],
      ["p", user.pubkey],
      ["p", owner.pubkey],
    ]);
  });

  it("adds applied patches and merge commit", async () => {
    const patch = user.event({
      kind: 1617,
      tags: [
        ["a", `30617:${owner.pubkey}:a`],
        ["t", "root"],
      ],
    });
    const draft = await GitAppliedStatusFactory.create(patch).appliedPatches([patch.id]).mergeCommit("a".repeat(40));

    expect(draft.kind).toBe(GIT_STATUS_APPLIED_KIND);
    expect(draft.tags).toEqual(
      expect.arrayContaining([
        ["q", patch.id],
        ["merge-commit", "a".repeat(40)],
      ]),
    );
  });
});
