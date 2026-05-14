import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { GIT_GRASP_LIST_KIND } from "../../helpers/git-grasp-list.js";
import { addGitGraspServer, removeGitGraspServer, setGitGraspServers } from "../git-grasp-list.js";

function createDraft(tags: string[][] = []): EventTemplate {
  return { kind: GIT_GRASP_LIST_KIND, content: "", tags, created_at: unixNow() };
}

describe("git grasp list operations", () => {
  it("adds and removes grasp relay URLs", async () => {
    const added = await addGitGraspServer("wss://grasp.example")(createDraft());
    expect(added.tags).toEqual([["g", "wss://grasp.example/"]]);

    const removed = await removeGitGraspServer("wss://grasp.example/")(added);
    expect(removed.tags).toEqual([]);
  });

  it("sets grasp relay URLs", async () => {
    const draft = await setGitGraspServers(["wss://a.example", "wss://b.example"])(
      createDraft([["g", "wss://old.example"]]),
    );
    expect(draft.tags).toEqual([
      ["g", "wss://a.example/"],
      ["g", "wss://b.example/"],
    ]);
  });
});
