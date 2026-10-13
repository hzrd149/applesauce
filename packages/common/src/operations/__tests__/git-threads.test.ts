import { blankEventTemplate } from "applesauce-core/factories";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GitPatchFactory } from "../../factories/git-patch.js";
import { GitAppliedStatusFactory } from "../../factories/git-applied-status.js";
import { GitRepositoryFactory } from "../../factories/git-repository.js";
import { setGitThreadRepository } from "../git-thread.js";
import {
  setGitPatchCommit,
  setGitPatchCommitter,
  setGitPatchLabels,
  setGitPatchPrevious,
  setGitPatchParentCommit,
} from "../git-patch.js";
import {
  setGitPullRequestTipCommit,
  setGitPullRequestCloneUrls,
  setGitPullRequestMergeBase,
  setGitPullRequestPatch,
} from "../git-pull-request.js";
import {
  setGitStatusAppliedCommits,
  setGitStatusAppliedPatches,
  setGitStatusMergeCommit,
  setGitStatusRoot,
} from "../git-status.js";

const owner = new FakeUser(),
  other = new FakeUser();
const a = "a".repeat(40),
  b = "b".repeat(40),
  c = "c".repeat(40);
const repo = { kind: 30617 as const, pubkey: owner.pubkey, identifier: "repo" };

describe("NIP-34 operations", () => {
  it("replaces repositories while preserving commit references and unrelated tags", async () => {
    const source = await GitPatchFactory.create(repo, "Patch").commit(a).sign(owner);
    const announcement = await GitRepositoryFactory.create("other").earliestUniqueCommit(b).sign(other);
    const draft = { ...source, tags: [...source.tags, ["r", c], ["p", "f".repeat(64)], ["custom", "keep"]] };
    const original = structuredClone(draft);
    const result = await setGitThreadRepository(announcement)(draft);
    expect(result.tags).toContainEqual(["r", a]);
    expect(result.tags).toContainEqual(["r", b]);
    expect(result.tags).not.toContainEqual(["r", c]);
    expect(result.tags).not.toContainEqual(["p", owner.pubkey]);
    expect(result.tags).toContainEqual(["p", "f".repeat(64)]);
    expect(result.tags).toContainEqual(["custom", "keep"]);
    expect(JSON.parse(JSON.stringify(draft))).toEqual(original);
  });

  it("replaces patch commit discovery tags and preserves series markers", async () => {
    let draft = await setGitPatchCommit(a)(blankEventTemplate(1617));
    draft = await setGitPatchCommit(b)(draft);
    expect(draft.tags).toEqual([
      ["commit", b],
      ["r", b],
    ]);
    draft = await setGitPatchCommit(null)(draft);
    expect(draft.tags).toEqual([]);
    draft.tags = [
      ["t", "root-revision"],
      ["t", "old"],
    ];
    const labeled = await setGitPatchLabels(["new", "new", "root"])(draft);
    expect(labeled.tags).toEqual([
      ["t", "root-revision"],
      ["t", "new"],
    ]);
    expect(draft.tags).toEqual([
      ["t", "root-revision"],
      ["t", "old"],
    ]);
  });

  it("replaces and removes previous patch references", async () => {
    let draft = await setGitPatchPrevious({ id: "a".repeat(64), relays: ["wss://relay.example"] })(
      blankEventTemplate(1617),
    );
    draft = await setGitPatchPrevious({ id: "b".repeat(64) })(draft);
    expect(draft.tags.filter((t) => t[0] === "e")).toEqual([["e", "b".repeat(64), "", "reply"]]);
    expect((await setGitPatchPrevious(null)(draft)).tags).toEqual([]);
  });

  it("removes stale merge references while preserving applied commit references", async () => {
    let draft = await setGitStatusMergeCommit(a)(blankEventTemplate(1631));
    draft = await setGitStatusMergeCommit(b)(draft);
    expect(draft.tags).toEqual([
      ["merge-commit", b],
      ["r", b],
    ]);
    draft = await setGitStatusAppliedCommits([b, c])(draft);
    draft = await setGitStatusMergeCommit(null)(draft);
    expect(draft.tags).toContainEqual(["r", b]);
    draft = await setGitStatusAppliedCommits([a])(draft);
    expect(draft.tags).not.toContainEqual(["r", b]);
    expect(draft.tags).not.toContainEqual(["r", c]);
    expect(draft.tags).toContainEqual(["r", a]);
  });

  it("clears old status target metadata when replacing the root", async () => {
    const root = await GitPatchFactory.create(repo, "Patch").sign(owner);
    const revision = await GitPatchFactory.revision(root, "Revision").sign(other);
    const otherRoot = await GitPatchFactory.create({ ...repo, pubkey: other.pubkey }, "Other").sign(other);
    const source = await GitAppliedStatusFactory.create(root)
      .acceptedRevision(revision)
      .appliedPatches([revision.id])
      .mergeCommit(a)
      .sign(owner);
    const result = await setGitStatusRoot(otherRoot)(source);
    expect(result.tags.some((t) => ["q", "merge-commit", "r"].includes(t[0]))).toBe(false);
    expect(result.tags.filter((t) => t[0] === "e")).toEqual([["e", otherRoot.id, "", "root", otherRoot.pubkey]]);
    expect(result.tags).not.toContainEqual(["p", owner.pubkey]);
  });

  it("preserves repository discovery when a patch or merge commit shares its id", async () => {
    const announcement = await GitRepositoryFactory.create("repo").earliestUniqueCommit(a).sign(owner);
    const patch = await GitPatchFactory.create(announcement, "Patch").commit(a).sign(owner);
    const changed = await GitPatchFactory.modify(patch).commit(b);
    expect(changed.tags).toContainEqual(["r", a]);
    expect(changed.tags).toContainEqual(["r", b]);
    const next = await GitPatchFactory.next(patch, "Next");
    expect(next.tags).toContainEqual(["r", a]);
    const status = await GitAppliedStatusFactory.create(patch).mergeCommit(a).sign(owner);
    const cleared = await GitAppliedStatusFactory.modify(status).mergeCommit(null);
    expect(cleared.tags).toContainEqual(["r", a]);
    const otherRepo = await GitRepositoryFactory.create("other").earliestUniqueCommit(c).sign(other);
    const moved = await GitPatchFactory.modify(patch).repository(otherRepo).commit(b);
    expect(moved.tags).not.toContainEqual(["r", a]);
    expect(moved.tags).toContainEqual(["r", b]);
    expect(moved.tags).toContainEqual(["r", c]);
  });

  it("accepts SHA-256 git ids and rejects malformed inputs", async () => {
    expect((await setGitPullRequestTipCommit("f".repeat(64))(blankEventTemplate(1618))).tags).toContainEqual([
      "c",
      "f".repeat(64),
    ]);
    for (const op of [
      setGitPatchCommit,
      setGitPatchParentCommit,
      setGitPullRequestTipCommit,
      setGitPullRequestMergeBase,
      setGitStatusMergeCommit,
    ])
      expect(() => op("bad")).toThrow();
    expect(() => setGitPullRequestCloneUrls([" "])).toThrow();
    expect(() => setGitPatchPrevious({ id: "bad" })).toThrow();
    expect(() => setGitPullRequestPatch("bad")).toThrow();
    expect(() => setGitStatusAppliedPatches(["bad"])).toThrow();
    expect(() => setGitStatusAppliedCommits(["bad"])).toThrow();
    expect(() => setGitPatchCommitter({ name: "A", email: "a@b", timestamp: NaN, timezoneOffset: 0 })).toThrow();
  });
});
