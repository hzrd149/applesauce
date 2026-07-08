import { describe, expect, it } from "vitest";

import { JOIN_LEAVE_KIND } from "../../helpers/guestbook.js";
import { JoinLeaveFactory } from "../guestbook.js";

describe("JoinLeaveFactory", () => {
  it("builds join with invite attribution and leave", async () => {
    const join = await JoinLeaveFactory.create("join", { invite: { creator: "c", label: "l" } });
    expect(join.content).toBe("join");
    expect(join.tags).toContainEqual(["invite", "c", "l"]);
    const leave = await JoinLeaveFactory.create("leave");
    expect(leave.content).toBe("leave");
  });

  it("chains verb/ms/invite", async () => {
    const t = await new JoinLeaveFactory((res) => res({ kind: JOIN_LEAVE_KIND, created_at: 0, tags: [], content: "" }))
      .verb("join")
      .ms(0)
      .invite("creator", "label");
    expect(t.content).toBe("join");
    expect(t.tags).toContainEqual(["invite", "creator", "label"]);
  });
});
