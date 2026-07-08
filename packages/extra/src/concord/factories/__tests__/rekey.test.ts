import { describe, expect, it } from "vitest";

import { REKEY_KIND } from "../../helpers/rekey.js";
import { RekeyFactory, buildRekeyFactories } from "../rekey.js";

describe("RekeyFactory", () => {
  it("buildRekeyFactories chunks blobs into 3303 rumors", async () => {
    const blobs = Array.from({ length: 121 }, (_, i) => ({ locator: String(i), wrapped: "w" }));
    const factories = buildRekeyFactories(
      { scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit: "cc" },
      blobs,
    );
    expect(factories).toHaveLength(2);
    const first = await factories[0];
    expect(first.tags).toContainEqual(["chunk", "1", "2"]);
    const single = await RekeyFactory.create({ scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit: "cc" }, [], 1, 1);
    expect(single.kind).toBe(REKEY_KIND);
  });
});
