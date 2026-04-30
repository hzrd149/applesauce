import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { GIT_REPOSITORY_KIND } from "../../helpers/git-repository.js";
import {
  addGitRepositoryCloneUrl,
  addGitRepositoryHashtag,
  addGitRepositoryMaintainer,
  addGitRepositoryRelay,
  addGitRepositoryWebUrl,
  removeGitRepositoryCloneUrl,
  removeGitRepositoryHashtag,
  removeGitRepositoryMaintainer,
  removeGitRepositoryRelay,
  removeGitRepositoryWebUrl,
  setGitRepositoryCloneUrls,
  setGitRepositoryDescription,
  setGitRepositoryEarliestUniqueCommit,
  setGitRepositoryHashtags,
  setGitRepositoryIdentifier,
  setGitRepositoryMaintainers,
  setGitRepositoryName,
  setGitRepositoryPersonalFork,
  setGitRepositoryRelays,
  setGitRepositoryWebUrls,
} from "../git-repository.js";

function createDraft(tags: string[][] = []): EventTemplate {
  return { kind: GIT_REPOSITORY_KIND, content: "", tags, created_at: unixNow() };
}

describe("git repository operations", () => {
  it("sets singleton metadata", async () => {
    const draft = await setGitRepositoryDescription("Nostr tools")(
      await setGitRepositoryName("Applesauce")(await setGitRepositoryIdentifier("applesauce")(createDraft())),
    );

    expect(draft.tags).toEqual([
      ["d", "applesauce"],
      ["name", "Applesauce"],
      ["description", "Nostr tools"],
    ]);
  });

  it("replaces multi-value tags in bulk", async () => {
    const pubkey = "b".repeat(64);
    const draft = await addGitRepositoryWebUrl("https://old.web")(
      await addGitRepositoryCloneUrl("https://old.git")(
        await addGitRepositoryRelay("wss://old.relay")(await addGitRepositoryMaintainer(pubkey)(createDraft())),
      ),
    );

    const replaced = await setGitRepositoryHashtags(["nostr"])(
      await setGitRepositoryMaintainers(["c".repeat(64)])(
        await setGitRepositoryRelays(["wss://new.relay"])(
          await setGitRepositoryCloneUrls(["https://new.git"])(
            await setGitRepositoryWebUrls(["https://new.web"])(draft),
          ),
        ),
      ),
    );

    expect(replaced.tags).toEqual([
      ["web", "https://new.web"],
      ["clone", "https://new.git"],
      ["relays", "wss://new.relay/"],
      ["maintainers", "c".repeat(64)],
      ["t", "nostr"],
    ]);
  });

  it("setHashtags keeps personal-fork marker", async () => {
    const withFork = await setGitRepositoryPersonalFork()(await addGitRepositoryHashtag("old")(createDraft()));
    const updated = await setGitRepositoryHashtags(["new"])(withFork);
    expect(updated.tags).toEqual([
      ["t", "personal-fork"],
      ["t", "new"],
    ]);
  });

  it("merges repeated adds into one NIP-34 flat tag", async () => {
    const draft = await addGitRepositoryWebUrl("https://b.example")(
      await addGitRepositoryWebUrl("https://a.example")(createDraft()),
    );
    expect(draft.tags).toEqual([["web", "https://a.example", "https://b.example"]]);
  });

  it("adds and removes URLs", async () => {
    const withUrls = await addGitRepositoryCloneUrl("https://git.example/repo.git")(
      await addGitRepositoryWebUrl("https://git.example/repo")(createDraft()),
    );

    expect(withUrls.tags).toEqual([
      ["web", "https://git.example/repo"],
      ["clone", "https://git.example/repo.git"],
    ]);

    const removed = await removeGitRepositoryCloneUrl("https://git.example/repo.git")(
      await removeGitRepositoryWebUrl("https://git.example/repo")(withUrls),
    );
    expect(removed.tags).toEqual([]);
  });

  it("adds and removes relays", async () => {
    const withRelay = await addGitRepositoryRelay("wss://relay.example")(createDraft());
    expect(withRelay.tags).toEqual([["relays", "wss://relay.example/"]]);

    const removed = await removeGitRepositoryRelay("wss://relay.example/")(withRelay);
    expect(removed.tags).toEqual([]);
  });

  it("sets earliest unique commit", async () => {
    const withCommit = await setGitRepositoryEarliestUniqueCommit("abc123")(createDraft([["r", "old", "euc"]]));
    expect(withCommit.tags).toEqual([["r", "abc123", "euc"]]);

    const removed = await setGitRepositoryEarliestUniqueCommit(null)(withCommit);
    expect(removed.tags).toEqual([]);
  });

  it("adds and removes maintainers and hashtags", async () => {
    const pubkey = "a".repeat(64);
    const updated = await addGitRepositoryHashtag("typescript")(
      await addGitRepositoryMaintainer(pubkey)(createDraft()),
    );
    expect(updated.tags).toEqual([
      ["maintainers", pubkey],
      ["t", "typescript"],
    ]);

    const removed = await removeGitRepositoryHashtag("typescript")(
      await removeGitRepositoryMaintainer(pubkey)(updated),
    );
    expect(removed.tags).toEqual([]);
  });

  it("sets personal fork marker", async () => {
    const marked = await setGitRepositoryPersonalFork()(createDraft());
    expect(marked.tags).toEqual([["t", "personal-fork"]]);

    const cleared = await setGitRepositoryPersonalFork(false)(marked);
    expect(cleared.tags).toEqual([]);
  });
});
