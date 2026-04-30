import { unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getGitAuthors,
  getGitRepositories,
  GIT_AUTHORS_KIND,
  GIT_REPOSITORIES_KIND,
  isValidGitAuthorsList,
  isValidGitRepositoriesList,
  REPOSITORY_ANNOUNCEMENT_KIND,
} from "../git-lists.js";

const user = new FakeUser();

describe("git list helpers", () => {
  it("validates git authors and repositories list kinds", () => {
    expect(isValidGitAuthorsList(user.event({ kind: GIT_AUTHORS_KIND }))).toBe(true);
    expect(isValidGitAuthorsList(user.event({ kind: GIT_REPOSITORIES_KIND }))).toBe(false);

    expect(isValidGitRepositoriesList(user.event({ kind: GIT_REPOSITORIES_KIND }))).toBe(true);
    expect(isValidGitRepositoriesList(user.event({ kind: GIT_AUTHORS_KIND }))).toBe(false);
  });

  it("returns git authors from public and hidden tags", async () => {
    const publicAuthor = "a".repeat(64);
    const hiddenAuthor = "b".repeat(64);
    const list = user.event({
      kind: GIT_AUTHORS_KIND,
      tags: [["p", publicAuthor, "wss://relay.example"]],
      content: await user.nip44.encrypt(user.pubkey, JSON.stringify([["p", hiddenAuthor]])),
    });

    expect(getGitAuthors(list)).toEqual([expect.objectContaining({ pubkey: publicAuthor })]);
    expect(getGitAuthors(list, "hidden")).toEqual([]);

    await unlockHiddenTags(list, user);

    expect(getGitAuthors(list, "hidden")).toEqual([expect.objectContaining({ pubkey: hiddenAuthor })]);
    expect(getGitAuthors(list, "all")).toEqual([
      expect.objectContaining({ pubkey: hiddenAuthor }),
      expect.objectContaining({ pubkey: publicAuthor }),
    ]);
  });

  it("returns only NIP-34 repository announcement pointers", async () => {
    const publicRepo = `${REPOSITORY_ANNOUNCEMENT_KIND}:${user.pubkey}:applesauce`;
    const hiddenRepo = `${REPOSITORY_ANNOUNCEMENT_KIND}:${user.pubkey}:hidden`;
    const article = `30023:${user.pubkey}:article`;
    const list = user.event({
      kind: GIT_REPOSITORIES_KIND,
      tags: [
        ["a", publicRepo, "wss://relay.example"],
        ["a", article],
      ],
      content: await user.nip44.encrypt(user.pubkey, JSON.stringify([["a", hiddenRepo]])),
    });

    expect(getGitRepositories(list)).toEqual([
      expect.objectContaining({ kind: REPOSITORY_ANNOUNCEMENT_KIND, identifier: "applesauce" }),
    ]);

    await unlockHiddenTags(list, user);

    expect(getGitRepositories(list, "all")).toEqual([
      expect.objectContaining({ kind: REPOSITORY_ANNOUNCEMENT_KIND, identifier: "hidden" }),
      expect.objectContaining({ kind: REPOSITORY_ANNOUNCEMENT_KIND, identifier: "applesauce" }),
    ]);
  });
});
