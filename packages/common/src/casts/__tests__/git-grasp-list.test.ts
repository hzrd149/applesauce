import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GIT_GRASP_LIST_KIND } from "../../helpers/git-grasp-list.js";
import { GitGraspList } from "../git-grasp-list.js";

const user = new FakeUser();
const store = {} as any;

describe("GitGraspList", () => {
  it("casts grasp lists", () => {
    const event = user.event({ kind: GIT_GRASP_LIST_KIND, tags: [["g", "wss://grasp.example"]] });
    const cast = new GitGraspList(event, store);

    expect(cast.servers).toEqual(["wss://grasp.example/"]);
  });
});
