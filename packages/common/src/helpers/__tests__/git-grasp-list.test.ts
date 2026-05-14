import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getGitGraspServers, GIT_GRASP_LIST_KIND, isValidGitGraspList } from "../git-grasp-list.js";

const user = new FakeUser();

describe("git grasp list helpers", () => {
  it("validates grasp lists", () => {
    expect(isValidGitGraspList(user.event({ kind: GIT_GRASP_LIST_KIND }))).toBe(true);
    expect(isValidGitGraspList(user.event({ kind: 1 }))).toBe(false);
  });

  it("returns valid websocket grasp servers", () => {
    const event = user.event({
      kind: GIT_GRASP_LIST_KIND,
      tags: [
        ["g", "wss://grasp.example"],
        ["g", "ws://localhost:7334"],
        ["g", "https://grasp.example"],
        ["g", "not a url"],
      ],
    });

    expect(getGitGraspServers(event)).toEqual(["wss://grasp.example/", "ws://localhost:7334/"]);
  });
});
