import { describe, expect, it } from "vitest";

import { EDIT_KIND } from "../../helpers/edit.js";
import { includeEditTarget } from "../edit.js";

const blank = (kind: number) => ({ kind, content: "", tags: [] as string[][], created_at: 0 });

describe("edit operations", () => {
  it("includeEditTarget points at its target", async () => {
    const edit = await includeEditTarget("e2")(blank(EDIT_KIND));
    expect(edit.tags).toContainEqual(["e", "e2"]);
  });
});
