import { type NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { GIT_GRASP_LIST_KIND } from "../../helpers/git-grasp-list.js";
import { GitGraspListFactory } from "../git-grasp-list.js";

const HEX = (char: string, length = 64) => char.repeat(length);

describe("GitGraspListFactory", () => {
  it("builds a grasp list", async () => {
    const draft = await GitGraspListFactory.create().addServer("wss://grasp.example");

    expect(draft.kind).toBe(GIT_GRASP_LIST_KIND);
    expect(draft.tags).toEqual([["g", "wss://grasp.example/"]]);
  });

  it("modifies a grasp list", async () => {
    const existing: NostrEvent = {
      kind: GIT_GRASP_LIST_KIND,
      id: HEX("1"),
      pubkey: HEX("2"),
      sig: HEX("a", 128),
      created_at: 1,
      content: "",
      tags: [["g", "wss://old.example/"]],
    };

    const draft = await GitGraspListFactory.modify(existing).setServers(["wss://a.example", "wss://b.example"]);

    expect(draft.tags).toEqual([
      ["g", "wss://a.example/"],
      ["g", "wss://b.example/"],
    ]);
  });
});
