import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GitRepositoryFactory } from "../../factories/git-repository.js";
import { GitPatchFactory } from "../../factories/git-patch.js";
import { GitPullRequestFactory } from "../../factories/git-pull-request.js";
import { GitPullRequestUpdateFactory } from "../../factories/git-pull-request-update.js";
import { GitAppliedStatusFactory } from "../../factories/git-applied-status.js";
import { GitClosedStatusFactory } from "../../factories/git-closed-status.js";
import { GitOpenStatusFactory } from "../../factories/git-open-status.js";
import { CommentFactory } from "../../factories/comment.js";
import { GitPatch } from "../../casts/git-patch.js";
import { GitPullRequest } from "../../casts/git-pull-request.js";
import { GitPatchOriginalRootModel } from "../git.js";

const owner = new FakeUser(),
  author = new FakeUser(),
  stranger = new FakeUser();
const repoPointer = { kind: 30617 as const, pubkey: owner.pubkey, identifier: "repo" };
const a = "a".repeat(40),
  b = "b".repeat(40),
  c = "c".repeat(40);
const urls = ["https://git.example/repo.git"];

async function setup() {
  const store = new EventStore();
  const repo = await GitRepositoryFactory.create("repo").sign(owner);
  store.add(repo);
  const root = await GitPatchFactory.create(repo, "Subject: [PATCH] Root").created(100).sign(author);
  const second = await GitPatchFactory.next(root, "Subject: [PATCH 2/2] Second").created(101).sign(author);
  const revision = await GitPatchFactory.revision(root, "Subject: [PATCH v2] Revision").created(200).sign(author);
  const revisedSecond = await GitPatchFactory.next(revision, "Subject: [PATCH v2 2/2] Second")
    .created(201)
    .sign(author);
  const otherRevision = await GitPatchFactory.revision(root, "Subject: [PATCH v3] Another").created(300).sign(stranger);
  for (const event of [root, second, revision, revisedSecond, otherRevision]) store.add(event);
  return { store, root, second, revision, revisedSecond, otherRevision };
}

describe("NIP-34 reactive integration", () => {
  it("resolves previous patches, series roots, original roots and ordered series", async () => {
    const { store, root, second, revision, revisedSecond, otherRevision } = await setup();
    const patch = new GitPatch(revisedSecond, store);
    expect((await firstValueFrom(patch.previous$))?.id).toBe(revision.id);
    expect((await firstValueFrom(patch.seriesRoot$))?.id).toBe(revision.id);
    expect((await firstValueFrom(patch.originalRoot$))?.id).toBe(root.id);
    expect((await firstValueFrom(patch.series$)).map((event) => event.id)).toEqual([revision.id, revisedSecond.id]);
    expect((await firstValueFrom(new GitPatch(second, store).series$)).map((event) => event.id)).toEqual([
      root.id,
      second.id,
    ]);
    expect((await firstValueFrom(patch.revisions$)).map((event) => event.id)).toEqual([otherRevision.id, revision.id]);
  });

  it("inherits closed status and closes only unaccepted revisions after application", async () => {
    const { store, root, revision, revisedSecond, otherRevision } = await setup();
    const accepted = new GitPatch(revisedSecond, store),
      rejected = new GitPatch(otherRevision, store);
    store.add(await GitClosedStatusFactory.create(root).created(400).sign(owner));
    expect(await firstValueFrom(accepted.status$)).toBe("closed");
    store.add(await GitAppliedStatusFactory.create(root).acceptedRevision(revision).created(500).sign(owner));
    expect(await firstValueFrom(accepted.status$)).toBe("applied");
    expect(await firstValueFrom(rejected.status$)).toBe("closed");
    expect((await firstValueFrom(accepted.statusEvent$))?.created_at).toBe(500);
    store.add(await GitOpenStatusFactory.create(root).created(600).sign(stranger));
    expect(await firstValueFrom(accepted.status$)).toBe("applied");
    store.add(await GitOpenStatusFactory.create(root).created(700).sign(author));
    expect(await firstValueFrom(rejected.status$)).toBe("open");
  });

  it("recognizes acceptance through an applied member of the revised series", async () => {
    const { store, root, revision, revisedSecond, otherRevision } = await setup();
    store.add(await GitAppliedStatusFactory.create(root).appliedPatches([revisedSecond.id]).created(400).sign(owner));
    expect(await firstValueFrom(new GitPatch(revision, store).status$)).toBe("applied");
    expect(await firstValueFrom(new GitPatch(otherRevision, store).status$)).toBe("closed");
  });

  it("resolves ancestors arriving later and rejects cyclic or cross-repository ancestry", async () => {
    const { root, revision } = await setup();
    const store = new EventStore();
    store.add(revision);
    const values: (string | undefined)[] = [];
    const subscription = store.model(GitPatchOriginalRootModel, revision).subscribe((event) => values.push(event?.id));
    expect(values.at(-1)).toBeUndefined();
    store.add(root);
    expect(values.at(-1)).toBe(root.id);
    subscription.unsubscribe();
    const cyclicA = author.event({
      kind: 1617,
      tags: [
        ["a", `30617:${owner.pubkey}:repo`],
        ["e", "b".repeat(64), "", "reply"],
      ],
    });
    const cyclicB = author.event({
      kind: 1617,
      tags: [
        ["a", `30617:${owner.pubkey}:repo`],
        ["e", cyclicA.id, "", "reply"],
      ],
    });
    // The malicious cycle is modeled with fixed ids so both references can point backwards.
    cyclicB.id = "b".repeat(64);
    store.add(cyclicA);
    store.add(cyclicB);
    expect(await firstValueFrom(store.model(GitPatchOriginalRootModel, cyclicA))).toBeUndefined();
    const wrongRepo = author.event({
      kind: 1617,
      tags: [
        ["a", `30617:${owner.pubkey}:other`],
        ["e", root.id, "", "reply"],
      ],
    });
    expect(await firstValueFrom(store.model(GitPatchOriginalRootModel, wrongRepo))).toBeUndefined();
  });

  it("tracks patch revisions and NIP-22 comments as activity", async () => {
    const { store, root } = await setup();
    const cast = new GitPatch(root, store);
    expect(await firstValueFrom(cast.updatedAt$)).toBe(300);
    const comment = await CommentFactory.create(root, "Review").created(500).sign(stranger);
    store.add(comment);
    store.add(stranger.event({ kind: 1111, created_at: 600, tags: [["E", root.id]] }));
    expect((await firstValueFrom(cast.comments$)).map((event) => event.id)).toEqual([comment.id]);
    expect(await firstValueFrom(cast.updatedAt$)).toBe(500);
  });

  it("keeps tip, clone URLs and merge base together and ignores malformed or unauthorized updates", async () => {
    const store = new EventStore();
    const pr = await GitPullRequestFactory.create(repoPointer, "Fix", a, urls).mergeBase(b).created(100).sign(author);
    store.add(pr);
    const cast = new GitPullRequest(pr, store);
    const states: string[] = [];
    const subscription = cast.state$.subscribe((state) => states.push(state.tipCommit));
    expect(await firstValueFrom(cast.state$)).toMatchObject({ tipCommit: a, cloneUrls: urls, mergeBase: b });
    const update = await GitPullRequestUpdateFactory.create(pr, b, ["git@example.com:fork.git"])
      .mergeBase(c)
      .created(200)
      .sign(author);
    store.add(update);
    expect(await firstValueFrom(cast.state$)).toMatchObject({
      event: update,
      tipCommit: b,
      cloneUrls: ["git@example.com:fork.git"],
      mergeBase: c,
    });
    expect(await firstValueFrom(cast.latestCloneUrls$)).toEqual(["git@example.com:fork.git"]);
    expect(await firstValueFrom(cast.latestMergeBase$)).toBe(c);
    const invalid = author.event({
      kind: 1619,
      created_at: 300,
      tags: [
        ["E", pr.id],
        ["P", author.pubkey],
      ],
    });
    store.add(invalid);
    store.add(await GitPullRequestUpdateFactory.create(pr, c, urls).created(400).sign(stranger));
    store.add(await GitPullRequestUpdateFactory.create(pr, c, urls).created(50).sign(author));
    const wrongAuthorTag = author.event({
      kind: 1619,
      created_at: 450,
      tags: [
        ["E", pr.id],
        ["P", stranger.pubkey],
        ["c", c],
        ["clone", ...urls],
      ],
    });
    store.add(wrongAuthorTag);
    expect(await firstValueFrom(cast.latestTipCommit$)).toBe(b);
    expect((await firstValueFrom(cast.updates$)).map((event) => event.id)).toEqual([update.id]);
    expect(await firstValueFrom(cast.updatedAt$)).toBe(200);
    expect(states.at(-1)).toBe(b);
    // A newer update without merge-base clears the old optional value.
    store.add(await GitPullRequestUpdateFactory.create(pr, c, urls).created(500).sign(author));
    expect(await firstValueFrom(cast.latestMergeBase$)).toBeUndefined();
    expect(await firstValueFrom(cast.latestTipCommit$)).toBe(c);
    subscription.unsubscribe();
  });

  it("resolves PR updates and patch-to-PR relationships", async () => {
    const { store, root } = await setup();
    const pr = await GitPullRequestFactory.create(repoPointer, "Large revision", a, urls).patch(root).sign(author);
    store.add(pr);
    expect((await firstValueFrom(new GitPullRequest(pr, store).patch$))?.id).toBe(root.id);
    const update = await GitPullRequestUpdateFactory.create(pr, b, urls).sign(author);
    store.add(update);
    const updates = await firstValueFrom(new GitPullRequest(pr, store).updates$);
    expect((await firstValueFrom(updates[0].pullRequest$))?.id).toBe(pr.id);
  });
});
