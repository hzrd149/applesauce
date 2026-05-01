import { type NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { GIT_REPOSITORY_KIND } from "../../helpers/git-repository.js";
import { GitRepositoryFactory } from "../git-repository.js";

const HEX = (char: string, length = 64) => char.repeat(length);

describe("GitRepositoryFactory", () => {
  it("builds a repository announcement", async () => {
    const draft = await GitRepositoryFactory.create("applesauce")
      .name("Applesauce")
      .description("Nostr tools")
      .addWebUrl("https://git.example/applesauce")
      .addClone("https://git.example/applesauce.git")
      .addRelay("wss://relay.example")
      .earliestUniqueCommit("abc123")
      .maintainer(HEX("a"))
      .hashtag("typescript")
      .upstream({
        kind: GIT_REPOSITORY_KIND,
        pubkey: HEX("f"),
        identifier: "upstream",
        relays: ["wss://relay.example.com"],
      });

    expect(draft.kind).toBe(GIT_REPOSITORY_KIND);
    expect(draft.tags).toEqual([
      ["d", "applesauce"],
      ["name", "Applesauce"],
      ["description", "Nostr tools"],
      ["web", "https://git.example/applesauce"],
      ["clone", "https://git.example/applesauce.git"],
      ["relays", "wss://relay.example/"],
      ["r", "abc123", "euc"],
      ["maintainers", HEX("a")],
      ["t", "typescript"],
      ["u", `${GIT_REPOSITORY_KIND}:${HEX("f")}:upstream`, "wss://relay.example.com/"],
    ]);
  });

  it("modifies a repository announcement and removes upstream", async () => {
    const existing: NostrEvent = {
      kind: GIT_REPOSITORY_KIND,
      id: HEX("1"),
      pubkey: HEX("2"),
      sig: HEX("a", 128),
      created_at: 1,
      content: "",
      tags: [
        ["d", "applesauce"],
        ["name", "Old"],
        ["u", `${GIT_REPOSITORY_KIND}:${HEX("f")}:upstream`, "wss://relay.example.com/"],
      ],
    };

    const draft = await GitRepositoryFactory.modify(existing).name("New").upstream(null);

    expect(draft.tags).toEqual([
      ["d", "applesauce"],
      ["name", "New"],
    ]);
  });
});
