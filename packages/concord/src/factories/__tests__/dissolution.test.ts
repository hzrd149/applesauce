import { describe, expect, it } from "vitest";

import { CONTROL_KIND } from "../../helpers/control.js";
import { DissolutionFactory } from "../control.js";

describe("DissolutionFactory", () => {
  it("builds kind 3308 rumors", async () => {
    const diss = await DissolutionFactory.create();
    expect(diss.kind).toBe(CONTROL_KIND);
    expect(diss.tags).toContainEqual(["vsk", "10"]);
  });

  it("exposes fluent dissolution method", async () => {
    const diss = await new DissolutionFactory((res) =>
      res({ kind: CONTROL_KIND, created_at: 0, tags: [], content: "" }),
    ).dissolution();
    expect(diss.tags).toContainEqual(["vsk", "10"]);
  });
});
