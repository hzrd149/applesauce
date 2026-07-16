import { describe, expect, it } from "vitest";

import { CONTROL_KIND } from "../../helpers/control.js";
import { EditionFactory } from "../control.js";

describe("EditionFactory", () => {
  it("builds kind 3308 rumors", async () => {
    const edition = await EditionFactory.create({ vsk: 0, eid: "eid", version: 1, content: "{}" });
    expect(edition.kind).toBe(CONTROL_KIND);
    expect(edition.tags).toContainEqual(["ev", "1"]);
  });

  it("exposes fluent edition method", async () => {
    const edition = await new EditionFactory((res) =>
      res({ kind: CONTROL_KIND, created_at: 0, tags: [], content: "" }),
    ).edition({ vsk: 0, eid: "eid", version: 1, content: "{}" });
    expect(edition.tags).toContainEqual(["ev", "1"]);
  });
});
