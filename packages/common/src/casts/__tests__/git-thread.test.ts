import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GitRepositoryFactory } from "../../factories/git-repository.js";
import { GitAppliedStatusFactory } from "../../factories/git-applied-status.js";
import { GitClosedStatusFactory } from "../../factories/git-closed-status.js";
import { COMMENT_KIND } from "../../helpers/comment.js";
import { GIT_ISSUE_KIND } from "../../helpers/git-issue.js";
import { GIT_PULL_REQUEST_KIND, GIT_PULL_REQUEST_UPDATE_KIND } from "../../helpers/git-pull-request.js";
import { GitIssue } from "../git-issue.js";
import { GitPullRequest } from "../git-pull-request.js";
import { GitRepository } from "../git-repository.js";
import { castUser } from "../user.js";

const owner = new FakeUser();
const maintainer = new FakeUser();
const contributor = new FakeUser();

async function setup() {
  const store = new EventStore();
  const repo = await GitRepositoryFactory.create("applesauce").maintainer(maintainer.pubkey).sign(owner);
  const repoTag = ["a", `30617:${owner.pubkey}:applesauce`];
  const pr = contributor.event({
    kind: GIT_PULL_REQUEST_KIND,
    created_at: 100,
    tags: [repoTag, ["subject", "PR"], ["c", "c".repeat(40)], ["clone", "https://git.example/repo.git"]],
  });
  const issue = contributor.event({ kind: GIT_ISSUE_KIND, created_at: 100, tags: [repoTag] });
  store.add(repo);
  store.add(pr);
  store.add(issue);
  return { store, repo, pr, issue };
}

describe("git thread casts", () => {
  it("lists issues and pull requests on the repository", async () => {
    const { store, repo } = await setup();
    const cast = new GitRepository(repo, store);
    expect((await firstValueFrom(cast.issues$)).map((i) => i.title)).toEqual([""]);
    expect((await firstValueFrom(cast.pullRequests$)).map((p) => p.title)).toEqual(["PR"]);
  });

  it("resolves the status from repository maintainers", async () => {
    const { store, pr } = await setup();
    const cast = new GitPullRequest(pr, store);
    expect(await firstValueFrom(cast.status$)).toBe("open");

    store.add(await GitAppliedStatusFactory.create(pr).created(200).sign(maintainer));
    expect(await firstValueFrom(cast.status$)).toBe("applied");

    // Statuses from unrelated users are ignored
    store.add(await GitClosedStatusFactory.create(pr).created(300).sign(new FakeUser()));
    expect(await firstValueFrom(cast.status$)).toBe("applied");
  });

  it("tracks the latest activity", async () => {
    const { store, pr, issue } = await setup();
    const cast = new GitPullRequest(pr, store);
    expect(await firstValueFrom(cast.updatedAt$)).toBe(100);

    store.add(
      contributor.event({
        kind: GIT_PULL_REQUEST_UPDATE_KIND,
        created_at: 150,
        tags: [
          ["E", pr.id],
          ["P", pr.pubkey],
          ["c", "d".repeat(40)],
          ["clone", "https://git.example/repo.git"],
        ],
      }),
    );
    expect(await firstValueFrom(cast.updatedAt$)).toBe(150);

    const tags = [
      ["E", pr.id],
      ["K", "1618"],
      ["e", pr.id],
      ["k", "1618"],
    ];
    store.add(owner.event({ kind: COMMENT_KIND, created_at: 400, tags }));
    expect(await firstValueFrom(cast.updatedAt$)).toBe(400);
    expect((await firstValueFrom(cast.comments$)).length).toBe(1);

    expect(await firstValueFrom(new GitIssue(issue, store).updatedAt$)).toBe(100);
  });

  it("lists a user's repositories", async () => {
    const { store } = await setup();
    const repos = await firstValueFrom(castUser(owner.pubkey, store).gitRepositories$);
    expect(repos.map((r) => r.identifier)).toEqual(["applesauce"]);
  });
});
