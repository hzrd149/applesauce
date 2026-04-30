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
  getGitRepositoryWebUrls,
  GIT_REPOSITORY_KIND,
  isGitRepositoryPersonalFork,
  isValidGitRepository,
} from "../git-repository.js";

const user = new FakeUser();

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
        ["t", "personal-fork"],
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
    expect(isGitRepositoryPersonalFork(event)).toBe(true);
  });
});
