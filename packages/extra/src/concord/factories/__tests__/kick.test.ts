import { describe, expect, it } from "vitest";

import { KICK_KIND } from "../../helpers/guestbook.js";
import { KickFactory } from "../guestbook.js";

describe("KickFactory", () => {
  it("carries the vac proof", async () => {
    const kick = await KickFactory.create("member", ["eid", "1", "h"]);
    expect(kick.kind).toBe(KICK_KIND);
    expect(kick.tags).toContainEqual(["p", "member"]);
    expect(kick.tags).toContainEqual(["vac", "eid", "1", "h"]);
  });
});
