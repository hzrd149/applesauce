import { describe, expect, it } from "vitest";
import * as factories from "../index.js";

describe("manifest factory exports", () => {
  it("exports one concrete factory per kind", () => {
    expect(
      Object.keys(factories)
        .filter((name) => /Nsite|Napplet/.test(name))
        .sort(),
    ).toMatchInlineSnapshot(`
      [
        "NamedNappletFactory",
        "NamedNsiteFactory",
        "NappletSnapshotFactory",
        "NsiteSnapshotFactory",
        "RootNappletFactory",
        "RootNsiteFactory",
      ]
    `);
  });
});
