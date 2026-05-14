import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GIT_REPOSITORY_KIND } from "../../helpers/git-repository.js";
import { GitRepository } from "../git-repository.js";

const user = new FakeUser();
const store = {} as any;
const UPSTREAM_PUBKEY = "f".repeat(64);

describe("GitRepository", () => {
  it("casts repository announcements", () => {
    const event = user.event({
      kind: GIT_REPOSITORY_KIND,
      tags: [
        ["d", "applesauce"],
        ["name", "Applesauce"],
        ["clone", "https://git.example/applesauce.git"],
        ["u", `${GIT_REPOSITORY_KIND}:${UPSTREAM_PUBKEY}:upstream-repo`, "wss://relay.example.com/"],
      ],
    });
    const cast = new GitRepository(event, store);

    expect(cast.identifier).toBe("applesauce");
    expect(cast.pointer).toEqual(expect.objectContaining({ kind: GIT_REPOSITORY_KIND, identifier: "applesauce" }));
    expect(cast.name).toBe("Applesauce");
    expect(cast.cloneUrls).toEqual(["https://git.example/applesauce.git"]);
    expect(cast.upstream).toEqual({
      kind: GIT_REPOSITORY_KIND,
      pubkey: UPSTREAM_PUBKEY,
      identifier: "upstream-repo",
      relays: ["wss://relay.example.com/"],
    });
  });
});
