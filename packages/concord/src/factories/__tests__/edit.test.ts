import { describe, expect, it } from "vitest";

import { EDIT_KIND } from "../../helpers/edit.js";
import { bindToChannel } from "../../operations/channel.js";
import { checkChatBinding } from "../../helpers/chat.js";
import { EditFactory } from "../edit.js";

describe("EditFactory", () => {
  it("targets a message with new content", async () => {
    const edit = await EditFactory.create("target", "new text");
    expect(edit.kind).toBe(EDIT_KIND);
    expect(edit.content).toBe("new text");
    expect(edit.tags).toContainEqual(["e", "target"]);
  });

  it("binds to a channel via bindToChannel", async () => {
    const edit = await bindToChannel("chan", 1)(await EditFactory.create("target", "new text"));
    expect(checkChatBinding(edit.tags, "chan", 1)).toBe(true);
  });
});
