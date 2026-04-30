import { unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GIT_AUTHORS_KIND, GIT_REPOSITORIES_KIND, REPOSITORY_ANNOUNCEMENT_KIND } from "../../helpers/git-lists.js";
import { FavoriteGitRepos, GitAuthors } from "../git-lists.js";

const user = new FakeUser();
const store = {} as any;

describe("GitAuthors", () => {
  it("casts git authors lists", async () => {
    const publicAuthor = "a".repeat(64);
    const hiddenAuthor = "b".repeat(64);
    const event = user.event({
      kind: GIT_AUTHORS_KIND,
      tags: [["p", publicAuthor]],
      content: await user.nip44.encrypt(user.pubkey, JSON.stringify([["p", hiddenAuthor]])),
    });
    const cast = new GitAuthors(event, store);

    expect(cast.pubkeys).toEqual([publicAuthor]);
    expect(cast.hasHidden).toBe(true);
    expect(cast.unlocked).toBe(false);

    await cast.unlock(user);

    expect(cast.unlocked).toBe(true);
    expect(cast.hidden).toEqual([expect.objectContaining({ pubkey: hiddenAuthor })]);
  });
});

describe("GitRepositories", () => {
  it("casts git repositories lists", async () => {
    const publicRepo = `${REPOSITORY_ANNOUNCEMENT_KIND}:${user.pubkey}:applesauce`;
    const hiddenRepo = `${REPOSITORY_ANNOUNCEMENT_KIND}:${user.pubkey}:hidden`;
    const event = user.event({
      kind: GIT_REPOSITORIES_KIND,
      tags: [["a", publicRepo]],
      content: await user.nip44.encrypt(user.pubkey, JSON.stringify([["a", hiddenRepo]])),
    });
    const cast = new FavoriteGitRepos(event, store);

    expect(cast.repositories).toEqual([expect.objectContaining({ identifier: "applesauce" })]);

    await unlockHiddenTags(event, user);

    expect(cast.hidden).toEqual([expect.objectContaining({ identifier: "hidden" })]);
  });
});
