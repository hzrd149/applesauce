import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { getHiddenTags, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GIT_AUTHORS_KIND, GIT_REPOSITORIES_KIND, REPOSITORY_ANNOUNCEMENT_KIND } from "../../helpers/git-lists.js";
import { GitAuthorsFactory } from "../git-authors.js";
import { GitRepositoriesFactory } from "../git-repositories.js";

const HEX = (char: string, length = 64) => char.repeat(length);

describe("GitAuthorsFactory", () => {
  it("builds and modifies git authors lists", async () => {
    const author = HEX("a");
    const draft = await GitAuthorsFactory.create().addAuthor(author);

    expect(draft.kind).toBe(GIT_AUTHORS_KIND);
    expect(draft.tags).toEqual([["p", author]]);

    const modified = await GitAuthorsFactory.modify({ ...draft, id: HEX("1"), pubkey: HEX("2"), sig: HEX("3", 128) })
      .removeAuthor(author)
      .addAuthor({ pubkey: HEX("b"), relays: ["wss://relay.example"] });

    expect(modified.tags).toEqual([["p", HEX("b"), "wss://relay.example"]]);
  });

  it("adds hidden authors", async () => {
    const user = new FakeUser();
    const author = HEX("c");
    const event = await GitAuthorsFactory.create().as(user).addAuthor(author, true).sign();

    expect(event.tags).toEqual([]);
    await unlockHiddenTags(event, user);
    expect(getHiddenTags(event)).toEqual([["p", author]]);
    expect(event.content).not.toBe("");
    expect(event.kind).toBe(GIT_AUTHORS_KIND);
  });
});

describe("GitRepositoriesFactory", () => {
  it("builds git repositories lists", async () => {
    const repo = { kind: REPOSITORY_ANNOUNCEMENT_KIND, pubkey: HEX("a"), identifier: "applesauce" } as const;
    const draft = await GitRepositoriesFactory.create().addRepository(repo);

    expect(draft.kind).toBe(GIT_REPOSITORIES_KIND);
    expect(draft.tags).toEqual([["a", `${REPOSITORY_ANNOUNCEMENT_KIND}:${HEX("a")}:applesauce`]]);
  });

  it("removes repository addresses", async () => {
    const address = `${REPOSITORY_ANNOUNCEMENT_KIND}:${HEX("a")}:applesauce`;
    const existing: NostrEvent = {
      kind: GIT_REPOSITORIES_KIND,
      id: HEX("1"),
      pubkey: HEX("2"),
      sig: HEX("3", 128),
      created_at: 1,
      content: "",
      tags: [["a", address]],
    };

    const draft = await GitRepositoriesFactory.modify(existing).removeRepository(address);

    expect(draft.tags).toEqual([]);
  });

  it("rejects non-repository addresses", async () => {
    expect(() => GitRepositoriesFactory.create().addRepository(`${kinds.LongFormArticle}:${HEX("a")}:article`)).toThrow(
      "Repository address must be kind 30617",
    );
  });
});
