import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("concord exports", () => {
  it("should export the expected symbols", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "ADMIN_PERMS",
        "Casts",
        "ConcordClient",
        "ConcordCommunity",
        "ConcordPrivateChannel",
        "ConcordRelayAuth",
        "Factories",
        "Helpers",
        "Models",
        "Operations",
        "PERM",
        "Storage",
        "VSK",
        "buildChain",
        "channelLiveAuthors",
        "planeStoreKey",
        "syncAuthors",
        "syncChannelEpochs",
        "syncEpoch",
        "syncEpochs",
      ]
    `);
  });
});
