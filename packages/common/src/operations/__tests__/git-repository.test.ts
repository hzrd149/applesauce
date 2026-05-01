import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { GIT_REPOSITORY_KIND, GitRepositoryPointer } from "../../helpers/git-repository.js";
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
  setGitRepositoryRelays,
  setGitRepositoryUpstream,
  setGitRepositoryWebUrls,
} from "../git-repository.js";

function createDraft(tags: string[][] = []): EventTemplate {
  return { kind: GIT_REPOSITORY_KIND, content: "", tags, created_at: unixNow() };
}

const UPSTREAM_PUBKEY = "f".repeat(64);
const upstreamPointer = (relay?: string): GitRepositoryPointer => ({
  kind: GIT_REPOSITORY_KIND,
  pubkey: UPSTREAM_PUBKEY,
  identifier: "upstream-repo",
  ...(relay ? { relays: [relay] } : {}),
});

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

  it("uses separate t tags per topic (NIP-34)", async () => {
    const draft = await addGitRepositoryHashtag("nostr")(await addGitRepositoryHashtag("rust")(createDraft()));
    expect(draft.tags).toEqual([
      ["t", "rust"],
      ["t", "nostr"],
    ]);
  });

  it("sets upstream pointer with relay hint", async () => {
    const withUpstream = await setGitRepositoryUpstream(upstreamPointer("wss://relay.example.com"))(createDraft());
    expect(withUpstream.tags).toEqual([
      ["u", `${GIT_REPOSITORY_KIND}:${UPSTREAM_PUBKEY}:upstream-repo`, "wss://relay.example.com/"],
    ]);
  });

  it("sets upstream pointer without relay hint", async () => {
    const withUpstream = await setGitRepositoryUpstream(upstreamPointer())(createDraft());
    expect(withUpstream.tags).toEqual([["u", `${GIT_REPOSITORY_KIND}:${UPSTREAM_PUBKEY}:upstream-repo`]]);
  });

  it("modifies existing upstream pointer", async () => {
    const initial = await setGitRepositoryUpstream(upstreamPointer("wss://old.relay"))(createDraft());
    const updated = await setGitRepositoryUpstream({
      kind: GIT_REPOSITORY_KIND,
      pubkey: "a".repeat(64),
      identifier: "other-repo",
      relays: ["wss://new.relay"],
    })(initial);
    expect(updated.tags).toEqual([
      ["u", `${GIT_REPOSITORY_KIND}:${"a".repeat(64)}:other-repo`, "wss://new.relay/"],
    ]);
  });

  it("removes upstream pointer", async () => {
    const initial = await setGitRepositoryUpstream(upstreamPointer())(createDraft());
    const cleared = await setGitRepositoryUpstream(null)(initial);
    expect(cleared.tags).toEqual([]);
  });

  it("rejects upstream pointer with wrong kind", async () => {
    await expect(
      setGitRepositoryUpstream({ kind: 30000 as any, pubkey: UPSTREAM_PUBKEY, identifier: "x" })(createDraft()),
    ).rejects.toThrow();
  });

  it("rejects upstream pointer without identifier", async () => {
    await expect(
      setGitRepositoryUpstream({ kind: GIT_REPOSITORY_KIND, pubkey: UPSTREAM_PUBKEY, identifier: "" })(createDraft()),
    ).rejects.toThrow();
  });
});
