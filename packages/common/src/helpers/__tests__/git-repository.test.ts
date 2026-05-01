import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getGitRepositoryCloneUrls,
  getGitRepositoryDescription,
  getGitRepositoryEarliestUniqueCommit,
  getGitRepositoryHashtags,
  getGitRepositoryIdentifier,
  getGitRepositoryMaintainers,
  getGitRepositoryName,
  getGitRepositoryRelays,
  getGitRepositoryUpstream,
  getGitRepositoryWebUrls,
  GIT_REPOSITORY_KIND,
  isValidGitRepository,
} from "../git-repository.js";

const user = new FakeUser();
const UPSTREAM_PUBKEY = "f".repeat(64);

describe("git repository helpers", () => {
  it("validates repository announcements", () => {
    expect(isValidGitRepository(user.event({ kind: GIT_REPOSITORY_KIND, tags: [["d", "applesauce"]] }))).toBe(true);
    expect(isValidGitRepository(user.event({ kind: GIT_REPOSITORY_KIND }))).toBe(false);
  });

  it("returns repository metadata", () => {
    const event = user.event({
      kind: GIT_REPOSITORY_KIND,
      tags: [
        ["d", "applesauce"],
        ["name", "Applesauce"],
        ["description", "Nostr tools"],
        ["web", "https://git.example/applesauce", "https://mirror.example/applesauce"],
        ["clone", "https://git.example/applesauce.git"],
        ["relays", "wss://relay.example"],
        ["r", "abc123", "euc"],
        ["maintainers", user.pubkey],
        ["t", "typescript"],
        ["u", `${GIT_REPOSITORY_KIND}:${UPSTREAM_PUBKEY}:upstream-repo`, "wss://relay.example.com/"],
      ],
    });

    expect(getGitRepositoryIdentifier(event)).toBe("applesauce");
    expect(getGitRepositoryName(event)).toBe("Applesauce");
    expect(getGitRepositoryDescription(event)).toBe("Nostr tools");
    expect(getGitRepositoryWebUrls(event)).toEqual([
      "https://git.example/applesauce",
      "https://mirror.example/applesauce",
    ]);
    expect(getGitRepositoryCloneUrls(event)).toEqual(["https://git.example/applesauce.git"]);
    expect(getGitRepositoryRelays(event)).toEqual(["wss://relay.example/"]);
    expect(getGitRepositoryEarliestUniqueCommit(event)).toBe("abc123");
    expect(getGitRepositoryMaintainers(event)).toEqual([user.pubkey]);
    expect(getGitRepositoryHashtags(event)).toEqual(["typescript"]);
    expect(getGitRepositoryUpstream(event)).toEqual({
      kind: GIT_REPOSITORY_KIND,
      pubkey: UPSTREAM_PUBKEY,
      identifier: "upstream-repo",
      relays: ["wss://relay.example.com/"],
    });
  });

  it("parses upstream pointer without relay hint", () => {
    const event = user.event({
      kind: GIT_REPOSITORY_KIND,
      tags: [
        ["d", "applesauce"],
        ["u", `${GIT_REPOSITORY_KIND}:${UPSTREAM_PUBKEY}:upstream-repo`],
      ],
    });

    expect(getGitRepositoryUpstream(event)).toEqual({
      kind: GIT_REPOSITORY_KIND,
      pubkey: UPSTREAM_PUBKEY,
      identifier: "upstream-repo",
    });
  });

  it("ignores upstream pointers with wrong kind or invalid pubkey", () => {
    const wrongKind = user.event({
      kind: GIT_REPOSITORY_KIND,
      tags: [
        ["d", "applesauce"],
        ["u", `30000:${UPSTREAM_PUBKEY}:upstream-repo`],
      ],
    });
    const badPubkey = user.event({
      kind: GIT_REPOSITORY_KIND,
      tags: [
        ["d", "applesauce"],
        ["u", `${GIT_REPOSITORY_KIND}:not-a-pubkey:upstream-repo`],
      ],
    });
    const noIdentifier = user.event({
      kind: GIT_REPOSITORY_KIND,
      tags: [
        ["d", "applesauce"],
        ["u", `${GIT_REPOSITORY_KIND}:${UPSTREAM_PUBKEY}:`],
      ],
    });

    expect(getGitRepositoryUpstream(wrongKind)).toBeUndefined();
    expect(getGitRepositoryUpstream(badPubkey)).toBeUndefined();
    expect(getGitRepositoryUpstream(noIdentifier)).toBeUndefined();
  });
});
