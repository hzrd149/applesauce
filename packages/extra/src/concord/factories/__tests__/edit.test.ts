import { describe, expect, it } from "vitest";

import { EDIT_KIND } from "../../helpers/edit.js";
import { EditFactory } from "../edit.js";

describe("EditFactory", () => {
  it("targets a message with new content", async () => {
    const edit = await EditFactory.create("chan", 1, "target", "new text");
    expect(edit.kind).toBe(EDIT_KIND);
    expect(edit.content).toBe("new text");
    expect(edit.tags).toContainEqual(["e", "target"]);
  });
});
