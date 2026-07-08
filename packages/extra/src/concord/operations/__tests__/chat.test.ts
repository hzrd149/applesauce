import { describe, expect, it } from "vitest";

import { KIND } from "../../types.js";
import {
  includeAttachments,
  includeChannelBinding,
  includeDeleteTarget,
  includeEditTarget,
  includeMs,
  includeReplyPointer,
  setReactionTarget,
} from "../chat.js";

const blank = (kind: number) => ({ kind, content: "", tags: [] as string[][], created_at: 0 });

describe("chat operations", () => {
  it("includeChannelBinding adds channel + epoch tags", async () => {
    const draft = await includeChannelBinding("chan", 3)(blank(KIND.MESSAGE));
    expect(draft.tags).toContainEqual(["channel", "chan"]);
    expect(draft.tags).toContainEqual(["epoch", "3"]);
  });

  it("includeMs adds an ms tag in [0,999]", async () => {
    const draft = await includeMs(12_345)(blank(KIND.MESSAGE));
    const ms = draft.tags.find((t) => t[0] === "ms")![1];
    expect(Number(ms)).toBe(345);
  });

  it("includeReplyPointer adds a q tag with author", async () => {
    const draft = await includeReplyPointer({ id: "abc", author: "pk" })(blank(KIND.MESSAGE));
    expect(draft.tags).toContainEqual(["q", "abc", "", "pk"]);
  });

  it("includeAttachments adds one imeta tag per attachment", async () => {
    const draft = await includeAttachments([{ url: "https://x/1", mime: "image/png" }])(blank(KIND.MESSAGE));
    const imeta = draft.tags.find((t) => t[0] === "imeta")!;
    expect(imeta).toContain("url https://x/1");
    expect(imeta).toContain("m image/png");
  });

  it("setReactionTarget adds e/p/k tags", async () => {
    const draft = await setReactionTarget({ id: "e1", author: "a1", kind: 9 })(blank(KIND.REACTION));
    expect(draft.tags).toContainEqual(["e", "e1"]);
    expect(draft.tags).toContainEqual(["p", "a1"]);
    expect(draft.tags).toContainEqual(["k", "9"]);
  });

  it("includeDeleteTarget and includeEditTarget point at their target", async () => {
    const del = await includeDeleteTarget("e1", 9)(blank(KIND.DELETE));
    expect(del.tags).toContainEqual(["e", "e1"]);
    expect(del.tags).toContainEqual(["k", "9"]);
    const edit = await includeEditTarget("e2")(blank(KIND.EDIT));
    expect(edit.tags).toContainEqual(["e", "e2"]);
  });
});
